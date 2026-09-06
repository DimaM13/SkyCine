import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/db';
import { JWT_SECRET, AuthRequest } from '../middleware/auth.middleware';
import { User } from '../types';

export class AuthController {
  public static async register(req: Request, res: Response): Promise<void> {
    try {
      const { username, email, password } = req.body;

      if (!username || !email || !password) {
        res.status(400).json({ error: 'Пожалуйста, заполните все обязательные поля' });
        return;
      }

      if (username.length < 3 || password.length < 6) {
        res.status(400).json({ error: 'Имя пользователя должно быть от 3 символов, а пароль от 6 символов' });
        return;
      }

      // Check if registration is allowed
      const regSetting = db.prepare('SELECT value FROM server_settings WHERE key = ?').get('allowPublicRegistration') as { value: string } | undefined;
      const countUsers = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };

      if (countUsers.count > 0 && regSetting?.value === 'false') {
        res.status(403).json({ error: 'Регистрация на сервере временно закрыта администратором' });
        return;
      }

      // First registered user gets ADMIN role automatically!
      const role = countUsers.count === 0 ? 'ADMIN' : 'USER';

      const existingUser = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE').get(username, email);
      if (existingUser) {
        res.status(400).json({ error: 'Пользователь с таким именем или email уже существует' });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const userId = uuidv4();
      const avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(username)}`;

      db.prepare(`
        INSERT INTO users (id, username, email, passwordHash, avatarUrl, role)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, username, email, passwordHash, avatarUrl, role);

      const user: User = {
        id: userId,
        username,
        email,
        passwordHash: '',
        avatarUrl,
        role,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
        expiresIn: '30d',
      });

      res.status(201).json({
        message: 'Регистрация успешна',
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          avatarUrl: user.avatarUrl,
          role: user.role,
        },
        token,
      });
    } catch (err) {
      console.error('Register error:', err);
      res.status(500).json({ error: 'Ошибка сервера при регистрации' });
    }
  }

  public static async login(req: Request, res: Response): Promise<void> {
    try {
      const loginRaw = req.body.login || req.body.username;
      const login = typeof loginRaw === 'string' ? loginRaw.trim() : '';
      const password = req.body.password;

      if (!login || !password) {
        res.status(400).json({ error: 'Введите имя пользователя/email и пароль' });
        return;
      }

      const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE').get(login, login) as User | undefined;
      if (!user) {
        res.status(401).json({ error: 'Неверные учетные данные' });
        return;
      }

      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        res.status(401).json({ error: 'Неверные учетные данные' });
        return;
      }

      const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
        expiresIn: '30d',
      });

      res.json({
        message: 'Вход выполнен успешно',
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          avatarUrl: user.avatarUrl,
          role: user.role,
        },
        token,
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Ошибка сервера при входе' });
    }
  }

  public static async me(req: AuthRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Не авторизован' });
      return;
    }

    res.json({ user: req.user });
  }

  public static async updateProfile(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ error: 'Не авторизован' });
        return;
      }

      const { avatarUrl, password } = req.body;

      if (avatarUrl) {
        db.prepare('UPDATE users SET avatarUrl = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(avatarUrl, user.id);
      }

      if (password && password.length >= 6) {
        const passwordHash = await bcrypt.hash(password, 10);
        db.prepare('UPDATE users SET passwordHash = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, user.id);
      }

      const updated = db.prepare('SELECT id, username, email, avatarUrl, role, createdAt, updatedAt FROM users WHERE id = ?').get(user.id);
      res.json({ message: 'Профиль обновлен', user: updated });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка при обновлении профиля' });
    }
  }
}
