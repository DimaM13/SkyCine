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

// Sliding window constants (optimized for 1GB RAM disk)
const WINDOW_AHEAD = 8;    // Max 8 segments ahead (~32 sec of video)
const WINDOW_BEHIND = 3;   // Keep 3 segments behind for buffer re-read (~12 sec)

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

  public async getSegmentDuration(media: MediaItem, quality: string = 'original', isApple: boolean = false): Promise<number> {
    const isVp9OrVp8 = media.videoCodec?.toLowerCase() === 'vp9' || media.videoCodec?.toLowerCase() === 'vp8';
    const is4k = media.resolution === '4K';
    const is4kVp9 = isVp9OrVp8 && is4k;
    const isApple4kVp9 = isApple && is4kVp9;

    const pcSupportedCodecs = ['h264', 'hevc', 'h265', 'vp8', 'vp9', 'av1'];
    const appleSupportedCodecs = isApple4kVp9 ? ['h264', 'hevc', 'h265'] : ['h264', 'hevc', 'h265', 'vp8', 'vp9'];
    const isSupportedCodec = isApple
      ? appleSupportedCodecs.includes(media.videoCodec?.toLowerCase() || '')
      : pcSupportedCodecs.includes(media.videoCodec?.toLowerCase() || '');
    const canCopyVideo = quality === 'original' && isSupportedCodec;

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

    fs.promises.readdir(session.sessionDir).then(files => {
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
      if (purgedCount > 0) {
        logger.debug('HLS_CLEANUP', `Purged ${purgedCount} segments behind #${minToKeep} for session ${session.sessionId}`);
      }
    }).catch(() => {});
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
        if (ahead > WINDOW_AHEAD && session.isReady) {
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

        if (!session.isSuspended && session.latestSegmentIndex - session.lastRequestedSegmentIndex > WINDOW_AHEAD && session.isReady) {
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
    sessionIdOverride?: string
  ): Promise<{ sessionId: string }> {
    const segDuration = await this.getSegmentDuration(media, quality, isApple);
    const cleanStartTime = Math.max(0, Math.floor(startTime));
    const deviceSuffix = isApple ? 'apple' : 'pc';
    const sessionId = sessionIdOverride || `${media.id}_q${quality}_a${audioIndex}_${deviceSuffix}`;

    // 1. Check if session creation is already in flight
    const inFlight = this.sessionCreationPromises.get(sessionId);
    if (inFlight) {
      logger.debug('HLS', `Session creation in-flight for ${sessionId}, awaiting existing promise...`);
      return inFlight;
    }

    // 2. Check if an existing session covers this position
    const existing = this.continuousSessions.get(sessionId);
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

      // Position changed (seek backward or far forward): gracefully retire existing session
      logger.info('HLS', `🔄 Restarting session ${sessionId} for seek to ${cleanStartTime}s (prev start: ${currentStart}s, latest produced: ${currentLatestTime}s)`);
      this.retireSession(sessionId, existing);
    }

    const promise = this._createContinuousHlsSession(media, quality, audioIndex, cleanStartTime, isApple, sessionId, deviceSuffix, segDuration);
    this.sessionCreationPromises.set(sessionId, promise);

    try {
      return await promise;
    } finally {
      this.sessionCreationPromises.delete(sessionId);
    }
  }

  private async retireSession(sessionId: string, session: ContinuousHlsSession): Promise<void> {
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

    // Give process 100ms to release file handles before purging and deleting folder
    setTimeout(async () => {
      this.closingSessions.delete(closingId);
      this.purgeSessionDir(dirToDelete);
      try {
        await fs.promises.rm(dirToDelete, { recursive: true, force: true, maxRetries: 5 });
      } catch {}
    }, 100);
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
    isRetry: boolean = false
  ): Promise<{ sessionId: string }> {
    await this.warmupFile(media.filePath);

    const baseTempDir = this.getBaseTempDir();
    const uniqueId = Date.now().toString() + '_' + Math.random().toString(36).substring(7);
    const sessionDir = path.join(baseTempDir, 'hls_sessions', `${sessionId}_${uniqueId}`);

    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

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

    const isVp9OrVp8 = media.videoCodec?.toLowerCase() === 'vp9' || media.videoCodec?.toLowerCase() === 'vp8';
    const is4k = media.resolution === '4K';
    const is4kVp9 = isVp9OrVp8 && is4k;
    const isApple4kVp9 = isApple && is4kVp9;

    const pcSupportedCodecs = ['h264', 'hevc', 'h265', 'vp8', 'vp9', 'av1'];
    const appleSupportedCodecs = isApple4kVp9 ? ['h264', 'hevc', 'h265'] : ['h264', 'hevc', 'h265', 'vp8', 'vp9'];
    const isSupportedCodec = isApple
      ? appleSupportedCodecs.includes(media.videoCodec?.toLowerCase() || '')
      : pcSupportedCodecs.includes(media.videoCodec?.toLowerCase() || '');
    const canCopyVideo = quality === 'original' && isSupportedCodec;

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

    const appleAudio = ['aac', 'ac3', 'eac3', 'mp3', 'alac'];
    const pcAudio = ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'wav'];
    const isAppleNativeAudio = appleAudio.some(c => trackAudioCodec.includes(c));
    const isPcNativeAudio = pcAudio.some(c => trackAudioCodec.includes(c));
    const isOpusIn4kVp9 = is4kVp9 && trackAudioCodec.includes('opus');
    const canCopyAudio = (isApple ? isAppleNativeAudio : isPcNativeAudio) && !isOpusIn4kVp9;

    const isHevc = media.videoCodec === 'hevc' || media.videoCodec === 'h265';
    const isVp9 = media.videoCodec === 'vp9' || media.videoCodec === 'vp8';
    const useFmp4 = (!isApple || isHevc || isVp9) && !isApple4kVp9;

    const audioBitrate = trackChannels >= 6 ? '512k' : '320k';
    logger.info('HLS', `🎬 Starting session [${sessionId}] (${isApple ? 'Apple/iOS' : 'PC/Android'}): ` +
      `File="${path.basename(media.filePath)}" (DB Dur=${media.durationSeconds || 0}s), ` +
      `Video=${media.videoCodec} (${canCopyVideo ? 'DIRECT COPY' : `TRANSCODE ${encoder}`}), ` +
      `Audio=${trackAudioCodec || 'default'} [${trackChannels}ch] (${canCopyAudio ? 'DIRECT COPY' : `AAC ${audioBitrate}`}), ` +
      `StartPos=${cleanStartTime}s (seg #${startNumber}, ${alignedStartTime}s), segDuration=${segDuration}s, Container=${useFmp4 ? 'fMP4' : 'MPEG-TS'}`);

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

    if (useFmp4) {
      args.push(
        '-hls_segment_type', 'fmp4',
        '-hls_fmp4_init_filename', 'init.mp4',
        '-hls_segment_filename', `${ffmpegSessionDir}/seg_%04d.m4s`
      );
    } else {
      if (canCopyVideo && media.videoCodec === 'h264') {
        args.push('-bsf:v', 'h264_mp4toannexb');
      }
      args.push(
        '-hls_segment_type', 'mpegts',
        '-hls_segment_filename', `${ffmpegSessionDir}/seg_%04d.ts`
      );
    }

    args.push(`${ffmpegSessionDir}/playlist.m3u8`);

    logger.debug('FFMPEG_CMD', `[${sessionId}] ffmpeg ${args.join(' ')}`);

    const proc = spawn('ffmpeg', args, { windowsHide: true });
    FFmpegService.registerSpawnedPid(proc.pid);

    const sessionObj: ContinuousHlsSession = {
      sessionId,
      mediaId: media.id,
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
        if (/error|failed|invalid|corrupt|cannot|non-monotonous/i.test(line)) {
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

    // Wait until first segment is ready
    const startNumStr = startNumber.toString().padStart(4, '0');
    const firstSegPath = useFmp4
      ? path.join(sessionDir, `seg_${startNumStr}.m4s`)
      : path.join(sessionDir, `seg_${startNumStr}.ts`);

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
      logger.error('HLS', `⚠️ First segment wait failed (${isDead ? `process exited early with code ${proc.exitCode}` : 'timeout >12s'}) for [${sessionId}]. Last stderr:`, {
        lastStderr: lastStderrLines.slice(-10)
      });

      // Self-healing: if process unexpectedly died and this is not already a retry, restart once immediately
      if (isDead && !isRetry) {
        logger.warn('HLS', `🔄 Self-healing: restarting session [${sessionId}] after unexpected process exit`);
        this.retireSession(sessionId, sessionObj);
        return this._createContinuousHlsSession(media, quality, audioIndex, cleanStartTime, isApple, sessionId, deviceSuffix, segDuration, true);
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
    const totalSegments = Math.max(1, Math.round(duration / segmentDuration));

    const isHevc = media.videoCodec === 'hevc' || media.videoCodec === 'h265';
    const isVp9 = media.videoCodec === 'vp9' || media.videoCodec === 'vp8';
    const is4k = media.resolution === '4K';
    const isApple = sessionId.includes('_apple');
    const isApple4kVp9 = isApple && isVp9 && is4k;
    const useFmp4 = (!isApple || isHevc || isVp9) && !isApple4kVp9;
    const ext = useFmp4 ? '.m4s' : '.ts';

    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';

    let m3u8 = `#EXTM3U\n`;
    m3u8 += `#EXT-X-VERSION:${useFmp4 ? '7' : '3'}\n`;
    m3u8 += `#EXT-X-INDEPENDENT-SEGMENTS\n`;
    m3u8 += `#EXT-X-TARGETDURATION:${Math.ceil(segmentDuration)}\n`;
    m3u8 += `#EXT-X-MEDIA-SEQUENCE:0\n`;
    m3u8 += `#EXT-X-PLAYLIST-TYPE:VOD\n`;

    if (startTime > 0) {
      m3u8 += `#EXT-X-START:TIME-OFFSET=${startTime.toFixed(3)},PRECISE=YES\n`;
    }

    if (useFmp4) {
      m3u8 += `#EXT-X-MAP:URI="/api/stream/hls/session/${sessionId}/init.mp4${tokenParam}"\n`;
    }

    for (let i = 0; i < totalSegments; i++) {
      const numStr = i.toString().padStart(4, '0');
      m3u8 += `#EXTINF:${segmentDuration.toFixed(6)},\n`;
      m3u8 += `/api/stream/hls/session/${sessionId}/seg_${numStr}${ext}${tokenParam}\n`;
    }

    m3u8 += `#EXT-X-ENDLIST\n`;

    logger.info('HLS', `📋 Playlist generated [${sessionId}]: duration=${duration}s (${Math.floor(duration / 60)}m ${Math.floor(duration % 60)}s), segments=${totalSegments}, segDuration=${segmentDuration}s, startOffset=${startTime}s, type=${ext}`);
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

    // Reject segments past the end of the media duration immediately (zero timeout)
    const totalSegments = Math.max(1, Math.round((media.durationSeconds || 7200) / segDuration));
    if (!isInit && segmentIndex >= totalSegments) {
      logger.debug('HLS', `Rejecting segment beyond duration [${sessionId}] seg_${segmentIndex} >= ${totalSegments}`);
      return null;
    }

    // 2. If session exists, deliver segment or resume
    if (session) {
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
          if (ahead > WINDOW_AHEAD) {
            this.suspendFFmpeg(session);
          }
        }

        logger.debug('HLS', `⚡ Segment HIT [${sessionId}] ${segmentName} (${(fs.statSync(segPath).size / 1024).toFixed(1)} KB)`);
        return segPath;
      }

      if (isInit) {
        return this.waitForSegment(session.sessionDir, segmentName, sessionId);
      }

      // Resume if suspended and buffer is low (ahead <= 4)
      if (session.isSuspended) {
        const ahead = session.latestSegmentIndex - segmentIndex;
        if (ahead <= 4) {
          await this.resumeFFmpeg(session);
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
      const targetStartTime = segmentIndex * segDuration;
      const isApple = sessionId.includes('_apple');
      const qualityMatch = sessionId.match(/_q([a-zA-Z0-9]+)_/);
      const audioMatch = sessionId.match(/_a(\d+)_/);
      const quality = qualityMatch ? qualityMatch[1] : 'original';
      const audioIndex = audioMatch ? parseInt(audioMatch[1], 10) : 0;

      logger.info('HLS', `⚡ Seek detected [${sessionId}] to segment #${segmentIndex} (${targetStartTime}s). Active window latest is #${session.latestSegmentIndex}. Re-starting session at ${targetStartTime}s`);
      await this.startContinuousHlsSession(media, quality, audioIndex, targetStartTime, isApple, sessionId);

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

  public killSession(sessionId: string): void {
    const session = this.continuousSessions.get(sessionId);
    if (session) {
      logger.info('HLS', `🛑 Kill requested for session: ${sessionId}`);
      this.retireSession(sessionId, session);
    }
  }

  public killSessionsForRoom(roomId: string): void {
    for (const [sId, session] of Array.from(this.continuousSessions.entries())) {
      if (sId.includes(`_r${roomId}`)) {
        logger.info('HLS', `🧹 Cleaning up session for empty room ${roomId}: ${sId}`);
        this.killSession(sId);
      }
    }
  }

  public killUserSessionInRoom(roomId: string, userId: string): void {
    const userClean = userId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
    for (const [sId, session] of Array.from(this.continuousSessions.entries())) {
      if (sId.includes(`_r${roomId}`) && sId.includes(`_u${userClean}`)) {
        logger.info('HLS', `🛑 Killing room session for departed user ${userId}: ${sId}`);
        this.killSession(sId);
      }
    }
  }

  public killSoloSessionsForMedia(mediaId: string): void {
    for (const [sId, session] of Array.from(this.continuousSessions.entries())) {
      if (session.mediaId === mediaId && !sId.includes('_r')) {
        logger.info('HLS', `🛑 Killing solo session for media ${mediaId}: ${sId}`);
        this.killSession(sId);
      }
    }
  }

  private async waitForSegment(sessionDir: string, segmentName: string, sessionId?: string): Promise<string | null> {
    const segPath = path.join(sessionDir, segmentName);
    for (let i = 0; i < 60; i++) {
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
