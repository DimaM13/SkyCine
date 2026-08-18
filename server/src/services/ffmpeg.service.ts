import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
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
  isReady: boolean;
}

class FFmpegService {
  private continuousSessions: Map<string, ContinuousHlsSession> = new Map();
  private closingSessions: Map<string, ContinuousHlsSession> = new Map();
  private detectedEncoder: string | null = null;

  constructor() {
    // Initial cleanup of old orphaned transcodes on server launch
    this.cleanupOrphanedTranscodes();
    // Periodically cleanup dead HLS sessions (idle > 2 minutes)
    setInterval(() => this.cleanupIdleSessions(), 20000);
  }

  private cleanupOrphanedTranscodes() {
    try {
      const transcodeDirs = [
        path.resolve(__dirname, '../../../data/transcodes'),
        path.resolve(__dirname, '../../data/transcodes'),
      ];
      for (const dir of transcodeDirs) {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
          fs.mkdirSync(dir, { recursive: true });
        }
      }
    } catch (e) {}
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
    isApple: boolean = false
  ): Promise<{ sessionId: string }> {
    const cleanStartTime = Math.max(0, Math.floor(startTime));
    const deviceSuffix = isApple ? 'apple' : 'pc';

    // Deterministic session ID based on stream parameters so concurrent requests from multiple users in a room share the exact same FFmpeg process.
    const sessionId = `${media.id}_q${quality}_a${audioIndex}_s${cleanStartTime}_${deviceSuffix}`;

    const existing = this.continuousSessions.get(sessionId);
    if (existing && existing.process && !existing.process.killed) {
      existing.lastAccess = Date.now();
      if (existing.isReady) {
        return { sessionId };
      }
    }

    // If an initialization promise is already in-flight for this session, wait for it!
    const inFlight = this.sessionCreationPromises.get(sessionId);
    if (inFlight) {
      return inFlight;
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

  private async _createContinuousHlsSession(
    media: MediaItem,
    quality: string,
    audioIndex: number,
    cleanStartTime: number,
    isApple: boolean,
    sessionId: string,
    deviceSuffix: string
  ): Promise<{ sessionId: string }> {
    const tempDirSetting = db.prepare('SELECT value FROM server_settings WHERE key = ?').get('transcodeTempDir') as { value: string } | undefined;
    const baseTempDir = tempDirSetting?.value || path.resolve(__dirname, '../../../data/transcodes');

    if (!fs.existsSync(baseTempDir)) {
      fs.mkdirSync(baseTempDir, { recursive: true });
    }

    const sessionDir = path.join(baseTempDir, 'hls_sessions', sessionId);
    if (fs.existsSync(sessionDir)) {
      try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (e) {}
    }
    fs.mkdirSync(sessionDir, { recursive: true });

    // FFmpeg requires forward slashes on Windows
    const ffmpegSessionDir = sessionDir.replace(/\\/g, '/');

    const encoder = await this.detectHardwareEncoder();
    const args: string[] = [
      '-fflags', '+genpts+discardcorrupt+nobuffer',
    ];

    if (encoder === 'h264_nvenc') {
      args.push('-hwaccel', 'cuda');
    }

    if (cleanStartTime > 0) {
      args.push('-noaccurate_seek', '-ss', cleanStartTime.toString());
    }
    args.push('-i', media.filePath);

    args.push('-map', '0:v:0');
    if (audioIndex > 0) {
      args.push('-map', `0:${audioIndex}`);
    } else {
      args.push('-map', '0:a:0?');
    }

    // Check if video can be directly stream-copied without re-encoding (Lossless Direct Stream Copy)
    const isSupportedCodec = media.videoCodec === 'h264' || media.videoCodec === 'hevc' || media.videoCodec === 'h265';
    const canCopyVideo = quality === 'original' && isSupportedCodec;

    let trackAudioCodec = media.audioCodec?.toLowerCase() || '';
    if (audioIndex > 0) {
      try {
        const track = db.prepare('SELECT codec FROM media_tracks WHERE mediaItemId = ? AND streamIndex = ?').get(media.id, audioIndex) as { codec: string } | undefined;
        if (track?.codec) {
          trackAudioCodec = track.codec.toLowerCase();
        }
      } catch (e) {}
    }

    const isAppleNativeAudio = trackAudioCodec.includes('aac') || trackAudioCodec.includes('ac3') || trackAudioCodec.includes('eac3') || trackAudioCodec.includes('mp3') || trackAudioCodec.includes('alac');
    const isPcNativeAudio = trackAudioCodec === 'aac' || trackAudioCodec === 'mp3';
    const canCopyAudio = isApple ? isAppleNativeAudio : isPcNativeAudio;

    console.log(`[Continuous HLS] 🎬 Starting session [${sessionId}] (${isApple ? 'Apple/iPad' : 'PC/Android'}): Video=${media.videoCodec} (${canCopyVideo ? 'DIRECT COPY - NO COMPRESSION' : `TRANSCODE ${encoder}`}), Audio=${trackAudioCodec || 'default'} (${canCopyAudio ? 'DIRECT COPY (Lossless)' : 'TRANSPARENT AAC 320k'}), StartPos=${cleanStartTime}s`);

    if (canCopyVideo) {
      args.push('-c:v', 'copy');
    } else {
      args.push('-c:v', encoder);
      if (encoder === 'h264_nvenc') {
        args.push('-preset', 'p1', '-tune', 'ull', '-cq', '19', '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p', '-g', '48', '-keyint_min', '48');
      } else {
        args.push('-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '20', '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p', '-g', '48', '-keyint_min', '48');
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
      args.push(
        '-c:a', 'aac',
        '-b:a', '320k',
        '-ac', '2'
      );
    }

    args.push(
      '-muxdelay', '0',
      '-muxpreload', '0',
      '-avoid_negative_ts', 'make_zero',
      '-f', 'hls',
      '-hls_init_time', '2',
      '-hls_time', '4',
      '-hls_list_size', '0',
      '-hls_playlist_type', 'event',
      '-hls_flags', 'independent_segments'
    );

    const isHevcDirect = canCopyVideo && (media.videoCodec === 'hevc' || media.videoCodec === 'h265');
    if (isHevcDirect) {
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

    const sessionObj: ContinuousHlsSession = {
      sessionId,
      mediaId: media.id,
      sessionDir,
      process: proc,
      lastAccess: Date.now(),
      quality,
      audioIndex,
      startTime: cleanStartTime,
      isReady: false,
    };
    this.continuousSessions.set(sessionId, sessionObj);

    proc.stderr?.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('Error') || msg.includes('failed')) {
        console.error(`[Continuous HLS stderr] ${sessionId}:`, msg);
      }
    });

    proc.on('error', (err) => {
      console.error(`[Continuous HLS] session ${sessionId} error:`, err);
    });

    proc.on('close', (code) => {
      console.log(`[Continuous HLS] session ${sessionId} exited (code: ${code})`);
    });

    // Wait until playlist and at least seg_0000.ts exist and ready (typically ~50-150ms)
    const playlistPath = path.join(sessionDir, 'playlist.m3u8');
    const firstSegPath = path.join(sessionDir, 'seg_0000.ts');

    const maxWaitMs = 15000; // Increased to 15s to allow for deep seeks in large HEVC/MKV files
    const startWait = Date.now();

    while (Date.now() - startWait < maxWaitMs) {
      if (proc.killed || !this.continuousSessions.has(sessionId)) {
        console.log(`[Continuous HLS] 🛑 Session ${sessionId} superseded/cancelled during startup`);
        break;
      }
      if (isHevcDirect) {
        if (fs.existsSync(playlistPath) && fs.existsSync(path.join(sessionDir, 'init.mp4'))) {
          const m4sPath = path.join(sessionDir, 'seg_0000.m4s');
          if (fs.existsSync(m4sPath) && fs.statSync(m4sPath).size > 100) {
            sessionObj.isReady = true;
            console.log(`[Continuous HLS] ⚡ Session ready in ${Date.now() - startWait}ms: ${sessionId}`);
            break;
          }
        }
      } else {
        if (fs.existsSync(playlistPath) && fs.existsSync(firstSegPath) && fs.statSync(firstSegPath).size > 100) {
          sessionObj.isReady = true;
          console.log(`[Continuous HLS] ⚡ Session ready in ${Date.now() - startWait}ms: ${sessionId}`);
          break;
        }
      }
      await new Promise(r => setTimeout(r, 20));
    }

    sessionObj.isReady = true;

    // Gracefully clean up previous sessions for the same media item and device
    // 1. Immediately kill old FFmpeg process so it stops saturating disk I/O and CPU
    // 2. Keep session directory for 5 seconds so in-flight segment downloads finish cleanly with HTTP 200
    for (const [sId, sess] of this.continuousSessions.entries()) {
      if (sess.mediaId === media.id && sId.endsWith(`_${deviceSuffix}`) && sId !== sessionId) {
        console.log(`[Continuous HLS] 🧹 Graceful retirement for previous seek session: ${sId}`);
        this.continuousSessions.delete(sId);
        this.closingSessions.set(sId, sess);
        try { sess.process.kill(); } catch (e) {}
        setTimeout(() => {
          this.closingSessions.delete(sId);
          try { fs.rmSync(sess.sessionDir, { recursive: true, force: true }); } catch (e) {}
        }, 30000);
      }
    }

    return { sessionId };
  }

  public hasSession(sessionId: string): boolean {
    return this.continuousSessions.has(sessionId) || this.closingSessions.has(sessionId);
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

  private cleanupIdleSessions() {
    try {
      const now = Date.now();
      for (const [sessionId, session] of this.continuousSessions.entries()) {
        // If inactive for > 10 minutes (600,000ms), terminate and clean up
        if (now - session.lastAccess > 600000) {
          try { session.process.kill(); } catch (e) {}
          try { fs.rmSync(session.sessionDir, { recursive: true, force: true }); } catch (e) {}
          this.continuousSessions.delete(sessionId);
          console.log(`[Continuous HLS] Cleaned up idle session ${sessionId}`);
        }
      }

      // Clean orphaned session folders older than 30 minutes
      const tempDirSetting = db.prepare('SELECT value FROM server_settings WHERE key = ?').get('transcodeTempDir') as { value: string } | undefined;
      const baseTempDir = tempDirSetting?.value || path.resolve(__dirname, '../../../data/transcodes');
      const sessionsRoot = path.join(baseTempDir, 'hls_sessions');
      if (fs.existsSync(sessionsRoot)) {
        const dirs = fs.readdirSync(sessionsRoot);
        for (const dir of dirs) {
          if (!this.continuousSessions.has(dir) && !this.closingSessions.has(dir)) {
            const dirPath = path.join(sessionsRoot, dir);
            try {
              const stats = fs.statSync(dirPath);
              if (now - stats.mtimeMs > 30 * 60 * 1000) {
                fs.rmSync(dirPath, { recursive: true, force: true });
              }
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
  }
}

export const ffmpegService = new FFmpegService();
