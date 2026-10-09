import bcrypt from 'bcryptjs';
import { db } from '../config/db';

// Пароли приватных комнат: bcrypt at rest. Старые plaintext-строки
// верифицируем напрямую и тихо перехешируем (миграция на использовании).
export const MAX_ROOM_PASSWORD_LEN = 64; // bcrypt режет после 72 байт — кап раньше

export function hashRoomPassword(pw: string): string {
  return bcrypt.hashSync(String(pw).slice(0, MAX_ROOM_PASSWORD_LEN), 10);
}

/** true = пароль подошёл (или его нет и комната открыта). */
export function verifyRoomPassword(roomId: string, stored: unknown, supplied: unknown): boolean {
  const h = String(stored || '');
  if (!h) return true;
  const s = String(supplied || '').slice(0, MAX_ROOM_PASSWORD_LEN);
  if (!s) return false;
  try {
    if (h.startsWith('$2')) return bcrypt.compareSync(s, h);
  } catch {
    return false;
  }
  // Legacy plaintext: сверяем и тихо перехешируем
  if (s === h) {
    try {
      db.prepare('UPDATE rooms SET password = ? WHERE id = ?').run(bcrypt.hashSync(s, 10), roomId);
    } catch {}
    return true;
  }
  return false;
}

/** Выкидываем секрет из объекта комнаты перед отправкой клиентам. */
export function stripRoomSecret<T extends Record<string, any>>(room: T): T {
  if (!room || typeof room !== 'object') return room;
  const rest: Record<string, any> = { ...room };
  delete rest.password;
  return rest as T;
}
