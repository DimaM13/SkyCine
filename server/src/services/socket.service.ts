import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { db } from '../config/db';
import { RoomMember, RoomState, RoomHealthEntry, RoomActionFeedEntry } from '../types';
import { logger } from './logger.service';
import { ffmpegService } from './ffmpeg.service';
import { roomHealthService } from './room-health.service';
import { getJwtSecret } from '../middleware/auth.middleware';
import { sanitizeMediaUrl } from '../controllers/media.controller';

interface ConnectedUser {
  userId: string;
  username: string;
  avatarUrl?: string;
  socketId: string;
  currentRoomId?: string;
  status: string;
  activity?: string;
  verified: boolean; // true = userId подтверждён JWT, подделать нельзя
}

interface ConnectedUser {
  userId: string;
  username: string;
  avatarUrl?: string;
  socketId: string;
  currentRoomId?: string;
  status: string;
  activity?: string;
}

// --- Этап 4: валидация входящих сокет-данных. Поведение честных не меняется:
// лимиты заведомо выше живого использования (heartbeat 3с, seek-драги, чат).
const MAX_POS_SEC = 24 * 3600; // отсекает NaN/Infinity/мусор; реальные фильмы короче
const MAX_CHAT_LEN = 500;
const MAX_NAME_LEN = 32;
const MAX_EMOJI_LEN = 24; // ZWJ-последовательности сюда влезают
const MAX_TITLE_LEN = 160;
const MAX_URL_LEN = 2000;
const MAX_BLOB_LEN = 500; // avatarUrl и прочий текст-мелочь

/** Позиция в секундах или null (событие игнорим, в БД/эфир мусор не пишем). */
function cleanPos(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_POS_SEC) return null;
  return Math.round(n * 100) / 100;
}

/** Текст без управляющих символов + кап длины. Эмодзи и \n не трогаем. */
function cleanText(v: unknown, max: number): string {
  // Сравнение по кодам (числа, не эскейпы): оставляем только таб и \n,
  // \r нормализуем в \n, остальное < 32 и DEL режем.
  const src = String(v ?? '');
  let out = '';
  for (const ch of src) {
    const c = ch.codePointAt(0) as number;
    if (c === 10 || c === 9) { out += ch; continue; }
    if (c === 13) { out += '\n'; continue; }
    if (c < 32 || c === 127) continue;
    out += ch;
  }
  return out.length > max ? out.slice(0, max) : out;
}

/** Имя с фолбэком. */
function cleanName(v: unknown, fallback: string): string {
  const s = cleanText(v, MAX_NAME_LEN).trim();
  return s || fallback;
}

class SocketService {
  private io: Server | null = null;
  private users: Map<string, ConnectedUser> = new Map(); // socketId -> user
  private userSockets: Map<string, Set<string>> = new Map(); // userId -> Set<socketId>
  private roomMembers: Map<string, Map<string, RoomMember>> = new Map(); // roomId -> (socketId -> RoomMember)
  private lastSeekTimeByRoom: Map<string, number> = new Map(); // roomId -> timestamp of last seek
  private lastMembersEmitByRoom: Map<string, number> = new Map(); // roomId -> timestamp of last room:members emit
  private lastHealthEmitByRoom: Map<string, number> = new Map(); // roomId -> timestamp of last room:health emit
  private lastRollbackNoticeByRoom: Map<string, { ts: number; culprit: string }> = new Map(); // roomId -> cooldown
  // roomId -> (userId -> последний heartbeat). Для детекта РЕАЛЬНОГО отката:
  // сравниваем сендера только с его же прошлой позицией, а не с чужим якорем.
  private lastHeartbeatByRoom: Map<string, Map<string, { pos: number; ts: number }>> = new Map();
  // roomId -> когда якорь последний раз принимали. Если все отстали и якорь протух —
  // принимаем лучшее из доступного (rebase), иначе комната замирает навсегда.
  private lastAcceptedAnchorByRoom: Map<string, number> = new Map();
  // roomId -> последние разосланные time_anchor. Нужны, чтобы отличить настоящую
  // локальную отмотку от штатной автокоррекции (клиент прыгнул ровно на якорь).
  private lastAnchorsByRoom: Map<string, { pos: number; ts: number }[]> = new Map();
  // socketId -> event -> метки времени. Дропим флуд молча (без ответа — у старых
  // клиентов нет хендлера ошибок, а честные лимиты не задевают: см. константы ниже).
  private eventRateBySocket: Map<string, Map<string, number[]>> = new Map();

  /** false если сокет превысил лимит (событие дропаем). Лимиты — см. вызовы. */
  private checkRate(socketId: string, event: string, limit: number, windowMs: number): boolean {
    let per = this.eventRateBySocket.get(socketId);
    if (!per) {
      per = new Map();
      this.eventRateBySocket.set(socketId, per);
    }
    const now = Date.now();
    let arr = per.get(event);
    if (!arr) {
      arr = [];
      per.set(event, arr);
    }
    while (arr.length > 0 && now - arr[0] > windowMs) arr.shift();
    if (arr.length >= limit) return false;
    arr.push(now);
    return true;
  }

  public init(io: Server) {
    this.io = io;

    io.on('connection', (socket: Socket) => {
      logger.info('SOCKET', `Client connected: ${socket.id}`);

      // 1. Time Synchronization (NTP Protocol)
      socket.on('sync:ping', (data: { clientTimestamp: number }) => {
        if (!data || typeof data !== 'object') return;
        if (!this.checkRate(socket.id, 'sync:ping', 60, 10000)) return;
        socket.emit('sync:pong', {
          clientTimestamp: data.clientTimestamp,
          serverTimestamp: Date.now(),
        });
      });

      // 2. User Presence (с проверкой личности: токен → доверенный id,
      // без токена → гость; чужой реальный userId взять нельзя)
      socket.on('user:connect', (userData: { userId: string; username: string; avatarUrl?: string; token?: string }) => {
        if (!userData) return;

        let finalId = '';
        let finalName = 'Гость';
        let finalAvatar: string | undefined =
          typeof userData?.avatarUrl === 'string' ? cleanText(userData.avatarUrl, MAX_BLOB_LEN) || undefined : undefined;
        let verified = false;

        // A. Пробуем JWT: валидный токен = доказанная личность
        const token = (userData as any)?.token;
        if (typeof token === 'string' && token.length > 10) {
          try {
            const payload = jwt.verify(token, getJwtSecret()) as { id: string };
            const dbUser = db.prepare('SELECT id, username, avatarUrl FROM users WHERE id = ?').get(payload.id) as
              { id: string; username: string; avatarUrl?: string } | undefined;
            if (dbUser) {
              finalId = dbUser.id;
              finalName = dbUser.username;
              finalAvatar = dbUser.avatarUrl || finalAvatar;
              verified = true;
            }
          } catch {
            // протухший/левый токен — падаем в гостевой путь ниже
          }
        }

        // B. Гость: свой id можно, ЧУЖОЙ реальный — нельзя
        if (!verified) {
          const supplied = String(userData?.userId || '').trim();
          let collides = false;
          if (supplied) {
            try {
              collides = !!db.prepare('SELECT id FROM users WHERE id = ?').get(supplied);
            } catch {}
          }
          if (collides) {
            finalId = `guest:${socket.id.slice(0, 8)}`;
            logger.warn('SECURITY', `Сокет ${socket.id} пытался занять чужой userId — выдан гостевой ${finalId}`);
          } else {
            finalId = supplied || `guest:${socket.id.slice(0, 8)}`;
          }
          finalName = cleanName(userData?.username, 'Гость');
        }

        const user: ConnectedUser = {
          userId: finalId,
          username: finalName,
          avatarUrl: finalAvatar,
          socketId: socket.id,
          status: 'online',
          verified,
        };

        this.users.set(socket.id, user);

        if (!this.userSockets.has(finalId)) {
          this.userSockets.set(finalId, new Set());
        }
        this.userSockets.get(finalId)!.add(socket.id);

        this.broadcastPresence(finalId, 'online');
      });

      socket.on('user:activity', (data: { activity?: string; status?: string }) => {
        const user = this.users.get(socket.id);
        if (user) {
          if (data.activity !== undefined) user.activity = cleanText(data.activity, 64);
          if (data.status !== undefined) user.status = cleanText(data.status, 32);
          this.broadcastPresence(user.userId, user.status, user.activity);
        }
      });

      // 3. Room Join / Leave
      socket.on('room:join', (data: { roomId: string; userId: string; username: string; avatarUrl?: string; streamMode?: 'direct' | 'fmp4' }) => {
        if (!data || typeof data !== 'object') return;
        const { roomId } = data;
        if (!roomId) return;

        // SECURITY: личность берём из проверенного сокета (user:connect),
        // а не из полей джоина — их можно подделать
        const connUser = this.users.get(socket.id);
        const userId = connUser?.userId || data.userId;
        const username = cleanName(connUser?.username || data.username, 'Гость');
        const avatarRaw = connUser?.avatarUrl || data.avatarUrl;
        const avatarUrl = typeof avatarRaw === 'string' ? cleanText(avatarRaw, MAX_BLOB_LEN) || undefined : undefined;
        const streamMode = data.streamMode === 'fmp4' ? 'fmp4' : 'direct';

        socket.join(roomId);

        if (!this.roomMembers.has(roomId)) {
          this.roomMembers.set(roomId, new Map());
        }

        const roomMap = this.roomMembers.get(roomId)!;
        const isAlreadyInRoom = Array.from(roomMap.values()).some(m => m.userId === userId);

        // Remove any old stale socket for the same user in this room
        for (const [sId, m] of Array.from(roomMap.entries())) {
          if (m.userId === userId && sId !== socket.id) {
            roomMap.delete(sId);
          }
        }

        const member: RoomMember = {
          userId: userId || 'guest',
          username: username || 'Гость',
          avatarUrl,
          socketId: socket.id,
          isReady: true,
          bufferedPosition: 0,
          currentPosition: 0,
          pingMs: 0,
          streamMode: streamMode || 'direct',
          joinedAt: new Date().toISOString(),
          isBuffering: false,
          isPlaying: false,
          bufferedAheadSec: -1, // -1 = неизвестно (нет данных о буфере)
          stallCount: 0,
          stallMs: 0,
          rttMs: 0,
          droppedFrames: 0,
          healthStatus: 'ok',
          lastHealthUpdate: Date.now(),
        };

        roomMap.set(socket.id, member);

        const user = this.users.get(socket.id);
        if (user) {
          user.currentRoomId = roomId;
        }

        logger.info('ROOM_JOIN', `User ${username} joined room ${roomId} (stream: ${member.streamMode}). Total members: ${roomMap.size}`);

        // Fetch room state
        const room = db.prepare(`
          SELECT r.*, m.title as mediaTitle, m.durationSeconds, m.segmentDuration, m.posterPath, m.backdropPath
          FROM rooms r
          LEFT JOIN media_items m ON r.mediaItemId = m.id
          WHERE r.id = ?
        `).get(roomId) as any;

        const now = Date.now();
        let livePosition = room?.currentPosition || 0;
        if (room && room.state === 'PLAYING' && room.serverTimestamp) {
          const elapsed = Math.max(0, (now - room.serverTimestamp) / 1000 * (room.playbackRate || 1.0));
          livePosition += elapsed;
        }

        // Deduplicated unique members list
        const uniqueMembers = new Map<string, RoomMember>();
        for (const m of roomMap.values()) {
          uniqueMembers.set(m.userId, m);
        }

        // Send initial state to newly joined client
        socket.emit('room:initial_state', {
          room,
          members: Array.from(uniqueMembers.values()),
          serverTimestamp: now,
          livePosition,
        });

        // Broadcast updated members list to the room
        this.emitRoomMembers(roomId);

        if (!isAlreadyInRoom) {
          io.to(roomId).emit('room:system_message', {
            text: `Пользователь ${username} присоединился к просмотру`,
            type: 'join',
            timestamp: now,
          });
          this.emitActionFeed(roomId, {
            id: `feed-${now}-${Math.random().toString(36).slice(2, 7)}`,
            userId: userId || 'guest',
            username: username || 'Гость',
            avatarUrl,
            action: 'JOIN',
            text: `${username || 'Гость'} присоединился`,
            timestamp: now,
          });
        }
        this.emitRoomHealth(roomId, true);
      });

      socket.on('room:leave', (data: { roomId: string }) => {
        if (data?.roomId) {
          this.handleLeaveRoom(socket, data.roomId);
        }
      });

      // 4. Clean Unified Room Play / Pause / Seek Actions
      socket.on('room:action', (data: {
        roomId: string;
        action: 'PLAY' | 'PAUSE' | 'SEEK';
        position: number;
        playbackRate?: number;
        shouldPlay?: boolean;
        userId?: string;
      }) => {
        // Пустой emit без payload ронял процесс на деструктуризации (uncaught в хендлере)
        if (!data || typeof data !== 'object') return;
        let { roomId, action, position, playbackRate = 1.0, shouldPlay } = data;
        if (!roomId) return;
        // Неизвестный action раньше всё равно писал фид и сбрасывал базлайны — дропаем
        if (action !== 'PLAY' && action !== 'PAUSE' && action !== 'SEEK') return;
        // Битая позиция (NaN/минус/гигабайты) отравляла livePosition всей комнате
        const cleanActionPos = cleanPos(position);
        if (cleanActionPos === null) {
          logger.warn('ROOM_ACTION', `Room ${roomId} игнорирую ${action} с битой позицией`);
          return;
        }
        position = cleanActionPos;
        playbackRate = typeof playbackRate === 'number' && Number.isFinite(playbackRate)
          ? Math.min(4, Math.max(0.25, playbackRate)) : 1.0;
        // Живое использование: тапы + seek-драги (троттлинг клиента ~4/с) — 60/10с с запасом
        if (!this.checkRate(socket.id, 'room:action', 60, 10000)) return;

        const now = Date.now();
        const user = this.users.get(socket.id);
        const member = this.roomMembers.get(roomId)?.get(socket.id);
        const initiatedBy = cleanName(user?.username || member?.username, 'Участник');
        const initiatedByUserId = user?.userId || member?.userId || data.userId || '';

        logger.info('ROOM_ACTION', `Room ${roomId} action: ${action} pos: ${position.toFixed(1)}s (by: ${initiatedBy})`);

        const feedText = action === 'PAUSE'
          ? `${initiatedBy} поставил на паузу (${this.formatPos(position)})`
          : action === 'PLAY'
            ? `${initiatedBy} продолжил воспроизведение (${this.formatPos(position)})`
            : `${initiatedBy} перемотал на ${this.formatPos(position)}${shouldPlay ? '' : ' (пауза)'}`;

        if (action === 'PAUSE') {
          try {
            db.prepare(`
              UPDATE rooms SET state = 'PAUSED', currentPosition = ?, serverTimestamp = ?, playbackRate = ? WHERE id = ?
            `).run(position, now, playbackRate, roomId);
          } catch {}

          io.to(roomId).emit('room:sync_state', {
            state: 'PAUSED',
            currentPosition: position,
            serverTimestamp: now,
            playbackRate,
            action: 'PAUSE',
            initiatedBy,
            initiatedByUserId,
          });
        } else if (action === 'PLAY') {
          // 150ms synchronized lockstep startup so all clients fire play() together
          const scheduledPlayAt = now + 150;
          try {
            db.prepare(`
              UPDATE rooms SET state = 'PLAYING', currentPosition = ?, serverTimestamp = ?, playbackRate = ? WHERE id = ?
            `).run(position, scheduledPlayAt, playbackRate, roomId);
          } catch {}

          io.to(roomId).emit('room:sync_state', {
            state: 'PLAYING',
            currentPosition: position,
            serverTimestamp: scheduledPlayAt,
            playbackRate,
            action: 'PLAY',
            initiatedBy,
            initiatedByUserId,
          });
        } else if (action === 'SEEK') {
          this.lastSeekTimeByRoom.set(roomId, now);
          const targetState: RoomState = shouldPlay ? 'PLAYING' : 'PAUSED';
          const scheduledPlayAt = shouldPlay ? now + 150 : now;

          try {
            db.prepare(`
              UPDATE rooms SET state = ?, currentPosition = ?, serverTimestamp = ?, playbackRate = ? WHERE id = ?
            `).run(targetState, position, scheduledPlayAt, playbackRate, roomId);
          } catch {}

          io.to(roomId).emit('room:sync_state', {
            state: targetState,
            currentPosition: position,
            serverTimestamp: scheduledPlayAt,
            playbackRate,
            action: 'SEEK',
            initiatedBy,
            initiatedByUserId,
          });
        }

        this.emitActionFeed(roomId, {
          id: `feed-${now}-${Math.random().toString(36).slice(2, 7)}`,
          userId: initiatedByUserId || 'guest',
          username: initiatedBy,
          avatarUrl: user?.avatarUrl || member?.avatarUrl,
          action,
          position,
          text: feedText,
          timestamp: now,
        });

        // Любой room action — новая точка отсчёта для всех: иначе пер-сендер
        // детект примет штатный прыжок по чужому SEEK/PLAY/PAUSE за "отмотку".
        // (свой SEEK инициатора, чужой исполняемый SEEK, возобновление после паузы)
        this.resetHeartbeatBaselines(roomId, position, now);
        this.lastAcceptedAnchorByRoom.set(roomId, now);
      });

      // 5. Periodic Time Anchor от любого играющего клиента.
      // Правила, чтобы не врать и не ломать комнату:
      // 1) Откат детектим ТОЛЬКО по таймлайну самого сендера (его позиция прыгнула
      //    назад относительно его же прошлого heartbeat). Сравнение с чужим якорем
      //    давало ложные обвинения: десктоп без автокоррекции или клиент, которому
      //    коррекции заблокированы частыми экшенами, законно едет на 2с позади —
      //    это не откат, и винить его каждые 8с — баг.
      // 2) Отставший heartbeat НЕ перезаписывает якорь и НЕ рассылается другим.
      //    Старый код писал чужую отсталую позицию в DB и слал её всем как
      //    time_anchor — т.е. сам УСТРАИВАЛ массовый откат, о котором потом рапортовал.
      //    Якорь теперь монотонный: только вперёд (допуск 1.5с под джиттер — как
      //    порог автокоррекции у клиентов).
      // 3) Если якорь протух (>10с никто не прислал свежее — например, шедший
      //    впереди ушёл), принимаем лучшее из доступного (rebase), иначе комната
      //    замрёт на старой позиции навсегда.
      socket.on('room:host_heartbeat', (data: { roomId: string; position: number }) => {
        if (!data?.roomId) return;
        const now = Date.now();
        // Каденс живых — раз в 3с; лимит с огромным запасом, флуд режем
        if (!this.checkRate(socket.id, 'room:host_heartbeat', 40, 10000)) return;

        // Короткое окно после seek, чтобы не откатывать свежий seek якорем от тормозящего клиента
        const lastSeek = this.lastSeekTimeByRoom.get(data.roomId) || 0;
        if (now - lastSeek < 2500) {
          return;
        }

        const sender = this.users.get(socket.id);
        const senderMember = this.roomMembers.get(data.roomId)?.get(socket.id);
        const senderUserId = sender?.userId || senderMember?.userId || socket.id;
        const senderName = cleanName(sender?.username || senderMember?.username, 'Участник');
        const pos = cleanPos(data.position);
        // Битый heartbeat игнорим целиком — иначе NaN/минус едет в детект откатов и якорь
        if (pos === null) return;

        try {
          const cur = db.prepare('SELECT currentPosition, serverTimestamp, state, playbackRate FROM rooms WHERE id = ?').get(data.roomId) as any;
          if (!cur) return;
          const rate = cur.playbackRate || 1.0;
          const playing = cur.state === 'PLAYING';
          let live = cur.currentPosition || 0;
          if (playing && cur.serverTimestamp) {
            live += Math.max(0, (now - cur.serverTimestamp) / 1000) * rate;
          }

          // — 1) Пер-сендер детект: его собственная позиция прыгнула назад? —
          let hbMap = this.lastHeartbeatByRoom.get(data.roomId);
          if (!hbMap) {
            hbMap = new Map();
            this.lastHeartbeatByRoom.set(data.roomId, hbMap);
          }
          const prev = hbMap.get(senderUserId);
          if (prev && playing) {
            const expected = prev.pos + Math.max(0, (now - prev.ts) / 1000) * rate;
            const jumpedBack = expected - pos;
            const senderBuffering = Boolean(senderMember?.isBuffering);
            // Зависший (буферизация) — не откат, его уже ведёт room:health. Только
            // резкий прыжок назад у играющего клиента считаем локальной отмоткой.
            // Два гейта против ложных срабатываний:
            // а) прыжок ровно на недавний якорь — это штатная автокоррекция дрейфа;
            // б) прыжок на известную позицию другого участника — ручное "Выровнять".
            if (!senderBuffering && jumpedBack > 2.0 && jumpedBack < 60) {
              let isSyncCorrection = false;
              const anchors = this.lastAnchorsByRoom.get(data.roomId) || [];
              for (const a of anchors) {
                if (now - a.ts > 8000) continue;
                const anchorLive = a.pos + Math.max(0, (now - a.ts) / 1000) * rate;
                if (Math.abs(anchorLive - pos) < 2.0) {
                  isSyncCorrection = true;
                  break;
                }
              }
              if (!isSyncCorrection) {
                const roomMap = this.roomMembers.get(data.roomId);
                if (roomMap) {
                  for (const other of roomMap.values()) {
                    if (other.userId !== senderUserId
                      && Math.abs((other.currentPosition || 0) - pos) < 4.0) {
                      isSyncCorrection = true;
                      break;
                    }
                  }
                }
              }
              if (!isSyncCorrection) {
                this.sendRollbackNotice(data.roomId, {
                  culpritUserId: sender?.userId || senderMember?.userId || '',
                  culpritName: senderName,
                  from: Math.round(expected * 10) / 10,
                  to: Math.round(pos * 10) / 10,
                  backwardSec: Math.round(jumpedBack * 10) / 10,
                  now,
                });
              }
            }
          }
          hbMap.set(senderUserId, { pos, ts: now });

          // — 2+3) Политика якоря: вперёд — пишем и рассылаем, назад — игнорим —
          const lastAccepted = this.lastAcceptedAnchorByRoom.get(data.roomId) || 0;
          const anchorStale = now - lastAccepted > 10000;
          if (pos >= live - 1.5 || anchorStale) {
            try {
              db.prepare('UPDATE rooms SET currentPosition = ?, serverTimestamp = ? WHERE id = ?').run(pos, now, data.roomId);
            } catch {}
            this.lastAcceptedAnchorByRoom.set(data.roomId, now);
            this.rememberAnchor(data.roomId, pos, now);
            socket.to(data.roomId).emit('room:time_anchor', {
              currentPosition: pos,
              serverTimestamp: now,
              anchorUserId: sender?.userId || senderMember?.userId || '',
              anchorUsername: senderName,
            });
          }
          // stale heartbeat: якорь не трогаем, другим не шлём — отставший сам
          // подтянется по чужим time_anchor (автокоррекция) или ручным "Выровнять".
        } catch {}
      });

      // 6. Force Sync All to Host Position
      socket.on('room:force_sync_all', (data: { roomId: string; position: number }) => {
        if (!data?.roomId) return;
        const pos = cleanPos(data.position);
        if (pos === null) return;
        // Кнопка жмётся руками — 10/10с с запасом
        if (!this.checkRate(socket.id, 'room:force_sync_all', 10, 10000)) return;
        const now = Date.now();
        const user = this.users.get(socket.id);
        const scheduledPlayAt = now + 200;

        try {
          db.prepare('UPDATE rooms SET currentPosition = ?, serverTimestamp = ? WHERE id = ?').run(pos, scheduledPlayAt, data.roomId);
        } catch {}
        this.resetHeartbeatBaselines(data.roomId, pos, now);
        this.lastAcceptedAnchorByRoom.set(data.roomId, now);

        io.to(data.roomId).emit('room:force_sync_all', {
          position: pos,
          serverTimestamp: scheduledPlayAt,
          initiatedBy: cleanName(user?.username, 'Хост'),
        });

        io.to(data.roomId).emit('room:system_message', {
          text: `👑 Хост ${cleanName(user?.username, '')} синхронизировал воспроизведение для всех`,
          type: 'sync',
          timestamp: now,
        });
        this.emitActionFeed(data.roomId, {
          id: `feed-${now}-${Math.random().toString(36).slice(2, 7)}`,
          userId: user?.userId || '',
          username: cleanName(user?.username, 'Хост'),
          avatarUrl: user?.avatarUrl,
          action: 'SYNC',
          position: pos,
          text: `${cleanName(user?.username, 'Хост')} синхронизировал всех на ${this.formatPos(pos)}`,
          timestamp: now,
        });
      });

      // 7. Member Status & Position Reporting (позиции нужны для syncToHost — рассылаем троттлингом 2с)
      // Расширено телеметрией здоровья: buffering/stalls/rtt/drops/platform
      socket.on('room:member_status', (data: {
        roomId: string; currentPosition: number; bufferedPosition?: number; streamMode?: 'direct' | 'fmp4';
        isBuffering?: boolean; isPlaying?: boolean; bufferedAheadSec?: number; stallCount?: number; stallMs?: number;
        rttMs?: number; pingMs?: number; droppedFrames?: number; platform?: string; hwdec?: string;
      }) => {
        if (!data?.roomId) return;
        // Каденс живых — 3с (+2с fastPoll) с клиента; лимит с запасом
        if (!this.checkRate(socket.id, 'room:member_status', 40, 10000)) return;
        const members = this.roomMembers.get(data.roomId);
        if (members && members.has(socket.id)) {
          const m = members.get(socket.id)!;
          const wasBuffering = Boolean(m.isBuffering);
          // Позиция — смысл события: битая — игнорим событие целиком
          const curPos = cleanPos(data.currentPosition);
          if (curPos === null) return;
          m.currentPosition = curPos;
          let buf: number | undefined;
          if (data.bufferedPosition !== undefined) {
            const b = cleanPos(data.bufferedPosition);
            if (b !== null) {
              m.bufferedPosition = b;
              buf = b;
            }
          }
          if (typeof data.isBuffering === 'boolean') m.isBuffering = data.isBuffering;
          if (typeof data.isPlaying === 'boolean') m.isPlaying = data.isPlaying;
          if (typeof data.bufferedAheadSec === 'number' && Number.isFinite(data.bufferedAheadSec)) {
            m.bufferedAheadSec = Math.min(MAX_POS_SEC, Math.max(0, data.bufferedAheadSec));
          } else if (buf !== undefined) {
            m.bufferedAheadSec = Math.min(MAX_POS_SEC, Math.max(0, buf - curPos));
          }
          const finiteNonNeg = (v: unknown): v is number =>
            typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000000000;
          if (finiteNonNeg(data.stallCount)) m.stallCount = data.stallCount;
          if (finiteNonNeg(data.stallMs)) m.stallMs = data.stallMs;
          if (finiteNonNeg(data.rttMs)) { m.rttMs = data.rttMs; m.pingMs = data.rttMs; }
          else if (finiteNonNeg(data.pingMs)) { m.pingMs = data.pingMs; m.rttMs = data.pingMs; }
          if (finiteNonNeg(data.droppedFrames)) m.droppedFrames = data.droppedFrames;
          if (typeof data.platform === 'string' && data.platform) (m as RoomMember).platform = cleanText(data.platform, 24);
          if (typeof data.hwdec === 'string') (m as RoomMember).hwdec = cleanText(data.hwdec, 24);
          // isReady для обратной совместимости: готов = не буферизуется
          m.isReady = !m.isBuffering;
          if (m.bufferedAheadSec !== undefined && m.bufferedAheadSec >= 0) {
            m.bufferPercent = Math.max(0, Math.min(100, Math.round((m.bufferedAheadSec / 10) * 100)));
          } else {
            m.bufferPercent = undefined;
          }
          const now2 = Date.now();
          m.lastHealthUpdate = now2;

          // Переходы буферизации — в ленту действий, но ТОЛЬКО когда комната играет.
          // На паузе seek'и дают 'waiting' у всех — это не повод писать "ожидаем".
          let roomPlaying = false;
          try {
            const row = db.prepare('SELECT state FROM rooms WHERE id = ?').get(data.roomId) as any;
            roomPlaying = row?.state === 'PLAYING';
          } catch {}
          const bufferingActive = Boolean(m.isBuffering) && roomPlaying && m.isPlaying !== false;
          const wasActive = wasBuffering && roomPlaying; // приближённо: прошлое окно тоже при игре
          if (!wasActive && bufferingActive) {
            this.emitActionFeed(data.roomId, {
              id: `feed-${now2}-${Math.random().toString(36).slice(2, 7)}`,
              userId: m.userId,
              username: m.username,
              avatarUrl: m.avatarUrl,
              action: 'BUFFERING',
              position: m.currentPosition,
              text: `${m.username} буферизуется — ожидаем…`,
              timestamp: now2,
            });
          } else if (wasBuffering && !m.isBuffering && roomPlaying) {
            this.emitActionFeed(data.roomId, {
              id: `feed-${now2}-${Math.random().toString(36).slice(2, 7)}`,
              userId: m.userId,
              username: m.username,
              avatarUrl: m.avatarUrl,
              action: 'RECOVERED',
              position: m.currentPosition,
              text: `${m.username} догнал комнату ✓`,
              timestamp: now2,
            });
          }

          if (data.streamMode && m.streamMode !== data.streamMode) {
            m.streamMode = data.streamMode;
            this.emitRoomMembers(data.roomId, true);
          } else {
            this.emitRoomMembers(data.roomId);
          }
          this.emitRoomHealth(data.roomId);
        }
      });

      // 8. Chat Messages
      socket.on('room:chat_message', (data: { roomId: string; text: string; userId?: string; username?: string; avatarUrl?: string }) => {
        if (!data?.roomId) return;
        // Живой чат — единицы сообщений в минуту; 8/10с с запасом
        if (!this.checkRate(socket.id, 'room:chat_message', 8, 10000)) return;
        const text = cleanText(data.text, MAX_CHAT_LEN).trim();
        if (!text) return;

        const user = this.users.get(socket.id);
        const senderUserId = user?.userId || data.userId || 'guest';
        const senderUsername = cleanName(user?.username || data.username, 'Пользователь');
        const rawAvatar = user?.avatarUrl || data.avatarUrl;
        const senderAvatar = typeof rawAvatar === 'string' ? cleanText(rawAvatar, MAX_BLOB_LEN) || undefined : undefined;

        io.to(data.roomId).emit('room:chat_message', {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          userId: senderUserId,
          username: senderUsername,
          avatarUrl: senderAvatar,
          text,
          timestamp: Date.now(),
        });
      });

      // 9. Floating Emoji Reactions
      socket.on('room:reaction', (data: { roomId: string; emoji: string; username?: string }) => {
        if (!data?.roomId) return;
        // Бурные реакции — клики подряд; 20/10с хватает, флуд режем
        if (!this.checkRate(socket.id, 'room:reaction', 20, 10000)) return;
        const emoji = cleanText(data.emoji, MAX_EMOJI_LEN);
        if (!emoji) return;

        const user = this.users.get(socket.id);
        const senderUsername = cleanName(user?.username || data.username, 'Участник');

        io.to(data.roomId).emit('room:reaction', {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          emoji,
          username: senderUsername,
          timestamp: Date.now(),
        });
      });

      // 10. Friend Invitations
      socket.on('friend:invite_to_room', (data: {
        targetUserId: string;
        roomId: string;
        roomCode: string;
        roomTitle: string;
        mediaTitle: string;
        posterPath?: string;
      }) => {
        if (!data || typeof data !== 'object') return;
        const sender = this.users.get(socket.id);
        if (!sender || !data.targetUserId) return;

        const targetSockets = this.userSockets.get(data.targetUserId);
        if (targetSockets) {
          for (const targetSocketId of targetSockets) {
            io.to(targetSocketId).emit('notification:room_invite', {
              senderUsername: cleanName(sender.username, 'Участник'),
              senderAvatar: typeof sender.avatarUrl === 'string' ? cleanText(sender.avatarUrl, MAX_BLOB_LEN) : sender.avatarUrl,
              roomId: cleanText(data.roomId, 64),
              roomCode: cleanText(data.roomCode, 32),
              roomTitle: cleanText(data.roomTitle, MAX_TITLE_LEN),
              mediaTitle: cleanText(data.mediaTitle, MAX_TITLE_LEN),
              posterPath: sanitizeMediaUrl(data.posterPath),
              timestamp: Date.now(),
            });
          }
        }
      });

      // 10b. YouTube video change (раньше клиент эмитил, а хендлера не было — смена никому не уходила)
      socket.on('room:change_youtube', async (data: { roomId: string; youtubeUrl: string }) => {
        try {
          if (!data?.roomId || !data?.youtubeUrl?.trim()) return;
          const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(data.roomId) as any;
          if (!room || room.sourceType !== 'YOUTUBE') return;

          const user = this.users.get(socket.id);
          // Менять видео может только хост (кнопка и так только у хоста)
          if (user && room.hostUserId && user.userId !== room.hostUserId) return;

          const trimmed = data.youtubeUrl.trim();
          let ytId: string | null = null;
          if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
            ytId = trimmed;
          } else {
            const m = trimmed.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
            ytId = m ? m[1] : null;
          }
          if (!ytId) return;

          let ytTitle = 'YouTube Видео';
          let ytThumb = `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 4000);
            const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`, { signal: ctrl.signal });
            clearTimeout(t);
            if (res.ok) {
              const info = (await res.json()) as any;
              if (info?.title) ytTitle = info.title;
              if (info?.thumbnail_url) ytThumb = info.thumbnail_url;
            }
          } catch {}

          const now = Date.now();
          const ytUrl = `https://www.youtube.com/watch?v=${ytId}`;
          db.prepare(`
            UPDATE rooms SET youtubeId = ?, youtubeUrl = ?, youtubeTitle = ?, youtubeThumbnail = ?,
              state = 'PAUSED', currentPosition = 0, serverTimestamp = ? WHERE id = ?
          `).run(ytId, ytUrl, ytTitle, ytThumb, now, data.roomId);
          this.lastSeekTimeByRoom.set(data.roomId, now);
          // Новое видео с нуля — старые базлайны/якоря недействительны
          this.resetHeartbeatBaselines(data.roomId, 0, now);
          this.lastAcceptedAnchorByRoom.set(data.roomId, now);

          io.to(data.roomId).emit('room:youtube_changed', {
            youtubeId: ytId,
            youtubeUrl: ytUrl,
            youtubeTitle: ytTitle,
            youtubeThumbnail: ytThumb,
            initiatedBy: user?.username || 'Хост',
          });
          io.to(data.roomId).emit('room:sync_state', {
            state: 'PAUSED',
            currentPosition: 0,
            serverTimestamp: now,
            playbackRate: 1.0,
            action: 'SEEK',
            initiatedBy: user?.username || 'Хост',
            initiatedByUserId: user?.userId || '',
          });
          io.to(data.roomId).emit('room:system_message', {
            text: `▶ Включено новое видео: ${ytTitle}`,
            type: 'sync',
            timestamp: now,
          });
          logger.info('ROOM_YOUTUBE', `Room ${data.roomId} switched YouTube video to ${ytId} (by: ${user?.username || '?'})`);
        } catch (err) {
          logger.error('ROOM_YOUTUBE', 'change_youtube error', err);
        }
      });

      // 11. Disconnect Cleanup
      socket.on('disconnect', () => {
        this.eventRateBySocket.delete(socket.id);
        for (const [roomId, roomMap] of this.roomMembers.entries()) {
          if (roomMap.has(socket.id)) {
            this.handleLeaveRoom(socket, roomId);
          }
        }

        const user = this.users.get(socket.id);
        if (user) {
          const userSet = this.userSockets.get(user.userId);
          if (userSet) {
            userSet.delete(socket.id);
            if (userSet.size === 0) {
              this.userSockets.delete(user.userId);
              this.broadcastPresence(user.userId, 'offline');
              // Страховка на случай потерянного end-маяка: если через 10с у юзера так и нет
              // живых сокетов — чистим его соло-HLS сессии. Проверка В МОМЕНТ срабатывания,
              // а не сразу: StrictMode-ремонт и реконнект сокета (пауза в мс-секунды) успевают
              // переподключиться и килл отменяется. Обычное закрытие и так чистится маяком
              // мгновенно — сюда доходит только потерянный маяк. Комнатные сессии не трогаем.
              // Убиваем только IDLE-сессии (без запросов >60с): живой плеер на медленной сети
              // качает сегменты по HTTP и переживает обрывы сокета — его трогать нельзя.
              const diedUserId = user.userId;
              setTimeout(async () => {
                if (!this.userSockets.has(diedUserId)) {
                  await ffmpegService.killSoloSessionsForUser(diedUserId, 60000);
                }
              }, 10000);
            }
          }
          this.users.delete(socket.id);
        }
      });
    });
  }

  private async handleLeaveRoom(socket: Socket, roomId: string) {
    socket.leave(roomId);
    const members = this.roomMembers.get(roomId);
    if (members) {
      const member = members.get(socket.id);
      members.delete(socket.id);

      const hasOtherConnections = Array.from(members.values()).some(m => m.userId === member?.userId);

      if (member && !hasOtherConnections && this.io) {
        this.io.to(roomId).emit('room:system_message', {
          text: `Пользователь ${member.username} покинул комнату`,
          type: 'leave',
          timestamp: Date.now(),
        });
        this.emitActionFeed(roomId, {
          id: `feed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          userId: member.userId,
          username: member.username,
          avatarUrl: member.avatarUrl,
          action: 'LEAVE',
          text: `${member.username} покинул комнату`,
          timestamp: Date.now(),
        });
      }

      logger.info('ROOM_LEAVE', `User ${member?.username || socket.id} left room ${roomId}. Remaining: ${members.size}`);

      if (members.size === 0) {
        this.roomMembers.delete(roomId);
        this.lastSeekTimeByRoom.delete(roomId);
        this.lastHealthEmitByRoom.delete(roomId);
        this.lastRollbackNoticeByRoom.delete(roomId);
        this.lastHeartbeatByRoom.delete(roomId);
        this.lastAcceptedAnchorByRoom.delete(roomId);
        this.lastAnchorsByRoom.delete(roomId);
        // Clean up FFmpeg session for empty room with 4s grace period (handles React remount / page reload)
        setTimeout(async () => {
          const currentMembers = this.roomMembers.get(roomId);
          if (!currentMembers || currentMembers.size === 0) {
            await ffmpegService.killSessionsForRoom(roomId);
          }
        }, 4000);
      } else {
        this.emitRoomMembers(roomId, true);
        this.emitRoomHealth(roomId, true);
        if (member?.userId && !hasOtherConnections) {
          this.lastHeartbeatByRoom.get(roomId)?.delete(member.userId);
          await ffmpegService.killUserSessionInRoom(roomId, member.userId);
        }
      }
    }
  }

  private emitRoomMembers(roomId: string, force: boolean = false) {
    if (!this.io) return;
    // Троттлинг позиционных апдейтов: не чаще 1 раза в 2с (force — смена streamMode/join/leave — идёт сразу)
    if (!force) {
      const now = Date.now();
      const last = this.lastMembersEmitByRoom.get(roomId) || 0;
      if (now - last < 2000) return;
      this.lastMembersEmitByRoom.set(roomId, now);
    } else {
      this.lastMembersEmitByRoom.set(roomId, Date.now());
    }
    const members = this.roomMembers.get(roomId);
    if (members) {
      const unique = new Map<string, RoomMember>();
      for (const m of members.values()) {
        unique.set(m.userId, m);
      }
      this.io.to(roomId).emit('room:members', Array.from(unique.values()));
    }
  }

  private emitRoomHealth(roomId: string, force: boolean = false) {
    if (!this.io) return;
    const now = Date.now();
    if (!force) {
      const last = this.lastHealthEmitByRoom.get(roomId) || 0;
      if (now - last < 2000) return;
    }
    this.lastHealthEmitByRoom.set(roomId, now);
    const membersMap = this.roomMembers.get(roomId);
    if (!membersMap) return;
    const unique = new Map<string, RoomMember>();
    for (const m of membersMap.values()) unique.set(m.userId, m);
    const memberList = Array.from(unique.values());

    let anchor: { position: number; serverTimestamp: number; state: string; playbackRate?: number } | null = null;
    try {
      const row = db.prepare('SELECT currentPosition, serverTimestamp, state, playbackRate FROM rooms WHERE id = ?').get(roomId) as any;
      if (!row) return; // комната удалена через API, а сокеты ещё висят — не считаем
      anchor = { position: row.currentPosition || 0, serverTimestamp: row.serverTimestamp || now, state: row.state || 'PAUSED', playbackRate: row.playbackRate || 1.0 };
    } catch {
      return;
    }

    const { health, culpritIds, waitingFor, waitingText } = roomHealthService.analyze(memberList, anchor, now);
    this.io.to(roomId).emit('room:health', {
      health,
      culpritIds,
      waitingFor,
      waitingText,
      serverTimestamp: now,
    });
  }

  private emitActionFeed(roomId: string, entry: RoomActionFeedEntry) {
    if (!this.io) return;
    this.io.to(roomId).emit('room:action_feed', entry);
  }

  /**
   * Сброс пер-сендер базлайнов heartbeat на новую точку отсчёта.
   * Вызывать при любом room-wide прыжке (PLAY/PAUSE/SEEK/force_sync/смена видео),
   * иначе детект отката примет штатный прыжок за локальную отмотку.
   */
  private resetHeartbeatBaselines(roomId: string, pos: number, ts: number) {
    const roomMap = this.roomMembers.get(roomId);
    const hb = new Map<string, { pos: number; ts: number }>();
    if (roomMap) {
      for (const m of roomMap.values()) {
        hb.set(m.userId, { pos, ts });
      }
    }
    this.lastHeartbeatByRoom.set(roomId, hb);
  }

  /** Запомнить разосланный якорь для гейта автокоррекций (храним ~10с). */
  private rememberAnchor(roomId: string, pos: number, ts: number) {
    let arr = this.lastAnchorsByRoom.get(roomId);
    if (!arr) {
      arr = [];
      this.lastAnchorsByRoom.set(roomId, arr);
    }
    arr.push({ pos, ts });
    while (arr.length > 10) arr.shift();
    while (arr.length > 0 && ts - arr[0].ts > 10000) arr.shift();
  }

  /**
   * Уведомление о локальной отмотке участника.
   * Кулдаун: тот же виновник — не чаще раза в минуту (иначе получаем "20 минут
   * подряд одно и то же"), новый виновник — не чаще раза в 8с.
   */
  private sendRollbackNotice(roomId: string, n: {
    culpritUserId: string; culpritName: string;
    from: number; to: number; backwardSec: number; now: number;
  }) {
    if (!this.io) return;
    const last = this.lastRollbackNoticeByRoom.get(roomId);
    if (last) {
      if (last.culprit === n.culpritUserId && n.now - last.ts < 60000) return;
      if (last.culprit !== n.culpritUserId && n.now - last.ts < 8000) return;
    }
    this.lastRollbackNoticeByRoom.set(roomId, { ts: n.now, culprit: n.culpritUserId });
    this.io.to(roomId).emit('room:rollback_notice', {
      culpritUserId: n.culpritUserId,
      culpritName: n.culpritName,
      from: n.from,
      to: n.to,
      backwardSec: n.backwardSec,
      waitingFor: [] as string[],
      text: `${n.culpritName} отмотал назад на ${n.backwardSec.toFixed(1)}с — выравниваем…`,
      timestamp: n.now,
    });
    const member = this.roomMembers.get(roomId)
      ? Array.from(this.roomMembers.get(roomId)!.values()).find((m) => m.userId === n.culpritUserId)
      : undefined;
    this.emitActionFeed(roomId, {
      id: `feed-${n.now}-${Math.random().toString(36).slice(2, 7)}`,
      userId: n.culpritUserId || 'guest',
      username: n.culpritName,
      avatarUrl: member?.avatarUrl,
      action: 'SYNC',
      position: n.to,
      text: `${n.culpritName} отмотал назад на ${n.backwardSec.toFixed(1)}с — выравниваем`,
      timestamp: n.now,
    });
  }

  private formatPos(pos: number): string {
    const s = Math.max(0, Math.floor(pos || 0));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (h > 0) return `${h}:${String(mm).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${mm}:${String(sec).padStart(2, '0')}`;
  }

  private broadcastPresence(userId: string, status: string, activity?: string) {
    if (!this.io) return;
    this.io.emit('user:presence', {
      userId,
      status,
      activity,
    });
  }

  public getOnlineUsers(): { userId: string; status: string; activity?: string }[] {
    const list: { userId: string; status: string; activity?: string }[] = [];
    for (const [userId, socketIds] of this.userSockets.entries()) {
      if (socketIds.size > 0) {
        const firstSocketId = Array.from(socketIds)[0];
        const u = this.users.get(firstSocketId);
        list.push({
          userId,
          status: u?.status || 'online',
          activity: u?.activity,
        });
      }
    }
    return list;
  }
}

export const socketService = new SocketService();
