import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { Room, RoomMember, RoomChatMessage, RoomReaction, RoomState } from '../types';

interface UseSyncPlayerProps {
  room: Room | null;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onTimeUpdate?: (currentTime: number) => void;
  onSeekTo?: (pos: number, shouldPlay?: boolean) => void;
  onPlay?: () => void;
  onPause?: () => void;
  getCurrentTime?: () => number;
  getIsPaused?: () => boolean;
}

export function useSyncPlayer({
  room,
  videoRef,
  onTimeUpdate,
  onSeekTo,
  onPlay,
  onPause,
  getCurrentTime,
  getIsPaused,
}: UseSyncPlayerProps) {
  const { socket, isConnected, getSyncedServerTime } = useSocket();
  const { user } = useAuth();

  const [roomState, setRoomState] = useState<RoomState>(room?.state || 'PAUSED');
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [messages, setMessages] = useState<RoomChatMessage[]>([]);
  const [reactions, setReactions] = useState<RoomReaction[]>([]);
  const [syncDiffMs, setSyncDiffMs] = useState<number>(0);
  const [syncQuality, setSyncQuality] = useState<'perfect' | 'good' | 'adjusting' | 'seeking'>('perfect');
  const [isHost, setIsHost] = useState(false);
  const [isBufferingBarrier, setIsBufferingBarrier] = useState<boolean>(false);
  const [barrierTargetPosition, setBarrierTargetPosition] = useState<number>(0);

  // References for live tracking without re-triggering effects
  const currentPosRef = useRef<number>(room?.currentPosition || 0);
  const serverTimestampRef = useRef<number>(room?.serverTimestamp || Date.now());
  const playbackRateRef = useRef<number>(room?.playbackRate || 1.0);
  const roomStateRef = useRef<RoomState>(room?.state || 'PAUSED');
  const isInternalAction = useRef<boolean>(false);
  const scheduledPlayTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (room && user) {
      setIsHost(room.hostUserId === user.id);
    }
  }, [room, user]);

  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const onSeekToRef = useRef(onSeekTo);
  useEffect(() => {
    onSeekToRef.current = onSeekTo;
  }, [onSeekTo]);

  const onPlayRef = useRef(onPlay);
  useEffect(() => {
    onPlayRef.current = onPlay;
  }, [onPlay]);

  const onPauseRef = useRef(onPause);
  useEffect(() => {
    onPauseRef.current = onPause;
  }, [onPause]);

  const getCurrentTimeRef = useRef(getCurrentTime);
  useEffect(() => {
    getCurrentTimeRef.current = getCurrentTime;
  }, [getCurrentTime]);

  const getIsPausedRef = useRef(getIsPaused);
  useEffect(() => {
    getIsPausedRef.current = getIsPaused;
  }, [getIsPaused]);

  const syncToHostRef = useRef<(() => void) | null>(null);

  const getRealPos = useCallback(() => {
    if (getCurrentTimeRef.current) return getCurrentTimeRef.current();
    return videoRef?.current?.currentTime || 0;
  }, [videoRef]);

  const getRealPaused = useCallback(() => {
    if (getIsPausedRef.current) return getIsPausedRef.current();
    if (videoRef?.current) return videoRef.current.paused;
    return roomStateRef.current !== 'PLAYING';
  }, [videoRef]);

  const executePlay = useCallback(() => {
    if (onPlayRef.current) {
      onPlayRef.current();
    } else if (videoRef?.current) {
      videoRef.current.playbackRate = playbackRateRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [videoRef]);

  const executePause = useCallback(() => {
    if (onPauseRef.current) {
      onPauseRef.current();
    } else if (videoRef?.current) {
      videoRef.current.pause();
    }
  }, [videoRef]);

  const executeSeek = useCallback((pos: number, shouldPlay?: boolean) => {
    if (onSeekToRef.current) {
      onSeekToRef.current(pos, shouldPlay);
    } else if (videoRef?.current) {
      videoRef.current.currentTime = pos;
      if (shouldPlay) {
        videoRef.current.play().catch(() => {});
      }
    }
  }, [videoRef]);

  const hasInitializedRef = useRef(false);

  // Handle Socket Events for Room
  useEffect(() => {
    if (!socket || !room?.id) return;

    const joinRoom = () => {
      const currentUser = userRef.current;
      socket.emit('room:join', {
        roomId: room.id,
        userId: currentUser?.id || 'guest',
        username: currentUser?.username || 'Гость',
        avatarUrl: currentUser?.avatarUrl,
      });
    };

    if (socket.connected) {
      joinRoom();
    }
    socket.on('connect', joinRoom);

    socket.on('room:initial_state', (data: { room: Room; members: RoomMember[]; serverTimestamp: number }) => {
      setMembers(data.members || []);
      if (data.room) {
        const now = getSyncedServerTime();
        const elapsed = Math.max(0, (now - data.room.serverTimestamp) / 1000);
        const livePos = data.room.state === 'PLAYING'
          ? Math.max(0, data.room.currentPosition + elapsed * (data.room.playbackRate || 1.0))
          : data.room.currentPosition;

        roomStateRef.current = data.room.state;
        serverTimestampRef.current = now;
        playbackRateRef.current = data.room.playbackRate || 1.0;
        setRoomState(data.room.state);

        if (!hasInitializedRef.current) {
          hasInitializedRef.current = true;
          currentPosRef.current = livePos;

          // Align player on initial join
          isInternalAction.current = true;
          const shouldPlay = data.room.state === 'PLAYING';
          executeSeek(livePos, shouldPlay);
          if (shouldPlay) {
            executePlay();
          } else {
            executePause();
          }
          setTimeout(() => { isInternalAction.current = false; }, 200);

          // Ask host directly for accurate live playback time
          if (userRef.current?.id !== data.room.hostUserId) {
            socket.emit('room:request_host_sync', { roomId: data.room.id });
          }
        }
      }
    });

    socket.on('room:query_host_time', (queryData: { requesterSocketId: string }) => {
      const cur = getRealPos();
      socket.emit('room:host_time_reply', {
        roomId: room.id,
        position: cur,
        requesterSocketId: queryData.requesterSocketId,
      });
    });

    socket.on('room:host_time_reply', (data: { position: number }) => {
      if (data?.position > 0) {
        currentPosRef.current = data.position;
        serverTimestampRef.current = getSyncedServerTime();
        const shouldPlay = roomStateRef.current === 'PLAYING';
        isInternalAction.current = true;
        executeSeek(data.position, shouldPlay);
        if (shouldPlay && getRealPaused()) {
          executePlay();
        }
        setTimeout(() => { isInternalAction.current = false; }, 150);
        smoothedDiffRef.current = 0;
        setSyncDiffMs(0);
        setSyncQuality('perfect');
      }
    });

    socket.on('room:members', (updatedMembers: RoomMember[]) => {
      setMembers(updatedMembers);
    });

    socket.on('room:members_status', (updatedMembers: RoomMember[]) => {
      setMembers(updatedMembers);
    });

    socket.on('room:buffer_barrier', (data: { isBuffering: boolean; targetPosition?: number }) => {
      setIsBufferingBarrier(!!data.isBuffering);
      if (data.targetPosition !== undefined) {
        setBarrierTargetPosition(data.targetPosition);
      }
    });

    socket.on('room:sync_state', (data: {
      state: RoomState;
      currentPosition: number;
      serverTimestamp: number;
      playbackRate: number;
      action: string;
      initiatedBy: string;
      initiatedByUserId?: string;
    }) => {
      roomStateRef.current = data.state;
      currentPosRef.current = data.currentPosition;
      serverTimestampRef.current = data.serverTimestamp;
      playbackRateRef.current = data.playbackRate;
      setRoomState(data.state);

      if (scheduledPlayTimer.current) {
        clearTimeout(scheduledPlayTimer.current);
        scheduledPlayTimer.current = null;
      }

      isInternalAction.current = true;

      if (data.action === 'SEEK') {
        executeSeek(data.currentPosition, false);
        executePause();
      } else if (data.action === 'PAUSE') {
        executePause();
        const cur = getRealPos();
        if (Math.abs(cur - data.currentPosition) > 1.0) {
          executeSeek(data.currentPosition, false);
        }
      } else if (data.action === 'PLAY') {
        const cur = getRealPos();
        const now = getSyncedServerTime();
        const delay = Math.max(0, data.serverTimestamp - now);

        if (Math.abs(cur - data.currentPosition) > 1.5) {
          executeSeek(data.currentPosition, false);
        }

        if (delay > 0) {
          scheduledPlayTimer.current = setTimeout(() => {
            isInternalAction.current = true;
            executePlay();
            setTimeout(() => { isInternalAction.current = false; }, 150);
          }, delay);
        } else {
          executePlay();
        }
      }
      setTimeout(() => { isInternalAction.current = false; }, 200);
    });

    socket.on('room:time_anchor', (data: { currentPosition: number; serverTimestamp: number }) => {
      currentPosRef.current = data.currentPosition;
      serverTimestampRef.current = data.serverTimestamp;
    });

    socket.on('room:force_sync_all', (data: { position: number; serverTimestamp: number; isPlaying?: boolean; initiatedBy: string; initiatedByUserId?: string }) => {
      currentPosRef.current = data.position;
      serverTimestampRef.current = data.serverTimestamp;
      
      isInternalAction.current = true;
      executeSeek(data.position, false);
      executePause();

      if (scheduledPlayTimer.current) {
        clearTimeout(scheduledPlayTimer.current);
        scheduledPlayTimer.current = null;
      }

      if (data.isPlaying) {
        const now = getSyncedServerTime();
        const delay = Math.max(0, data.serverTimestamp - now);

        if (delay > 0) {
          scheduledPlayTimer.current = setTimeout(() => {
            isInternalAction.current = true;
            executePlay();
            setTimeout(() => { isInternalAction.current = false; }, 150);
          }, delay);
        } else {
          executePlay();
        }
      }

      setTimeout(() => { isInternalAction.current = false; }, 200);
      smoothedDiffRef.current = 0;
      setSyncDiffMs(0);
      setSyncQuality('perfect');
    });

    socket.on('room:chat_message', (msg: RoomChatMessage) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on('room:reaction', (reaction: RoomReaction) => {
      setReactions((prev) => [...prev, reaction]);
      setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== reaction.id));
      }, 3000);
    });

    socket.on('room:system_message', (sysMsg: { text: string; type: string }) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-${Date.now()}-${Math.random()}`,
          userId: 'system',
          username: 'Система',
          text: sysMsg.text,
          timestamp: Date.now(),
        },
      ]);
    });

    return () => {
      if (scheduledPlayTimer.current) clearTimeout(scheduledPlayTimer.current);
      socket.emit('room:leave', { roomId: room.id });
      socket.off('connect', joinRoom);
      socket.off('room:initial_state');
      socket.off('room:host_time_reply');
      socket.off('room:members');
      socket.off('room:members_status');
      socket.off('room:buffer_barrier');
      socket.off('room:sync_state');
      socket.off('room:time_anchor');
      socket.off('room:force_sync_all');
      socket.off('room:chat_message');
      socket.off('room:reaction');
      socket.off('room:system_message');
    };
  }, [socket, room?.id, user?.id, executePlay, executePause, executeSeek, getRealPaused, getRealPos, getSyncedServerTime]);

  // Host Continuous Heartbeat Anchor (broadcast real position every 2.5 seconds while playing)
  useEffect(() => {
    if (!isHost || !socket || !room?.id || roomState !== 'PLAYING' || isBufferingBarrier) return;

    const interval = setInterval(() => {
      if (!getRealPaused()) {
        const cur = getRealPos();
        socket.emit('room:host_heartbeat', {
          roomId: room.id,
          position: cur,
        });
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [isHost, socket, room?.id, roomState, isBufferingBarrier, getRealPaused, getRealPos]);

  const smoothedDiffRef = useRef<number>(0);

  // Pure Tracking / Drift calculation (Clean informational indicator, NO disruptive auto-seek loops)
  useEffect(() => {
    const interval = setInterval(() => {
      if (roomStateRef.current !== 'PLAYING' || isBufferingBarrier) {
        setSyncQuality('perfect');
        setSyncDiffMs(0);
        return;
      }

      const now = getSyncedServerTime();
      const targetTime = currentPosRef.current + Math.max(0, (now - serverTimestampRef.current) / 1000) * playbackRateRef.current;
      const actualTime = getRealPos();
      const rawDiffMs = Math.round((actualTime - targetTime) * 1000);

      // Exponential moving average filter to prevent jitter
      smoothedDiffRef.current = Math.round(smoothedDiffRef.current * 0.7 + rawDiffMs * 0.3);
      setSyncDiffMs(smoothedDiffRef.current);

      const absDiffMs = Math.abs(smoothedDiffRef.current);

      if (absDiffMs < 500) {
        setSyncQuality('perfect');
      } else if (absDiffMs < 1200) {
        setSyncQuality('good');
      } else {
        setSyncQuality('adjusting');
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [getSyncedServerTime, getRealPos, isBufferingBarrier]);

  // Synchronize To Host Query Button (Manual User Action)
  const syncToHost = useCallback(() => {
    if (!socket || !room?.id) return;

    // Send query to host for real-time live position
    socket.emit('room:request_host_sync', { roomId: room.id });

    // Check host reported position from active members list
    const hostMember = members.find((m) => m.userId === room.hostUserId);
    let targetPos = hostMember && hostMember.currentPosition > 0 ? hostMember.currentPosition : 0;

    if (targetPos <= 0 && currentPosRef.current > 0) {
      const now = getSyncedServerTime();
      const elapsed = Math.max(0, (now - serverTimestampRef.current) / 1000);
      targetPos = roomStateRef.current === 'PLAYING'
        ? Math.max(0, currentPosRef.current + elapsed * playbackRateRef.current)
        : currentPosRef.current;
    }

    if (targetPos > 0) {
      isInternalAction.current = true;
      executeSeek(targetPos, roomStateRef.current === 'PLAYING');
      if (roomStateRef.current === 'PLAYING' && getRealPaused()) {
        executePlay();
      }
      setTimeout(() => { isInternalAction.current = false; }, 200);
    }

    smoothedDiffRef.current = 0;
    setSyncDiffMs(0);
    setSyncQuality('perfect');
  }, [socket, room?.id, room?.hostUserId, members, getSyncedServerTime, executeSeek, getRealPaused, executePlay]);

  useEffect(() => {
    syncToHostRef.current = syncToHost;
  }, [syncToHost]);

  // Send local buffer status to room
  const reportBufferStatus = useCallback((isReady: boolean, bufferedSec?: number, currentSec?: number, bufferPercent?: number) => {
    if (!socket || !room?.id) return;
    const cur = currentSec !== undefined ? currentSec : getRealPos();
    const buf = bufferedSec !== undefined
      ? bufferedSec
      : (videoRef?.current?.buffered?.length ? videoRef.current.buffered.end(videoRef.current.buffered.length - 1) : cur + 5);

    socket.emit('room:buffer_status', {
      roomId: room.id,
      isReady,
      bufferedPosition: buf,
      currentPosition: cur,
      bufferPercent: bufferPercent !== undefined ? Math.round(bufferPercent) : (isReady ? 100 : 0),
    });
  }, [socket, room?.id, videoRef, getRealPos]);

  // Force barrier play (Manual Host Override)
  const forceBarrierPlay = useCallback(() => {
    if (!socket || !room?.id) return;
    socket.emit('room:force_barrier_play', { roomId: room.id });
    setIsBufferingBarrier(false);
  }, [socket, room?.id]);

  // Check if all participants are ready
  const allMembersReady = members.length <= 1 || members.every((m) => m.isReady);

  // Client Action Triggers
  const sendPlay = useCallback(() => {
    if (!socket || !room?.id) return;
    if (isInternalAction.current) return;
    const allReady = members.length <= 1 || members.every((m) => m.isReady);
    if (!allReady) {
      return; // Block play request until everyone is ready
    }
    const cur = getRealPos();
    socket.emit('room:action', {
      roomId: room.id,
      action: 'PLAY',
      position: cur,
      playbackRate: playbackRateRef.current,
    });
  }, [socket, room?.id, members, getRealPos]);

  const sendPause = useCallback(() => {
    if (!socket || !room?.id) return;
    if (isInternalAction.current) return;
    executePause();
    const cur = getRealPos();
    socket.emit('room:action', {
      roomId: room.id,
      action: 'PAUSE',
      position: cur,
    });
  }, [socket, room?.id, executePause, getRealPos]);

  const sendSeek = useCallback((pos: number) => {
    if (!socket || !room?.id) return;
    if (isInternalAction.current) return;
    executeSeek(pos, false);
    executePause();
    socket.emit('room:action', {
      roomId: room.id,
      action: 'SEEK',
      position: pos,
      isPlaying: false,
    });
  }, [socket, room?.id, executeSeek, executePause]);

  const sendMessage = useCallback((text: string) => {
    if (!socket || !room?.id || !text.trim()) return;
    const currentUser = userRef.current;
    socket.emit('room:chat_message', {
      roomId: room.id,
      text: text.trim(),
      userId: currentUser?.id,
      username: currentUser?.username,
      avatarUrl: currentUser?.avatarUrl,
    });
  }, [socket, room?.id]);

  const sendReaction = useCallback((emoji: string) => {
    if (!socket || !room?.id) return;
    const currentUser = userRef.current;
    socket.emit('room:reaction', {
      roomId: room.id,
      emoji,
      username: currentUser?.username,
    });
  }, [socket, room?.id]);

  // Host Force Sync All Participants to Host Position
  const forceSyncAll = useCallback(() => {
    if (!socket || !room?.id) return;
    const cur = getRealPos();
    socket.emit('room:force_sync_all', {
      roomId: room.id,
      position: cur,
    });
    smoothedDiffRef.current = 0;
    setSyncDiffMs(0);
    setSyncQuality('perfect');
  }, [socket, room?.id, getRealPos]);

  // Send Friend Invite
  const sendFriendInvite = useCallback((targetUserId: string) => {
    if (!socket || !room) return;
    socket.emit('friend:invite_to_room', {
      targetUserId,
      roomId: room.id,
      roomCode: room.code,
      roomTitle: room.title,
      mediaTitle: room.mediaTitle || 'Фильм',
      posterPath: room.posterPath,
    });
  }, [socket, room]);

  return {
    roomState,
    members,
    messages,
    reactions,
    syncDiffMs,
    syncQuality,
    isHost,
    allMembersReady,
    isBufferingBarrier,
    barrierTargetPosition,
    forceBarrierPlay,
    syncToHost,
    forceSyncAll,
    sendPlay,
    sendPause,
    sendSeek,
    sendMessage,
    sendReaction,
    sendFriendInvite,
    reportBufferStatus,
  };
}
