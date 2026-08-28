import { logger } from '../services/logger.service';
import { Response } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { db } from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';
import { ffmpegService } from '../services/ffmpeg.service';
import { MediaItem } from '../types';
import { permissionService } from '../services/permission.service';

export class StreamController {
  public static async remuxStream(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const userId = req.user?.id || '';
      const userRole = req.user?.role || 'USER';

      if (!permissionService.hasMediaOrRoomAccess(userId, userRole, id)) {
        res.status(403).json({ error: 'Доступ к стриму ограничен администратором' });
        return;
      }

      const media = db.prepare('SELECT * FROM media_items WHERE id = ?').get(id) as MediaItem | undefined;
      if (!media || !fs.existsSync(media.filePath)) {
        res.status(404).json({ error: 'Медиафайл не найден' });
        return;
      }

      const quality = (req.query.quality as string) || 'original';
      const audioIndex = parseInt(req.query.audioIndex as string || '0', 10);
      const startTime = Math.max(0, parseFloat(req.query.startTime as string || '0'));

      const encoder = await ffmpegService.detectHardwareEncoder();
      const args: string[] = [
        '-fflags', '+genpts+discardcorrupt+nobuffer',
      ];

      if (startTime > 0) {
        args.push('-noaccurate_seek', '-ss', startTime.toString());
      }
      args.push('-i', media.filePath);

      args.push('-map', '0:v:0');
      if (audioIndex > 0) {
        args.push('-map', `0:${audioIndex}`);
      } else {
        args.push('-map', '0:a:0?');
      }

      const canCopyVideo = quality === 'original' && (media.videoCodec === 'h264' || !media.videoCodec);

      if (canCopyVideo) {
        args.push('-c:v', 'copy');
      } else {
        args.push('-c:v', encoder);
        if (encoder === 'h264_nvenc') {
          args.push('-preset', 'p1', '-tune', 'ull', '-cq', '19', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', '48');
        } else {
          args.push('-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', '48');
        }

        if (quality === '720p') {
          args.push('-vf', 'scale=-2:720', '-b:v', '3500k');
        } else if (quality === '480p') {
          args.push('-vf', 'scale=-2:480', '-b:v', '1800k');
        } else if (quality === '1080p') {
          args.push('-vf', 'scale=-2:1080', '-b:v', '8000k');
        }
      }

      args.push(
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ac', '2',
        '-af', 'aresample=async=1:first_pts=0',
        '-avoid_negative_ts', 'make_zero',
        '-max_muxing_queue_size', '1024',
        '-flush_packets', '1',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof+faststart',
        '-f', 'mp4',
        'pipe:1'
      );

      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'Accept-Ranges': 'none',
      });

      const proc = spawn('ffmpeg', args, { windowsHide: true });
      proc.stdout.pipe(res);

      req.on('close', () => {
        try { proc.kill(); } catch (e) {}
      });

      proc.on('error', (err) => {
        console.error('Remux ffmpeg error:', err);
      });
    } catch (err) {
      console.error('remuxStream error:', err);
      res.status(500).json({ error: 'Ошибка при отдаче ремукс-потока' });
    }
  }

  public static async getStreamInfo(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const userId = req.user?.id || '';
      const userRole = req.user?.role || 'USER';

      if (!permissionService.hasMediaOrRoomAccess(userId, userRole, id)) {
        res.status(403).json({ error: 'Доступ к данному медиафайлу ограничен' });
        return;
      }

      const media = db.prepare('SELECT * FROM media_items WHERE id = ?').get(id) as MediaItem | undefined;
      if (!media) {
        res.status(404).json({ error: 'Медиа не найдено' });
        return;
      }

      const tracks = db.prepare('SELECT * FROM media_tracks WHERE mediaItemId = ?').all(id) as any[];
      const ext = path.extname(media.filePath).toLowerCase();

      const isMp4 = ext === '.mp4' || ext === '.m4v';
      const isH264 = media.videoCodec === 'h264';
      const isAac = media.audioCodec === 'aac' || media.audioCodec === 'mp3';

      const canDirectPlay = isMp4 && isH264 && isAac;
      const canDirectStream = isH264;

      res.json({
        mediaId: media.id,
        title: media.title,
        durationSeconds: media.durationSeconds,
        videoCodec: media.videoCodec,
        audioCodec: media.audioCodec,
        resolution: media.resolution,
        fileExtension: ext,
        canDirectPlay,
        canDirectStream,
        audioTracks: tracks.filter(t => t.type === 'AUDIO'),
        subtitleTracks: tracks.filter(t => t.type === 'SUBTITLE'),
        availableQualities: ['original', '1080p', '720p', '480p'],
      });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка получения информации о потоке' });
    }
  }

  public static async directStream(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const userId = req.user?.id || '';
      const userRole = req.user?.role || 'USER';

      if (!permissionService.hasMediaOrRoomAccess(userId, userRole, id)) {
        res.status(403).json({ error: 'Доступ к стриму ограничен администратором' });
        return;
      }

      const media = db.prepare('SELECT * FROM media_items WHERE id = ?').get(id) as MediaItem | undefined;
      if (!media || !fs.existsSync(media.filePath)) {
        res.status(404).json({ error: 'Видеофайл не найден на диске' });
        return;
      }

      const stat = fs.statSync(media.filePath);
      const fileSize = stat.size;
      const range = req.headers.range;
      const mimeType = mime.lookup(media.filePath) || 'video/mp4';

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;

        const file = fs.createReadStream(media.filePath, { start, end });
        const head = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': mimeType,
        };

        res.writeHead(206, head);
        file.pipe(res);
      } else {
        const head = {
          'Content-Length': fileSize,
          'Content-Type': mimeType,
          'Accept-Ranges': 'bytes',
        };
        res.writeHead(200, head);
        fs.createReadStream(media.filePath).pipe(res);
      }
    } catch (err) {
      console.error('DirectStream error:', err);
      res.status(500).json({ error: 'Ошибка при отдаче видеопотока' });
    }
  }

  public static async startHlsSession(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const userId = req.user?.id || '';
      const userRole = req.user?.role || 'USER';

      if (!permissionService.hasMediaOrRoomAccess(userId, userRole, id)) {
        res.status(403).json({ error: 'Доступ к данному медиафайлу ограничен' });
        return;
      }

      const quality = (req.query.quality as string) || 'original';
      const audioIndex = parseInt(req.query.audioIndex as string || '0', 10);
      const startTime = parseFloat(req.query.startTime as string || '0');
      const userAgent = req.headers['user-agent'] || '';
      const isApple = req.query.isApple === '1' || /iPad|iPhone|iPod|Macintosh/i.test(userAgent);
      const roomId = req.query.roomId as string || '';

      const media = db.prepare('SELECT * FROM media_items WHERE id = ?').get(id) as MediaItem | undefined;
      if (!media || !fs.existsSync(media.filePath)) {
        res.status(404).json({ error: 'Медиафайл не найден' });
        return;
      }

      const deviceSuffix = isApple ? 'apple' : 'pc';
      const roomSuffix = roomId ? `_r${roomId}` : '';
      const userSuffix = (roomId && userId) ? `_u${userId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8)}` : '';
      const sessionId = `${media.id}_q${quality}_a${audioIndex}_${deviceSuffix}${roomSuffix}${userSuffix}`;

      // Start / Prewarm continuous session
      ffmpegService.startContinuousHlsSession(media, quality, audioIndex, startTime, isApple, sessionId).catch(() => {});

      res.json({ sessionId, playlistUrl: `/api/stream/hls/session/${sessionId}/playlist.m3u8` });
    } catch (err) {
      console.error('startHlsSession error:', err);
      res.status(500).json({ error: 'Ошибка запуска сессии HLS' });
    }
  }

  public static async endHlsSession(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id || '';
      const mediaId = req.body?.mediaId || (req.query.mediaId as string);
      const quality = req.body?.quality || (req.query.quality as string);
      const audioIndex = req.body?.audioIndex !== undefined ? req.body.audioIndex : (req.query.audioIndex !== undefined ? parseInt(req.query.audioIndex as string, 10) : undefined);
      const isApple = req.body?.isApple !== undefined ? req.body.isApple : (req.query.isApple === '1');
      const roomId = req.body?.roomId || (req.query.roomId as string);

      if (roomId) {
        const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId);
        if (room) {
          if (mediaId && quality && audioIndex !== undefined) {
            const deviceSuffix = isApple ? 'apple' : 'pc';
            const roomSuffix = `_r${roomId}`;
            const userSuffix = userId ? `_u${userId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8)}` : '';
            const sessionId = `${mediaId}_q${quality}_a${audioIndex}_${deviceSuffix}${roomSuffix}${userSuffix}`;
            ffmpegService.killSession(sessionId);
          }
          res.json({ success: true, message: 'User room session ended' });
          return;
        }
      }

      if (mediaId) {
        if (quality && audioIndex !== undefined) {
          const deviceSuffix = isApple ? 'apple' : 'pc';
          const roomSuffix = roomId ? `_r${roomId}` : '';
          const userSuffix = (roomId && userId) ? `_u${userId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8)}` : '';
          const sessionId = `${mediaId}_q${quality}_a${audioIndex}_${deviceSuffix}${roomSuffix}${userSuffix}`;
          ffmpegService.killSession(sessionId);
        }
        if (!roomId) {
          ffmpegService.killSoloSessionsForMedia(mediaId);
        }
      }
      res.json({ success: true });
    } catch (err) {
      console.error('endHlsSession error:', err);
      res.status(500).json({ error: 'Ошибка завершения сессии HLS' });
    }
  }

  public static async getHlsMaster(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const userId = req.user?.id || '';
      const userRole = req.user?.role || 'USER';

      if (!permissionService.hasMediaOrRoomAccess(userId, userRole, id)) {
        res.status(403).json({ error: 'Доступ к данному медиафайлу ограничен' });
        return;
      }

      const quality = (req.query.quality as string) || 'original';
      const audioIndex = parseInt(req.query.audioIndex as string || '0', 10);
      const startTime = parseFloat(req.query.startTime as string || '0');
      const userAgent = req.headers['user-agent'] || '';
      const isApple = req.query.isApple === '1' || /iPad|iPhone|iPod|Macintosh/i.test(userAgent);
      const authHeader = req.headers.authorization;
      const token = (req.query.token as string) || (typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '') : '');
      const roomId = req.query.roomId as string || '';

      const media = db.prepare('SELECT * FROM media_items WHERE id = ?').get(id) as MediaItem | undefined;
      if (!media || !fs.existsSync(media.filePath)) {
        res.status(404).json({ error: 'Медиафайл не найден' });
        return;
      }

      const deviceSuffix = isApple ? 'apple' : 'pc';
      const roomSuffix = roomId ? `_r${roomId}` : '';
      const userSuffix = (roomId && userId) ? `_u${userId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8)}` : '';
      const sessionId = `${media.id}_q${quality}_a${audioIndex}_${deviceSuffix}${roomSuffix}${userSuffix}`;

      // Start/prewarm session
      ffmpegService.startContinuousHlsSession(media, quality, audioIndex, startTime, isApple, sessionId).catch(() => {});

      const startT = req.query.startTime ? parseFloat(req.query.startTime as string) : 0;
      const playlist = ffmpegService.generateVodPlaylist(media, sessionId, token, startT);

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.send(playlist);
    } catch (err) {
      logger.error("HLS_CRITICAL", "HLS failed!", err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Ошибка генерации HLS плейлиста' });
      }
    }
  }

  public static async getHlsSessionPlaylist(req: AuthRequest, res: Response): Promise<void> {
    try {
      const sessionId = req.params.sessionId as string;
      const authHeader = req.headers.authorization;
      const token = (req.query.token as string) || (typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '') : '');

      const mediaId = sessionId.split('_')[0];
      const media = db.prepare('SELECT * FROM media_items WHERE id = ?').get(mediaId) as MediaItem | undefined;

      if (!media) {
        res.status(404).send('Media not found');
        return;
      }

      const startT = req.query.startTime ? parseFloat(req.query.startTime as string) : 0;
      const playlist = ffmpegService.generateVodPlaylist(media, sessionId, token, startT);

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.send(playlist);
    } catch (err) {
      logger.error("HLS_CRITICAL", "HLS failed!", err);
      res.status(500).send('Session playlist error');
    }
  }

  public static async getHlsSessionSegment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const sessionOrMediaId = String(req.params.sessionId || req.params.mediaId || req.params.id || '');
      const segmentName = String(req.params.segmentName || '');

      const mediaId = sessionOrMediaId.split('_')[0];
      const media = db.prepare('SELECT * FROM media_items WHERE id = ?').get(mediaId) as MediaItem | undefined;
      if (!media) {
        res.status(404).send('Media not found');
        return;
      }

      const segmentPath = await ffmpegService.ensureSegmentReady(sessionOrMediaId, segmentName, media);

      if (!segmentPath || !fs.existsSync(segmentPath)) {
        res.status(404).send('Segment not found');
        return;
      }

      const stat = fs.statSync(segmentPath);
      let contentType = 'video/mp2t';
      if (segmentPath.endsWith('.m4s') || segmentPath.endsWith('.mp4')) {
        contentType = 'video/mp4';
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', 'public, max-age=3600');

      const fileStream = fs.createReadStream(segmentPath);
      fileStream.pipe(res);
      res.on('close', () => {
        try { fileStream.destroy(); } catch {}
      });
      fileStream.on('error', () => {
        try { fileStream.destroy(); } catch {}
      });
    } catch (err) {
      logger.error("HLS_CRITICAL", "HLS segment error", err);
      res.status(500).send('Segment delivery error');
    }
  }

  public static async getSubtitle(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id, trackIndex } = req.params;
      const format = (req.query.format as string) === 'ass' ? 'ass' : 'vtt';

      const media = db.prepare('SELECT filePath FROM media_items WHERE id = ?').get(id) as { filePath: string } | undefined;
      if (!media || !fs.existsSync(media.filePath)) {
        res.status(404).send('Media not found');
        return;
      }

      const streamIndex = parseInt(trackIndex as string, 10);
      const subtitleContent = await ffmpegService.extractSubtitle(media.filePath, streamIndex, format);

      res.setHeader('Content-Type', format === 'ass' ? 'text/plain; charset=utf-8' : 'text/vtt; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(subtitleContent);
    } catch (err) {
      console.error('getSubtitle error:', err);
      res.status(500).send('Subtitle extraction error');
    }
  }
}
