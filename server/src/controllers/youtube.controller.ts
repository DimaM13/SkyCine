import { Request, Response } from 'express';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

interface DownloadProgress {
  videoId: string;
  status: 'downloading' | 'ready' | 'error';
  percent: number;
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

  public static deleteCache(videoId: string): void {
    if (!videoId) return;
    try {
      const filePath = path.join(cacheDir, `${videoId}.mp4`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[YouTube] Deleted cache for ${videoId}`);
      }
      activeDownloads.delete(videoId);
    } catch (err) {
      console.error(`[YouTube] Error deleting cache for ${videoId}:`, err);
    }
  }

  public static startDownload(videoId: string): DownloadProgress {
    const filePath = path.join(cacheDir, `${videoId}.mp4`);

    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1024 * 1024) {
      const progress: DownloadProgress = {
        videoId,
        status: 'ready',
        percent: 100,
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
      filePath,
    };
    activeDownloads.set(videoId, progress);

    const ytdlpPath = YouTubeController.getYtDlpPath();
    const cookiesPath = YouTubeController.getCookiesPath();
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    const args = [
      '--newline',
      '--format-sort', 'vcodec:h264,acodec:m4a,res:1080',
      '--format', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--recode-video', 'mp4',
      '--postprocessor-args', 'ffmpeg:-movflags +faststart',
      '--retries', '10',
      '--fragment-retries', '10',
      ...(cookiesPath ? ['--cookies', cookiesPath] : []),
      '-o', filePath,
      videoUrl,
    ];

    console.log(`[YouTube] Starting 1080p download for ${videoId}`);

    const process = spawn(ytdlpPath, args, { windowsHide: true });

    process.stdout.on('data', (data) => {
      const line = data.toString();
      const match = line.match(/\[download\]\s+([\d\.]+)%/);
      if (match && match[1]) {
        const pct = Math.min(99, Math.round(parseFloat(match[1])));
        progress.percent = Math.max(progress.percent, pct);
      }
    });

    process.stderr.on('data', (data) => {
      const line = data.toString();
      if (line.includes('ERROR:')) {
        console.error(`[YouTube] Error for ${videoId}:`, line.trim());
      }
    });

    process.on('close', (code) => {
      if (code === 0 && fs.existsSync(filePath) && fs.statSync(filePath).size > 1024 * 1024) {
        progress.status = 'ready';
        progress.percent = 100;
        console.log(`[YouTube] Download completed: ${videoId}`);
      } else {
        progress.status = 'error';
        progress.error = `yt-dlp exit code ${code}`;
      }
    });

    return progress;
  }

  public static async getDownloadStatus(req: Request, res: Response): Promise<void> {
    try {
      const videoId = req.params.videoId as string;
      if (!videoId) {
        res.status(400).json({ error: 'videoId is required' });
        return;
      }

      const filePath = path.join(cacheDir, `${videoId}.mp4`);
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1024 * 1024) {
        res.json({ success: true, videoId, status: 'ready', percent: 100 });
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
      res.status(500).json({ error: err.message });
    }
  }

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

      res.json({ success: true, videoId, isReady });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  public static async stream(req: Request, res: Response): Promise<void> {
    try {
      const videoId = req.params.videoId as string;
      if (!videoId) {
        res.status(400).send('videoId is required');
        return;
      }

      const filePath = path.join(cacheDir, `${videoId}.mp4`);
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1024 * 1024) {
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunksize = (end - start) + 1;

          const file = fs.createReadStream(filePath, { start, end });
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': 'video/mp4',
            'Access-Control-Allow-Origin': '*',
          });
          file.pipe(res);
        } else {
          res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
          });
          fs.createReadStream(filePath).pipe(res);
        }
        return;
      }

      YouTubeController.startDownload(videoId);
      res.status(202).json({ status: 'downloading', message: 'Downloading in 1080p. Please wait.' });
    } catch (err: any) {
      res.status(500).send(`Streaming error: ${err.message}`);
    }
  }
}
