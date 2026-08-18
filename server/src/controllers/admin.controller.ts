import { Response } from 'express';
import { db } from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';
import { systemService } from '../services/system.service';

export class AdminController {
  public static async getSystemStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const stats = await systemService.getSystemStats();
      const activeSessions = systemService.getActiveSessions();

      res.json({
        ...stats,
        activeSessions,
      });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка получения статуса системы' });
    }
  }

  public static async getSettings(req: AuthRequest, res: Response): Promise<void> {
    try {
      const rows = db.prepare('SELECT key, value FROM server_settings').all() as { key: string; value: string }[];
      const settings: Record<string, any> = {};

      for (const row of rows) {
        settings[row.key] = row.value;
      }

      res.json({ settings });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка получения настроек сервера' });
    }
  }

  public static async updateSettings(req: AuthRequest, res: Response): Promise<void> {
    try {
      const updates = req.body; // e.g. { tmdbApiKey: '...', transcodeHardware: 'nvenc' }

      const updateStmt = db.prepare(`
        INSERT INTO server_settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `);

      for (const [k, v] of Object.entries(updates)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          updateStmt.run(k, v.toString());
        }
      }

      res.json({ message: 'Настройки сервера успешно сохранены' });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка сохранения настроек' });
    }
  }

  public static async getUsers(req: AuthRequest, res: Response): Promise<void> {
    try {
      const users = db.prepare(`
        SELECT id, username, email, avatarUrl, role, createdAt, updatedAt,
               (SELECT COUNT(*) FROM watch_history WHERE userId = users.id) as watchCount
        FROM users
        ORDER BY createdAt ASC
      `).all();

      res.json({ users });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка получения списка пользователей' });
    }
  }

  public static async updateUserRole(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const { role } = req.body;

      if (role !== 'ADMIN' && role !== 'USER') {
        res.status(400).json({ error: 'Недопустимая роль' });
        return;
      }

      // Check if trying to demote the only admin
      if (role === 'USER') {
        const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'ADMIN'").get() as { count: number };
        const targetUser = db.prepare("SELECT role FROM users WHERE id = ?").get(userId) as any;
        if (targetUser?.role === 'ADMIN' && adminCount.count <= 1) {
          res.status(400).json({ error: 'Нельзя отозвать права у единственного администратора сервера' });
          return;
        }
      }

      db.prepare('UPDATE users SET role = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(role, userId);
      res.json({ message: 'Роль пользователя успешно изменена' });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка изменения роли' });
    }
  }

  public static async deleteUser(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      if (userId === req.user!.id) {
        res.status(400).json({ error: 'Вы не можете удалить собственный аккаунт' });
        return;
      }

      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      res.json({ message: 'Пользователь удален' });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка удаления пользователя' });
    }
  }

  public static async getLogs(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { logger } = await import('../services/logger.service');
      const logs = logger.getRecentLogs(200);
      res.json(logs);
    } catch (err) {
      res.status(500).json({ error: 'Ошибка чтения логов' });
    }
  }

  public static async clearLogs(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { logger } = await import('../services/logger.service');
      logger.clearLogs();
      res.json({ message: 'Логи успешно очищены' });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка очистки логов' });
    }
  }

  public static async browseFilesystem(req: AuthRequest, res: Response): Promise<void> {
    try {
      const targetPath = req.query.path as string | undefined;
      const mode = (req.query.mode as 'folders' | 'files' | 'all') || 'folders';
      const { filesystemService } = await import('../services/filesystem.service');

      const result = filesystemService.browse(targetPath, mode);
      res.json(result);
    } catch (err: any) {
      console.error('browseFilesystem error:', err);
      res.status(500).json({ error: err.message || 'Ошибка чтения файловой системы' });
    }
  }
}

