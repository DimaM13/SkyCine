import fs from 'fs';
import path from 'path';
import { spawn, execFile, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { db } from '../config/db';
import { MediaItem } from '../types';
import { ProcessController } from '../utils/process_controller';
import { logger } from './logger.service';

const execFileAsync = promisify(execFile);

export interface ContinuousHlsSession {
  sessionId: string;
  mediaId: string;
  ownerUserId?: string;
  sessionDir: string;
  process: ChildProcess;
  lastAccess: number;
  quality: string;
  audioIndex: number;
  startTime: number;
  startSegmentNumber: number;
  segmentDuration: number;
  isReady: boolean;
  latestSegmentIndex: number;
  lastRequestedSegmentIndex: number;
  isSuspended: boolean;
  _createdAt: number;
  _watcherInterval?: ReturnType<typeof setInterval>;
  _fsWatcher?: fs.FSWatcher;
}

// Маркер ТВ-клиента в sessionId. ТВ-движок включается ТОЛЬКО по нему:
// PC/Apple-сессии (без маркера) идут ровно как раньше, побайтово тот же код.
export type TvClient = 'tizen' | 'webos';

export function parseTvClient(sessionId: string): TvClient | null {
  if (sessionId.includes('_tvtizen')) return 'tizen';
  if (sessionId.includes('_tvwebos')) return 'webos';
  return null;
}

// ТВ-движок (tizen/webos, спеки Samsung 2024/2025 + LG webOS 25/26):
//  - video-copy ТОЛЬКО H.264/HEVC. VP9/AV1/MPEG-2/VC-1 в HLS-контейнере на
//    прошивках негарантированы (у Samsung VP9 — только WebM-direct, у LG VP9/AV1 —
//    только mkv/mp4/ts-direct) — поэтому транскод в H.264, а не copy;
//  - audio-copy AAC/AC3/EAC3/MP3 (декодеры DD/DD+ есть в 100% TV обеих платформ).
//    DTS/TrueHD/FLAC/Vorbis — в AAC-транскод внутри сегментов;
//  - контейнер ВСЕГДА fMP4 (Tizen 3.0+, webOS HLS v7). MPEG-TS для ТВ не отдаём.
export const TV_COPY_VIDEO: readonly string[] = ['h264', 'hevc', 'h265'];
export const TV_COPY_AUDIO: readonly string[] = ['aac', 'ac3', 'eac3', 'mp3'];

// Единый конструктор sessionId для HLS. Суффикс _m{mount} привязывает сессию к конкретному
// маунту плеера: прощальный маяк от старого маунта (StrictMode-ремонт, вторая вкладка) физически
// не может попасть в чужую живую сессию. Без mount — легаси-id, поведение как раньше.
// tvClient вшивается маркером _tvtizen/_tvwebos ПЕРЕД room/user/mount-суффиксами,
// чтобы _m{LAT} оставался в конце (на него завязаны killStaleQualityVariants и endHlsSession).
export function buildHlsSessionId(
  mediaId: string,
  quality: string,
  audioIndex: number,
  isApple: boolean,
  roomId?: string,
  userId?: string,
  mount?: string,
  tvClient?: TvClient | null,
): string {
  const deviceSuffix = isApple ? 'apple' : 'pc';
  const tvSuffix = tvClient === 'tizen' ? '_tvtizen' : tvClient === 'webos' ? '_tvwebos' : '';
  const roomSuffix = roomId ? `_r${roomId}` : '';
  const userSuffix = (roomId && userId) ? `_u${userId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8)}` : '';
  const cleanMount = (mount || '').replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
  const mountSuffix = cleanMount ? `_m${cleanMount}` : '';
  return `${mediaId}_q${quality}_a${audioIndex}_${deviceSuffix}${tvSuffix}${roomSuffix}${userSuffix}${mountSuffix}`;
}

// Предикат direct-copy видео. ТВИН логики canCopyVideo из _createContinuousHlsSession
// и getSegmentDuration — при смене белых списков менять синхронно во всех трёх местах!
// ЛОКАЛЬНЫЙ ЭКСПЕРИМЕНТ: 4K VP9 на Apple идёт напрямую (исключение убрано).
// isTv=true: только H.264/HEVC (TV_COPY_VIDEO), остальное — транскод в H.264.
export function isDirectCopyVideo(media: MediaItem, quality: string, isApple: boolean, isTv: boolean = false): boolean {
  if (quality !== 'original') return false;
  const vc = media.videoCodec?.toLowerCase() || '';
  if (isTv) return TV_COPY_VIDEO.includes(vc);
  // PC: без vp8 — Chrome MSE в MP4-контейнере VP8 не принимает (только WebM),
  // copy давал гарантированный BUFFER_APPEND_ERROR. VP8 идёт в транскод H.264.
  const pcSupportedCodecs = ['h264', 'hevc', 'h265', 'vp9', 'av1'];
  const appleSupportedCodecs = ['h264', 'hevc', 'h265', 'vp8', 'vp9'];
  const isSupportedCodec = isApple
    ? appleSupportedCodecs.includes(vc)
    : pcSupportedCodecs.includes(vc);
  return isSupportedCodec;
}

// Контейнер HLS — всегда fMP4 для всех (PC, Apple, TV). MPEG-TS удалён полностью:
// Apple AVPlayer ест fMP4 с 2016 года, hls.js и TV-прошивки — тем более.
// Единый путь: меньше веток — меньше рассинхронов плейлиста и движка.
// (История: раньше Apple h264 шёл в TS, fMP4 был только для HEVC/VP9/TV/ALAC/FLAC.)
export function shouldUseFmp4(_media: MediaItem, _isApple: boolean, _isTv: boolean = false): boolean {
  return true;
}

// Сколько сегментов обещать в VOD-плейлисте. Для copy+fmp4 muxer глотает хвостовой partial
// (проверено воспроизведением: обещанный round-хвост не производится никогда) — floor.
// Режим транскода хвост флашит — round как раньше, без изменений.
export function countPlaylistSegments(media: MediaItem, quality: string, isApple: boolean, segDuration: number, isTv: boolean = false): number {
  const duration = media.durationSeconds && media.durationSeconds > 0 ? media.durationSeconds : 7200;
  const seg = segDuration && segDuration > 0 ? segDuration : 4;
  const raw = duration / seg;
  const dropTail = isDirectCopyVideo(media, quality, isApple, isTv);
  return Math.max(1, dropTail ? Math.floor(raw) : Math.round(raw));
}

// Sliding window constants (optimized for 1GB RAM disk)
const WINDOW_AHEAD = 8;    // Max 8 segments ahead (~32 sec of video)
const WINDOW_BEHIND = 10;  // Keep 10 segments behind (~35 sec): плейхед, догоняющий префетч-фронт,
                           // не должен упираться в затёртую дыру (иначе каждый такой промах = рестарт ffmpeg)
// Байт-крышки окна (для жирного контента: 4K-ремукс даёт 20-30МБ на сегмент,
// и счётное окно в одиночку съедает полгига). Обычный контент их не замечает.
const WINDOW_BEHIND_BYTES = 96 * 1024 * 1024; // ~96МБ позади
const WINDOW_AHEAD_BYTES = 96 * 1024 * 1024;  // ~96МБ впереди

class FFmpegService {
  public static activeDirectPids = new Set<number>();
  public static registerDirectPid(pid?: number) {
    if (pid) this.activeDirectPids.add(pid);
  }
  public static unregisterDirectPid(pid?: number) {
    if (pid) this.activeDirectPids.delete(pid);
  }

  public static knownSpawnedPids = new Map<number, number>(); // pid -> spawnTimeMs
  public static registerSpawnedPid(pid?: number) {
    if (pid) this.knownSpawnedPids.set(pid, Date.now());
  }
  public static unregisterSpawnedPid(pid?: number) {
    if (pid) this.knownSpawnedPids.delete(pid);
  }

  private continuousSessions: Map<string, ContinuousHlsSession> = new Map();
  private closingSessions: Map<string, ContinuousHlsSession> = new Map();
  private sessionCreationPromises: Map<string, Promise<{ sessionId: string }>> = new Map();
  private restartDebounceMap: Map<string, number> = new Map();
  private segmentDurationCache: Map<string, number> = new Map();
  private detectedEncoder: string | null = null;

  public async getSegmentDuration(media: MediaItem, quality: string = 'original', isApple: boolean = false, isTv: boolean = false): Promise<number> {
    // Единый предикат с _createContinuousHlsSession (ТВИН убран: было два списка).
    // isTv=true: copy только H.264/HEVC, остальное — транскод с seg=4.0.
    const canCopyVideo = isDirectCopyVideo(media, quality, isApple, isTv);

    if (!canCopyVideo) {
      return 4.0;
    }

    if (this.segmentDurationCache.has(media.id)) {
      return this.segmentDurationCache.get(media.id)!;
    }

    // 1. Check if already stored in database
    if (media.segmentDuration && media.segmentDuration > 0) {
      this.segmentDurationCache.set(media.id, media.segmentDuration);
      return media.segmentDuration;
    }

    try {
      const row = db.prepare('SELECT segmentDuration FROM media_items WHERE id = ?').get(media.id) as { segmentDuration?: number } | undefined;
      if (row?.segmentDuration && row.segmentDuration > 0) {
        this.segmentDurationCache.set(media.id, row.segmentDuration);
        return row.segmentDuration;
      }
    } catch {}

    try {
      const res = await new Promise<string>((resolve) => {
        const proc = spawn('ffprobe', [
          '-v', 'error',
          '-select_streams', 'v:0',
          '-show_entries', 'packet=pts_time,flags',
          '-of', 'csv=p=0',
          '-read_intervals', '%+20',
          media.filePath
        ], { windowsHide: true });

        let stdout = '';
        proc.stdout.on('data', d => stdout += d.toString());
        proc.on('close', () => resolve(stdout));
        proc.on('error', () => resolve(''));
        setTimeout(() => {
          try { proc.kill(); } catch {}
          resolve(stdout);
        }, 3000);
      });

      const keyframes = res.split('\n')
        .filter(l => l.includes(',K'))
        .map(l => parseFloat(l.split(',')[0]))
        .filter(n => !isNaN(n));

      if (keyframes.length >= 2) {
        const diff = Math.abs(keyframes[1] - keyframes[0]);
        if (diff >= 3.5 && diff <= 15) {
          const duration = Math.round(diff * 100) / 100;
          this.segmentDurationCache.set(media.id, duration);
          try {
            db.prepare('UPDATE media_items SET segmentDuration = ? WHERE id = ?').run(duration, media.id);
          } catch {}
          logger.info('HLS', `Detected GOP interval for ${media.title || media.id}: ${duration}s (saved to database)`);
          return duration;
        } else if (diff > 0.5 && diff < 3.5) {
          const factor = Math.ceil(4.0 / diff);
          const duration = Math.round(diff * factor * 100) / 100;
          this.segmentDurationCache.set(media.id, duration);
          try {
            db.prepare('UPDATE media_items SET segmentDuration = ? WHERE id = ?').run(duration, media.id);
          } catch {}
          logger.info('HLS', `Detected frequent GOP (${diff}s), normalized segment duration for ${media.title || media.id}: ${duration}s (saved to database)`);
          return duration;
        }
      }
    } catch (e: any) {
      logger.warn('HLS', `Failed to probe keyframe interval for ${media.id}: ${e?.message || e}`);
    }

    this.segmentDurationCache.set(media.id, 4.0);
    try {
      db.prepare('UPDATE media_items SET segmentDuration = ? WHERE id = ?').run(4.0, media.id);
    } catch {}
    return 4.0;
  }

  constructor() {
    this.validateRamDisk();
    this.cleanupOrphanedTranscodes();
    // Periodically clean dead sessions & orphaned files on RAM disk every 5s
    setInterval(() => this.cleanupIdleSessions(), 5000);
  }

  private getBaseTempDir(): string {
    const tempDirSetting = db.prepare('SELECT value FROM server_settings WHERE key = ?').get('transcodeTempDir') as { value: string } | undefined;
    return tempDirSetting?.value || 'R:\\Temp';
  }

  private validateRamDisk(): void {
    const baseTempDir = this.getBaseTempDir();
    if (!fs.existsSync(baseTempDir)) {
      try {
        fs.mkdirSync(baseTempDir, { recursive: true });
        logger.info('FFMPEG', `✅ Created RAM disk temp directory: ${baseTempDir}`);
      } catch (e: any) {
        logger.warn('FFMPEG', `⚠️ RAM disk temp directory not found at ${baseTempDir}, using local fallback: ${e.message}`);
      }
    } else {
      logger.info('FFMPEG', `✅ RAM disk validated: ${baseTempDir}`);
    }
  }

  public async terminateProcess(proc: ChildProcess): Promise<void> {
    if (!proc || !proc.pid) return;
    try {
      await ProcessController.kill(proc.pid);
    } catch {}
    try {
      proc.kill('SIGKILL');
    } catch {}
  }

  // ── Sliding Window: delete old segments behind playback position ──
  private cleanupOldSegments(session: ContinuousHlsSession, currentSegmentIndex: number): void {
    const minToKeep = currentSegmentIndex - WINDOW_BEHIND;
    if (minToKeep <= session.startSegmentNumber) return;

    fs.promises.readdir(session.sessionDir).then(async (files) => {
      // 1. Счётное окно как раньше
      let purgedCount = 0;
      for (const file of files) {
        const match = file.match(/^seg_(\d+)\.(ts|m4s)$/);
        if (!match) continue;
        const idx = parseInt(match[1], 10);
        if (idx < minToKeep) {
          fs.promises.unlink(path.join(session.sessionDir, file)).catch(() => {});
          purgedCount++;
        }
      }
      // 2. Байт-крышка позади current: для жирного контента 10 файлов это полгига —
      // добираем самые старые, пока вес > CAP. Держим минимум 2 файла,
      // idx >= current не трогаем никогда. Обычный контент сюда не попадает.
      try {
        const behind: { idx: number; size: number; name: string }[] = [];
        for (const file of files) {
          const match = file.match(/^seg_(\d+)\.(ts|m4s)$/);
          if (!match) continue;
          const idx = parseInt(match[1], 10);
          if (idx < session.startSegmentNumber || idx >= currentSegmentIndex) continue;
          if (idx < minToKeep) continue; // уже удалены выше
          try {
            const st = await fs.promises.stat(path.join(session.sessionDir, file));
            behind.push({ idx, size: st.size, name: file });
          } catch {}
        }
        behind.sort((a, b) => a.idx - b.idx);
        let total = behind.reduce((s, f) => s + f.size, 0);
        let kept = behind.length;
        let byteTrimmed = 0;
        for (const f of behind) {
          if (total <= WINDOW_BEHIND_BYTES) break;
          if (kept <= 2) break;
          fs.promises.unlink(path.join(session.sessionDir, f.name)).catch(() => {});
          total -= f.size;
          kept--;
          byteTrimmed++;
        }
        if (purgedCount > 0 || byteTrimmed > 0) {
          logger.debug('HLS_CLEANUP', `Purged ${purgedCount} segments behind #${minToKeep} + ${byteTrimmed} by byte-cap for session ${session.sessionId}`);
        }
      } catch {}
    }).catch(() => {});
  }

  // Суммарный вес seg-файлов в диапазоне индексов (служебные файлы мимо).
  // Синхронный: рамдиск, ~20 stat'ов — доли миллисекунды.
  private dirBytesInRange(sessionDir: string, fromIdx: number, toIdx: number): number {
    let total = 0;
    try {
      const files = fs.readdirSync(sessionDir);
      for (const file of files) {
        const match = file.match(/^seg_(\d+)\.(ts|m4s)$/);
        if (!match) continue;
        const idx = parseInt(match[1], 10);
        if (idx < fromIdx || idx > toIdx) continue;
        try { total += fs.statSync(path.join(sessionDir, file)).size; } catch {}
      }
    } catch {}
    return total;
  }

  // ── Kernel-level FFmpeg Process Suspend (via NtSuspendProcess) ──
  private async suspendFFmpeg(session: ContinuousHlsSession): Promise<void> {
    if (session.isSuspended || !session.process?.pid || session.process.killed) return;

    session.isSuspended = true;
    const ok = await ProcessController.suspend(session.process.pid);
    if (ok) {
      const ahead = session.latestSegmentIndex - session.lastRequestedSegmentIndex;
      logger.info('HLS_THROTTLE', `⏸️ Suspended FFmpeg PID ${session.process.pid} (session ${session.sessionId}, ahead: ${ahead} segments > ${WINDOW_AHEAD})`);
    } else {
      session.isSuspended = false;
    }
  }

  // ── Kernel-level FFmpeg Process Resume (via NtResumeProcess) ──
  private async resumeFFmpeg(session: ContinuousHlsSession): Promise<void> {
    if (!session.isSuspended || !session.process?.pid || session.process.killed) {
      session.isSuspended = false;
      return;
    }

    session.isSuspended = false;
    const ok = await ProcessController.resume(session.process.pid);
    if (ok) {
      logger.info('HLS_THROTTLE', `▶️ Resumed FFmpeg PID ${session.process.pid} (session ${session.sessionId})`);
    }
  }

  // ── Immediately purge all segment files in a session directory ──
  private purgeSessionDir(sessionDir: string): void {
    fs.promises.readdir(sessionDir).then(files => {
      for (const file of files) {
        if (file.startsWith('seg_') || file === 'playlist.m3u8' || file === 'init.mp4') {
          fs.promises.unlink(path.join(sessionDir, file)).catch(() => {});
        }
      }
    }).catch(() => {});
  }

  // ── Segment Watcher: fs.watch + backup poll for instant suspend check ──
  private startSegmentWatcher(session: ContinuousHlsSession): void {
    if (session._fsWatcher) return;

    try {
      session._fsWatcher = fs.watch(session.sessionDir, (eventType, filename) => {
        if (!filename || session.isSuspended || session.process?.killed) return;

        const match = filename.match(/^seg_(\d+)\.(ts|m4s)$/);
        if (!match) return;

        const idx = parseInt(match[1], 10);
        try {
          const size = fs.statSync(path.join(session.sessionDir, filename)).size;
          if (size <= 100) return;
        } catch { return; }

        session.latestSegmentIndex = Math.max(session.latestSegmentIndex, idx);

        const ahead = session.latestSegmentIndex - session.lastRequestedSegmentIndex;
        // Байт-крышка впереди: для жирного контента 8 штук это ~200МБ — встаём раньше.
        // Обычный контент идёт счётной веткой как раньше.
        const aheadBytes = ahead > 2
          ? this.dirBytesInRange(session.sessionDir, session.lastRequestedSegmentIndex + 1, session.latestSegmentIndex)
          : 0;
        if ((ahead > WINDOW_AHEAD || aheadBytes > WINDOW_AHEAD_BYTES) && session.isReady) {
          this.suspendFFmpeg(session);
        }
      });

      session._fsWatcher.on('error', () => {});
    } catch {}

    session._watcherInterval = setInterval(() => {
      if (!session.process || session.process.killed || session.process.exitCode !== null) {
        this.stopSegmentWatcher(session);
        return;
      }

      try {
        const files = fs.readdirSync(session.sessionDir);
        let maxIdx = session.latestSegmentIndex;
        for (const file of files) {
          const match = file.match(/^seg_(\d+)\.(ts|m4s)$/);
          if (match) {
            const idx = parseInt(match[1], 10);
            if (idx > maxIdx) maxIdx = idx;
          }
        }
        session.latestSegmentIndex = maxIdx;

        const aheadInt = session.latestSegmentIndex - session.lastRequestedSegmentIndex;
        const aheadIntBytes = aheadInt > 2
          ? this.dirBytesInRange(session.sessionDir, session.lastRequestedSegmentIndex + 1, session.latestSegmentIndex)
          : 0;
        if (!session.isSuspended && (aheadInt > WINDOW_AHEAD || aheadIntBytes > WINDOW_AHEAD_BYTES) && session.isReady) {
          this.suspendFFmpeg(session);
        }
      } catch {}
    }, 2000);
  }

  private stopSegmentWatcher(session: ContinuousHlsSession): void {
    if (session._fsWatcher) {
      try { session._fsWatcher.close(); } catch {}
      session._fsWatcher = undefined;
    }
    if (session._watcherInterval) {
      clearInterval(session._watcherInterval);
      session._watcherInterval = undefined;
    }
  }

  private getFreeBytes(dir: string): number {
    try {
      const st = fs.statfsSync(dir);
      return (st.bfree || 0) * (st.bsize || 4096);
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }

  // Защита RAM-диска перед стартом сессии: мало места (<256МБ) — выгоняем самые
  // старые idle-сессии (>30с без запросов); если всё равно <128МБ — громко жалуемся
  // (тихие обрезанные сегменты хуже честной ошибки: плеер на них виснет навсегда).
  private async ensureRamDiskSpace(newSessionId: string): Promise<void> {
    const LOW_WATER = 256 * 1024 * 1024;
    const CRITICAL = 128 * 1024 * 1024;
    const IDLE_MS = 30000;
    try {
      let free = this.getFreeBytes(this.getBaseTempDir());
      if (free >= LOW_WATER) return;
      logger.warn('HLS', `💾 RAM disk low (${(free / 1048576).toFixed(0)}MB free), evicting oldest idle sessions before starting ${newSessionId}`);
      const now = Date.now();
      const idle = Array.from(this.continuousSessions.entries())
        .filter(([, s]) => now - s.lastAccess > IDLE_MS)
        .sort((a, b) => a[1].lastAccess - b[1].lastAccess);
      for (const [sId, session] of idle) {
        if (sId === newSessionId) continue;
        await this.retireSession(sId, session);
        free = this.getFreeBytes(this.getBaseTempDir());
        if (free >= LOW_WATER) break;
      }
      if (free < CRITICAL) {
        logger.error('HLS', `💾 RAM disk CRITICALLY low (${(free / 1048576).toFixed(0)}MB free)! Segments may truncate — playback will stall. Free up R:\\Temp!`);
      }
    } catch {}
  }

  private cleanupOrphanedTranscodes(): void {
    try {
      const baseTempDir = this.getBaseTempDir();
      const hlsSessionsDir = path.join(baseTempDir, 'hls_sessions');
      if (fs.existsSync(hlsSessionsDir)) {
        fs.rmSync(hlsSessionsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
        fs.mkdirSync(hlsSessionsDir, { recursive: true });
        logger.info('FFMPEG', `🧹 Cleaned up old HLS transcode sessions at ${hlsSessionsDir}`);
      }
    } catch (e: any) {
      logger.warn('FFMPEG', `Initial cleanup notice: ${e.message}`);
    }
  }

  public async detectHardwareEncoder(): Promise<string> {
    if (this.detectedEncoder) return this.detectedEncoder;

    const setting = db.prepare('SELECT value FROM server_settings WHERE key = ?').get('transcodeHardware') as { value: string } | undefined;
    const preference = setting?.value || 'auto';

    if (preference !== 'auto' && preference !== 'cpu') {
      this.detectedEncoder = preference === 'nvenc' ? 'h264_nvenc' : preference === 'qsv' ? 'h264_qsv' : preference === 'amf' ? 'h264_amf' : 'libx264';
      logger.info('FFMPEG', `Using user configured video encoder: ${this.detectedEncoder}`);
      return this.detectedEncoder;
    }

    const encodersToTest = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'];
    for (const enc of encodersToTest) {
      const works = await this.testEncoder(enc);
      if (works) {
        this.detectedEncoder = enc;
        logger.info('FFMPEG', `Hardware encoder detected & verified: ${enc}`);
        return enc;
      }
    }

    this.detectedEncoder = 'libx264';
    logger.info('FFMPEG', 'Fallback to software CPU video encoder: libx264');
    return this.detectedEncoder;
  }

  private testEncoder(encoderName: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('ffmpeg', ['-f', 'lavfi', '-i', 'nullsrc=s=64x64:d=0.1', '-c:v', encoderName, '-f', 'null', '-']);
      FFmpegService.registerSpawnedPid(proc.pid);
      proc.on('close', (code) => {
        FFmpegService.unregisterSpawnedPid(proc.pid);
        resolve(code === 0);
      });
      proc.on('error', () => {
        FFmpegService.unregisterSpawnedPid(proc.pid);
        resolve(false);
      });
    });
  }

  public async startContinuousHlsSession(
    media: MediaItem,
    quality: string = 'original',
    audioIndex: number = 0,
    startTime: number = 0,
    isApple: boolean = false,
    sessionIdOverride?: string,
    ownerUserId?: string,
    tvClient?: TvClient | null,
  ): Promise<{ sessionId: string }> {
    const isTv = tvClient === 'tizen' || tvClient === 'webos';
    const segDuration = await this.getSegmentDuration(media, quality, isApple, isTv);
    const cleanStartTime = Math.max(0, Math.floor(startTime));
    const deviceSuffix = isApple ? 'apple' : 'pc';
    const sessionId = sessionIdOverride || `${media.id}_q${quality}_a${audioIndex}_${deviceSuffix}`;

    // 0. Смена качества (original <-> transcode, ручная или авто-фолбэк) даёт ДРУГОЙ
    // sessionId — старая сессия того же плеера (тот же mount) сама не умрёт и будет
    // висеть жирным грузом до idle-таймаута. Убиваем такие stale-варианты ЖЁСТКО
    // (процесс + папка + проверка) ДО старта новой сессии.
    await this.killStaleQualityVariants(media.id, sessionId);

    // 1. Check if session creation is already in flight
    const inFlight = this.sessionCreationPromises.get(sessionId);
    if (inFlight) {
      logger.debug('HLS', `Session creation in-flight for ${sessionId}, awaiting existing promise...`);
      return inFlight;
    }

    // 2. Check if an existing session covers this position.
    // Сессия с АВАРИЙНО умершим процессом (не EOF с кодом 0 — такие досчитали файл и раздают
    // сегменты с диска) никогда не переиспользуется — пересоздаём.
    let existing = this.continuousSessions.get(sessionId);
    if (existing && this.isProcessCrashed(existing)) {
      logger.info('HLS', `Dead session object [${sessionId}] found (process crashed), dropping and recreating`);
      this.continuousSessions.delete(sessionId);
      existing = undefined;
    }
    if (existing && existing.process && !existing.process.killed) {
      existing.lastAccess = Date.now();
      const currentStart = existing.startTime;
      const currentLatestTime = existing.latestSegmentIndex * segDuration;

      // When seeking BACKWARD (cleanStartTime < currentStart or cleanStartTime < currentLatestTime - segDuration) OR out of forward range,
      // restart FFmpeg immediately to eliminate any lag or hangs!
      const isSeekingBackward = cleanStartTime < currentStart || cleanStartTime < currentLatestTime - segDuration;
      const forwardLimit = currentStart + (WINDOW_AHEAD * segDuration);
      const isWithinForwardWindow = !isSeekingBackward && cleanStartTime >= currentStart && cleanStartTime <= forwardLimit;

      if (isWithinForwardWindow) {
        logger.debug('HLS', `Reusing existing session ${sessionId}: requested=${cleanStartTime}s is within window [${currentStart}s..${forwardLimit}s]`);
        return { sessionId };
      }

      // Position changed (seek backward or far forward): HARD retire existing session
      // and only then create a new one — the old dir must be gone from disk first,
      // иначе жирные сессии копятся и забивают 1ГБ RAM-диск. Concurrent requests
      // ждут тот же промис (без дублей ffmpeg).
      logger.info('HLS', `🔄 Restarting session ${sessionId} for seek to ${cleanStartTime}s (prev start: ${currentStart}s, latest produced: ${currentLatestTime}s)`);
      const restartPromise = (async () => {
        await this.retireSession(sessionId, existing);
        return this._createContinuousHlsSession(media, quality, audioIndex, cleanStartTime, isApple, sessionId, deviceSuffix, segDuration, ownerUserId, false, tvClient);
      })();
      this.sessionCreationPromises.set(sessionId, restartPromise);
      try {
        return await restartPromise;
      } finally {
        this.sessionCreationPromises.delete(sessionId);
      }
    }

    const promise = this._createContinuousHlsSession(media, quality, audioIndex, cleanStartTime, isApple, sessionId, deviceSuffix, segDuration, ownerUserId, false, tvClient);
    this.sessionCreationPromises.set(sessionId, promise);

    try {
      return await promise;
    } finally {
      this.sessionCreationPromises.delete(sessionId);
    }
  }

  // Ждём реального завершения процесса (иначе Windows держит хендлы файлов
  // и удаление папки молча падает, оставляя сотни мегабайт мусора).
  private waitForExit(proc: ChildProcess, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      try {
        const p = proc as any;
        const done = () => !proc || !proc.pid || p.killed || p.exitCode !== null || p.signalCode !== null;
        if (done()) return resolve();
        const t0 = Date.now();
        const iv = setInterval(() => {
          if (done() || Date.now() - t0 > timeoutMs) {
            clearInterval(iv);
            resolve();
          }
        }, 50);
      } catch {
        resolve();
      }
    });
  }

  private dirSizeBytes(dir: string): number {
    try {
      let total = 0;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        try { total += fs.statSync(path.join(dir, file)).size; } catch {}
      }
      return total;
    } catch {
      return 0;
    }
  }

  // Stale-варианты качества одного плеера: тот же mediaId + тот же mount-суффикс,
  // но другой sessionId (другое quality/audio/device). Убиваются жёстко перед
  // стартом новой сессии, иначе переживают её и забивают RAM-диск.
  // Без mount (легаси) не трогаем: там id общий на вкладки.
  private async killStaleQualityVariants(mediaId: string, keepSessionId: string): Promise<void> {
    try {
      const mountMatch = keepSessionId.match(/_m([A-Za-z0-9]{1,8})$/);
      if (!mountMatch) return;
      const mountSuffix = `_m${mountMatch[1]}`;
      const kills: Promise<void>[] = [];
      for (const [sId, session] of Array.from(this.continuousSessions.entries())) {
        if (sId === keepSessionId) continue;
        if (session.mediaId !== mediaId) continue;
        if (!sId.endsWith(mountSuffix)) continue;
        logger.info('HLS', `🔄 Quality switch: retiring stale variant ${sId} before starting ${keepSessionId}`);
        kills.push(this.retireSession(sId, session));
      }
      await Promise.all(kills);
    } catch {}
  }

  private async retireSession(sessionId: string, session: ContinuousHlsSession): Promise<void> {
    try {
      this.stopSegmentWatcher(session);
      if (session.isSuspended) {
        session.isSuspended = false;
        this.resumeFFmpeg(session).catch(() => {});
      }

      const closingId = `${sessionId}_closing_${Date.now()}`;
      const dirToDelete = session.sessionDir;
      this.closingSessions.set(closingId, session);
      this.continuousSessions.delete(sessionId);

      logger.info('HLS', `Retiring session ${sessionId}, terminating process PID ${session.process?.pid}`);
      await this.terminateProcess(session.process);
      // Жёстко: процесс мёртв + папка удалена + место проверено — только потом дальше.
      await this.waitForExit(session.process, 3000);

      this.closingSessions.delete(closingId);
      this.purgeSessionDir(dirToDelete);
      try {
        await fs.promises.rm(dirToDelete, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch {}
      try {
        const leftover = this.dirSizeBytes(dirToDelete);
        if (leftover > 0) {
          logger.error('HLS', `⚠️ Session dir NOT fully deleted: ${dirToDelete} (${(leftover / 1048576).toFixed(1)}MB left, likely locked handles)`);
        }
      } catch {}
    } catch {}
  }

  public async warmupFile(filePath: string): Promise<void> {
    const start = Date.now();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await fs.promises.stat(filePath);
        const elapsed = Date.now() - start;
        if (elapsed > 1500) {
          logger.info('HDD', `⏳ External disk wakeup took ${elapsed}ms for ${path.basename(filePath)}`);
        }
        return;
      } catch {
        await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
      }
    }
  }

  private async _createContinuousHlsSession(
    media: MediaItem,
    quality: string,
    audioIndex: number,
    cleanStartTime: number,
    isApple: boolean,
    sessionId: string,
    deviceSuffix: string,
    segDuration: number,
    ownerUserId?: string,
    isRetry: boolean = false,
    tvClient?: TvClient | null,
  ): Promise<{ sessionId: string }> {
    const isTv = tvClient === 'tizen' || tvClient === 'webos';
    const tvLabel = tvClient === 'tizen' ? 'Tizen TV' : tvClient === 'webos' ? 'webOS TV' : '';
    await this.warmupFile(media.filePath);

    const baseTempDir = this.getBaseTempDir();
    const uniqueId = Date.now().toString() + '_' + Math.random().toString(36).substring(7);
    const sessionDir = path.join(baseTempDir, 'hls_sessions', `${sessionId}_${uniqueId}`);

    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    // RAM-диск 1ГБ: 4 жирные сессии (по ~170МБ) забивают его целиком, и новым
    // (особенно транскоду, который пишет непрерывно) некуда писаться.
    // Проверяем место ДО старта и выгоняем старые idle-сессии.
    await this.ensureRamDiskSpace(sessionId);

    const ffmpegSessionDir = sessionDir.replace(/\\/g, '/');
    const encoder = await this.detectHardwareEncoder();

    const startNumber = Math.floor(cleanStartTime / segDuration);
    const alignedStartTime = startNumber * segDuration;

    const args: string[] = [
      '-loglevel', 'error',
      '-err_detect', 'ignore_err',
      '-fflags', '+genpts+discardcorrupt+nobuffer',
    ];

    // Fast seek: at 0s force clean 0.000s start; for >0s preserve timestamps with -copyts for perfect A/V sync
    if (cleanStartTime === 0) {
      args.push('-noaccurate_seek', '-ss', '0');
    } else {
      args.push('-noaccurate_seek', '-ss', alignedStartTime.toString(), '-copyts');
    }
    args.push('-i', media.filePath);

    args.push('-map', '0:v:0');
    if (audioIndex > 0) {
      args.push('-map', `0:${audioIndex}`);
    } else {
      args.push('-map', '0:a:0?');
    }

    // Видео: единый предикат (ТВИН убран). ТВ: copy только H.264/HEVC,
    // VP9/AV1/MPEG-2/VC-1 — в HLS-контейнере на прошивках негарантированы,
    // поэтому транскод в H.264 (PC/Apple-ветки не тронуты).
    const canCopyVideo = isDirectCopyVideo(media, quality, isApple, isTv);

    let trackAudioCodec = media.audioCodec?.toLowerCase() || '';
    let trackChannels = 2;
    if (audioIndex > 0) {
      try {
        const track = db.prepare('SELECT codec, channels FROM media_tracks WHERE mediaItemId = ? AND streamIndex = ?').get(media.id, audioIndex) as { codec: string; channels: number } | undefined;
        if (track?.codec) trackAudioCodec = track.codec.toLowerCase();
        if (track?.channels) trackChannels = track.channels;
      } catch {}
    } else {
      try {
        const track = db.prepare('SELECT codec, channels FROM media_tracks WHERE mediaItemId = ? AND type = "AUDIO" ORDER BY isDefault DESC, streamIndex ASC LIMIT 1').get(media.id) as { codec: string; channels: number } | undefined;
        if (track?.codec) trackAudioCodec = track.codec.toLowerCase();
        if (track?.channels) trackChannels = track.channels;
      } catch {}
    }

    // Аудио: ТВ копирует AAC/AC3/EAC3/MP3 (декодеры DD/DD+ есть в 100% TV).
    // DTS/TrueHD/FLAC/Vorbis — в AAC-транскод внутри сегментов (ремукс удалён).
    // Apple: +FLAC passthrough (Safari ест FLAC; контейнер форсится в fMP4 выше).
    // PC/Apple-ветки иначе не тронуты.
    const appleAudio = ['aac', 'ac3', 'eac3', 'mp3', 'alac', 'opus', 'flac'];
    const pcAudio = ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'wav'];
    const isAppleNativeAudio = appleAudio.some(c => trackAudioCodec.includes(c));
    const isPcNativeAudio = pcAudio.some(c => trackAudioCodec.includes(c));
    const isTvNativeAudio = TV_COPY_AUDIO.some(c => trackAudioCodec.includes(c));
    const canCopyAudio = isTv ? isTvNativeAudio : (isApple ? isAppleNativeAudio : isPcNativeAudio);

    // Контейнер всегда fMP4 (shouldUseFmp4() === true для всех): MPEG-TS удалён,
    // отдельной ветки больше нет — единый путь для PC/Apple/TV.
    const audioBitrate = trackChannels >= 6 ? '512k' : '320k';
    const transAudioLabel = !isTv && isApple && trackChannels >= 6 ? 'AC3 640k' : `AAC ${audioBitrate}`;
    logger.info('HLS', `🎬 Starting session [${sessionId}] (${isTv ? tvLabel : (isApple ? 'Apple/iOS' : 'PC/Android')}): ` +
      `File="${path.basename(media.filePath)}" (DB Dur=${media.durationSeconds || 0}s), ` +
      `Video=${media.videoCodec} (${canCopyVideo ? 'DIRECT COPY' : `TRANSCODE ${encoder}`}), ` +
      `Audio=${trackAudioCodec || 'default'} [${trackChannels}ch] (${canCopyAudio ? 'DIRECT COPY' : transAudioLabel}), ` +
      `StartPos=${cleanStartTime}s (seg #${startNumber}, ${alignedStartTime}s), segDuration=${segDuration}s, Container=fMP4`);

    if (canCopyVideo) {
      args.push('-c:v', 'copy');
    } else {
      args.push('-c:v', encoder);
      if (encoder === 'h264_nvenc') {
        args.push('-preset', 'p1', '-tune', 'ull', '-cq', '19', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', '48', '-keyint_min', '48');
      } else {
        args.push('-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', '48', '-keyint_min', '48');
      }

      if (quality === '720p') {
        args.push('-vf', 'format=yuv420p,scale=-2:720', '-b:v', '3500k');
      } else if (quality === '480p') {
        args.push('-vf', 'format=yuv420p,scale=-2:480', '-b:v', '1800k');
      } else if (quality === '1080p') {
        args.push('-vf', 'format=yuv420p,scale=-2:1080', '-b:v', '8000k');
      } else {
        args.push('-vf', 'format=yuv420p');
      }
    }

    if (canCopyAudio) {
      args.push('-c:a', 'copy');
    } else {
      if (isApple && trackChannels >= 6) {
        args.push('-c:a', 'ac3', '-b:a', '640k');
      } else if (trackChannels >= 6) {
        args.push('-c:a', 'aac', '-b:a', '512k', '-af', 'aformat=channel_layouts=5.1');
      } else {
        args.push('-c:a', 'aac', '-b:a', '320k');
      }
    }

    args.push(
      '-muxdelay', '0',
      '-muxpreload', '0',
      ...(cleanStartTime > 0 ? ['-avoid_negative_ts', 'disabled'] : ['-avoid_negative_ts', 'make_zero']),
      '-f', 'hls',
      '-hls_time', segDuration.toString(),
      '-hls_list_size', '0',
      '-hls_playlist_type', 'event',
      '-hls_flags', 'independent_segments+temp_file',
      '-start_number', startNumber.toString()
    );

    // fMP4 для всех (MPEG-TS удалён): init + сегменты .m4s.
    args.push(
      '-hls_segment_type', 'fmp4',
      '-hls_fmp4_init_filename', 'init.mp4',
      '-hls_segment_filename', `${ffmpegSessionDir}/seg_%04d.m4s`
    );

    args.push(`${ffmpegSessionDir}/playlist.m3u8`);

    logger.debug('FFMPEG_CMD', `[${sessionId}] ffmpeg ${args.join(' ')}`);

    const proc = spawn('ffmpeg', args, { windowsHide: true });
    FFmpegService.registerSpawnedPid(proc.pid);

    const sessionObj: ContinuousHlsSession = {
      sessionId,
      mediaId: media.id,
      ownerUserId,
      sessionDir,
      process: proc,
      lastAccess: Date.now(),
      quality,
      audioIndex,
      startTime: cleanStartTime,
      startSegmentNumber: startNumber,
      segmentDuration: segDuration,
      isReady: false,
      latestSegmentIndex: startNumber,
      lastRequestedSegmentIndex: startNumber,
      isSuspended: false,
      _createdAt: Date.now(),
    };

    this.continuousSessions.set(sessionId, sessionObj);
    this.startSegmentWatcher(sessionObj);

    const lastStderrLines: string[] = [];
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        lastStderrLines.push(line);
        if (lastStderrLines.length > 40) lastStderrLines.shift();
        if (/error|failed|invalid|corrupt|cannot|non-monotonous|no space left|enospace|enospc|disk full|No space/i.test(line)) {
          logger.warn('FFMPEG_STDERR', `[${sessionId}] ${line}`);
        }
      }
    });

    proc.on('error', (err) => {
      FFmpegService.unregisterSpawnedPid(proc.pid);
      logger.error('HLS', `Session [${sessionId}] process spawn/runtime error:`, err);
    });

    proc.on('close', (code) => {
      FFmpegService.unregisterSpawnedPid(proc.pid);
      const elapsedSec = ((Date.now() - sessionObj._createdAt) / 1000).toFixed(1);
      if (code === 0 || code === null || code === 4294967295 || proc.killed) {
        logger.info('HLS', `Session [${sessionId}] process exited cleanly or retired (code: ${code}, active: ${elapsedSec}s)`);
      } else {
        logger.error('HLS', `Session [${sessionId}] process exited with error code ${code} (active: ${elapsedSec}s). Recent stderr:`, {
          lastStderr: lastStderrLines.slice(-10)
        });
      }
    });

    // Wait until first segment is ready (всегда fMP4: seg_*.m4s + init.mp4).
    const startNumStr = startNumber.toString().padStart(4, '0');
    const firstSegPath = path.join(sessionDir, `seg_${startNumStr}.m4s`);

    const maxWaitMs = 12000;
    const startWait = Date.now();

    while (Date.now() - startWait < maxWaitMs) {
      if (proc.killed || proc.exitCode !== null || proc.signalCode !== null || !this.continuousSessions.has(sessionId)) {
        break;
      }

      try {
        const stats = await fs.promises.stat(firstSegPath);
        if (stats.size > 100) {
          sessionObj.isReady = true;
          logger.info('HLS', `⚡ Session ready [${sessionId}] first segment produced in ${Date.now() - startWait}ms (${(stats.size / 1024).toFixed(1)} KB)`);
          break;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 20));
    }

    if (!sessionObj.isReady) {
      const isDead = proc.killed || proc.exitCode !== null || proc.signalCode !== null;
      const waitedMs = Date.now() - startWait;
      // Честно различаем «сессию убили во время старта» и «ffmpeg реально тупил 12с»
      logger.error('HLS', `⚠️ First segment not ready for [${sessionId}] (waited ${waitedMs}ms, ${isDead ? `process gone with code ${proc.exitCode}` : 'process alive but silent — likely killed mid-startup or stalled input'}). Last stderr:`, {
        lastStderr: lastStderrLines.slice(-10)
      });

      // Self-healing: if process unexpectedly died and this is not already a retry, restart once immediately
      if (isDead && !isRetry) {
        logger.warn('HLS', `🔄 Self-healing: restarting session [${sessionId}] after unexpected process exit`);
        await this.retireSession(sessionId, sessionObj);
        return this._createContinuousHlsSession(media, quality, audioIndex, cleanStartTime, isApple, sessionId, deviceSuffix, segDuration, ownerUserId, true, tvClient);
      }
    }

    sessionObj.isReady = true;
    return { sessionId };
  }

  public hasSession(sessionId: string): boolean {
    return this.continuousSessions.has(sessionId) || this.closingSessions.has(sessionId);
  }

  public generateVodPlaylist(media: MediaItem, sessionId: string, token?: string, startTime: number = 0, segDuration: number = 4): string {
    const duration = media.durationSeconds && media.durationSeconds > 0 ? media.durationSeconds : 7200;
    const segmentDuration = segDuration && segDuration > 0 ? segDuration : 4;
    const isApple = sessionId.includes('_apple');
    const tvClient = parseTvClient(sessionId);
    const isTv = tvClient !== null;
    const quality = sessionId.match(/_q([a-zA-Z0-9]+)_/)?.[1] || 'original';
    const totalSegments = countPlaylistSegments(media, quality, isApple, segmentDuration, isTv);

    // Всегда fMP4 (MPEG-TS удалён): VERSION 7 + MAP + сегменты .m4s для всех.
    const ext = '.m4s';

    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';

    let m3u8 = `#EXTM3U\n`;
    m3u8 += `#EXT-X-VERSION:7\n`;
    // ТВ-прошивки: EXT-X-INDEPENDENT-SEGMENTS в списке "Not supported" у LG webOS
    // (строгий парсер может отвергнуть плейлист) — для ТВ-сессий не эмитим.
    // Сегменты при этом реально независимые (ffmpeg -hls_flags independent_segments,
    // GOP 48, keyint_min 48). PC/Apple (hls.js/AVPlayer) — как раньше.
    if (!isTv) {
      m3u8 += `#EXT-X-INDEPENDENT-SEGMENTS\n`;
    }
    m3u8 += `#EXT-X-TARGETDURATION:${Math.ceil(segmentDuration)}\n`;
    // MEDIA-SEQUENCE константа 0 + single rendition (без STREAM-INF/MEDIA):
    // требование webOS "sequence совпадает по rendition" выполнено тривиально,
    // отдельный CODECS не нужен (нет multivariant).
    m3u8 += `#EXT-X-MEDIA-SEQUENCE:0\n`;
    m3u8 += `#EXT-X-PLAYLIST-TYPE:VOD\n`;

    if (startTime > 0) {
      m3u8 += `#EXT-X-START:TIME-OFFSET=${startTime.toFixed(3)},PRECISE=YES\n`;
    }

    m3u8 += `#EXT-X-MAP:URI="/api/stream/hls/session/${sessionId}/init.mp4${tokenParam}"\n`;

    for (let i = 0; i < totalSegments; i++) {
      const numStr = i.toString().padStart(4, '0');
      m3u8 += `#EXTINF:${segmentDuration.toFixed(6)},\n`;
      m3u8 += `/api/stream/hls/session/${sessionId}/seg_${numStr}${ext}${tokenParam}\n`;
    }

    m3u8 += `#EXT-X-ENDLIST\n`;

    logger.info('HLS', `📋 Playlist generated [${sessionId}]: duration=${duration}s (${Math.floor(duration / 60)}m ${Math.floor(duration % 60)}s), segments=${totalSegments}, segDuration=${segmentDuration}s, startOffset=${startTime}s, type=${ext}${isTv ? `, tv=${tvClient}` : ''}`);
    return m3u8;
  }

  public async ensureSegmentReady(sessionId: string, segmentName: string, media: MediaItem): Promise<string | null> {
    const isInit = segmentName === 'init.mp4';
    let segmentIndex = 0;

    if (!isInit) {
      const match = segmentName.match(/seg_(\d+)\.(ts|m4s)/);
      if (!match) return null;
      segmentIndex = parseInt(match[1], 10);
    }

    // 1. If creation is in flight, await it
    const inFlight = this.sessionCreationPromises.get(sessionId);
    if (inFlight) {
      await inFlight;
    }

    let session = this.continuousSessions.get(sessionId);
    const segDuration = session?.segmentDuration || 4;

    // Единый подсчёт с плейлистом (floor для copy+fmp4 — хвостового фантома в нём уже нет).
    // ТВ-маркер тянем из sessionId, иначе seek-рестарт ТВ-сессии потерял бы ТВ-движок
    // (segDuration/длина плейлиста разъехались бы: PC-copy vs TV-transcode).
    const guardQuality = sessionId.match(/_q([a-zA-Z0-9]+)_/)?.[1] || 'original';
    const guardIsApple = sessionId.includes('_apple');
    const guardIsTv = parseTvClient(sessionId) !== null;
    const totalSegments = countPlaylistSegments(media, guardQuality, guardIsApple, segDuration, guardIsTv);
    // Reject segments past the end of the media duration immediately (zero timeout)
    if (!isInit && segmentIndex >= totalSegments) {
      logger.debug('HLS', `Rejecting segment beyond duration [${sessionId}] seg_${segmentIndex} >= ${totalSegments}`);
      return null;
    }

    // 2. If session exists, deliver segment or resume
    if (session) {
      // Процесс аварийно умер — не ждём 6с впустую, сразу 404: плеер перечитает master.m3u8
      // и сессия пересоздастся. Чистый EOF (код 0) идёт обычным путём — сегменты на диске.
      if (!isInit && this.isProcessCrashed(session)) {
        logger.warn('HLS', `Session process crashed [${sessionId}], dropping entry so next request recreates it`);
        this.continuousSessions.delete(sessionId);
        return null;
      }
      // Хвостовой фантом (остаточный риск): запрошен ПОСЛЕДНИЙ сегмент плейлиста, а ffmpeg уже
      // завершён — файл не появится никогда. Короткая пауза на гонку дискового флаша и сразу
      // 404 вместо 6.5с ступора. Живой процесс ждёт обычным путём ниже.
      if (!isInit && segmentIndex === totalSegments - 1 && this.isProcessFinished(session)) {
        const tailFound = await this.waitForSegment(session.sessionDir, segmentName, sessionId, 12);
        if (!tailFound) {
          logger.warn('HLS', `Tail phantom [${sessionId}] ${segmentName}: process finished, segment will never appear (fast 404)`);
          return null;
        }
      }
      if (!isInit) {
        session.lastRequestedSegmentIndex = Math.max(session.lastRequestedSegmentIndex, segmentIndex);
      }

      const segPath = path.join(session.sessionDir, segmentName);
      if (fs.existsSync(segPath) && fs.statSync(segPath).size > 100) {
        session.lastAccess = Date.now();
        session.latestSegmentIndex = Math.max(session.latestSegmentIndex, segmentIndex);

        if (!isInit) {
          this.cleanupOldSegments(session, segmentIndex);
        }

        if (!session.isSuspended && !isInit) {
          const ahead = session.latestSegmentIndex - session.lastRequestedSegmentIndex;
          const aheadBytes = ahead > 2
            ? this.dirBytesInRange(session.sessionDir, session.lastRequestedSegmentIndex + 1, session.latestSegmentIndex)
            : 0;
          if (ahead > WINDOW_AHEAD || aheadBytes > WINDOW_AHEAD_BYTES) {
            this.suspendFFmpeg(session);
          }
        }

        logger.debug('HLS', `⚡ Segment HIT [${sessionId}] ${segmentName} (${(fs.statSync(segPath).size / 1024).toFixed(1)} KB)`);
        return segPath;
      }

      if (isInit) {
        return this.waitForSegment(session.sessionDir, segmentName, sessionId);
      }

      // Resume if suspended and buffer is low (ahead <= 4). Байтовая половина порога —
      // гистерезис: иначе на жирном контенте будет дёргаться suspend/resume на каждом запросе.
      // Обычный контент идёт счётной веткой как раньше.
      if (session.isSuspended) {
        const ahead = session.latestSegmentIndex - segmentIndex;
        const aheadBytes = ahead > 2
          ? this.dirBytesInRange(session.sessionDir, segmentIndex + 1, session.latestSegmentIndex)
          : 0;
        if (ahead <= 4 && aheadBytes <= WINDOW_AHEAD_BYTES / 2) {
          await this.resumeFFmpeg(session);
        }
      }

      // Промах чуть позади фронта (догоняющий плейхед / rename-гонка temp_file / бут-лаг
      // после рестарта): сессию НЕ убиваем — короткое ожидание (0.5с) и перепроверка.
      // Далёкие прыжки назад падают ниже в обычный seek-restart как раньше.
      if (segmentIndex >= session.latestSegmentIndex - WINDOW_BEHIND && segmentIndex < session.latestSegmentIndex) {
        const catchUp = await this.waitForSegment(session.sessionDir, segmentName, sessionId, 5);
        if (catchUp) {
          session.lastAccess = Date.now();
          session.latestSegmentIndex = Math.max(session.latestSegmentIndex, segmentIndex);
          this.cleanupOldSegments(session, segmentIndex);
          return catchUp;
        }
      }

      // If segment is currently being produced forward by active FFmpeg (latestSegmentIndex <= segmentIndex <= latestSegmentIndex + 20), wait for it
      if (segmentIndex >= session.latestSegmentIndex && segmentIndex <= session.latestSegmentIndex + 20) {
        const waitStart = Date.now();
        const foundPath = await this.waitForSegment(session.sessionDir, segmentName, sessionId);
        if (foundPath) {
          logger.info('HLS', `Segment READY [${sessionId}] ${segmentName} generated in ${Date.now() - waitStart}ms`);
          session.latestSegmentIndex = Math.max(session.latestSegmentIndex, segmentIndex);
          this.cleanupOldSegments(session, segmentIndex);
          return foundPath;
        } else {
          logger.error('HLS', `Segment TIMEOUT [${sessionId}] ${segmentName} not ready after ${Date.now() - waitStart}ms (latest produced is seg_${session.latestSegmentIndex})`);
          return null;
        }
      }

      // If segment is in a closing session (recent transcode), reuse it
      for (const [, closing] of this.closingSessions) {
        if (closing.mediaId !== media.id) continue;
        const closingPath = path.join(closing.sessionDir, segmentName);
        if (fs.existsSync(closingPath) && fs.statSync(closingPath).size > 100) {
          logger.info('HLS', `Reusing segment [${sessionId}] ${segmentName} from recent closing session`);
          return closingPath;
        }
      }

      // Handle seeking (backward or far forward): The requested segment is outside the active session's window.
      // Immediately start a fresh session at the requested segment's timestamp!
      // ТВ-маркер пробрасываем, иначе рестарт сбросит ТВ-движок на PC-правила.
      const targetStartTime = segmentIndex * segDuration;
      const isApple = sessionId.includes('_apple');
      const tvClient = parseTvClient(sessionId);
      const qualityMatch = sessionId.match(/_q([a-zA-Z0-9]+)_/);
      const audioMatch = sessionId.match(/_a(\d+)_/);
      const quality = qualityMatch ? qualityMatch[1] : 'original';
      const audioIndex = audioMatch ? parseInt(audioMatch[1], 10) : 0;

      logger.info('HLS', `⚡ Seek detected [${sessionId}] to segment #${segmentIndex} (${targetStartTime}s). Active window latest is #${session.latestSegmentIndex}. Re-starting session at ${targetStartTime}s`);
      await this.startContinuousHlsSession(media, quality, audioIndex, targetStartTime, isApple, sessionId, session.ownerUserId, tvClient);

      const activeSession = this.continuousSessions.get(sessionId);
      if (activeSession) {
        return this.waitForSegment(activeSession.sessionDir, segmentName, sessionId);
      }

      logger.error('HLS', `Failed to start active session for seek to segment #${segmentIndex} on ${sessionId}`);
      return null;
    }

    // 3. Strict Anti-Ghosting Rule:
    // If NO session exists and this is a segment request (not init.mp4), return NULL (404).
    if (!isInit) {
      logger.warn('HLS', `Anti-ghosting: rejecting segment ${segmentName} for non-existent session ${sessionId} (404)`);
      return null;
    }

    return null;
  }

  // Аварийно умерший процесс: вышел с ненулевым кодом (кроме виндового кода ретайра),
  // убит сигналом или kill(). Чистое завершение в EOF (код 0) — НЕ смерть: файл досчитан,
  // сегменты на диске и раздаются дальше.
  private isProcessCrashed(session: ContinuousHlsSession): boolean {
    const proc = session.process as any;
    if (!proc) return false;
    if (proc.killed) return true;
    if (proc.signalCode !== null && proc.signalCode !== undefined) return true;
    if (proc.exitCode !== null && proc.exitCode !== undefined && proc.exitCode !== 0 && proc.exitCode !== 4294967295) return true;
    return false;
  }

  public async killSession(sessionId: string): Promise<void> {
    const session = this.continuousSessions.get(sessionId);
    if (session) {
      logger.info('HLS', `🛑 Kill requested for session: ${sessionId}`);
      await this.retireSession(sessionId, session);
    }
  }

  public async killSessionsForRoom(roomId: string): Promise<void> {
    const kills: Promise<void>[] = [];
    for (const [sId, session] of Array.from(this.continuousSessions.entries())) {
      if (sId.includes(`_r${roomId}`)) {
        logger.info('HLS', `🧹 Cleaning up session for empty room ${roomId}: ${sId}`);
        kills.push(this.retireSession(sId, session));
      }
    }
    await Promise.all(kills);
  }

  public async killUserSessionInRoom(roomId: string, userId: string): Promise<void> {
    const userClean = userId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
    const kills: Promise<void>[] = [];
    for (const [sId, session] of Array.from(this.continuousSessions.entries())) {
      if (sId.includes(`_r${roomId}`) && sId.includes(`_u${userClean}`)) {
        logger.info('HLS', `🛑 Killing room session for departed user ${userId}: ${sId}`);
        kills.push(this.retireSession(sId, session));
      }
    }
    await Promise.all(kills);
  }

  public async killSoloSessionsForMedia(mediaId: string): Promise<void> {
    const kills: Promise<void>[] = [];
    for (const [sId, session] of Array.from(this.continuousSessions.entries())) {
      if (session.mediaId === mediaId && !sId.includes('_r')) {
        logger.info('HLS', `🛑 Killing solo session for media ${mediaId}: ${sId}`);
        kills.push(this.retireSession(sId, session));
      }
    }
    await Promise.all(kills);
  }

  // Чистка соло-сессий юзера, у которого не осталось живых сокетов (закрытие/креш вкладки —
  // страховка на случай потерянного end-маяка; вызывается отложенно с перепроверкой).
  // Комнатные сессии тут не трогаем: их ведёт socket.service.
  // onlyIdleMs: убивать только сессии без запросов дольше N мс. Живой плеер качает
  // сегменты по HTTP независимо от сокета (обрыв/реконнект на медленной сети), и его
  // сессию убивать нельзя — иначе вечный 404 и ступор до полного перезахода.
  public async killSoloSessionsForUser(userId: string, onlyIdleMs: number = 0): Promise<void> {
    if (!userId) return;
    const now = Date.now();
    const kills: Promise<void>[] = [];
    for (const [sId, session] of Array.from(this.continuousSessions.entries())) {
      if (!sId.includes('_r') && session.ownerUserId === userId) {
        if (onlyIdleMs > 0 && now - session.lastAccess < onlyIdleMs) {
          logger.debug('HLS', `⏭️ Skipping kill of active session ${sId} (last access ${((now - session.lastAccess) / 1000).toFixed(1)}s ago, socket flap?)`);
          continue;
        }
        logger.info('HLS', `🧹 Cleaning up solo session of disconnected user ${userId}: ${sId}`);
        kills.push(this.retireSession(sId, session));
      }
    }
    await Promise.all(kills);
  }

  // Процесс завершён (любым кодом), убит или сигнал — производить больше не будет.
  // Приостановленный (suspend) НЕ считается завершённым: после resume продолжит.
  private isProcessFinished(session: ContinuousHlsSession): boolean {
    const proc = session.process as any;
    if (!proc) return true;
    if (proc.killed) return true;
    if (proc.signalCode !== null && proc.signalCode !== undefined) return true;
    if (proc.exitCode !== null && proc.exitCode !== undefined) return true;
    return false;
  }

  private async waitForSegment(sessionDir: string, segmentName: string, sessionId?: string, maxIters: number = 60): Promise<string | null> {
    const segPath = path.join(sessionDir, segmentName);
    for (let i = 0; i < maxIters; i++) {
      if (sessionId && !this.continuousSessions.has(sessionId) && !this.closingSessions.has(sessionId)) {
        return null;
      }
      try {
        const stats = await fs.promises.stat(segPath);
        if (stats.size > 100) return segPath;
      } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  }

  public touchSessionByMediaId(mediaId: string): void {
    const now = Date.now();
    for (const s of this.continuousSessions.values()) {
      if (s.mediaId === mediaId) s.lastAccess = now;
    }
  }

  public extractSubtitle(filePath: string, streamIndex: number, format: 'vtt' | 'ass'): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        '-i', filePath,
        '-map', `0:${streamIndex}`,
        '-f', format === 'vtt' ? 'webvtt' : 'ass',
        '-'
      ];

      const proc = spawn('ffmpeg', args);
      FFmpegService.registerSpawnedPid(proc.pid);
      let output = '';
      proc.stdout.on('data', (chunk) => { output += chunk.toString(); });
      proc.on('close', (code) => {
        FFmpegService.unregisterSpawnedPid(proc.pid);
        if (code === 0) resolve(output);
        else reject(new Error(`Failed to extract subtitle: exit code ${code}`));
      });
      proc.on('error', (err) => {
        FFmpegService.unregisterSpawnedPid(proc.pid);
        reject(err);
      });
    });
  }

  private async cleanupIdleSessions() {
    try {
      if (this.sessionCreationPromises.size > 0) return;

      const now = Date.now();

      // 1. Terminate inactive sessions (>10 minutes without segment requests)
      const INACTIVE_SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes (600,000 ms)
      for (const [sessionId, session] of Array.from(this.continuousSessions.entries())) {
        if (now - session.lastAccess > INACTIVE_SESSION_TIMEOUT_MS) {
          logger.info('HLS', `⏱️ Inactive session timeout (>10m) for ${sessionId}, terminating process...`);
          this.retireSession(sessionId, session);
        }
      }

      // 2. Scan and terminate any zombie ffmpeg.exe processes on Windows not owned by active sessions
      if (process.platform === 'win32') {
        try {
          // If a session is being created or restarted, skip process sweeping to avoid race conditions
          if (this.sessionCreationPromises.size > 0) return;

          const { stdout } = await execFileAsync('tasklist', ['/FI', 'IMAGENAME eq ffmpeg.exe', '/FO', 'CSV', '/NH'], { windowsHide: true });

          // Re-check after awaiting tasklist!
          if (this.sessionCreationPromises.size > 0) return;

          const activePids = new Set<number>();
          for (const session of this.continuousSessions.values()) {
            if (session.process?.pid) activePids.add(session.process.pid);
          }
          for (const session of this.closingSessions.values()) {
            if (session.process?.pid) activePids.add(session.process.pid);
          }
          for (const pid of FFmpegService.activeDirectPids) {
            activePids.add(pid);
          }
          const nowTs = Date.now();
          for (const [pid, spawnTime] of FFmpegService.knownSpawnedPids.entries()) {
            // Grace period: any process spawned within the last 30 seconds is protected
            if (nowTs - spawnTime < 30000) {
              activePids.add(pid);
            }
          }

          const lines = stdout.split('\r\n').filter(l => l.trim());
          for (const line of lines) {
            const match = line.match(/^"ffmpeg\.exe","(\d+)"/i);
            if (match) {
              const pid = parseInt(match[1], 10);
              if (pid && !activePids.has(pid)) {
                // Final safety check: re-verify against latest active sessions and spawn timestamps
                const spawnTime = FFmpegService.knownSpawnedPids.get(pid);
                if (spawnTime && Date.now() - spawnTime < 30000) continue;
                if (Array.from(this.continuousSessions.values()).some(s => s.process?.pid === pid)) continue;
                if (Array.from(this.closingSessions.values()).some(s => s.process?.pid === pid)) continue;

                logger.info('SWEEPER', `🧹 Terminating zombie FFmpeg PID ${pid}`);
                ProcessController.kill(pid).catch(() => {});
                FFmpegService.knownSpawnedPids.delete(pid);
              }
            }
          }
        } catch {}
      }

      // 3. Scan and wipe any orphaned session folders on RAM disk
      const baseTempDir = this.getBaseTempDir();
      const sessionsRoot = path.join(baseTempDir, 'hls_sessions');

      try {
        if (fs.existsSync(sessionsRoot)) {
          const dirs = await fs.promises.readdir(sessionsRoot);
          for (const dir of dirs) {
            const isKnown = Array.from(this.continuousSessions.values()).some(s => path.basename(s.sessionDir) === dir) ||
                            Array.from(this.closingSessions.values()).some(s => path.basename(s.sessionDir) === dir);
            if (!isKnown) {
              const dirPath = path.join(sessionsRoot, dir);
              try {
                const dirStats = await fs.promises.stat(dirPath);
                if (now - dirStats.mtimeMs > 5000) {
                  await fs.promises.rm(dirPath, { recursive: true, force: true, maxRetries: 3 });
                }
              } catch {}
            }
          }
        }
      } catch {}
    } catch {}
  }
}

export { FFmpegService };
export const ffmpegService = new FFmpegService();
