import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../config/db';
import { User } from '../types';

export const JWT_SECRET = process.env.JWT_SECRET || 'myplex_super_secret_jwt_key_2026_cinema';

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
    const payload = jwt.verify(token, JWT_SECRET) as { id: string; username: string };
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
    const payload = jwt.verify(token, JWT_SECRET) as { id: string };
    const user = db.prepare('SELECT id, username, email, avatarUrl, role, createdAt, updatedAt FROM users WHERE id = ?').get(payload.id) as User | undefined;
    if (user) {
      req.user = user;
    }
  } catch (e) {
    // ignore invalid token for optional auth
  }
  next();
}
