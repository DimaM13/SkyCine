import { logger } from '../services/logger.service';
import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';
import { MediaItem } from '../types';
import { tmdbService } from '../services/tmdb.service';
import { permissionService } from '../services/permission.service';

const activeThumbnailTasks = new Map<string, Promise<string | null>>();
const failedThumbnailIds = new Map<string, number>();
let currentRunningThumbJobs = 0;
const MAX_CONCURRENT_THUMBS = 2;
const thumbJobQueue: Array<() => void> = [];

function queueThumbnailJob<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const execute = () => {
      currentRunningThumbJobs++;
      fn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          currentRunningThumbJobs--;
          if (thumbJobQueue.length > 0) {
            const next = thumbJobQueue.shift();
            if (next) next();
          }
        });
    };

    if (currentRunningThumbJobs < MAX_CONCURRENT_THUMBS) {
      execute();
    } else {
      thumbJobQueue.push(execute);
    }
  });
}

export class MediaController {
  public static async getMovies(req: AuthRequest, res: Response): Promise<void> {
    try {
      const search = (req.query.search as string || '').trim();
      const genre = (req.query.genre as string || '').trim();
      const libraryId = (req.query.libraryId as string || '').trim();
      const sortBy = (req.query.sortBy as string) || 'recent'; // 'recent', 'rating', 'title', 'year'
      const userId = req.user?.id || '';
      const userRole = req.user?.role || 'USER';

      const filter = permissionService.getMediaFilter(userId, userRole, 'm');

      let query = `
        SELECT m.*, l.name as libraryName,
               wh.progressSeconds as userProgress,
               wh.isCompleted as userCompleted
        FROM media_items m
        JOIN libraries l ON m.libraryId = l.id
        LEFT JOIN watch_history wh ON (wh.mediaItemId = m.id AND wh.userId = ?)
        WHERE m.type IN ('MOVIE', 'VIDEO') AND ${filter.sql}
      `;
      const params: any[] = [userId, ...filter.params];

      if (libraryId) {
        query += ` AND m.libraryId = ?`;
        params.push(libraryId);
      }

      if (search) {
        query += ` AND (m.title LIKE ? OR m.originalTitle LIKE ? OR m.overview LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      if (genre) {
        query += ` AND m.genres LIKE ?`;
        params.push(`%${genre}%`);
      }

      switch (sortBy) {
        case 'rating':
          query += ` ORDER BY m.rating DESC`;
          break;
        case 'title':
          query += ` ORDER BY m.title ASC`;
          break;
        case 'year':
          query += ` ORDER BY m.year DESC`;
          break;
        case 'recent':
        default:
          query += ` ORDER BY m.createdAt DESC`;
          break;
      }

      const movies = db.prepare(query).all(...params);

      // Parse JSON tracks for each movie
      const parsedMovies = movies.map((m: any) => {
        let tracks = [];
        if (typeof m.tracks === 'string') {
          try { tracks = JSON.parse(m.tracks); } catch {}
        } else if (Array.isArray(m.tracks)) {
          tracks = m.tracks;
        }
        return { ...m, tracks };
      });

      res.json({ movies: parsedMovies });
    } catch (err) {
      logger.error('MEDIA_ERR', 'API Error:', err);
      res.status(500).json({ error: 'Ошибка получения списка фильмов' });
    }
  }

  public static async getShows(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id || '';
      const userRole = req.user?.role || 'USER';
      const libraryId = (req.query.libraryId as string || '').trim();

      const filter = permissionService.getMediaFilter(userId, userRole, 'm');

      let query = `
        SELECT MIN(m.id) as id,
               m.showTitle,
               m.showTitle as title,
               'SHOW' as type,
               m.libraryId,
               COUNT(m.id) as totalEpisodes,
               COUNT(DISTINCT m.seasonNumber) as totalSeasons,
               MIN(m.posterPath) as posterPath,
               MIN(m.backdropPath) as backdropPath,
               MIN(m.year) as year,
               MIN(m.rating) as rating,
               MIN(m.overview) as overview
        FROM media_items m
        WHERE m.type = 'EPISODE' AND m.showTitle IS NOT NULL AND ${filter.sql}
      `;
      const params: any[] = [...filter.params];

      if (libraryId) {
        query += ` AND m.libraryId = ?`;
        params.push(libraryId);
      }

      query += `
        GROUP BY m.showTitle
        ORDER BY m.showTitle ASC
      `;

      const shows = db.prepare(query).all(...params);
      res.json({ shows });
    } catch (err) {
      logger.error('MEDIA_ERR', 'API Error:', err);
      res.status(500).json({ error: 'Ошибка получения списка сериалов' });
    }
  }

  public static async getShowEpisodes(req: AuthRequest, res: Response): Promise<void> {
    try {
      const showTitle = decodeURIComponent(req.params.showTitle as string);
      const userId = req.user?.id || '';
      const userRole = req.user?.role || 'USER';
      const filter = permissionService.getMediaFilter(userId, userRole, 'm');

      const episodes = db.prepare(`
        SELECT m.*, l.name as libraryName,
               wh.progressSeconds as userProgress, wh.isCompleted as userCompleted,
               wh.lastWatchedAt as userLastWatchedAt
        FROM media_items m
        JOIN libraries l ON m.libraryId = l.id
        LEFT JOIN watch_history wh ON (wh.mediaItemId = m.id AND wh.userId = ?)
        WHERE m.showTitle = ? AND ${filter.sql}
        ORDER BY m.seasonNumber ASC, m.episodeNumber ASC
      `).all(userId, showTitle, ...filter.params);

      const parsedEpisodes = episodes.map((ep: any) => {
        let tracks = [];
        if (typeof ep.tracks === 'string') {
          try { tracks = JSON.parse(ep.tracks); } catch {}
        } else if (Array.isArray(ep.tracks)) {
          tracks = ep.tracks;
        }
        return { ...ep, tracks };
      });

      res.json({ episodes: parsedEpisodes });
    } catch (err) {
      logger.error('MEDIA_ERR', 'API Error:', err);
      res.status(500).json({ error: 'Ошибка получения серий сериала' });
    }
  }

  public static async getMediaItem(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const userId = req.user?.id || '';
      const userRole = req.user?.role || 'USER';

      // Check permission
      if (!permissionService.hasMediaOrRoomAccess(userId, userRole, id)) {
        res.status(403).json({ error: 'Доступ к данному медиафайлу ограничен администратором' });
        return;
      }

      const media = db.prepare(`
        SELECT m.*, l.name as libraryName,
               wh.progressSeconds as userProgress,
               wh.durationSeconds as userProgressDuration,
               wh.isCompleted as userCompleted,
               wh.lastWatchedAt as userLastWatchedAt
        FROM media_items m
        JOIN libraries l ON m.libraryId = l.id
        LEFT JOIN watch_history wh ON (wh.mediaItemId = m.id AND wh.userId = ?)
        WHERE m.id = ?
      `).get(userId, id) as MediaItem | undefined;

      if (!media) {
        res.status(404).json({ error: 'Медиафайл не найден' });
        return;
      }

      const tracks = db.prepare(`
        SELECT * FROM media_tracks WHERE mediaItemId = ? ORDER BY type ASC, streamIndex ASC
      `).all(id);

      res.json({ media: { ...media, tracks } });
    } catch (err) {
      logger.error('MEDIA_ERR', 'API Error:', err);
      res.status(500).json({ error: 'Ошибка получения информации о медиа' });
    }
  }

  public static async getContinueWatching(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role || 'USER';
      if (!userId) {
        res.json({ items: [] });
        return;
      }

      const filter = permissionService.getMediaFilter(userId, userRole, 'm');

      const items = db.prepare(`
        SELECT wh.progressSeconds, wh.durationSeconds, wh.lastWatchedAt,
               m.id, m.id as mediaId, m.title, m.posterPath, m.backdropPath, m.stillPath,
               m.type, m.showTitle, m.seasonNumber, m.episodeNumber, m.durationSeconds as fullDuration,
               m.audioCodec, m.videoCodec, m.filePath, m.resolution
        FROM watch_history wh
        JOIN media_items m ON wh.mediaItemId = m.id
        WHERE wh.userId = ? AND wh.isCompleted = 0 AND wh.progressSeconds > 15 AND ${filter.sql}
        ORDER BY wh.lastWatchedAt DESC
        LIMIT 10
      `).all(userId, ...filter.params);

      res.json({ items });
    } catch (err) {
      logger.error('MEDIA_ERR', 'API Error:', err);
      res.status(500).json({ error: 'Ошибка получения истории просмотров' });
    }
  }

  public static async updateProgress(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const { mediaItemId, progressSeconds, durationSeconds } = req.body;

      if (!mediaItemId) {
        res.status(400).json({ error: 'mediaItemId обязателен' });
        return;
      }

      const isCompleted = durationSeconds > 0 && (progressSeconds / durationSeconds) > 0.92 ? 1 : 0;
      const existing = db.prepare('SELECT id FROM watch_history WHERE userId = ? AND mediaItemId = ?').get(userId, mediaItemId) as { id: string } | undefined;

      if (existing) {
        db.prepare(`
          UPDATE watch_history SET
            progressSeconds = ?,
            durationSeconds = ?,
            isCompleted = ?,
            lastWatchedAt = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(progressSeconds, durationSeconds, isCompleted, existing.id);
      } else {
        db.prepare(`
          INSERT INTO watch_history (id, userId, mediaItemId, progressSeconds, durationSeconds, isCompleted)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(uuidv4(), userId, mediaItemId, progressSeconds, durationSeconds, isCompleted);
      }

      // Keep HLS session alive while video is playing (fixes idle timeout during playback with no segment request)
      try { const { ffmpegService } = await import('../services/ffmpeg.service'); ffmpegService.touchSessionByMediaId(mediaItemId); } catch (e) {}

      res.json({ success: true, isCompleted });
    } catch (err) {
      logger.error('MEDIA_ERR', 'API Error:', err);
      res.status(500).json({ error: 'Ошибка сохранения прогресса' });
    }
  }

  public static async searchMatch(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const query = (req.query.query as string || '').trim();
      const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;

      const media = db.prepare('SELECT title, type FROM media_items WHERE id = ?').get(id) as MediaItem | undefined;
      if (!media) {
        res.status(404).json({ error: 'Медиафайл не найден' });
        return;
      }

      const searchQuery = query || media.title;
      const candidates = await tmdbService.searchCandidates(searchQuery, media.type === 'EPISODE' ? 'SHOW' : 'MOVIE', year);

      res.json({ candidates });
    } catch (err: any) {
      logger.error('MEDIA_ERR', 'searchMatch error:', err);
      res.status(500).json({ error: err.message || 'Ошибка поиска в TMDB' });
    }
  }

  public static async applyMatch(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { title, originalTitle, year, overview, posterPath, backdropPath, rating } = req.body;

      if (!title) {
        res.status(400).json({ error: 'Название обязательно' });
        return;
      }

      db.prepare(`
        UPDATE media_items SET
          title = ?,
          originalTitle = ?,
          year = ?,
          overview = ?,
          posterPath = ?,
          backdropPath = ?,
          rating = ?,
          updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        title,
        originalTitle || '',
        year || null,
        overview || '',
        posterPath || '',
        backdropPath || '',
        rating || 0,
        id
      );

      res.json({ message: 'Сопоставление успешно обновлено' });
    } catch (err: any) {
      logger.error('MEDIA_ERR', 'applyMatch error:', err);
      res.status(500).json({ error: err.message || 'Ошибка применения сопоставления' });
    }
  }

  public static async searchShowMatch(req: AuthRequest, res: Response): Promise<void> {
    try {
      const query = (req.query.query as string || '').trim();
      const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;

      if (!query) {
        res.status(400).json({ error: 'Поисковый запрос обязателен' });
        return;
      }

      const candidates = await tmdbService.searchCandidates(query, 'SHOW', year);
      res.json({ candidates });
    } catch (err: any) {
      logger.error('MEDIA_ERR', 'searchShowMatch error:', err);
      res.status(500).json({ error: err.message || 'Ошибка поиска сериала в TMDB' });
    }
  }

  public static async applyShowMatch(req: AuthRequest, res: Response): Promise<void> {
    try {
      const showTitle = decodeURIComponent(req.params.showTitle as string);
      const { title, originalTitle, year, overview, posterPath, backdropPath, rating, tmdbId } = req.body;

      if (!title) {
        res.status(400).json({ error: 'Название обязательно' });
        return;
      }

      // Update show base fields (including vertical show poster and backdrop)
      db.prepare(`
        UPDATE media_items SET
          showTitle = ?,
          originalTitle = ?,
          year = ?,
          posterPath = ?,
          backdropPath = ?,
          rating = ?,
          updatedAt = CURRENT_TIMESTAMP
        WHERE showTitle = ? AND type = 'EPISODE'
      `).run(
        title,
        originalTitle || '',
        year || null,
        posterPath || '',
        backdropPath || '',
        rating || 0,
        showTitle
      );

      // If TMDB ID is provided, fetch detailed episode names, overviews, stills, and ratings!
      if (tmdbId) {
        const seasons = db.prepare(`
          SELECT DISTINCT seasonNumber
          FROM media_items
          WHERE showTitle = ? AND type = 'EPISODE'
        `).all(title) as { seasonNumber: number }[];

        for (const s of seasons) {
          const sNum = s.seasonNumber || 1;
          const episodesList = await tmdbService.fetchSeasonEpisodes(tmdbId, sNum);
          for (const ep of episodesList) {
            const epTitle = ep.title || `Серия ${ep.episodeNumber}`;
            db.prepare(`
              UPDATE media_items SET
                title = ?,
                stillPath = ?,
                overview = ?,
                rating = COALESCE(?, rating)
              WHERE showTitle = ? AND seasonNumber = ? AND episodeNumber = ? AND type = 'EPISODE'
            `).run(
              epTitle,
              ep.stillPath || null,
              ep.overview || '',
              ep.rating || rating || null,
              title,
              sNum,
              ep.episodeNumber
            );
          }
        }
      }

      res.json({ message: 'Сопоставление сериала и всех серий успешно обновлено', newShowTitle: title });
    } catch (err: any) {
      logger.error('MEDIA_ERR', 'applyShowMatch error:', err);
      res.status(500).json({ error: err.message || 'Ошибка применения сопоставления сериала' });
    }
  }

  public static async getThumbnail(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id || '');

      const thumbDir = path.resolve(__dirname, '../../data/thumbnails');
      const thumbFile = path.join(thumbDir, `${id}.jpg`);

      // 1. Fast cache check (0ms response)
      if (fs.existsSync(thumbFile)) {
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        res.sendFile(thumbFile);
        return;
      }

      // 2. Fast failed-cache check (0ms response)
      const failedTime = failedThumbnailIds.get(id);
      if (failedTime && Date.now() - failedTime < 60000) {
        res.status(404).send('Миниатюра недоступна');
        return;
      }

      const media = db.prepare('SELECT filePath, posterPath, durationSeconds FROM media_items WHERE id = ?').get(id) as { filePath: string; posterPath: string; durationSeconds: number } | undefined;

      if (!media || !fs.existsSync(media.filePath)) {
        res.status(404).send('Медиафайл не найден');
        return;
      }

      if (!fs.existsSync(thumbDir)) {
        try { fs.mkdirSync(thumbDir, { recursive: true }); } catch (e) {}
      }

      // 3. Deduplicate in-flight generation for the same media ID
      let task = activeThumbnailTasks.get(id);
      if (!task) {
        task = queueThumbnailJob(async () => {
          return new Promise<string | null>((resolve) => {
            const seekSec = Math.min(120, Math.max(10, Math.floor((media.durationSeconds || 300) * 0.15)));
            const ffmpegCmd = `ffmpeg -y -ss ${seekSec} -i "${media.filePath}" -vframes 1 -q:v 4 -vf "scale=480:-1" "${thumbFile}"`;

            exec(ffmpegCmd, { timeout: 8000 }, (err) => {
              if (err || !fs.existsSync(thumbFile)) {
                failedThumbnailIds.set(id, Date.now());
                resolve(null);
              } else {
                resolve(thumbFile);
              }
            });
          });
        }).finally(() => {
          activeThumbnailTasks.delete(id);
        });

        activeThumbnailTasks.set(id, task);
      }

      const resultFile = await task;
      if (resultFile && fs.existsSync(resultFile)) {
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        res.sendFile(resultFile);
      } else if (media.posterPath) {
        res.redirect(media.posterPath);
      } else {
        res.status(404).send('Не удалось создать миниатюру');
      }
    } catch (err) {
      logger.error('MEDIA_ERR', 'API Error:', err);
      res.status(500).send('Ошибка генерации миниатюры');
    }
  }

  public static async deleteMedia(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      db.prepare('DELETE FROM media_items WHERE id = ?').run(id);
      res.json({ message: 'Медиафайл удален из медиатеки' });
    } catch (err) {
      logger.error('MEDIA_ERR', 'API Error:', err);
      res.status(500).json({ error: 'Ошибка удаления медиафайла' });
    }
  }
}
