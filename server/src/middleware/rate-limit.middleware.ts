import { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger.service';

interface Bucket {
  count: number;
  resetAt: number;
  warned?: boolean;
}

const buckets = new Map<string, Bucket>();

// Чистка протухших корзин, чтобы карта не росла бесконечно
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}, 5 * 60 * 1000);
if (typeof (sweepTimer as any).unref === 'function') (sweepTimer as any).unref();

function hit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  return b.count > limit;
}

/**
 * Душит перебор паролей: 60 попыток с IP за 15 минут
 * + 12 попыток на конкретный логин с IP за 15 минут.
 * Легитимных юзеров не задевает (кто 12 раз ошибся паролем — пусть ждёт).
 */
export function authRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || (req.socket as any)?.remoteAddress || 'unknown';
  const login = String(req.body?.login || req.body?.username || req.body?.email || '')
    .toLowerCase()
    .slice(0, 64);

  const windowMs = 15 * 60 * 1000;
  if (hit(`auth:ip:${ip}`, 60, windowMs) || (login && hit(`auth:ip-login:${ip}:${login}`, 12, windowMs))) {
    const b = buckets.get(`auth:ip:${ip}`);
    if (b && !b.warned) {
      b.warned = true;
      logger.warn('SECURITY', `Рейт-лимит авторизации для IP ${ip} (возможный перебор)`);
    }
    res.setHeader('Retry-After', '900');
    res.status(429).json({ error: 'Слишком много попыток входа. Подождите 15 минут.' });
    return;
  }
  next();
}

/**
 * Публичный /api/debug/* (ТВ шлёт туда логи без авторизации):
 * режем флуд, чтобы нельзя было забить диск логами.
 * 300/мин на IP — живому ТВ хватает с запасом.
 */
export function debugRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || (req.socket as any)?.remoteAddress || 'unknown';
  if (hit(`debug:ip:${ip}`, 300, 60 * 1000)) {
    res.status(429).json({ error: 'Too many log requests' });
    return;
  }
  next();
}
