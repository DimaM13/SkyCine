import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';
import { MediaItem } from '../types';
import { tmdbService } from '../services/tmdb.service';
import { permissionService } from '../services/permission.service';

export class MediaController {
  public static async getMovies(req: AuthRequest, res: Response): Promise<void> {
    try {
      const search = (req.query.search as string || '').trim();
      const genre = (req.query.genre as string || '').trim();
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
        WHERE m.type = 'MOVIE' AND ${filter.sql}
      `;
      const params: any[] = [userId, ...filter.params];

      if (search) {
        query += ` AND (m.title LIKE ? OR m.originalTitle LIKE ? OR m.overview LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      if (genre) {
        query += ` AND m.genres LIKE ?`;
        params.push(`%${genre}%`);
      }

      if (sortBy === 'rating') {
        query += ` ORDER BY m.rating DESC, m.createdAt DESC`;
      } else if (sortBy === 'title') {
        query += ` ORDER BY m.title ASC`;
      } else if (sortBy === 'year') {
        query += ` ORDER BY m.year DESC`;
      } else {
        query += ` ORDER BY m.createdAt DESC`;
      }

      const movies = db.prepare(query).all(...params);
      res.json({ movies });
    } catch (err) {
      console.error('getMovies error:', err);
      res.status(500).json({ error: 'Ошибка получения списка фильмов' });
    }
  }

  public static async getShows(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id || '';
      const userRole = req.user?.role || 'USER';
      const filter = permissionService.getMediaFilter(userId, userRole, 'm');

      const shows = db.prepare(`
        SELECT m.showTitle,
               COUNT(m.id) as totalEpisodes,
               COUNT(DISTINCT m.seasonNumber) as totalSeasons,
               MIN(m.posterPath) as posterPath,
               MIN(m.backdropPath) as backdropPath,
               MIN(m.year) as year,
               MIN(m.rating) as rating,
               MIN(m.overview) as overview
        FROM media_items m
        WHERE m.type = 'EPISODE' AND m.showTitle IS NOT NULL AND ${filter.sql}
        GROUP BY m.showTitle
        ORDER BY m.showTitle ASC
      `).all(...filter.params);

      res.json({ shows });
    } catch (err) {
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
               wh.progressSeconds as userProgress, wh.isCompleted as userCompleted
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
               wh.isCompleted as userCompleted
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
               m.id as mediaId, m.title, m.posterPath, m.backdropPath,
               m.type, m.showTitle, m.seasonNumber, m.episodeNumber, m.durationSeconds as fullDuration
        FROM watch_history wh
        JOIN media_items m ON wh.mediaItemId = m.id
        WHERE wh.userId = ? AND wh.isCompleted = 0 AND wh.progressSeconds > 15 AND ${filter.sql}
        ORDER BY wh.lastWatchedAt DESC
        LIMIT 10
      `).all(userId, ...filter.params);

      res.json({ items });
    } catch (err) {
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

      res.json({ success: true, isCompleted });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка сохранения прогресса' });
    }
  }

  public static async searchMatch(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const query = (req.query.query as string || '').trim();
      const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
      const type = (req.query.type as 'MOVIE' | 'SHOW') || 'MOVIE';

      if (!query) {
        res.status(400).json({ error: 'Поисковый запрос обязателен' });
        return;
      }

      const candidates = await tmdbService.searchCandidates(query, type, year);
      res.json({ candidates });
    } catch (err: any) {
      console.error('searchMatch error:', err);
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

      const updated = db.prepare('SELECT * FROM media_items WHERE id = ?').get(id);
      res.json({ message: 'Сопоставление успешно обновлено', media: updated });
    } catch (err: any) {
      console.error('applyMatch error:', err);
      res.status(500).json({ error: err.message || 'Ошибка применения сопоставления' });
    }
  }

  public static async deleteMedia(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      db.prepare('DELETE FROM media_items WHERE id = ?').run(id);
      res.json({ message: 'Медиафайл удален из медиатеки' });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка удаления медиафайла' });
    }
  }
}
