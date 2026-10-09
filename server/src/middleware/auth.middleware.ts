import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { db } from '../config/db';
import { User } from '../types';

// Одноразовый секрет на процесс — только если секрет не настроен через env/.env.
// ensureJwtSecret() в index.ts обычно уже всё настроил до первого вызова.
// Публичного дефолта больше нет: сковать токены по исходникам из git нельзя.
let ephemeralSecret: string | null = null;

export function getJwtSecret(): string {
  // Ленивое чтение env: секрет подсовывается при старте (см. ensureJwtSecret
  // в index.ts) уже ПОСЛЕ загрузки модулей — константа на это опоздала бы.
  const cur = (process.env.JWT_SECRET || '').trim();
  if (cur.length >= 32) return cur;
  if (!ephemeralSecret) {
    ephemeralSecret = crypto.randomBytes(48).toString('hex');
    console.warn('[SECURITY] JWT_SECRET не настроен — использую временный секрет на процесс. Все сессии слетят при рестарте. Запустите сервер через src/index.ts чтобы сохранить постоянный секрет в .env.');
  }
  return ephemeralSecret;
}

export interface AuthRequest extends Request {
  user?: User;
}

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : (req.query.token as string);

  if (!token) {
    res.status(401).json({ error: 'Требуется авторизация (Token missing)' });
    return;
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as { id: string; username: string };
    const user = db.prepare('SELECT id, username, email, avatarUrl, role, createdAt, updatedAt FROM users WHERE id = ?').get(payload.id) as User | undefined;

    if (!user) {
      res.status(401).json({ error: 'Пользователь не найден' });
      return;
    }

    req.user = user;
    next();
  } catch (err) {
    res.status(403).json({ error: 'Недействительный или истекший токен' });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  authenticateToken(req, res, () => {
    if (req.user?.role !== 'ADMIN') {
      res.status(403).json({ error: 'Доступ запрещен. Требуются права Администратора сервера' });
      return;
    }
    next();
  });
}

export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : (req.query.token as string);

  if (!token) {
    return next();
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as { id: string };
    const user = db.prepare('SELECT id, username, email, avatarUrl, role, createdAt, updatedAt FROM users WHERE id = ?').get(payload.id) as User | undefined;
    if (user) {
      req.user = user;
    }
  } catch (e) {
    // ignore invalid token for optional auth
  }
  next();
}
