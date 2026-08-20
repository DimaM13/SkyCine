import { Server, Socket } from 'socket.io';
import { db } from '../config/db';
import { Room, RoomMember, RoomState } from '../types';
import { logger } from './logger.service';
import { extractYouTubeId, fetchYouTubeInfo } from '../controllers/rooms.controller';

interface ConnectedUser {
  userId: string;
  username: string;
  avatarUrl?: string;
  socketId: string;
  currentRoomId?: string;
  status: string; // e.g., 'online', 'watching', 'idle'
  activity?: string; // e.g., 'Watching Inception'
}

class SocketService {
  private io: Server | null = null;
  private users: Map<string, ConnectedUser> = new Map(); // socketId -> user
  private userSockets: Map<string, Set<string>> = new Map(); // userId -> Set of socketIds
  private roomMembers: Map<string, Map<string, RoomMember>> = new Map(); // roomId -> (socketId -> RoomMember)
  private pendingBarriers: Map<string, { targetPosition: number; action: string; playbackRate: number; timer?: NodeJS.Timeout }> = new Map();

  private startBarrierPlayback(roomId: string, targetPosition: number, playbackRate: number, initiatedBy: string, initiatedByUserId: string) {
    if (this.pendingBarriers.has(roomId)) {
      const b = this.pendingBarriers.get(roomId)!;
      if (b.timer) clearTimeout(b.timer);
      this.pendingBarriers.delete(roomId);
    }

    const now = Date.now();
    const scheduledPlayAt = now + 350; // 350ms synchronized lockstep

    try {
      db.prepare(`
        UPDATE rooms SET
          state = 'PLAYING',
          currentPosition = ?,
          serverTimestamp = ?,
          playbackRate = ?
        WHERE id = ?
      `).run(targetPosition, scheduledPlayAt, playbackRate, roomId);
    } catch (e) {}

    logger.info('BARRIER_RESOLVED', `Room ${roomId} all members ready. Starting playback from ${targetPosition.toFixed(1)}s (lockstep in 350ms)`);

    this.io?.to(roomId).emit('room:buffer_barrier', { isBuffering: false });
    this.io?.to(roomId).emit('room:sync_state', {
      state: 'PLAYING',
      currentPosition: targetPosition,
      serverTimestamp: scheduledPlayAt,
      playbackRate,
      action: 'PLAY',
      initiatedBy,
      initiatedByUserId,
    });
  }

  public init(io: Server) {
    this.io = io;

    io.on('connection', (socket: Socket) => {
      // 1. Time Synchronization (NTP Protocol)
      socket.on('sync:ping', (data: { clientTimestamp: number }) => {
        socket.emit('sync:pong', {
          clientTimestamp: data.clientTimestamp,
          serverTimestamp: Date.now(),
        });
      });

      // 2. User Presence
      socket.on('user:connect', (userData: { userId: string; username: string; avatarUrl?: string }) => {
        const user: ConnectedUser = {
          userId: userData.userId,
          username: userData.username,
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

      // 3. Room Management & Watch Together
      socket.on('room:join', (data: { roomId: string; userId: string; username: string; avatarUrl?: string }) => {
        const { roomId, userId, username, avatarUrl } = data;
        socket.join(roomId);

        if (!this.roomMembers.has(roomId)) {
          this.roomMembers.set(roomId, new Map());
        }

        const roomMap = this.roomMembers.get(roomId)!;
        
        // Track whether this exact socket was already in room
        const isReconnectingSameSocket = roomMap.has(socket.id);

        const member: RoomMember = {
          userId,
          username,
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

        logger.info('ROOM_JOIN', `User ${username} (socket: ${socket.id}, userId: ${userId}) joined room ${roomId}. Total members in room: ${roomMap.size}`);

        // Fetch room state from DB
        const room = db.prepare(`
          SELECT r.*, m.title as mediaTitle, m.durationSeconds, m.posterPath, m.backdropPath
          FROM rooms r
          LEFT JOIN media_items m ON r.mediaItemId = m.id
          WHERE r.id = ?
        `).get(roomId) as any;

        if (room) {
          // If host is connected and watching, use host's live position
          const hostMember = Array.from(roomMap.values()).find(m => m.userId === room.hostUserId && m.socketId !== socket.id);
          if (hostMember && hostMember.currentPosition > 0) {
            room.currentPosition = hostMember.currentPosition;
            room.serverTimestamp = Date.now();
          } else if (room.state === 'PLAYING' && room.serverTimestamp) {
            const elapsed = Math.max(0, (Date.now() - room.serverTimestamp) / 1000 * (room.playbackRate || 1.0));
            room.currentPosition = room.currentPosition + elapsed;
            room.serverTimestamp = Date.now();
          }
        }

        // Broadcast updated room members
        this.emitRoomMembers(roomId);

        // Send full room state to the newly joined client
        socket.emit('room:initial_state', {
          room,
          members: Array.from(roomMap.values()),
          serverTimestamp: Date.now(),
        });

        // Notify room ONLY IF first time joining (not reconnect)
        if (!isReconnectingSameSocket) {
          io.to(roomId).emit('room:system_message', {
            text: `Пользователь ${username} присоединился к просмотру`,
            type: 'join',
            timestamp: Date.now(),
          });
        }
      });

      socket.on('room:leave', (data: { roomId: string }) => {
        this.handleLeaveRoom(socket, data.roomId);
      });

      // 4. Room Actions (Play, Pause, Seek, Rate)
      socket.on('room:action', (data: {
        roomId: string;
        action: 'PLAY' | 'PAUSE' | 'SEEK' | 'RATE';
        position: number;
        playbackRate?: number;
        isPlaying?: boolean;
      }) => {
        const { roomId, action, position, playbackRate = 1.0 } = data;
        const now = Date.now();
        const roomMap = this.roomMembers.get(roomId);
        const memberCount = roomMap ? roomMap.size : 1;

        const currentRoom = db.prepare('SELECT state FROM rooms WHERE id = ?').get(roomId) as any;
        const wasPlaying = currentRoom?.state === 'PLAYING';
        const user = this.users.get(socket.id);

        // Cancel previous pending barrier if any
        if (this.pendingBarriers.has(roomId)) {
          const existing = this.pendingBarriers.get(roomId)!;
          if (existing.timer) clearTimeout(existing.timer);
          this.pendingBarriers.delete(roomId);
        }

        if (action === 'PAUSE') {
          // Immediate Pause
          db.prepare(`
            UPDATE rooms SET
              state = 'PAUSED',
              currentPosition = ?,
              serverTimestamp = ?,
              playbackRate = ?
            WHERE id = ?
          `).run(position, now, playbackRate, roomId);

          io.to(roomId).emit('room:buffer_barrier', { isBuffering: false });
          io.to(roomId).emit('room:sync_state', {
            state: 'PAUSED',
            currentPosition: position,
            serverTimestamp: now,
            playbackRate,
            action: 'PAUSE',
            initiatedBy: user?.username || 'Host',
            initiatedByUserId: user?.userId || '',
          });
          return;
        }

        const shouldPlay = action === 'PLAY' || (action === 'SEEK' && (data.isPlaying !== undefined ? !!data.isPlaying : wasPlaying));

        if (memberCount > 1 && shouldPlay) {
          // Multi-user room: engage Buffer Barrier lockstep!
          if (roomMap) {
            for (const member of roomMap.values()) {
              member.isReady = false;
              member.currentPosition = position;
            }
            io.to(roomId).emit('room:members_status', Array.from(roomMap.values()));
          }

          // Seek and pause all players first so they buffer from target position
          io.to(roomId).emit('room:sync_state', {
            state: 'PAUSED',
            currentPosition: position,
            serverTimestamp: now,
            playbackRate,
            action: 'SEEK',
            initiatedBy: user?.username || 'Host',
            initiatedByUserId: user?.userId || '',
          });

          io.to(roomId).emit('room:buffer_barrier', {
            isBuffering: true,
            targetPosition: position,
            initiatedBy: user?.username || 'Host',
          });

          // Fallback timer (6 seconds maximum)
          const fallbackTimer = setTimeout(() => {
            this.startBarrierPlayback(roomId, position, playbackRate, user?.username || 'Host', user?.userId || '');
          }, 6000);

          this.pendingBarriers.set(roomId, {
            targetPosition: position,
            action,
            playbackRate,
            timer: fallbackTimer,
          });
        } else {
          // Single user OR seek while paused
          const newState: RoomState = shouldPlay ? 'PLAYING' : 'PAUSED';
          const scheduledPlayAt = shouldPlay ? now + 50 : now;

          db.prepare(`
            UPDATE rooms SET
              state = ?,
              currentPosition = ?,
              serverTimestamp = ?,
              playbackRate = ?
            WHERE id = ?
          `).run(newState, position, scheduledPlayAt, playbackRate, roomId);

          io.to(roomId).emit('room:buffer_barrier', { isBuffering: false });
          io.to(roomId).emit('room:sync_state', {
            state: newState,
            currentPosition: position,
            serverTimestamp: scheduledPlayAt,
            playbackRate,
            action,
            initiatedBy: user?.username || 'Host',
            initiatedByUserId: user?.userId || '',
          });
        }
      });

      // Host Continuous Time Anchor (every 2.5s while playing)
      socket.on('room:host_heartbeat', (data: { roomId: string; position: number }) => {
        const { roomId, position } = data;
        const now = Date.now();

        // Update DB without noisy logs
        try {
          db.prepare('UPDATE rooms SET currentPosition = ?, serverTimestamp = ? WHERE id = ?').run(position, now, roomId);
        } catch (e) {}

        // Broadcast accurate host time anchor to other participants
        socket.to(roomId).emit('room:time_anchor', {
          currentPosition: position,
          serverTimestamp: now,
        });
      });

      // Query Host Direct Sync
      socket.on('room:request_host_sync', (data: { roomId: string }) => {
        const { roomId } = data;
        const roomMap = this.roomMembers.get(roomId);
        if (!roomMap) return;
        const room = db.prepare('SELECT hostUserId FROM rooms WHERE id = ?').get(roomId) as any;
        if (!room) return;
        const hostMember = Array.from(roomMap.values()).find(m => m.userId === room.hostUserId && m.socketId !== socket.id);
        if (hostMember) {
          io.to(hostMember.socketId).emit('room:query_host_time', { requesterSocketId: socket.id });
        }
      });

      socket.on('room:host_time_reply', (data: { roomId: string; position: number; requesterSocketId: string }) => {
        if (data?.requesterSocketId && data.position >= 0) {
          io.to(data.requesterSocketId).emit('room:host_time_reply', { position: data.position });
        }
      });

      // Host Force Sync All Participants
      socket.on('room:force_sync_all', (data: { roomId: string; position: number }) => {
        const { roomId, position } = data;
        const now = Date.now();
        const user = this.users.get(socket.id);

        const room = db.prepare('SELECT state FROM rooms WHERE id = ?').get(roomId) as any;
        const isPlaying = room?.state === 'PLAYING';

        // 1.5s synchronized buffer barrier so iPad / HLS mobile clients have time to prepare stream without PC running ahead
        const scheduledPlayAt = now + (isPlaying ? 1500 : 0);

        try {
          db.prepare('UPDATE rooms SET currentPosition = ?, serverTimestamp = ? WHERE id = ?').run(position, scheduledPlayAt, roomId);
        } catch (e) {}

        logger.info('ROOM_FORCE_SYNC', `Host ${user?.username || 'Host'} forced sync in room ${roomId} to ${position.toFixed(1)}s`);

        io.to(roomId).emit('room:force_sync_all', {
          position,
          serverTimestamp: scheduledPlayAt,
          isPlaying,
          initiatedBy: user?.username || 'Хост',
          initiatedByUserId: user?.userId || '',
        });

        io.to(roomId).emit('room:system_message', {
          text: `👑 Хост ${user?.username || ''} синхронизировал воспроизведение для всех`,
          type: 'sync',
          timestamp: now,
        });
      });

      // Host Change YouTube Video Live
      socket.on('room:change_youtube', async (data: { roomId: string; youtubeUrl: string; title?: string }) => {
        const { roomId, youtubeUrl, title } = data;
        const user = this.users.get(socket.id);
        if (!user) return;

        const room = db.prepare('SELECT hostUserId FROM rooms WHERE id = ?').get(roomId) as any;
        if (!room) return;

        if (room.hostUserId !== user.userId) {
          socket.emit('room:error', { message: 'Только хост может переключать видео' });
          return;
        }

        const ytId = extractYouTubeId(youtubeUrl);
        if (!ytId) {
          socket.emit('room:error', { message: 'Некорректная ссылка на YouTube' });
          return;
        }

        const ytInfo = await fetchYouTubeInfo(ytId);
        const finalTitle = title?.trim() || ytInfo.title;
        const fullUrl = `https://www.youtube.com/watch?v=${ytId}`;
        const now = Date.now();

        try {
          db.prepare(`
            UPDATE rooms SET
              sourceType = 'YOUTUBE',
              youtubeId = ?,
              youtubeUrl = ?,
              youtubeTitle = ?,
              youtubeThumbnail = ?,
              title = ?,
              currentPosition = 0,
              state = 'PAUSED',
              serverTimestamp = ?
            WHERE id = ?
          `).run(ytId, fullUrl, ytInfo.title, ytInfo.thumbnail, `YouTube: ${finalTitle}`, now, roomId);

          logger.info('ROOM_CHANGE_YT', `Room ${roomId} YouTube changed to ${ytId} (${finalTitle}) by ${user.username}`);

          io.to(roomId).emit('room:youtube_changed', {
            sourceType: 'YOUTUBE',
            youtubeId: ytId,
            youtubeUrl: fullUrl,
            youtubeTitle: ytInfo.title,
            youtubeThumbnail: ytInfo.thumbnail,
            title: `YouTube: ${finalTitle}`,
            state: 'PAUSED',
            currentPosition: 0,
            serverTimestamp: now,
          });

          io.to(roomId).emit('room:system_message', {
            text: `🎬 Хост ${user.username} переключил видео на «${finalTitle}»`,
            type: 'video_change',
            timestamp: now,
          });
        } catch (err) {
          logger.error('ROOM_CHANGE_YT', `Error changing YouTube video: ${err}`);
        }
      });

      // Member Buffer Status
      socket.on('room:buffer_status', (data: {
        roomId: string;
        isReady: boolean;
        bufferedPosition: number;
        currentPosition: number;
        pingMs?: number;
        bufferPercent?: number;
      }) => {
        const { roomId, isReady, bufferedPosition, currentPosition, pingMs = 0, bufferPercent } = data;
        const members = this.roomMembers.get(roomId);
        if (members && members.has(socket.id)) {
          const m = members.get(socket.id)!;
          m.isReady = isReady;
          m.bufferedPosition = bufferedPosition;
          m.currentPosition = currentPosition;
          m.pingMs = pingMs;
          if (bufferPercent !== undefined) m.bufferPercent = bufferPercent;

          // Notify room about member states (for UI sync indicators)
          io.to(roomId).emit('room:members_status', Array.from(members.values()));

          // Check if active barrier is ready to trigger synchronized play
          if (this.pendingBarriers.has(roomId)) {
            const barrier = this.pendingBarriers.get(roomId)!;
            const allMembersReady = Array.from(members.values()).every((member) => member.isReady);
            if (allMembersReady) {
              const user = this.users.get(socket.id);
              this.startBarrierPlayback(roomId, barrier.targetPosition, barrier.playbackRate, user?.username || 'Участники', user?.userId || '');
            }
          }
        }
      });

      // Host Force Barrier Play (Manual Override)
      socket.on('room:force_barrier_play', (data: { roomId: string }) => {
        const { roomId } = data;
        const user = this.users.get(socket.id);
        if (this.pendingBarriers.has(roomId)) {
          const barrier = this.pendingBarriers.get(roomId)!;
          this.startBarrierPlayback(roomId, barrier.targetPosition, barrier.playbackRate, user?.username || 'Host', user?.userId || '');
        }
      });

      // Chat Messages
      socket.on('room:chat_message', (data: { roomId: string; text: string; userId?: string; username?: string; avatarUrl?: string }) => {
        if (!data?.roomId || !data?.text?.trim()) return;

        const user = this.users.get(socket.id);
        const roomMember = this.roomMembers.get(data.roomId)?.get(socket.id);

        const senderUserId = user?.userId || roomMember?.userId || data.userId || 'guest';
        const senderUsername = user?.username || roomMember?.username || data.username || 'Пользователь';
        const senderAvatar = user?.avatarUrl || roomMember?.avatarUrl || data.avatarUrl;

        // Ensure socket is joined to room
        socket.join(data.roomId);

        io.to(data.roomId).emit('room:chat_message', {
          id: `${Date.now()}-${Math.random()}`,
          userId: senderUserId,
          username: senderUsername,
          avatarUrl: senderAvatar,
          text: data.text.trim(),
          timestamp: Date.now(),
        });
      });

      // Flying Emoji Reactions
      socket.on('room:reaction', (data: { roomId: string; emoji: string; username?: string }) => {
        if (!data?.roomId || !data?.emoji) return;

        const user = this.users.get(socket.id);
        const roomMember = this.roomMembers.get(data.roomId)?.get(socket.id);
        const senderUsername = user?.username || roomMember?.username || data.username || 'Участник';

        socket.join(data.roomId);

        io.to(data.roomId).emit('room:reaction', {
          id: `${Date.now()}-${Math.random()}`,
          emoji: data.emoji,
          username: senderUsername,
          timestamp: Date.now(),
        });
      });

      // 4. Friend Invitations
      socket.on('friend:invite_to_room', (data: {
        targetUserId: string;
        roomId: string;
        roomCode: string;
        roomTitle: string;
        mediaTitle: string;
        posterPath?: string;
      }) => {
        const sender = this.users.get(socket.id);
        if (!sender) return;

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

      // On-Demand Sync Request (When a viewer clicks "Выровнять" or connects)
      socket.on('room:request_host_sync', (data: { roomId: string }) => {
        const { roomId } = data;
        const roomMap = this.roomMembers.get(roomId);
        if (!roomMap) return;

        const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as any;
        if (!room) return;

        const hostMember = Array.from(roomMap.values()).find(m => m.userId === room.hostUserId);
        if (hostMember && hostMember.socketId !== socket.id) {
          // Ask host's player directly for exact real-time playback position
          io.to(hostMember.socketId).emit('room:query_host_time', { requesterSocketId: socket.id });
        } else {
          // Fallback to room DB state with elapsed calculation
          const elapsed = room.state === 'PLAYING' ? Math.max(0, (Date.now() - room.serverTimestamp) / 1000 * (room.playbackRate || 1.0)) : 0;
          socket.emit('room:time_anchor', {
            currentPosition: room.currentPosition + elapsed,
            serverTimestamp: Date.now(),
            state: room.state,
          });
        }
      });

      // Host replies with exact current time
      socket.on('room:host_time_reply', (data: { roomId: string; position: number; requesterSocketId?: string }) => {
        const now = Date.now();
        try {
          db.prepare('UPDATE rooms SET currentPosition = ?, serverTimestamp = ? WHERE id = ?').run(data.position, now, data.roomId);
        } catch (e) {}

        if (data.requesterSocketId) {
          io.to(data.requesterSocketId).emit('room:time_anchor', {
            currentPosition: data.position,
            serverTimestamp: now,
          });
        } else {
          socket.to(data.roomId).emit('room:time_anchor', {
            currentPosition: data.position,
            serverTimestamp: now,
          });
        }
      });

      // Disconnect handling
      socket.on('disconnect', () => {
        // 1. Unconditionally clean up from ALL room members maps
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

      logger.info('ROOM_LEAVE', `Socket ${socket.id} (user: ${member?.username}) left room ${roomId}. Remaining members in room: ${members.size}`);

      if (members.size === 0) {
        this.roomMembers.delete(roomId);
      } else {
        this.emitRoomMembers(roomId);
      }
    }

    const user = this.users.get(socket.id);
    if (user) {
      user.currentRoomId = undefined;
    }
  }

  private emitRoomMembers(roomId: string) {
    if (!this.io) return;
    const members = this.roomMembers.get(roomId);
    if (members) {
      this.io.to(roomId).emit('room:members', Array.from(members.values()));
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
