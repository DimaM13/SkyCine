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
      socket.on('room:join', (data: { roomId: string; userId: string; username: string; avatarUrl?: string }) => {
        const { roomId, userId, username, avatarUrl } = data;
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
          joinedAt: new Date().toISOString(),
        };

        roomMap.set(socket.id, member);

        const user = this.users.get(socket.id);
        if (user) {
          user.currentRoomId = roomId;
        }

        logger.info('ROOM_JOIN', `User ${username} joined room ${roomId}. Total members: ${roomMap.size}`);

        // Fetch room state
        const room = db.prepare(`
          SELECT r.*, m.title as mediaTitle, m.durationSeconds, m.posterPath, m.backdropPath
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
      }) => {
        const { roomId, action, position, playbackRate = 1.0, shouldPlay } = data;
        if (!roomId) return;

        const now = Date.now();
        const user = this.users.get(socket.id);
        const initiatedBy = user?.username || 'Участник';

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
            initiatedByUserId: user?.userId || '',
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
            initiatedByUserId: user?.userId || '',
          });
        } else if (action === 'SEEK') {
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
            initiatedByUserId: user?.userId || '',
          });
        }
      });

      // 5. Periodic Time Anchor from Host (every 3 seconds while playing)
      socket.on('room:host_heartbeat', (data: { roomId: string; position: number }) => {
        if (!data?.roomId) return;
        const now = Date.now();

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

      // 7. Member Status & Position Reporting
      socket.on('room:member_status', (data: { roomId: string; currentPosition: number; bufferedPosition?: number }) => {
        if (!data?.roomId) return;
        const members = this.roomMembers.get(data.roomId);
        if (members && members.has(socket.id)) {
          const m = members.get(socket.id)!;
          m.currentPosition = data.currentPosition || 0;
          if (data.bufferedPosition !== undefined) m.bufferedPosition = data.bufferedPosition;
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
        // Clean up FFmpeg session for empty room with 4s grace period (handles React remount / page reload)
        setTimeout(() => {
          const currentMembers = this.roomMembers.get(roomId);
          if (!currentMembers || currentMembers.size === 0) {
            ffmpegService.killSessionsForRoom(roomId);
          }
        }, 4000);
      } else {
        this.emitRoomMembers(roomId);
      }
    }
  }

  private emitRoomMembers(roomId: string) {
    if (!this.io) return;
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
