import { Request, Response } from 'express';
import { spawn, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

interface DownloadProgress {
  videoId: string;
  status: 'downloading' | 'ready' | 'error';
  percent: number;
  title: string;
  duration: number;
  filePath?: string;
  error?: string;
}

const activeDownloads = new Map<string, DownloadProgress>();
const cacheDir = path.resolve(__dirname, '../../uploads/youtube_cache');

if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

export class YouTubeController {
  private static getYtDlpPath(): string {
    const venvYtDlp = 'd:\\DowloadAiAll\\.venv\\Scripts\\yt-dlp.exe';
    if (fs.existsSync(venvYtDlp)) return venvYtDlp;

    const localBin = path.join(__dirname, '../../bin/yt-dlp.exe');
    if (fs.existsSync(localBin)) return localBin;

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
   * Start 1080p background download of a YouTube video to uploads/youtube_cache
   */
  public static startDownload(videoId: string): DownloadProgress {
    const filePath = path.join(cacheDir, `${videoId}.mp4`);

    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1024 * 1024) {
      const progress: DownloadProgress = {
        videoId,
        status: 'ready',
        percent: 100,
        title: 'YouTube Video',
        duration: 0,
        filePath,
      };
      activeDownloads.set(videoId, progress);
      return progress;
    }

    const existing = activeDownloads.get(videoId);
    if (existing && existing.status === 'downloading') {
      return existing;
    }

    const progress: DownloadProgress = {
      videoId,
      status: 'downloading',
      percent: 5,
      title: 'YouTube Video',
      duration: 0,
      filePath,
    };
    activeDownloads.set(videoId, progress);

    const ytdlpPath = YouTubeController.getYtDlpPath();
    const cookiesPath = YouTubeController.getCookiesPath();
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    const args = [
      '--newline',
      '--js-runtimes', 'node',
      '--remote-components', 'ejs:github',
      '--format-sort', 'vcodec:h264,acodec:m4a,res:1080',
      '--format', 'bestvideo[height<=1080][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=1080]+bestaudio/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--recode-video', 'mp4',
      '--postprocessor-args', 'ffmpeg:-movflags +faststart',
      '--http-chunk-size', '5242880',
      '--retries', '25',
      '--fragment-retries', '25',
      ...(cookiesPath ? ['--cookies', cookiesPath] : []),
      '-o', filePath,
      videoUrl,
    ];

    console.log(`[YouTubeController] Starting 1080p download for ${videoId}`);

    const process = spawn(ytdlpPath, args);

    process.stdout.on('data', (data) => {
      const line = data.toString();
      // Match "[download]  45.6% of ..."
      const match = line.match(/\[download\]\s+([\d\.]+)%/);
      if (match && match[1]) {
        const pct = Math.min(99, Math.round(parseFloat(match[1])));
        progress.percent = Math.max(progress.percent, pct);
      }
    });

    process.stderr.on('data', (data) => {
      const line = data.toString();
      if (line.includes('ERROR:')) {
        console.error(`[YouTubeController] Download error for ${videoId}:`, line.trim());
      }
    });

    process.on('close', (code) => {
      if (code === 0 && fs.existsSync(filePath) && fs.statSync(filePath).size > 1024 * 1024) {
        progress.status = 'ready';
        progress.percent = 100;
        console.log(`[YouTubeController] 1080p download completed for ${videoId}`);
      } else {
        progress.status = 'error';
        progress.error = `yt-dlp exited with code ${code}`;
        console.error(`[YouTubeController] 1080p download failed for ${videoId} (code ${code})`);
      }
    });

    return progress;
  }

  /**
   * GET /api/stream/youtube/download-status/:videoId
   */
  public static async getDownloadStatus(req: Request, res: Response): Promise<void> {
    try {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      const videoId = req.params.videoId as string;
      if (!videoId) {
        res.status(400).json({ error: 'videoId is required' });
        return;
      }

      const filePath = path.join(cacheDir, `${videoId}.mp4`);
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1024 * 1024) {
        res.json({
          success: true,
          videoId,
          status: 'ready',
          percent: 100,
        });
        return;
      }

      let progress = activeDownloads.get(videoId);
      if (!progress || progress.status === 'error') {
        progress = YouTubeController.startDownload(videoId);
      }

      res.json({
        success: true,
        videoId,
        status: progress.status,
        percent: progress.percent,
        error: progress.error,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to retrieve download status',
        message: err.message,
      });
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

      const filePath = path.join(cacheDir, `${videoId}.mp4`);
      const isReady = fs.existsSync(filePath) && fs.statSync(filePath).size > 1024 * 1024;

      if (!isReady) {
        YouTubeController.startDownload(videoId);
      }

      res.json({
        success: true,
        videoId,
        isReady,
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
   * Serves 1080p MP4 file with native HTTP 206 Range headers for iOS Safari and all browsers
   */
  public static async stream(req: Request, res: Response): Promise<void> {
    try {
      const videoId = req.params.videoId as string;
      if (!videoId) {
        res.status(400).send('videoId is required');
        return;
      }

      const filePath = path.join(cacheDir, `${videoId}.mp4`);

      // If already downloaded, serve with standard Range headers support
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1024 * 1024) {
        res.sendFile(filePath, {
          acceptRanges: true,
          headers: {
            'Content-Type': 'video/mp4',
            'Access-Control-Allow-Origin': '*',
          },
        });
        return;
      }

      // If not yet downloaded, start download and notify client
      YouTubeController.startDownload(videoId);
      res.status(202).json({
        status: 'downloading',
        message: 'Video is being downloaded in 1080p quality. Please wait.',
      });
    } catch (err: any) {
      console.error(`[YouTubeController] Streaming error:`, err.message);
      if (!res.headersSent) {
        res.status(500).send(`Streaming error: ${err.message}`);
      }
    }
  }
}
