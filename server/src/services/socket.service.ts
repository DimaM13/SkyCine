import { Server, Socket } from 'socket.io';
import { db } from '../config/db';
import { RoomMember, RoomState } from '../types';
import { logger } from './logger.service';
import { ffmpegService } from './ffmpeg.service';

interface ConnectedUser {
  userId: string;
  username: string;
  avatarUrl?: string;
  socketId: string;
  currentRoomId?: string;
  status: string;
  activity?: string;
}

class SocketService {
  private io: Server | null = null;
  private users: Map<string, ConnectedUser> = new Map(); // socketId -> user
  private userSockets: Map<string, Set<string>> = new Map(); // userId -> Set<socketId>
  private roomMembers: Map<string, Map<string, RoomMember>> = new Map(); // roomId -> (socketId -> RoomMember)
  private lastSeekTimeByRoom: Map<string, number> = new Map(); // roomId -> timestamp of last seek
  private lastMembersEmitByRoom: Map<string, number> = new Map(); // roomId -> timestamp of last room:members emit

  public init(io: Server) {
    this.io = io;

    io.on('connection', (socket: Socket) => {
      logger.info('SOCKET', `Client connected: ${socket.id}`);

      // 1. Time Synchronization (NTP Protocol)
      socket.on('sync:ping', (data: { clientTimestamp: number }) => {
        socket.emit('sync:pong', {
          clientTimestamp: data.clientTimestamp,
          serverTimestamp: Date.now(),
        });
      });

      // 2. User Presence
      socket.on('user:connect', (userData: { userId: string; username: string; avatarUrl?: string }) => {
        if (!userData?.userId) return;
        const user: ConnectedUser = {
          userId: userData.userId,
          username: userData.username || 'User',
          avatarUrl: userData.avatarUrl,
          socketId: socket.id,
          status: 'online',
        };

        this.users.set(socket.id, user);

        if (!this.userSockets.has(userData.userId)) {
          this.userSockets.set(userData.userId, new Set());
        }
        this.userSockets.get(userData.userId)!.add(socket.id);

        this.broadcastPresence(userData.userId, 'online');
      });

      socket.on('user:activity', (data: { activity?: string; status?: string }) => {
        const user = this.users.get(socket.id);
        if (user) {
          user.activity = data.activity;
          if (data.status) user.status = data.status;
          this.broadcastPresence(user.userId, user.status, user.activity);
        }
      });

      // 3. Room Join / Leave
      socket.on('room:join', (data: { roomId: string; userId: string; username: string; avatarUrl?: string; streamMode?: 'direct' | 'apple_ts' | 'fmp4' }) => {
        const { roomId, userId, username, avatarUrl, streamMode } = data;
        if (!roomId) return;

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
        }
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
        const { roomId, action, position, playbackRate = 1.0, shouldPlay } = data;
        if (!roomId) return;

        const now = Date.now();
        const user = this.users.get(socket.id);
        const member = this.roomMembers.get(roomId)?.get(socket.id);
        const initiatedBy = user?.username || member?.username || 'Участник';
        const initiatedByUserId = user?.userId || member?.userId || data.userId || '';

        logger.info('ROOM_ACTION', `Room ${roomId} action: ${action} pos: ${position.toFixed(1)}s (by: ${initiatedBy})`);

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
      });

      // 5. Periodic Time Anchor from any playing client (раньше только хост + игнор 8с после seek —
      // при активных экшенах якоря не доходили вообще, дрейф копился)
      socket.on('room:host_heartbeat', (data: { roomId: string; position: number }) => {
        if (!data?.roomId) return;
        const now = Date.now();

        // Короткое окно после seek, чтобы не откатывать свежий seek якорем от тормозящего клиента
        const lastSeek = this.lastSeekTimeByRoom.get(data.roomId) || 0;
        if (now - lastSeek < 2500) {
          return;
        }

        try {
          db.prepare('UPDATE rooms SET currentPosition = ?, serverTimestamp = ? WHERE id = ?').run(data.position, now, data.roomId);
        } catch {}

        socket.to(data.roomId).emit('room:time_anchor', {
          currentPosition: data.position,
          serverTimestamp: now,
        });
      });

      // 6. Force Sync All to Host Position
      socket.on('room:force_sync_all', (data: { roomId: string; position: number }) => {
        if (!data?.roomId) return;
        const now = Date.now();
        const user = this.users.get(socket.id);
        const scheduledPlayAt = now + 200;

        try {
          db.prepare('UPDATE rooms SET currentPosition = ?, serverTimestamp = ? WHERE id = ?').run(data.position, scheduledPlayAt, data.roomId);
        } catch {}

        io.to(data.roomId).emit('room:force_sync_all', {
          position: data.position,
          serverTimestamp: scheduledPlayAt,
          initiatedBy: user?.username || 'Хост',
        });

        io.to(data.roomId).emit('room:system_message', {
          text: `👑 Хост ${user?.username || ''} синхронизировал воспроизведение для всех`,
          type: 'sync',
          timestamp: now,
        });
      });

      // 7. Member Status & Position Reporting (позиции нужны для syncToHost — рассылаем троттлингом 2с)
      socket.on('room:member_status', (data: { roomId: string; currentPosition: number; bufferedPosition?: number; streamMode?: 'direct' | 'apple_ts' | 'fmp4' }) => {
        if (!data?.roomId) return;
        const members = this.roomMembers.get(data.roomId);
        if (members && members.has(socket.id)) {
          const m = members.get(socket.id)!;
          m.currentPosition = data.currentPosition || 0;
          if (data.bufferedPosition !== undefined) m.bufferedPosition = data.bufferedPosition;
          if (data.streamMode && m.streamMode !== data.streamMode) {
            m.streamMode = data.streamMode;
            this.emitRoomMembers(data.roomId, true);
          } else {
            this.emitRoomMembers(data.roomId);
          }
        }
      });

      // 8. Chat Messages
      socket.on('room:chat_message', (data: { roomId: string; text: string; userId?: string; username?: string; avatarUrl?: string }) => {
        if (!data?.roomId || !data?.text?.trim()) return;

        const user = this.users.get(socket.id);
        const senderUserId = user?.userId || data.userId || 'guest';
        const senderUsername = user?.username || data.username || 'Пользователь';
        const senderAvatar = user?.avatarUrl || data.avatarUrl;

        io.to(data.roomId).emit('room:chat_message', {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          userId: senderUserId,
          username: senderUsername,
          avatarUrl: senderAvatar,
          text: data.text.trim(),
          timestamp: Date.now(),
        });
      });

      // 9. Floating Emoji Reactions
      socket.on('room:reaction', (data: { roomId: string; emoji: string; username?: string }) => {
        if (!data?.roomId || !data?.emoji) return;

        const user = this.users.get(socket.id);
        const senderUsername = user?.username || data.username || 'Участник';

        io.to(data.roomId).emit('room:reaction', {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          emoji: data.emoji,
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
        const sender = this.users.get(socket.id);
        if (!sender || !data.targetUserId) return;

        const targetSockets = this.userSockets.get(data.targetUserId);
        if (targetSockets) {
          for (const targetSocketId of targetSockets) {
            io.to(targetSocketId).emit('notification:room_invite', {
              senderUsername: sender.username,
              senderAvatar: sender.avatarUrl,
              roomId: data.roomId,
              roomCode: data.roomCode,
              roomTitle: data.roomTitle,
              mediaTitle: data.mediaTitle,
              posterPath: data.posterPath,
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
            }
          }
          this.users.delete(socket.id);
        }
      });
    });
  }

  private handleLeaveRoom(socket: Socket, roomId: string) {
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
      }

      logger.info('ROOM_LEAVE', `User ${member?.username || socket.id} left room ${roomId}. Remaining: ${members.size}`);

      if (members.size === 0) {
        this.roomMembers.delete(roomId);
        this.lastSeekTimeByRoom.delete(roomId);
        // Clean up FFmpeg session for empty room with 4s grace period (handles React remount / page reload)
        setTimeout(() => {
          const currentMembers = this.roomMembers.get(roomId);
          if (!currentMembers || currentMembers.size === 0) {
            ffmpegService.killSessionsForRoom(roomId);
          }
        }, 4000);
      } else {
        this.emitRoomMembers(roomId);
        if (member?.userId && !hasOtherConnections) {
          ffmpegService.killUserSessionInRoom(roomId, member.userId);
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
