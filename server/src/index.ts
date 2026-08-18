import express from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import { Server as SocketIOServer } from 'socket.io';
import { initDatabase } from './config/db';
import { socketService } from './services/socket.service';
import apiRouter from './routes';

dotenv.config();

// 1. Initialize SQLite Database
initDatabase();

const app = express();
const server = http.createServer(app);

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

// HTTP Request Logger Middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.path.startsWith('/stream/hls')) {
      logger.info('HTTP', `${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
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
import fs from 'fs';
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
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('SERVER_ERR', `${req.method} ${req.originalUrl}: ${err.message}`, err);
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
  console.log(`🌐 Local Web Interface: http://localhost:3000`);
  console.log(`🛠  Server API: http://localhost:${PORT}/api`);

  // Initialize UPnP automatic port forwarding
  try {
    const upnpRes = await UpnpService.init(3000);
    if (upnpRes.success) {
      console.log(`🚀 UPnP Direct Public Link: http://${upnpRes.publicIp}:3000`);
    }
  } catch (e) {}

  console.log(`=========================================`);
});
