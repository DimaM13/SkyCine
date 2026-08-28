import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { db } from '../config/db';
import { MediaItem } from '../types';
import { ProcessController } from '../utils/process_controller';

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
  private continuousSessions: Map<string, ContinuousHlsSession> = new Map();
  private closingSessions: Map<string, ContinuousHlsSession> = new Map();
  private sessionCreationPromises: Map<string, Promise<{ sessionId: string }>> = new Map();
  private restartDebounceMap: Map<string, number> = new Map();
  private detectedEncoder: string | null = null;

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
        console.log(`[FFmpeg] ✅ Created RAM disk temp directory: ${baseTempDir}`);
      } catch (e) {
        console.warn(`[FFmpeg] ⚠️ RAM disk temp directory not found at ${baseTempDir}, using local fallback`);
      }
    } else {
      console.log(`[FFmpeg] ✅ RAM disk validated: ${baseTempDir}`);
    }
  }

  public terminateProcess(proc: ChildProcess): void {
    if (!proc || !proc.pid) return;
    ProcessController.kill(proc.pid);
    try {
      proc.kill('SIGKILL');
    } catch {}
  }

  // ── Sliding Window: delete old segments behind playback position ──
  private cleanupOldSegments(session: ContinuousHlsSession, currentSegmentIndex: number): void {
    const minToKeep = currentSegmentIndex - WINDOW_BEHIND;
    if (minToKeep <= session.startSegmentNumber) return;

    fs.promises.readdir(session.sessionDir).then(files => {
      for (const file of files) {
        const match = file.match(/^seg_(\d+)\.(ts|m4s)$/);
        if (!match) continue;
        const idx = parseInt(match[1], 10);
        if (idx < minToKeep) {
          fs.promises.unlink(path.join(session.sessionDir, file)).catch(() => {});
        }
      }
    }).catch(() => {});
  }

  // ── Kernel-level FFmpeg Process Suspend (via NtSuspendProcess) ──
  private async suspendFFmpeg(session: ContinuousHlsSession): Promise<void> {
    if (session.isSuspended || !session.process?.pid || session.process.killed) return;

    session.isSuspended = true;
    const ok = await ProcessController.suspend(session.process.pid);
    if (ok) {
      console.log(`[HLS Throttle] ⏸️ Suspended FFmpeg PID ${session.process.pid} (session ${session.sessionId}, ahead: ${session.latestSegmentIndex - session.lastRequestedSegmentIndex})`);
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
      console.log(`[HLS Throttle] ▶️ Resumed FFmpeg PID ${session.process.pid} (session ${session.sessionId})`);
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
      }
    } catch (e) {
      console.warn('[FFmpeg] Initial cleanup notice:', e);
    }
  }

  public async detectHardwareEncoder(): Promise<string> {
    if (this.detectedEncoder) return this.detectedEncoder;

    const setting = db.prepare('SELECT value FROM server_settings WHERE key = ?').get('transcodeHardware') as { value: string } | undefined;
    const preference = setting?.value || 'auto';

    if (preference !== 'auto' && preference !== 'cpu') {
      this.detectedEncoder = preference === 'nvenc' ? 'h264_nvenc' : preference === 'qsv' ? 'h264_qsv' : preference === 'amf' ? 'h264_amf' : 'libx264';
      return this.detectedEncoder;
    }

    const encodersToTest = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'];
    for (const enc of encodersToTest) {
      const works = await this.testEncoder(enc);
      if (works) {
        this.detectedEncoder = enc;
        console.log(`[FFmpeg] Using video encoder: ${enc}`);
        return enc;
      }
    }

    this.detectedEncoder = 'libx264';
    return this.detectedEncoder;
  }

  private testEncoder(encoderName: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('ffmpeg', ['-f', 'lavfi', '-i', 'nullsrc=s=64x64:d=0.1', '-c:v', encoderName, '-f', 'null', '-']);
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
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
    const cleanStartTime = Math.max(0, Math.floor(startTime));
    const deviceSuffix = isApple ? 'apple' : 'pc';
    const sessionId = sessionIdOverride || `${media.id}_q${quality}_a${audioIndex}_${deviceSuffix}`;

    // 1. Check if session creation is already in flight
    const inFlight = this.sessionCreationPromises.get(sessionId);
    if (inFlight) {
      return inFlight;
    }

    // 2. Check if an existing session covers this position
    const existing = this.continuousSessions.get(sessionId);
    if (existing && existing.process && !existing.process.killed) {
      existing.lastAccess = Date.now();
      const currentStart = existing.startTime;
      // If position is within current streaming range, reuse session!
      if (cleanStartTime >= currentStart && cleanStartTime < currentStart + 90) {
        return { sessionId };
      }

      // Position changed (seek): gracefully retire existing session
      this.retireSession(sessionId, existing);
    }

    const promise = this._createContinuousHlsSession(media, quality, audioIndex, cleanStartTime, isApple, sessionId, deviceSuffix);
    this.sessionCreationPromises.set(sessionId, promise);

    try {
      return await promise;
    } finally {
      this.sessionCreationPromises.delete(sessionId);
    }
  }

  private retireSession(sessionId: string, session: ContinuousHlsSession): void {
    this.stopSegmentWatcher(session);
    if (session.isSuspended) {
      session.isSuspended = false;
      this.resumeFFmpeg(session).catch(() => {});
    }

    const closingId = `${sessionId}_closing_${Date.now()}`;
    const dirToDelete = session.sessionDir;
    this.closingSessions.set(closingId, session);
    this.continuousSessions.delete(sessionId);

    this.terminateProcess(session.process);

    // Give process 200ms to release file handles before purging and deleting folder
    setTimeout(async () => {
      this.closingSessions.delete(closingId);
      this.purgeSessionDir(dirToDelete);
      try {
        await fs.promises.rm(dirToDelete, { recursive: true, force: true, maxRetries: 5 });
      } catch {}
    }, 200);
  }

  public async warmupFile(filePath: string): Promise<void> {
    const start = Date.now();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await fs.promises.stat(filePath);
        const elapsed = Date.now() - start;
        if (elapsed > 2000) {
          console.log(`[HDD] ⏳ External disk wakeup took ${elapsed}ms for ${path.basename(filePath)}`);
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
    deviceSuffix: string
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

    const args: string[] = [
      '-loglevel', 'error',
      '-err_detect', 'ignore_err',
      '-fflags', '+genpts+discardcorrupt+nobuffer',
    ];

    // Fast seek for instant segment startup
    args.push('-noaccurate_seek', '-ss', cleanStartTime.toString());
    args.push('-i', media.filePath);

    args.push('-map', '0:v:0');
    if (audioIndex > 0) {
      args.push('-map', `0:${audioIndex}`);
    } else {
      args.push('-map', '0:a:0?');
    }

    const pcSupportedCodecs = ['h264', 'hevc', 'h265', 'vp8', 'vp9', 'av1'];
    const appleSupportedCodecs = ['h264', 'hevc', 'h265', 'vp8', 'vp9'];
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

    const appleAudio = ['aac', 'ac3', 'eac3', 'mp3', 'alac', 'opus'];
    const pcAudio = ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'wav'];
    const isAppleNativeAudio = appleAudio.some(c => trackAudioCodec.includes(c));
    const isPcNativeAudio = pcAudio.some(c => trackAudioCodec.includes(c));
    const canCopyAudio = canCopyVideo && (isApple ? isAppleNativeAudio : isPcNativeAudio);

    const audioBitrate = trackChannels >= 6 ? '512k' : '320k';
    console.log(`[Continuous HLS] 🎬 Starting session [${sessionId}] (${isApple ? 'Apple/iPad' : 'PC/Android'}): Video=${media.videoCodec} (${canCopyVideo ? 'DIRECT COPY' : `TRANSCODE ${encoder}`}), Audio=${trackAudioCodec || 'default'} [${trackChannels}ch] (${canCopyAudio ? 'DIRECT COPY' : `AAC ${audioBitrate}`}), StartPos=${cleanStartTime}s`);

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
      '-avoid_negative_ts', 'make_zero',
      '-f', 'hls',
      '-hls_time', '4',
      '-hls_list_size', '0',
      '-hls_playlist_type', 'event',
      '-hls_flags', 'independent_segments+temp_file',
      '-start_number', Math.floor(cleanStartTime / 4).toString()
    );

    const isHevc = media.videoCodec === 'hevc' || media.videoCodec === 'h265';
    const isVp9 = media.videoCodec === 'vp9' || media.videoCodec === 'vp8';
    const useFmp4 = !isApple || isHevc || isVp9;

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

    const proc = spawn('ffmpeg', args, { windowsHide: true });
    const startNumber = Math.floor(cleanStartTime / 4);

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
      isReady: false,
      latestSegmentIndex: startNumber,
      lastRequestedSegmentIndex: startNumber,
      isSuspended: false,
      _createdAt: Date.now(),
    };

    this.continuousSessions.set(sessionId, sessionObj);
    this.startSegmentWatcher(sessionObj);

    proc.on('error', (err) => {
      console.error(`[Continuous HLS] session ${sessionId} error:`, err);
    });

    proc.on('close', (code) => {
      console.log(`[Continuous HLS] session ${sessionId} exited (code: ${code})`);
    });

    // Wait until first segment is ready
    const startNumStr = startNumber.toString().padStart(4, '0');
    const firstSegPath = useFmp4
      ? path.join(sessionDir, `seg_${startNumStr}.m4s`)
      : path.join(sessionDir, `seg_${startNumStr}.ts`);

    const maxWaitMs = 12000;
    const startWait = Date.now();

    while (Date.now() - startWait < maxWaitMs) {
      if (proc.killed || !this.continuousSessions.has(sessionId)) break;

      try {
        const stats = await fs.promises.stat(firstSegPath);
        if (stats.size > 100) {
          sessionObj.isReady = true;
          console.log(`[Continuous HLS] ⚡ Session ready in ${Date.now() - startWait}ms: ${sessionId}`);
          break;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 20));
    }

    sessionObj.isReady = true;
    return { sessionId };
  }

  public hasSession(sessionId: string): boolean {
    return this.continuousSessions.has(sessionId) || this.closingSessions.has(sessionId);
  }

  public generateVodPlaylist(media: MediaItem, sessionId: string, token?: string, _startTime: number = 0): string {
    const duration = media.durationSeconds && media.durationSeconds > 0 ? media.durationSeconds : 7200;
    const segmentDuration = 4;
    const totalSegments = Math.ceil(duration / segmentDuration);

    const isHevc = media.videoCodec === 'hevc' || media.videoCodec === 'h265';
    const isVp9 = media.videoCodec === 'vp9' || media.videoCodec === 'vp8';
    const isApple = sessionId.includes('_apple');
    const useFmp4 = !isApple || isHevc || isVp9;
    const ext = useFmp4 ? '.m4s' : '.ts';

    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';

    let m3u8 = `#EXTM3U\n`;
    m3u8 += `#EXT-X-VERSION:${useFmp4 ? '7' : '3'}\n`;
    m3u8 += `#EXT-X-INDEPENDENT-SEGMENTS\n`;
    m3u8 += `#EXT-X-TARGETDURATION:${segmentDuration}\n`;
    m3u8 += `#EXT-X-MEDIA-SEQUENCE:0\n`;
    m3u8 += `#EXT-X-PLAYLIST-TYPE:VOD\n`;

    if (useFmp4) {
      m3u8 += `#EXT-X-MAP:URI="/api/stream/hls/session/${sessionId}/init.mp4${tokenParam}"\n`;
    }

    for (let i = 0; i < totalSegments; i++) {
      const numStr = i.toString().padStart(4, '0');
      m3u8 += `#EXTINF:${segmentDuration.toFixed(6)},\n`;
      m3u8 += `/api/stream/hls/session/${sessionId}/seg_${numStr}${ext}${tokenParam}\n`;
    }

    m3u8 += `#EXT-X-ENDLIST\n`;
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

      // If segment is within reachable range, wait for it
      if (segmentIndex >= session.startSegmentNumber && segmentIndex <= session.latestSegmentIndex + 20) {
        const foundPath = await this.waitForSegment(session.sessionDir, segmentName, sessionId);
        if (foundPath) {
          session.latestSegmentIndex = Math.max(session.latestSegmentIndex, segmentIndex);
          this.cleanupOldSegments(session, segmentIndex);
        }
        return foundPath;
      }

      // If segment is out of range, check closing sessions
      for (const [, closing] of this.closingSessions) {
        if (closing.mediaId !== media.id) continue;
        const closingPath = path.join(closing.sessionDir, segmentName);
        if (fs.existsSync(closingPath) && fs.statSync(closingPath).size > 100) {
          return closingPath;
        }
      }

      // Handle seeking: The requested segment is outside the active session's window.
      // Immediately start or replace session at the requested segment's timestamp!
      const targetStartTime = segmentIndex * 4;
      const isApple = sessionId.includes('_apple');
      const qualityMatch = sessionId.match(/_q([a-zA-Z0-9]+)_/);
      const audioMatch = sessionId.match(/_a(\d+)_/);
      const quality = qualityMatch ? qualityMatch[1] : 'original';
      const audioIndex = audioMatch ? parseInt(audioMatch[1], 10) : 0;

      console.log(`[JIT HLS] Seeking session ${sessionId} to ${targetStartTime}s for segment ${segmentIndex}`);
      await this.startContinuousHlsSession(media, quality, audioIndex, targetStartTime, isApple, sessionId);

      const activeSession = this.continuousSessions.get(sessionId);
      if (activeSession) {
        return this.waitForSegment(activeSession.sessionDir, segmentName, sessionId);
      }

      return null;
    }

    // 3. Strict Anti-Ghosting Rule:
    // If NO session exists and this is a segment request (not init.mp4), return NULL (404).
    // This stops tablet background loops from spawning ghost FFmpeg sessions!
    if (!isInit) {
      return null;
    }

    return null;
  }

  public killSession(sessionId: string): void {
    const session = this.continuousSessions.get(sessionId);
    if (session) {
      console.log(`[Continuous HLS] 🛑 Kill requested for session: ${sessionId}`);
      this.retireSession(sessionId, session);
    }
  }

  public killSessionsForRoom(roomId: string): void {
    for (const [sId, session] of Array.from(this.continuousSessions.entries())) {
      if (sId.includes(`_r${roomId}`)) {
        console.log(`[Continuous HLS] 🧹 Cleaning up session for empty room ${roomId}: ${sId}`);
        this.killSession(sId);
      }
    }
  }

  public killSoloSessionsForMedia(mediaId: string): void {
    for (const [sId, session] of Array.from(this.continuousSessions.entries())) {
      if (session.mediaId === mediaId && !sId.includes('_r')) {
        console.log(`[Continuous HLS] 🛑 Killing solo session for media ${mediaId}: ${sId}`);
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
      let output = '';
      proc.stdout.on('data', (chunk) => { output += chunk.toString(); });
      proc.on('close', (code) => {
        if (code === 0) resolve(output);
        else reject(new Error(`Failed to extract subtitle: exit code ${code}`));
      });
      proc.on('error', (err) => reject(err));
    });
  }

  private async cleanupIdleSessions() {
    try {
      const now = Date.now();
      for (const [sessionId, session] of Array.from(this.continuousSessions.entries())) {
        if (now - session.lastAccess > 40000) {
          console.log(`[Continuous HLS] ⏱️ Inactive session timeout (>40s) for ${sessionId}, terminating process...`);
          this.retireSession(sessionId, session);
        }
      }

      // Clean orphaned session folders on RAM disk older than 10 seconds
      const baseTempDir = this.getBaseTempDir();
      const sessionsRoot = path.join(baseTempDir, 'hls_sessions');

      try {
        const stats = await fs.promises.stat(sessionsRoot);
        if (stats.isDirectory()) {
          const dirs = await fs.promises.readdir(sessionsRoot);
          for (const dir of dirs) {
            const isKnown = Array.from(this.continuousSessions.values()).some(s => path.basename(s.sessionDir) === dir) ||
                            Array.from(this.closingSessions.values()).some(s => path.basename(s.sessionDir) === dir);
            if (!isKnown) {
              const dirPath = path.join(sessionsRoot, dir);
              try {
                const dirStats = await fs.promises.stat(dirPath);
                if (now - dirStats.mtimeMs > 10000) {
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

export const ffmpegService = new FFmpegService();
