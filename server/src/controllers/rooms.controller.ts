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

export class RoomsController {
  public static async getRooms(req: AuthRequest, res: Response): Promise<void> {
    try {
      const rooms = db.prepare(`
        SELECT r.*, m.title as mediaTitle, m.posterPath, m.backdropPath, m.durationSeconds,
               u.username as hostUsername, u.avatarUrl as hostAvatar
        FROM rooms r
        JOIN media_items m ON r.mediaItemId = m.id
        JOIN users u ON r.hostUserId = u.id
        WHERE r.isPrivate = 0
        ORDER BY r.createdAt DESC
      `).all();

      res.json({ rooms });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка получения списка комнат' });
    }
  }

  public static async createRoom(req: AuthRequest, res: Response): Promise<void> {
    try {
      const hostUserId = req.user!.id;
      const { mediaItemId, title, isPrivate, password } = req.body;

      if (!mediaItemId) {
        res.status(400).json({ error: 'Необходимо выбрать фильм или серию' });
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
          id, code, title, hostUserId, mediaItemId, state,
          currentPosition, serverTimestamp, playbackRate, isPrivate, password
        ) VALUES (?, ?, ?, ?, ?, 'PAUSED', 0, ?, 1.0, ?, ?)
      `).run(id, code, roomTitle, hostUserId, mediaItemId, Date.now(), isPrivate ? 1 : 0, password || null);

      res.status(201).json({
        message: 'Комната создана',
        room: {
          id,
          code,
          title: roomTitle,
          hostUserId,
          mediaItemId,
          isPrivate: !!isPrivate,
        }
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
        JOIN media_items m ON r.mediaItemId = m.id
        JOIN users u ON r.hostUserId = u.id
        WHERE r.code = ? OR r.id = ?
      `).get(codeOrId, codeOrId) as any;

      if (!room) {
        res.status(404).json({ error: 'Комната не найдена' });
        return;
      }

      const tracks = db.prepare('SELECT * FROM media_tracks WHERE mediaItemId = ? ORDER BY type ASC, streamIndex ASC').all(room.mediaItemId);

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
