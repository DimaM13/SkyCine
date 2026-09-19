import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import cors from 'cors';
import dotenv from 'dotenv';
import compression from 'compression';
import { Server as SocketIOServer } from 'socket.io';
import { initDatabase } from './config/db';
import { socketService } from './services/socket.service';
import apiRouter from './routes';

dotenv.config();

// SECURITY: JWT-секрет обязан быть уникальным. Дефолт лежит в публичном git —
// с ним любой может подделать админский токен. При первом старте генерируем
// случайный и кладём в .env (уже в .gitignore). Все старые сессии сгорят разово.
function ensureJwtSecret() {
  const cur = (process.env.JWT_SECRET || '').trim();
  if (cur.length >= 32) return;
  const envPath = path.resolve(process.cwd(), '.env');
  try {
    let content = '';
    try {
      if (fs.existsSync(envPath)) content = fs.readFileSync(envPath, 'utf8');
    } catch {}
    const m = content.match(/^JWT_SECRET=(.+)$/m);
    if (m && m[1].trim().length >= 32) {
      process.env.JWT_SECRET = m[1].trim();
      return;
    }
    const fresh = crypto.randomBytes(48).toString('hex');
    const prefix = content === '' || content.endsWith('\n') ? '' : '\n';
    fs.appendFileSync(envPath, `${prefix}JWT_SECRET=${fresh}\n`, 'utf8');
    process.env.JWT_SECRET = fresh;
    // Логгер ещё не импортирован выше? Импортируем лениво через console — нет,
    // logger импортирован ниже по файлу; используем console здесь напрямую.
    console.warn('[SECURITY] JWT_SECRET отсутствовал — сгенерирован новый и сохранён в .env. Все старые сессии завершены, войдите заново.');
  } catch (e: any) {
    console.warn(`[SECURITY] Не удалось сохранить JWT_SECRET в .env (${e?.message}), использую временный (слетит при рестарте).`);
    process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
  }
}
ensureJwtSecret();

// 1. Initialize SQLite Database
initDatabase();

const app = express();
const server = http.createServer(app);

// Optimize responses with gzip/brotli compression
app.use(compression({
  filter: (req, res) => {
    // Don't compress HLS video streams, they are already compressed and chunked
    if (req.path.startsWith('/api/stream/hls')) return false;
    return compression.filter(req, res);
  }
}));

// 2. Configure CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

import { logger } from './services/logger.service';

// SECURITY: базовые заголовки + прячем движок. Без новых зависимостей.
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// HTTP Request Logger Middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    // SECURITY: JWT в query (?token=...) иначе целиком оседает в лог-файлах
    const safeUrl = req.originalUrl.replace(/([?&]token=)[^&\s]*/g, '$1***');
    const isSegment = req.originalUrl.includes('/segment_') || req.originalUrl.includes('/init.mp4');
    if (res.statusCode >= 500) {
      logger.error('HTTP', `${req.method} ${safeUrl} -> ${res.statusCode} (${duration}ms)`);
    } else if (res.statusCode >= 400) {
      logger.warn('HTTP', `${req.method} ${safeUrl} -> ${res.statusCode} (${duration}ms)`);
    } else if (isSegment) {
      logger.debug('HTTP', `${req.method} ${safeUrl} -> ${res.statusCode} (${duration}ms)`);
    } else {
      logger.info('HTTP', `${req.method} ${safeUrl} -> ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// 3. Static Files
const uploadsDir = path.resolve(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsDir));

// 4. API Routes
app.use('/api', apiRouter);

// Serve Frontend in Production / All-in-one Mode
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io') || req.path.startsWith('/uploads')) {
      return next();
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// 5. Initialize Socket.io
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingInterval: 25000,
  pingTimeout: 60000,
});

socketService.init(io);

// 6. Global Error Handler
app.use((err: any, req: express.Request, res: Response, next: express.NextFunction) => {
  const safeUrl = String(req.originalUrl || '').replace(/([?&]token=)[^&\s]*/g, '$1***');
  logger.error('SERVER_ERR', `${req.method} ${safeUrl}: ${err.message}`, err);
  res.status(err.status || 500).json({
    error: err.message || 'Внутренняя ошибка сервера',
  });
});

import { UpnpService } from './services/upnp.service';

const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  logger.info('SERVER', `SkyCine Cinema Server started on port ${PORT}`);
  console.log(`=========================================`);
  console.log(`🎬 SkyCine Cinema Server running on port ${PORT}`);
  console.log(`📡 WebSocket Sync Engine ready`);
  console.log(`🌐 Local Web Interface: http://localhost:${PORT}`);
  console.log(`🛠  Server API: http://localhost:${PORT}/api`);

  // Initialize UPnP automatic port forwarding (со сторожем: при обрыве сети
  // маппинг сам восстановится в течение минуты, без рестарта сервера).
  // Прод (NODE_ENV=production, all-in-one): живёт только PORT (5000) — его и мапим.
  // Дев: 3000 (Vite) + 5000 (API) — оба живы, мапим оба.
  const PUBLIC_PORTS = process.env.NODE_ENV === 'production' ? [5000] : [3000, 5000];
  try {
    await UpnpService.init(PUBLIC_PORTS);
  } catch (e) {}

  console.log(`=========================================`);
});
