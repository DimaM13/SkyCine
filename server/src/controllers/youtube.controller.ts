import { Request, Response } from 'express';
import { spawn, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

interface CachedYtStream {
  videoUrl: string;
  audioUrl?: string;
  title: string;
  duration: number;
  expiresAt: number;
}

const streamCache = new Map<string, CachedYtStream>();

export class YouTubeController {
  private static getYtDlpPath(): string {
    // 1. Check virtual env on D: drive
    const venvYtDlp = 'd:\\DowloadAiAll\\.venv\\Scripts\\yt-dlp.exe';
    if (fs.existsSync(venvYtDlp)) return venvYtDlp;

    // 2. Check local server bin directory
    const localBin = path.join(__dirname, '../../bin/yt-dlp.exe');
    if (fs.existsSync(localBin)) return localBin;

    // 3. Fallback to global command
    return 'yt-dlp';
  }

  private static getCookiesPath(): string | null {
    const serverCookies = path.join(__dirname, '../../cookies.txt');
    if (fs.existsSync(serverCookies)) return serverCookies;

    const dowloadAiCookies = 'd:\\DowloadAiAll\\cookies.txt';
    if (fs.existsSync(dowloadAiCookies)) return dowloadAiCookies;

    return null;
  }

  /**
   * Extract direct GoogleVideo URLs for a YouTube video using yt-dlp
   */
  public static async extractStreamUrls(videoId: string): Promise<CachedYtStream> {
    const cached = streamCache.get(videoId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }

    const ytdlpPath = YouTubeController.getYtDlpPath();
    const cookiesPath = YouTubeController.getCookiesPath();
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    const args = [
      '--dump-single-json',
      '--no-playlist',
      '--js-runtimes', 'node',
      '--remote-components', 'ejs:github',
      '--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best/18',
      ...(cookiesPath ? ['--cookies', cookiesPath] : []),
      videoUrl,
    ];

    try {
      const { stdout } = await execFileAsync(ytdlpPath, args, { maxBuffer: 10 * 1024 * 1024, timeout: 25000 });
      const info = JSON.parse(stdout);

      const title = info.title || 'YouTube Video';
      const duration = info.duration || 0;

      let vUrl = '';
      let aUrl = '';

      if (info.requested_formats && info.requested_formats.length >= 2) {
        vUrl = info.requested_formats[0].url;
        aUrl = info.requested_formats[1].url;
      } else if (info.url) {
        vUrl = info.url;
      } else if (info.formats && info.formats.length > 0) {
        const best = info.formats[info.formats.length - 1];
        vUrl = best.url;
      }

      if (!vUrl) {
        throw new Error('No stream URL extracted from YouTube');
      }

      const streamData: CachedYtStream = {
        videoUrl: vUrl,
        audioUrl: aUrl || undefined,
        title,
        duration,
        expiresAt: Date.now() + 3.5 * 60 * 60 * 1000, // 3.5 hours
      };

      streamCache.set(videoId, streamData);
      return streamData;
    } catch (err: any) {
      console.error(`[YouTubeController] Failed to extract streams for ${videoId}:`, err.message);
      throw err;
    }
  }

  /**
   * GET /api/stream/youtube/info/:videoId
   */
  public static async getInfo(req: Request, res: Response): Promise<void> {
    try {
      const videoId = req.params.videoId as string;
      if (!videoId) {
        res.status(400).json({ error: 'videoId is required' });
        return;
      }

      const info = await YouTubeController.extractStreamUrls(videoId);
      res.json({
        success: true,
        videoId,
        title: info.title,
        duration: info.duration,
        hasAudioStream: !!info.audioUrl,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to retrieve YouTube video stream info',
        message: err.message,
      });
    }
  }

  /**
   * GET /api/stream/youtube/:videoId
   * Streams video + audio remuxed on-the-fly via ffmpeg as fragmented MP4
   */
  public static async stream(req: Request, res: Response): Promise<void> {
    try {
      const videoId = req.params.videoId as string;
      const startSec = Math.max(0, parseFloat(req.query.start as string) || 0);

      if (!videoId) {
        res.status(400).send('videoId is required');
        return;
      }

      const streamInfo = await YouTubeController.extractStreamUrls(videoId);
      const { videoUrl, audioUrl } = streamInfo;

      const ffmpegArgs: string[] = [];

      // Video input with seeking
      if (startSec > 0) {
        ffmpegArgs.push('-ss', startSec.toString());
      }
      ffmpegArgs.push(
        '-reconnect', '1',
        '-reconnect_at_eof', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', videoUrl
      );

      // Audio input with seeking (if separate)
      if (audioUrl) {
        if (startSec > 0) {
          ffmpegArgs.push('-ss', startSec.toString());
        }
        ffmpegArgs.push(
          '-reconnect', '1',
          '-reconnect_at_eof', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '5',
          '-i', audioUrl
        );
      }

      // Fast remux: copy video codec, encode audio to aac (or copy if compatible)
      ffmpegArgs.push(
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        '-f', 'mp4',
        'pipe:1'
      );

      console.log(`[YouTubeController] Starting ffmpeg stream for ${videoId} at ${startSec}s`);

      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Access-Control-Allow-Origin': '*',
      });

      const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

      ffmpeg.stdout.pipe(res);

      ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('Error') || msg.includes('fatal')) {
          console.warn(`[YouTube ffmpeg] ${msg.trim()}`);
        }
      });

      const cleanup = () => {
        try {
          ffmpeg.kill('SIGKILL');
        } catch (e) {}
      };

      req.on('close', cleanup);
      res.on('close', cleanup);
      res.on('error', cleanup);
    } catch (err: any) {
      console.error(`[YouTubeController] Streaming error:`, err.message);
      if (!res.headersSent) {
        res.status(500).send(`Streaming error: ${err.message}`);
      }
    }
  }
}
