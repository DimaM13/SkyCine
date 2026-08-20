import { Request, Response } from 'express';
import { spawn, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import axios from 'axios';

const execFileAsync = promisify(execFile);

interface CachedYtStream {
  videoUrl: string;
  audioUrl?: string;
  isCombined: boolean;
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

    // Prefer progressive combined MP4 (format 18 / best[acodec!=none]) for 100% native iOS Safari Range support
    const args = [
      '--dump-single-json',
      '--no-playlist',
      '--js-runtimes', 'node',
      '--remote-components', 'ejs:github',
      '--format', '18/best[ext=mp4][acodec!=none]/best[acodec!=none]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',
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
      let isCombined = false;

      if (info.url && info.acodec && info.acodec !== 'none' && info.vcodec && info.vcodec !== 'none') {
        // Combined stream with both audio and video
        vUrl = info.url;
        isCombined = true;
      } else if (info.requested_formats && info.requested_formats.length >= 2) {
        vUrl = info.requested_formats[0].url;
        aUrl = info.requested_formats[1].url;
        isCombined = false;
      } else if (info.url) {
        vUrl = info.url;
        isCombined = true;
      }

      if (!vUrl) {
        throw new Error('No stream URL extracted from YouTube');
      }

      const streamData: CachedYtStream = {
        videoUrl: vUrl,
        audioUrl: aUrl || undefined,
        isCombined,
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
        isCombined: info.isCombined,
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
   * Streams progressive MP4 with full HTTP 206 Range request support for iOS/iPadOS Safari & Chrome
   */
  public static async stream(req: Request, res: Response): Promise<void> {
    try {
      const videoId = req.params.videoId as string;
      if (!videoId) {
        res.status(400).send('videoId is required');
        return;
      }

      const streamInfo = await YouTubeController.extractStreamUrls(videoId);
      const { videoUrl, audioUrl, isCombined } = streamInfo;

      // 1. If combined stream, proxy directly with native HTTP Range support (perfect for iOS/iPadOS Safari)
      if (isCombined || !audioUrl) {
        const range = req.headers.range;

        const proxyHeaders: Record<string, string> = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': '*/*',
        };
        if (range) {
          proxyHeaders['Range'] = range;
        }

        const upstream = await axios({
          method: 'get',
          url: videoUrl,
          headers: proxyHeaders,
          responseType: 'stream',
          validateStatus: () => true,
        });

        const responseHeaders: Record<string, any> = {
          'Content-Type': upstream.headers['content-type'] || 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        };

        if (upstream.headers['content-length']) {
          responseHeaders['Content-Length'] = upstream.headers['content-length'];
        }
        if (upstream.headers['content-range']) {
          responseHeaders['Content-Range'] = upstream.headers['content-range'];
        }

        res.writeHead(upstream.status, responseHeaders);
        upstream.data.pipe(res);

        const cleanup = () => {
          try {
            upstream.data?.destroy?.();
          } catch (e) {}
        };
        req.on('close', cleanup);
        res.on('close', cleanup);
        return;
      }

      // 2. Separate video + audio streams: remux on-the-fly via ffmpeg
      const startSec = Math.max(0, parseFloat(req.query.start as string) || 0);
      const ffmpegArgs: string[] = [];

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

      ffmpegArgs.push(
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        '-f', 'mp4',
        'pipe:1'
      );

      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Access-Control-Allow-Origin': '*',
      });

      const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      ffmpeg.stdout.pipe(res);

      const cleanup = () => {
        try {
          ffmpeg.kill('SIGKILL');
        } catch (e) {}
      };

      req.on('close', cleanup);
      res.on('close', cleanup);
    } catch (err: any) {
      console.error(`[YouTubeController] Streaming error:`, err.message);
      if (!res.headersSent) {
        res.status(500).send(`Streaming error: ${err.message}`);
      }
    }
  }
}
