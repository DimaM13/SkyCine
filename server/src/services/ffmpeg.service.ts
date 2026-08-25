import fs from 'fs';
import path from 'path';
import { spawn, exec, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/db';
import { systemService } from './system.service';
import { MediaItem } from '../types';

interface ContinuousHlsSession {
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
  _createdAt: number;
}

class FFmpegService {
  private continuousSessions: Map<string, ContinuousHlsSession> = new Map();
  private closingSessions: Map<string, ContinuousHlsSession> = new Map();
  private closingCreatedAt: Map<string, number> = new Map();
  private closingServeCount: Map<string, number> = new Map(); // throttle spam: seg_0000 loop
  private detectedEncoder: string | null = null;

  constructor() {
    // Initial cleanup of old orphaned transcodes on server launch
    this.cleanupOrphanedTranscodes();
    // Periodically cleanup dead HLS sessions (idle > 25 seconds)
    setInterval(() => this.cleanupIdleSessions(), 5000);
  }

  public terminateProcess(proc: ChildProcess): void {
    if (!proc || !proc.pid) return;
    try {
      if (process.platform === 'win32') {
        exec(`taskkill /pid ${proc.pid} /T /F`, () => {
          try { proc.kill('SIGKILL'); } catch (e) {}
        });
      } else {
        proc.kill('SIGKILL');
      }
    } catch (e) {
      try { proc.kill(); } catch (err) {}
    }
  }

  private cleanupOrphanedTranscodes() {
    try {
      const transcodeDirs = [
        path.resolve(__dirname, '../../../data/transcodes'),
        path.resolve(__dirname, '../../data/transcodes'),
      ];
      for (const dir of transcodeDirs) {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });
          fs.mkdirSync(dir, { recursive: true });
        }
      }
    } catch (e) {
      console.error('[FFmpeg] Error in cleanupOrphanedTranscodes:', e);
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

    // Test NVENC first, then QSV, then AMF, then libx264
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
      proc.on('close', (code) => {
        resolve(code === 0);
      });
      proc.on('error', () => resolve(false));
    });
  }

  private pendingSegmentTasks: Map<string, Promise<string>> = new Map();

  private sessionCreationPromises: Map<string, Promise<{ sessionId: string }>> = new Map();

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

    // JIT VOD: Session ID is deterministic based only on format/quality/device, NO startTime!
    const sessionId = sessionIdOverride || `${media.id}_q${quality}_a${audioIndex}_${deviceSuffix}`;

    // 1. Check if a session creation for this sessionId is ALREADY in flight
    const inFlight = this.sessionCreationPromises.get(sessionId);
    if (inFlight) {
      return inFlight;
    }

    // 2. Check if an existing active session covers this position
    const existing = this.continuousSessions.get(sessionId);
    if (existing && existing.process && !existing.process.killed) {
      existing.lastAccess = Date.now();
      const currentStart = existing.startTime;
      if (cleanStartTime >= currentStart && cleanStartTime < currentStart + 120) {
        return { sessionId };
      }
      const sId = `${sessionId}_closing_${Date.now()}`;
      const dirToDelete = existing.sessionDir;
      this.closingSessions.set(sId, existing);
      this.terminateProcess(existing.process);
      setTimeout(async () => {
        try { await fs.promises.rm(dirToDelete, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {}
        this.closingSessions.delete(sId);
      }, 30000);
      this.continuousSessions.delete(sessionId);
    }

    const promise = this._createContinuousHlsSession(media, quality, audioIndex, cleanStartTime, isApple, sessionId, deviceSuffix);
    this.sessionCreationPromises.set(sessionId, promise);

    try {
      const res = await promise;
      return res;
    } finally {
      this.sessionCreationPromises.delete(sessionId);
    }
  }

  // External HDD warmup: non-blocking stat with retry, logs when disk is waking (fixes 12s master.m3u8)
  public async warmupFile(filePath: string): Promise<void> {
    const start = Date.now();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await fs.promises.stat(filePath);
        const elapsed = Date.now() - start;
        if (elapsed > 2000) {
          console.log(`[HDD] ⏳ External disk wakeup took ${elapsed}ms for ${path.basename(filePath)} (attempt ${attempt + 1})`);
        }
        return;
      } catch (e: any) {
        const elapsed = Date.now() - start;
        if (elapsed > 8000) break;
        // Disk sleeping — wait a bit and retry (spinup)
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    // Final fire-and-forget warmup read (first byte) to trigger spinup without blocking
    try {
      const fd = await fs.promises.open(filePath, 'r');
      const buf = Buffer.alloc(1);
      await fd.read(buf, 0, 1, 0).catch(() => {});
      await fd.close();
    } catch (e) {}
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
    // Warmup external HDD before spawning FFmpeg (prevents 12s master + segment not found spam)
    await this.warmupFile(media.filePath);

    const tempDirSetting = db.prepare('SELECT value FROM server_settings WHERE key = ?').get('transcodeTempDir') as { value: string } | undefined;
    const baseTempDir = tempDirSetting?.value || path.resolve(__dirname, '../../../data/transcodes');

    if (!fs.existsSync(baseTempDir)) {
      fs.mkdirSync(baseTempDir, { recursive: true });
    }

    const uniqueId = Date.now().toString() + '_' + Math.random().toString(36).substring(7);
    const sessionDir = path.join(baseTempDir, 'hls_sessions', `${sessionId}_${uniqueId}`);

    // Ensure the base directory exists
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    // FFmpeg requires forward slashes on Windows
    const ffmpegSessionDir = sessionDir.replace(/\\/g, '/');

    const encoder = await this.detectHardwareEncoder();
    const args: string[] = [
      '-loglevel', 'error',
      '-err_detect', 'ignore_err',
      '-fflags', '+genpts+discardcorrupt+nobuffer',
    ];

    // Fast seek для DIRECT COPY: -noaccurate_seek прыгает на ближайший I-frame, иначе copy не может резать между кадрами и seg_0017 пропускается
    args.push('-noaccurate_seek', '-ss', cleanStartTime.toString());
    // Троттлинг только для больших файлов >5ГБ → 3x, мелкие на полной скорости SSD
    try {
      const fsize = media.fileSize && media.fileSize > 0 ? media.fileSize : (fs.existsSync(media.filePath) ? fs.statSync(media.filePath).size : 0);
      const gb = fsize / (1024 * 1024 * 1024);
      if (gb > 5) {
        args.push('-readrate_initial_burst', '2');
        args.push('-readrate', '3');
      }
    } catch {}
    args.push('-i', media.filePath);

    args.push('-map', '0:v:0');
    if (audioIndex > 0) {
      args.push('-map', `0:${audioIndex}`);
    } else {
      args.push('-map', '0:a:0?');
    }

    // Check if video can be directly stream-copied without re-encoding (Lossless Direct Stream Copy)
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
        if (track?.codec) {
          trackAudioCodec = track.codec.toLowerCase();
        }
        if (track?.channels) {
          trackChannels = track.channels;
        }
      } catch (e) {}
    } else {
      try {
        const track = db.prepare('SELECT codec, channels FROM media_tracks WHERE mediaItemId = ? AND type = "AUDIO" ORDER BY isDefault DESC, streamIndex ASC LIMIT 1').get(media.id) as { codec: string; channels: number } | undefined;
        if (track?.codec) {
          trackAudioCodec = track.codec.toLowerCase();
        }
        if (track?.channels) {
          trackChannels = track.channels;
        }
      } catch (e) {}
    }

    const appleAudio = ['aac', 'ac3', 'eac3', 'mp3', 'alac', 'opus'];
    const pcAudio = ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'wav'];
    const isAppleNativeAudio = appleAudio.some(c => trackAudioCodec.includes(c));
    const isPcNativeAudio = pcAudio.some(c => trackAudioCodec.includes(c));
    // Direct audio stream copy is only safe if video is ALSO direct copied (otherwise seeking causes audio/video PTS drift).
    const canCopyAudio = canCopyVideo && (isApple ? isAppleNativeAudio : isPcNativeAudio);

    const audioBitrate = trackChannels >= 6 ? '512k' : '320k';
    console.log(`[Continuous HLS] 🎬 Starting session [${sessionId}] (${isApple ? 'Apple/iPad' : 'PC/Android'}): Video=${media.videoCodec} (${canCopyVideo ? 'DIRECT COPY - NO COMPRESSION' : `TRANSCODE ${encoder}`}), Audio=${trackAudioCodec || 'default'} [${trackChannels}ch] (${canCopyAudio ? 'DIRECT COPY (Lossless)' : `TRANSPARENT AAC ${audioBitrate} (${trackChannels}ch Multi-channel)`}), StartPos=${cleanStartTime}s`);

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
        // Apple devices natively decode Dolby Digital 5.1 (AC-3 640 kbps) with Spatial Audio
        args.push(
          '-c:a', 'ac3',
          '-b:a', '640k'
        );
      } else if (trackChannels >= 6) {
        // PC / Android: Clean standard 5.1 layout mapping without PCE artifacts
        args.push(
          '-c:a', 'aac',
          '-b:a', '512k',
          '-af', 'aformat=channel_layouts=5.1'
        );
      } else {
        // Stereo: High-bitrate 320 kbps AAC
        args.push(
          '-c:a', 'aac',
          '-b:a', '320k'
        );
      }
    }

    args.push(
      '-muxdelay', '0',
      '-muxpreload', '0',
      '-avoid_negative_ts', 'make_zero'
    );

    args.push(
      '-f', 'hls',
      '-hls_time', '4',
      '-hls_list_size', '0',
      '-hls_playlist_type', 'event',
      '-hls_flags', 'independent_segments+temp_file',
      '-start_number', Math.floor(cleanStartTime / 4).toString()
    );

    // MATRIX OF TRUTH:
    // Hls.js (PC) strictly requires fmp4 (CMAF) with tfdt=0 to prevent Continuity Counter jumping.
    // Apple Native (iPad) strictly requires mpegts for H.264 (it handles TS discontinuities natively). 
    // Apple Native strictly requires fmp4 for HEVC (but might need offset, keeping as is for now since user didn't complain).
    //
    // WATCH TOGETHER OVERRIDE:
    // In Watch Together, fmp4 and mpegts produce slightly different PTS alignments when using
    // -c:v copy with -noaccurate_seek. To guarantee frame-identical streams across devices,
    // we force BOTH iPad and PC to use the SAME container format (mpegts for H.264).
    // Hls.js on PC supports mpegts perfectly fine.
    const isHevc = media.videoCodec === 'hevc' || media.videoCodec === 'h265';
    const isVp9 = media.videoCodec === 'vp9' || media.videoCodec === 'vp8';
    const isRoomSession = /_r[a-zA-Z0-9]/.test(sessionId.split('_apple').pop() || sessionId.split('_pc').pop() || '');
    // Apple uses fmp4 for HEVC/VP9/VP8 direct copy, mpegts for H.264.
    // PC uses fmp4 for everything (except Watch Together H.264 rooms where mpegts is used for exact sync).
    const useFmp4 = (isRoomSession && !isHevc) ? false : (!isApple || ((isHevc || isVp9) && canCopyVideo));

    if (cleanStartTime > 0) {
      args.push('-output_ts_offset', cleanStartTime.toString());
    }

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
      _createdAt: Date.now()
    };
    this.continuousSessions.set(sessionId, sessionObj);

    proc.stderr?.on('data', (d) => {
      const raw = d.toString().trim();
      if (!raw) return;
      const isDecoderNoise = raw.includes('Not all references are available') || 
                             raw.includes('Error submitting packet to decoder') || 
                             raw.includes('zero_bit out of range') || 
                             raw.includes('Failed to read frame header') ||
                             raw.includes('Failed to read unit') ||
                             raw.includes('Decoding error: Invalid data');
      if (isDecoderNoise) return;
      if (raw.includes('Non-monotonous DTS') || raw.includes('Error muxing') || raw.includes('non monotonically increasing dts') || raw.includes('Fatal') || raw.includes('Conversion failed') || raw.includes('Invalid data')) {
        console.error(`[FFMPEG][${sessionId}] ${raw}`);
      }
    });

    proc.on('error', (err) => {
      console.error(`[Continuous HLS] session ${sessionId} error:`, err);
    });

    proc.on('close', (code) => {
      console.log(`[Continuous HLS] session ${sessionId} exited (code: ${code})`);
    });

    // Wait until at least the first requested segment is ready
    const startNumStr = startNumber.toString().padStart(4, '0');
    
    const firstSegPathTs = path.join(sessionDir, `seg_${startNumStr}.ts`);
    const firstSegPathM4s = path.join(sessionDir, `seg_${startNumStr}.m4s`);

    const maxWaitMs = 15000; // Increased to 15s to allow for deep seeks in large HEVC/MKV files
    const startWait = Date.now();

    while (Date.now() - startWait < maxWaitMs) {
      if (proc.killed || !this.continuousSessions.has(sessionId)) {
        console.log(`[Continuous HLS] 🛑 Session ${sessionId} superseded/cancelled during startup`);
        break;
      }
      const isApple = sessionId.includes('_apple');
      const isHevc = media.videoCodec === 'hevc' || media.videoCodec === 'h265';
      const isVp9 = media.videoCodec === 'vp9' || media.videoCodec === 'vp8';
      const isRoomSession = /_r[a-zA-Z0-9]/.test(sessionId.split('_apple').pop() || sessionId.split('_pc').pop() || '');
      const canCopyVideo = sessionId.includes('_qoriginal_') && (isApple ? ['h264', 'hevc', 'h265', 'vp8', 'vp9'].includes(media.videoCodec?.toLowerCase() || '') : true);
      const useFmp4 = (isRoomSession && !isHevc) ? false : (!isApple || ((isHevc || isVp9) && canCopyVideo));

      if (useFmp4) {
        try {
          const stats = await fs.promises.stat(firstSegPathM4s);
          if (stats.size > 100) {
            sessionObj.isReady = true;
            console.log(`[Continuous HLS] ⚡ Session ready in ${Date.now() - startWait}ms: ${sessionId}`);
            break;
          }
        } catch (e) {}
      } else {
        try {
          const stats = await fs.promises.stat(firstSegPathTs);
          if (stats.size > 100) {
            sessionObj.isReady = true;
            console.log(`[Continuous HLS] ⚡ Session ready in ${Date.now() - startWait}ms: ${sessionId}`);
            break;
          }
        } catch (e) {}
      }
      await new Promise(r => setTimeout(r, 20));
    }

    sessionObj.isReady = true;

    // Gracefully clean up previous sessions for the same media item and device
    // 1. Immediately kill old FFmpeg process so it stops saturating disk I/O and CPU
    // 2. Keep session directory for 5 seconds so in-flight segment downloads finish cleanly with HTTP 200
    // 3. Don't kill a session that is still warming up (isReady false && age < 8s) — prevents HDD spinup thrashing (1113-1207 spam)
    for (const [sId, sess] of this.continuousSessions.entries()) {
      if (sess.mediaId === media.id && sId.includes(`_${deviceSuffix}`) && sId !== sessionId) {
        const age = Date.now() - sess._createdAt;
        if (!sess.isReady && age < 8000) {
          console.log(`[Continuous HLS] ⏳ Skip retirement for warming-up session: ${sId} (age ${age}ms)`);
          continue;
        }
        console.log(`[Continuous HLS] 🧹 Graceful retirement for previous seek session: ${sId}`);
        this.continuousSessions.delete(sId);
        const dirToDelete = sess.sessionDir;
        this.closingSessions.set(sId, sess);
        this.closingCreatedAt.set(sId, Date.now());
        this.terminateProcess(sess.process);
        setTimeout(async () => {
          this.closingSessions.delete(sId);
          this.closingCreatedAt.delete(sId);
          this.closingServeCount.delete(sId);
          try { await fs.promises.rm(dirToDelete, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {}
        }, 30000);
      }
    }

    return { sessionId };
  }

  public hasSession(sessionId: string): boolean {
    return this.continuousSessions.has(sessionId) || this.closingSessions.has(sessionId);
  }

  public generateVodPlaylist(media: MediaItem, sessionId: string, token?: string, _startTime: number = 0): string {
    const duration = media.durationSeconds && media.durationSeconds > 0 ? media.durationSeconds : 7200; // fallback 2h
    const segmentDuration = 4;
    const totalSegments = Math.ceil(duration / segmentDuration);

    const isHevc = media.videoCodec === 'hevc' || media.videoCodec === 'h265';
    const isVp9 = media.videoCodec === 'vp9' || media.videoCodec === 'vp8';
    const isApple = sessionId.includes('_apple');
    const isRoomSession = /_r[a-zA-Z0-9]/.test(sessionId.split('_apple').pop() || sessionId.split('_pc').pop() || '');
    const canCopyVideo = sessionId.includes('_qoriginal_') && (isApple ? ['h264', 'hevc', 'h265', 'vp8', 'vp9'].includes(media.videoCodec?.toLowerCase() || '') : true);
    const useFmp4 = (isRoomSession && !isHevc) ? false : (!isApple || ((isHevc || isVp9) && canCopyVideo));
    const ext = useFmp4 ? '.m4s' : '.ts';

    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';

    let m3u8 = `#EXTM3U\n`;
    m3u8 += `#EXT-X-VERSION:${useFmp4 ? '7' : '3'}\n`;
    m3u8 += `#EXT-X-INDEPENDENT-SEGMENTS\n`;
    m3u8 += `#EXT-X-TARGETDURATION:${segmentDuration}\n`;
    // Seamless JIT VOD: всегда полный манифест от 0 для Safari (Священный Грааль Jellyfin/Emby)
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

    const isApple = sessionId.includes('_apple');
    const qualityMatch = sessionId.match(/_q([a-zA-Z0-9]+)_/);
    const audioMatch = sessionId.match(/_a(\d+)_/);
    const quality = qualityMatch ? qualityMatch[1] : 'original';
    const audioIndex = audioMatch ? parseInt(audioMatch[1], 10) : 0;
    // Seamless JIT VOD: старт строго с запрошенного сегмента, без пре-ролла (иначе Safari ждет seg_0017 а FFmpeg генерит 0013-0016)
    const targetStartTime = segmentIndex * 4;

    // 1. If session creation is already in flight, wait for it!
    const inFlight = this.sessionCreationPromises.get(sessionId);
    if (inFlight) {
      await inFlight;
    }

    let session = this.continuousSessions.get(sessionId);

    // 2. If session exists, check if segment is on disk or within valid encoding range
    if (session) {
       const segPath = path.join(session.sessionDir, segmentName);
       if (fs.existsSync(segPath) && fs.statSync(segPath).size > 100) {
         session.lastAccess = Date.now();
         session.latestSegmentIndex = Math.max(session.latestSegmentIndex, segmentIndex);
         return segPath;
       }
       
       if (isInit) {
         return this.waitForSegment(session.sessionDir, segmentName);
       }
       
          // Segment is before the session start - check closing sessions as fallback
          if (segmentIndex < session.startSegmentNumber) {
            // Check closing sessions for the segment (same media only)
            for (const [, closing] of this.closingSessions) {
              if (closing.mediaId !== media.id) continue;
              const closingPath = path.join(closing.sessionDir, segmentName);
              if (fs.existsSync(closingPath) && fs.statSync(closingPath).size > 100) {
                return closingPath;
              }
            }
            // Not found in closing sessions either - restart FFmpeg from the requested position
            console.log(`[JIT HLS] Segment ${segmentIndex} before session start ${session.startSegmentNumber}, unavailable in closing sessions. Restarting from ${targetStartTime}s...`);
          } else if (segmentIndex <= session.latestSegmentIndex + 25) {
           // Segment is within the valid range - wait for it
           const foundPath = await this.waitForSegment(session.sessionDir, segmentName, sessionId);
           if (foundPath) {
             session.latestSegmentIndex = Math.max(session.latestSegmentIndex, segmentIndex);
           }
           return foundPath;
          } else {
           console.log(`[JIT HLS] Segment ${segmentIndex} ahead of session range [${session.startSegmentNumber}..${session.latestSegmentIndex}]. Restarting FFmpeg from ${targetStartTime}s...`);
          }
    } else {
      // 2b. No active session — do NOT serve from closing after manual kill
      //     iPad keeps hammering seg_0021..0047 after navigation, which kept audio playing in background.
      //     Return 404 immediately to break loop and avoid zombie FFmpeg spawn; matching mediaId check prevents cross-show bleed.
      if (!isInit) {
        for (const [, closing] of this.closingSessions) {
          if (closing.mediaId === media.id) return null;
        }
      }
    }

    // 3. If init.mp4 requested when no session exists, briefly wait for a segment request or start at 0s
    if (isInit && !session) {
      await new Promise(r => setTimeout(r, 300));
      const inFlightAfter = this.sessionCreationPromises.get(sessionId);
      if (inFlightAfter) {
        await inFlightAfter;
        session = this.continuousSessions.get(sessionId);
        if (session) {
         return this.waitForSegment(session.sessionDir, segmentName, sessionId);
        }
      }
    }

    // 4. Start or restart session safely with mutex
    await this.startContinuousHlsSession(media, quality, audioIndex, targetStartTime, isApple, sessionId);
    
    const newSession = this.continuousSessions.get(sessionId);
    if (!newSession) return null;
    return this.waitForSegment(newSession.sessionDir, segmentName, sessionId);
  }

  public killSession(sessionId: string): void {
    const session = this.continuousSessions.get(sessionId);
    if (session) {
      console.log(`[Continuous HLS] 🛑 Manual kill requested for session: ${sessionId}`);
      const sessionToClose = session;
      const dirToDelete = session.sessionDir;
      const closingId = `${sessionId}_closing_${Date.now()}`;
      
      this.closingSessions.set(closingId, sessionToClose);
      this.closingCreatedAt.set(closingId, Date.now());
      this.terminateProcess(sessionToClose.process);
      setTimeout(async () => {
        try { await fs.promises.rm(dirToDelete, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {
          console.error(`[Continuous HLS] Failed to delete session dir: ${dirToDelete}`, e);
        }
        this.closingSessions.delete(closingId);
        this.closingCreatedAt.delete(closingId);
        this.closingServeCount.delete(closingId);
      }, 30000);
      
      this.continuousSessions.delete(sessionId);
    }
  }

  public killSessionsForRoom(roomId: string): void {
    for (const [sId, session] of Array.from(this.continuousSessions.entries())) {
      if (sId.includes(`_r${roomId}`)) {
        console.log(`[Continuous HLS] 🧹 Cleaning up zombie session for empty/deleted room ${roomId}: ${sId}`);
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
      // Wait up to 30 seconds (150 * 200ms) for external HDDs to spin up
      for (let i = 0; i < 150; i++) {
        // Abort early if session was killed/superseded while we were waiting
        if (sessionId && !this.continuousSessions.has(sessionId) && !this.closingSessions.has(sessionId)) {
          return null;
        }
        try {
          const stats = await fs.promises.stat(segPath);
          if (stats.size > 100) {
            return segPath;
          }
        } catch (e) {
          // File doesn't exist yet
        }
        await new Promise(r => setTimeout(r, 200));
      }
      return null;
    }

  public getHlsPlaylist(sessionId: string, token?: string): string | null {
    const session = this.continuousSessions.get(sessionId) || this.closingSessions.get(sessionId);
    if (!session) return null;
    session.lastAccess = Date.now();

    const playlistPath = path.join(session.sessionDir, 'playlist.m3u8');
    if (!fs.existsSync(playlistPath)) return null;

    let content = fs.readFileSync(playlistPath, 'utf8');
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
    // Convert relative segment paths to absolute API endpoint
    content = content.replace(/(seg_\d+\.ts|seg_\d+\.m4s|init\.mp4)/g, `/api/stream/hls/session/${sessionId}/$1${tokenParam}`);
    return content;
  }

  public getHlsSegmentPath(sessionOrMediaId: string, segmentName: string): string | null {
    let session = this.continuousSessions.get(sessionOrMediaId) || this.closingSessions.get(sessionOrMediaId);
    if (!session) {
      // Fallback lookup if client requested by mediaId
      for (const s of this.continuousSessions.values()) {
        if (s.mediaId === sessionOrMediaId) {
          session = s;
          break;
        }
      }
      if (!session) {
        for (const s of this.closingSessions.values()) {
          if (s.mediaId === sessionOrMediaId) {
            session = s;
            break;
          }
        }
      }
    }
    if (!session) return null;
    session.lastAccess = Date.now();

    const segPath = path.join(session.sessionDir, segmentName);
    if (fs.existsSync(segPath) && fs.statSync(segPath).size > 0) {
      return segPath;
    }
    return null;
  }

  public touchSessionByMediaId(mediaId: string): void {
    const now = Date.now();
    for (const s of this.continuousSessions.values()) {
      if (s.mediaId === mediaId) s.lastAccess = now;
    }
    for (const s of this.closingSessions.values()) {
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
      proc.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });

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
        // If inactive for > 45 seconds (no segment or playlist requested), terminate FFmpeg (was 25s — too aggressive for HDD wakeup & background)
        if (now - session.lastAccess > 45000) {
          console.log(`[Continuous HLS] ⏱️ Inactive session timeout (>25s) for ${sessionId}, terminating process...`);
          this.terminateProcess(session.process);
          // Move to closing sessions so in-flight segment requests can still be served
          const closingId = `${sessionId}_closing_${Date.now()}`;
          const dirToDelete = session.sessionDir;
          this.closingSessions.set(closingId, session);
          this.closingCreatedAt.set(closingId, Date.now());
          this.continuousSessions.delete(sessionId);
          setTimeout(async () => {
            this.closingSessions.delete(closingId);
            this.closingCreatedAt.delete(closingId);
            this.closingServeCount.delete(closingId);
            try { await fs.promises.rm(dirToDelete, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {}
          }, 30000);
        }
      }

      // Clean orphaned session folders older than 5 minutes
      const tempDirSetting = db.prepare('SELECT value FROM server_settings WHERE key = ?').get('transcodeTempDir') as { value: string } | undefined;
      const baseTempDir = tempDirSetting?.value || path.resolve(__dirname, '../../../data/transcodes');
      const sessionsRoot = path.join(baseTempDir, 'hls_sessions');
      
      try {
        const stats = await fs.promises.stat(sessionsRoot);
        if (stats.isDirectory()) {
          const dirs = await fs.promises.readdir(sessionsRoot);
          for (const dir of dirs) {
            if (!this.continuousSessions.has(dir) && !this.closingSessions.has(dir)) {
              const dirPath = path.join(sessionsRoot, dir);
              try {
                const dirStats = await fs.promises.stat(dirPath);
                if (now - dirStats.mtimeMs > 5 * 60 * 1000) {
                  await fs.promises.rm(dirPath, { recursive: true, force: true, maxRetries: 3 });
                }
              } catch (e) {}
            }
          }
        }
      } catch (e) {}
    } catch (e) {}
  }
}

export const ffmpegService = new FFmpegService();
