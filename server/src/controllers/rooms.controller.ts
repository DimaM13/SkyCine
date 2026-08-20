import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function extractYouTubeId(urlOrId: string): string | null {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const trimmed = urlOrId.trim();

  // If it's already an 11-char ID like dQw4w9WgXcQ
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  // Match youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID, youtube.com/shorts/ID, etc.
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
  const match = trimmed.match(regex);
  return match ? match[1] : null;
}

export async function fetchYouTubeInfo(youtubeId: string): Promise<{ title: string; thumbnail: string }> {
  const fallbackThumbnail = `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${youtubeId}&format=json`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = (await res.json()) as any;
      return {
        title: data.title || 'YouTube Видео',
        thumbnail: data.thumbnail_url || fallbackThumbnail,
      };
    }
  } catch (err) {}

  return {
    title: 'YouTube Видео',
    thumbnail: fallbackThumbnail,
  };
}

export class RoomsController {
  public static async getRooms(req: AuthRequest, res: Response): Promise<void> {
    try {
      const rawRooms = db.prepare(`
        SELECT r.*,
               m.title as mediaTitle, m.posterPath, m.backdropPath, m.durationSeconds,
               u.username as hostUsername, u.avatarUrl as hostAvatar
        FROM rooms r
        LEFT JOIN media_items m ON r.mediaItemId = m.id
        JOIN users u ON r.hostUserId = u.id
        WHERE r.isPrivate = 0
        ORDER BY r.createdAt DESC
      `).all() as any[];

      const rooms = rawRooms.map((room) => {
        if (room.sourceType === 'YOUTUBE') {
          return {
            ...room,
            mediaTitle: room.youtubeTitle || room.title,
            posterPath: room.youtubeThumbnail || `https://i.ytimg.com/vi/${room.youtubeId}/hqdefault.jpg`,
            backdropPath: room.youtubeThumbnail || `https://i.ytimg.com/vi/${room.youtubeId}/hqdefault.jpg`,
          };
        }
        return room;
      });

      res.json({ rooms });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка получения списка комнат' });
    }
  }

  public static async createRoom(req: AuthRequest, res: Response): Promise<void> {
    try {
      const hostUserId = req.user!.id;
      const { mediaItemId, youtubeUrl, title, isPrivate, password, sourceType } = req.body;

      const isYouTube = sourceType === 'YOUTUBE' || (youtubeUrl && !mediaItemId);

      if (isYouTube) {
        if (!youtubeUrl || !youtubeUrl.trim()) {
          res.status(400).json({ error: 'Необходимо указать ссылку на YouTube видео' });
          return;
        }

        const ytId = extractYouTubeId(youtubeUrl.trim());
        if (!ytId) {
          res.status(400).json({ error: 'Не удалось распознать ссылку на YouTube. Введите корректный URL (например, https://youtube.com/watch?v=... или https://youtu.be/...)' });
          return;
        }

        const ytInfo = await fetchYouTubeInfo(ytId);
        const id = uuidv4();
        const code = generateRoomCode();
        const roomTitle = title?.trim() || `YouTube: ${ytInfo.title}`;

        db.prepare(`
          INSERT INTO rooms (
            id, code, title, hostUserId, mediaItemId, sourceType,
            youtubeId, youtubeUrl, youtubeTitle, youtubeThumbnail,
            state, currentPosition, serverTimestamp, playbackRate, isPrivate, password
          ) VALUES (?, ?, ?, ?, NULL, 'YOUTUBE', ?, ?, ?, ?, 'PAUSED', 0, ?, 1.0, ?, ?)
        `).run(
          id,
          code,
          roomTitle,
          hostUserId,
          ytId,
          `https://www.youtube.com/watch?v=${ytId}`,
          ytInfo.title,
          ytInfo.thumbnail,
          Date.now(),
          isPrivate ? 1 : 0,
          password || null
        );

        res.status(201).json({
          message: 'YouTube комната создана',
          room: {
            id,
            code,
            title: roomTitle,
            hostUserId,
            sourceType: 'YOUTUBE',
            youtubeId: ytId,
            youtubeUrl: `https://www.youtube.com/watch?v=${ytId}`,
            youtubeTitle: ytInfo.title,
            youtubeThumbnail: ytInfo.thumbnail,
            isPrivate: !!isPrivate,
          },
        });
        return;
      }

      // Local Media Room
      if (!mediaItemId) {
        res.status(400).json({ error: 'Необходимо выбрать фильм, серию или указать ссылку на YouTube' });
        return;
      }

      const media = db.prepare('SELECT title, posterPath, backdropPath FROM media_items WHERE id = ?').get(mediaItemId) as any;
      if (!media) {
        res.status(404).json({ error: 'Медиафайл не найден' });
        return;
      }

      const id = uuidv4();
      const code = generateRoomCode();
      const roomTitle = title || `Совместный просмотр: ${media.title}`;

      db.prepare(`
        INSERT INTO rooms (
          id, code, title, hostUserId, mediaItemId, sourceType,
          state, currentPosition, serverTimestamp, playbackRate, isPrivate, password
        ) VALUES (?, ?, ?, ?, ?, 'LOCAL', 'PAUSED', 0, ?, 1.0, ?, ?)
      `).run(id, code, roomTitle, hostUserId, mediaItemId, Date.now(), isPrivate ? 1 : 0, password || null);

      res.status(201).json({
        message: 'Комната создана',
        room: {
          id,
          code,
          title: roomTitle,
          hostUserId,
          mediaItemId,
          sourceType: 'LOCAL',
          isPrivate: !!isPrivate,
        },
      });
    } catch (err) {
      console.error('createRoom error:', err);
      res.status(500).json({ error: 'Ошибка при создании комнаты' });
    }
  }

  public static async getRoom(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { codeOrId } = req.params;
      const room = db.prepare(`
        SELECT r.*,
               m.title as mediaTitle, m.originalTitle, m.durationSeconds, m.posterPath, m.backdropPath,
               m.filePath, m.fileSize, m.videoCodec, m.audioCodec, m.resolution, m.type, m.year,
               m.seasonNumber, m.episodeNumber, m.libraryId,
               u.username as hostUsername, u.avatarUrl as hostAvatar
        FROM rooms r
        LEFT JOIN media_items m ON r.mediaItemId = m.id
        JOIN users u ON r.hostUserId = u.id
        WHERE r.code = ? OR r.id = ?
      `).get(codeOrId, codeOrId) as any;

      if (!room) {
        res.status(404).json({ error: 'Комната не найдена' });
        return;
      }

      let tracks: any[] = [];
      if (room.mediaItemId) {
        tracks = db.prepare('SELECT * FROM media_tracks WHERE mediaItemId = ? ORDER BY type ASC, streamIndex ASC').all(room.mediaItemId);
      }

      if (room.sourceType === 'YOUTUBE') {
        room.mediaTitle = room.youtubeTitle || room.title;
        room.posterPath = room.youtubeThumbnail || `https://i.ytimg.com/vi/${room.youtubeId}/hqdefault.jpg`;
        room.backdropPath = room.youtubeThumbnail || `https://i.ytimg.com/vi/${room.youtubeId}/hqdefault.jpg`;
      }

      res.json({ room: { ...room, tracks } });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка получения комнаты' });
    }
  }

  public static async deleteRoom(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { roomId } = req.params;
      const currentUserId = req.user!.id;
      const role = req.user!.role;

      const room = db.prepare('SELECT hostUserId FROM rooms WHERE id = ?').get(roomId) as { hostUserId: string } | undefined;
      if (!room) {
        res.status(404).json({ error: 'Комната не найдена' });
        return;
      }

      if (room.hostUserId !== currentUserId && role !== 'ADMIN') {
        res.status(403).json({ error: 'Вы не являетесь владельцем комнаты' });
        return;
      }

      db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
      res.json({ message: 'Комната закрыта' });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка закрытия комнаты' });
    }
  }
}
