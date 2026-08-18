import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';
import { socketService } from '../services/socket.service';

export class FriendsController {
  public static async getFriends(req: AuthRequest, res: Response): Promise<void> {
    try {
      const currentUserId = req.user!.id;

      // Get all accepted friendships
      const friends = db.prepare(`
        SELECT u.id, u.username, u.email, u.avatarUrl, u.role, f.id as friendshipId, f.createdAt as friendsSince
        FROM friendships f
        JOIN users u ON (u.id = CASE WHEN f.requesterId = ? THEN f.addresseeId ELSE f.requesterId END)
        WHERE (f.requesterId = ? OR f.addresseeId = ?) AND f.status = 'ACCEPTED'
        ORDER BY u.username ASC
      `).all(currentUserId, currentUserId, currentUserId) as any[];

      const onlineMap = new Map<string, { status: string; activity?: string }>();
      const onlineList = socketService.getOnlineUsers();
      for (const item of onlineList) {
        onlineMap.set(item.userId, { status: item.status, activity: item.activity });
      }

      const formatted = friends.map(f => {
        const presence = onlineMap.get(f.id);
        return {
          ...f,
          isOnline: !!presence,
          presenceStatus: presence?.status || 'offline',
          currentActivity: presence?.activity || null,
        };
      });

      res.json({ friends: formatted });
    } catch (err) {
      console.error('getFriends error:', err);
      res.status(500).json({ error: 'Ошибка получения списка друзей' });
    }
  }

  public static async getFriendRequests(req: AuthRequest, res: Response): Promise<void> {
    try {
      const currentUserId = req.user!.id;

      const incoming = db.prepare(`
        SELECT f.id, f.createdAt, u.id as requesterId, u.username, u.avatarUrl
        FROM friendships f
        JOIN users u ON u.id = f.requesterId
        WHERE f.addresseeId = ? AND f.status = 'PENDING'
      `).all(currentUserId);

      const outgoing = db.prepare(`
        SELECT f.id, f.createdAt, u.id as addresseeId, u.username, u.avatarUrl
        FROM friendships f
        JOIN users u ON u.id = f.addresseeId
        WHERE f.requesterId = ? AND f.status = 'PENDING'
      `).all(currentUserId);

      res.json({ incoming, outgoing });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка получения запросов в друзья' });
    }
  }

  public static async searchUsers(req: AuthRequest, res: Response): Promise<void> {
    try {
      const currentUserId = req.user!.id;
      const query = (req.query.q as string || '').trim();

      if (!query || query.length < 2) {
        res.json({ users: [] });
        return;
      }

      const users = db.prepare(`
        SELECT id, username, avatarUrl
        FROM users
        WHERE id != ? AND (username LIKE ? OR email LIKE ?)
        LIMIT 10
      `).all(currentUserId, `%${query}%`, `%${query}%`) as any[];

      // Check friendship status for each user
      const usersWithStatus = users.map(u => {
        const friendship = db.prepare(`
          SELECT id, requesterId, addresseeId, status
          FROM friendships
          WHERE (requesterId = ? AND addresseeId = ?) OR (requesterId = ? AND addresseeId = ?)
        `).get(currentUserId, u.id, u.id, currentUserId) as any;

        return {
          ...u,
          friendshipStatus: friendship ? friendship.status : 'NONE',
          isRequester: friendship ? friendship.requesterId === currentUserId : false,
          friendshipId: friendship ? friendship.id : null,
        };
      });

      res.json({ users: usersWithStatus });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка поиска пользователей' });
    }
  }

  public static async sendFriendRequest(req: AuthRequest, res: Response): Promise<void> {
    try {
      const currentUserId = req.user!.id;
      const { targetUserId } = req.body;

      if (!targetUserId || targetUserId === currentUserId) {
        res.status(400).json({ error: 'Некорректный получатель запроса' });
        return;
      }

      const targetUser = db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId);
      if (!targetUser) {
        res.status(404).json({ error: 'Пользователь не найден' });
        return;
      }

      const existing = db.prepare(`
        SELECT id, status FROM friendships
        WHERE (requesterId = ? AND addresseeId = ?) OR (requesterId = ? AND addresseeId = ?)
      `).get(currentUserId, targetUserId, targetUserId, currentUserId) as any;

      if (existing) {
        if (existing.status === 'ACCEPTED') {
          res.status(400).json({ error: 'Вы уже являетесь друзьями' });
          return;
        }
        if (existing.status === 'PENDING') {
          res.status(400).json({ error: 'Запрос в друзья уже отправлен' });
          return;
        }
      }

      const id = uuidv4();
      db.prepare(`
        INSERT INTO friendships (id, requesterId, addresseeId, status)
        VALUES (?, ?, ?, 'PENDING')
      `).run(id, currentUserId, targetUserId);

      res.json({ message: 'Запрос в друзья отправлен', friendshipId: id });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка при отправке запроса' });
    }
  }

  public static async acceptFriendRequest(req: AuthRequest, res: Response): Promise<void> {
    try {
      const currentUserId = req.user!.id;
      const { requestId } = req.params;

      const friendship = db.prepare('SELECT * FROM friendships WHERE id = ? AND addresseeId = ?').get(requestId, currentUserId) as any;
      if (!friendship) {
        res.status(404).json({ error: 'Запрос в друзья не найден' });
        return;
      }

      db.prepare("UPDATE friendships SET status = 'ACCEPTED', updatedAt = CURRENT_TIMESTAMP WHERE id = ?").run(requestId);
      res.json({ message: 'Запрос в друзья принят' });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка принятия запроса' });
    }
  }

  public static async declineFriendRequest(req: AuthRequest, res: Response): Promise<void> {
    try {
      const currentUserId = req.user!.id;
      const { requestId } = req.params;

      db.prepare('DELETE FROM friendships WHERE id = ? AND (addresseeId = ? OR requesterId = ?)').run(requestId, currentUserId, currentUserId);
      res.json({ message: 'Запрос удален' });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка удаления запроса' });
    }
  }

  public static async removeFriend(req: AuthRequest, res: Response): Promise<void> {
    try {
      const currentUserId = req.user!.id;
      const { friendId } = req.params;

      db.prepare(`
        DELETE FROM friendships
        WHERE (requesterId = ? AND addresseeId = ?) OR (requesterId = ? AND addresseeId = ?)
      `).run(currentUserId, friendId, friendId, currentUserId);

      res.json({ message: 'Друг удален из списка' });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка удаления друга' });
    }
  }
}
