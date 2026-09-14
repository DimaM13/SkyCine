import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { Room, RoomMember, RoomChatMessage, RoomReaction, RoomState } from '../types';

interface UseSyncPlayerProps {
  room: Room | null;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  streamMode?: 'direct' | 'apple_ts' | 'fmp4';
  onSeekTo?: (pos: number, shouldPlay?: boolean) => void;
  onPlay?: () => void;
  onPause?: () => void;
  getCurrentTime?: () => number;
  getIsPaused?: () => boolean;
}

export function useSyncPlayer({
  room,
  videoRef,
  streamMode = 'direct',
  onSeekTo,
  onPlay,
  onPause,
  getCurrentTime,
  getIsPaused,
}: UseSyncPlayerProps) {
  const { socket, getSyncedServerTime } = useSocket();
  const { user } = useAuth();

  const [roomState, setRoomState] = useState<RoomState>(room?.state || 'PAUSED');
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [messages, setMessages] = useState<RoomChatMessage[]>([]);
  const [reactions, setReactions] = useState<RoomReaction[]>([]);
  const [syncDiffSec, setSyncDiffSec] = useState<number>(0);
  const [isHost, setIsHost] = useState(false);
  const [isMicroCorrection, setIsMicroCorrection] = useState(false);

  const roomStateRef = useRef<RoomState>(room?.state || 'PAUSED');
  const isInternalAction = useRef<boolean>(false);
  const isMicroCorrectionRef = useRef<boolean>(false);
  isMicroCorrectionRef.current = isMicroCorrection;

  const [microCorrectionOffset, setMicroCorrectionOffset] = useState<number>(0);
  const microCorrectionOffsetRef = useRef<number>(0);
  microCorrectionOffsetRef.current = microCorrectionOffset;

  const streamModeRef = useRef<'direct' | 'apple_ts' | 'fmp4'>(streamMode);
  streamModeRef.current = streamMode;

  const lastSentSeekPosRef = useRef<number | null>(null);
  const lastSentSeekTimeRef = useRef<number>(0);

  const internalActionTimer = useRef<NodeJS.Timeout | null>(null);
  const scheduledPlayTimer = useRef<NodeJS.Timeout | null>(null);

  const blockSyncFor = useCallback((ms: number) => {
    isInternalAction.current = true;
    if (internalActionTimer.current) {
      clearTimeout(internalActionTimer.current);
    }
    internalActionTimer.current = setTimeout(() => {
      isInternalAction.current = false;
      internalActionTimer.current = null;
    }, ms);
  }, []);

  useEffect(() => {
    if (room && user) {
      setIsHost(room.hostUserId === user.id);
    }
  }, [room, user]);

  const userRef = useRef(user);
  userRef.current = user;

  const onSeekToRef = useRef(onSeekTo);
  onSeekToRef.current = onSeekTo;

  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;

  const onPauseRef = useRef(onPause);
  onPauseRef.current = onPause;

  const getCurrentTimeRef = useRef(getCurrentTime);
  getCurrentTimeRef.current = getCurrentTime;

  const getIsPausedRef = useRef(getIsPaused);
  getIsPausedRef.current = getIsPaused;

  const getRealPos = useCallback((): number => {
    if (getCurrentTimeRef.current) return getCurrentTimeRef.current();
    return videoRef?.current?.currentTime || 0;
  }, [videoRef]);

  const getRealPaused = useCallback((): boolean => {
    if (getIsPausedRef.current) return getIsPausedRef.current();
    if (videoRef?.current) return videoRef.current.paused;
    return roomStateRef.current !== 'PLAYING';
  }, [videoRef]);

  const executePlay = useCallback(() => {
    if (onPlayRef.current) {
      onPlayRef.current();
    } else if (videoRef?.current) {
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

  const adjustMicroCorrection = useCallback((delta: number) => {
    setMicroCorrectionOffset((prev) => {
      const next = prev + delta;
      microCorrectionOffsetRef.current = next;
      if (isMicroCorrectionRef.current) {
        const cur = getRealPos();
        blockSyncFor(2000);
        executeSeek(Math.max(0, cur + delta), !getRealPaused());
      }
      return next;
    });
  }, [getRealPos, getRealPaused, executeSeek, blockSyncFor]);

  const hasInitializedRef = useRef(false);

  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;

  const getSyncedServerTimeRef = useRef(getSyncedServerTime);
  getSyncedServerTimeRef.current = getSyncedServerTime;

  // ── Socket Events ──
  useEffect(() => {
    if (!socket || !room?.id) return;

    const targetRoomId = room.id;

    const joinRoom = () => {
      const currentUser = userRef.current;
      socket.emit('room:join', {
        roomId: targetRoomId,
        userId: currentUser?.id || 'guest',
        username: currentUser?.username || 'Гость',
        avatarUrl: currentUser?.avatarUrl,
        streamMode: streamModeRef.current,
      });
    };

    if (socket.connected) {
      joinRoom();
    }
    socket.on('connect', joinRoom);

    // Initial state on joining
    socket.on('room:initial_state', (data: { room: Room; members: RoomMember[]; serverTimestamp: number; livePosition: number }) => {
      setMembers(data.members || []);
      if (data.room) {
        roomStateRef.current = data.room.state;
        setRoomState(data.room.state);

        if (!hasInitializedRef.current) {
          hasInitializedRef.current = true;
          const rawPos = data.livePosition || data.room.currentPosition || 0;
          const livePos = isMicroCorrectionRef.current ? (rawPos + microCorrectionOffsetRef.current) : rawPos;
          const shouldPlay = data.room.state === 'PLAYING';

          blockSyncFor(2000);
          executeSeek(Math.max(0, livePos), shouldPlay);
          if (shouldPlay) {
            executePlay();
          } else {
            executePause();
          }
        }
      }
    });

    socket.on('room:members', (updatedMembers: RoomMember[]) => {
      setMembers(updatedMembers || []);
    });

    // Synchronized state change (Play / Pause / Seek)
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
      setRoomState(data.state);

      if (scheduledPlayTimer.current) {
        clearTimeout(scheduledPlayTimer.current);
        scheduledPlayTimer.current = null;
      }

      // Check if this client was the initiator of the action
      const now = Date.now();
      const isRecentLocalSeek =
        data.action === 'SEEK' &&
        lastSentSeekPosRef.current !== null &&
        Math.abs(data.currentPosition - lastSentSeekPosRef.current) < 1.5 &&
        (now - lastSentSeekTimeRef.current) < 5000;

      const isInitiator = Boolean(
        isRecentLocalSeek ||
        (data.initiatedByUserId &&
          userRef.current?.id &&
          data.initiatedByUserId === userRef.current.id)
      );

      if (data.action === 'PAUSE') {
        executePause();
        const cur = getRealPos();
        const targetPos = isMicroCorrectionRef.current ? (data.currentPosition + microCorrectionOffsetRef.current) : data.currentPosition;
        if (!isInitiator && Math.abs(cur - targetPos) > 0.8) {
          executeSeek(Math.max(0, targetPos), false);
        }
        blockSyncFor(1500);
      } else if (data.action === 'PLAY') {
        const serverNow = getSyncedServerTimeRef.current();
        const delay = Math.max(0, data.serverTimestamp - serverNow);
        const cur = getRealPos();
        const targetPos = isMicroCorrectionRef.current ? (data.currentPosition + microCorrectionOffsetRef.current) : data.currentPosition;

        if (Math.abs(cur - targetPos) > 1.5) {
          executeSeek(Math.max(0, targetPos), true);
        }

        blockSyncFor(1500);

        if (delay > 0) {
          scheduledPlayTimer.current = setTimeout(() => {
            executePlay();
          }, delay);
        } else {
          executePlay();
        }
      } else if (data.action === 'SEEK') {
        const shouldPlay = data.state === 'PLAYING';
        // Grace period so buffering finishes without drift interference
        blockSyncFor(2500);

        // Do NOT re-execute seek on the initiator's device (prevents double-seek & range abortion)
        if (!isInitiator) {
          const targetPos = isMicroCorrectionRef.current
            ? data.currentPosition + microCorrectionOffsetRef.current
            : data.currentPosition;
          executeSeek(Math.max(0, targetPos), shouldPlay);
        } else {
          lastSentSeekPosRef.current = null;
        }
        if (!shouldPlay) {
          executePause();
        }
      }
    });

    // Host Heartbeat Time Anchor (теперь якоря шлют ВСЕ играющие, а не только хост —
    // иначе при частых экшенах isInternalAction вечно true и time_anchor мёртв, см. логи)
    socket.on('room:time_anchor', (data: { currentPosition: number; serverTimestamp: number }) => {
      if (isInternalAction.current) return;

      const now = getSyncedServerTimeRef.current();
      const elapsed = Math.max(0, (now - data.serverTimestamp) / 1000);
      const hostExpectedPos = data.currentPosition + (roomStateRef.current === 'PLAYING' ? elapsed : 0);
      const myPos = getRealPos();
      const effectivePos = isMicroCorrectionRef.current ? (myPos - microCorrectionOffsetRef.current) : myPos;
      const diff = effectivePos - hostExpectedPos;

      setSyncDiffSec(Math.round(diff * 10) / 10);

      // Auto-correct при дрейфе от 1.5с (было 3.0с — мелкий рассинхрон копился и давал "у одного мотается, у другого нет")
      if (roomStateRef.current === 'PLAYING' && Math.abs(diff) > 1.5 && Math.abs(diff) < 20.0 && !isInternalAction.current) {
        console.log(`[WatchTogether] 🔄 Auto-aligning drift of ${diff.toFixed(1)}s to host pos: ${hostExpectedPos.toFixed(1)}s`);
        blockSyncFor(2500);
        const targetPos = isMicroCorrectionRef.current ? (hostExpectedPos + microCorrectionOffsetRef.current) : hostExpectedPos;
        executeSeek(Math.max(0, targetPos), true);
      }
    });

    // Force Sync All from Host
    socket.on('room:force_sync_all', (data: { position: number; serverTimestamp: number; initiatedBy: string }) => {
      blockSyncFor(2500);
      const shouldPlay = roomStateRef.current === 'PLAYING';
      executeSeek(data.position, shouldPlay);
      if (shouldPlay) {
        executePlay();
      } else {
        executePause();
      }
      setSyncDiffSec(0);
    });

    // Chat and Reactions
    socket.on('room:chat_message', (msg: RoomChatMessage) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on('room:reaction', (reaction: RoomReaction) => {
      setReactions((prev) => [...prev, reaction]);
      setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== reaction.id));
      }, 3000);
    });

    socket.on('room:system_message', (sysMsg: { text: string; type: string; timestamp: number }) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-${Date.now()}-${Math.random()}`,
          userId: 'system',
          username: 'Система',
          text: sysMsg.text,
          timestamp: sysMsg.timestamp || Date.now(),
        },
      ]);
    });

    return () => {
      if (scheduledPlayTimer.current) clearTimeout(scheduledPlayTimer.current);
      if (internalActionTimer.current) clearTimeout(internalActionTimer.current);
      if (seekDebounceTimer.current) clearTimeout(seekDebounceTimer.current);
      socket.emit('room:leave', { roomId: targetRoomId });
      socket.off('connect', joinRoom);
      socket.off('room:initial_state');
      socket.off('room:members');
      socket.off('room:sync_state');
      socket.off('room:time_anchor');
      socket.off('room:force_sync_all');
      socket.off('room:chat_message');
      socket.off('room:reaction');
      socket.off('room:system_message');
    };
  }, [socket, room?.id]);

  // Periodic Heartbeat (каждый играющий клиент шлёт якорь каждые 3с —
  // раньше слал только хост и только когда !isInternalAction, при активных экшенах якоря не уходили вообще)
  useEffect(() => {
    if (!socket || !room?.id || roomState !== 'PLAYING') return;

    const interval = setInterval(() => {
      // Do not send heartbeat if user is paused, or if seeking / syncing is in progress
      if (!getRealPaused() && !isInternalAction.current) {
        const cur = getRealPos();
        socket.emit('room:host_heartbeat', {
          roomId: room.id,
          position: cur,
        });
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [socket, room?.id, roomState, getRealPaused, getRealPos]);

  // ── Action Triggers ──
  const sendPlay = useCallback(() => {
    if (!socket || !room?.id) return;
    const cur = getRealPos();
    socket.emit('room:action', {
      roomId: room.id,
      action: 'PLAY',
      position: cur,
      userId: userRef.current?.id,
    });
  }, [socket, room?.id, getRealPos]);

  const sendPause = useCallback(() => {
    if (!socket || !room?.id) return;
    executePause();
    const cur = getRealPos();
    socket.emit('room:action', {
      roomId: room.id,
      action: 'PAUSE',
      position: cur,
      userId: userRef.current?.id,
    });
  }, [socket, room?.id, executePause, getRealPos]);

  const seekDebounceTimer = useRef<NodeJS.Timeout | null>(null);

  // Send streamMode update when it changes
  useEffect(() => {
    if (!socket || !room?.id) return;
    socket.emit('room:member_status', {
      roomId: room.id,
      currentPosition: getRealPos(),
      streamMode,
    });
  }, [socket, room?.id, streamMode, getRealPos]);

  // Periodic position report (каждые 3с) — без него room:members всегда с position=0
  // и кнопка "Выровнять" (syncToHost) молча ничего не делает
  useEffect(() => {
    if (!socket || !room?.id) return;
    const interval = setInterval(() => {
      try {
        const cur = getRealPos();
        let buffered: number | undefined;
        const v = videoRef?.current;
        if (v && v.buffered && v.buffered.length > 0) {
          try { buffered = v.buffered.end(v.buffered.length - 1); } catch {}
        }
        socket.emit('room:member_status', {
          roomId: room!.id,
          currentPosition: cur,
          bufferedPosition: buffered,
          streamMode: streamModeRef.current,
        });
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [socket, room?.id]);

  const sendSeek = useCallback((pos: number, shouldPlay?: boolean) => {
    if (!socket || !room?.id) return;
    const willPlay = shouldPlay !== undefined ? shouldPlay : !getRealPaused();
    blockSyncFor(2500);
    lastSentSeekPosRef.current = pos;
    lastSentSeekTimeRef.current = Date.now();
    const localTarget = isMicroCorrectionRef.current ? (pos + microCorrectionOffsetRef.current) : pos;
    executeSeek(Math.max(0, localTarget), willPlay);

    if (seekDebounceTimer.current) {
      clearTimeout(seekDebounceTimer.current);
    }

    seekDebounceTimer.current = setTimeout(() => {
      lastSentSeekPosRef.current = pos;
      lastSentSeekTimeRef.current = Date.now();
      socket.emit('room:action', {
        roomId: room.id,
        action: 'SEEK',
        position: pos,
        shouldPlay: willPlay,
        userId: userRef.current?.id,
      });
      seekDebounceTimer.current = null;
      blockSyncFor(2500);
    }, 150);
  }, [socket, room?.id, executeSeek, getRealPaused, blockSyncFor]);

  const toggleMicroCorrection = useCallback(() => {
    setIsMicroCorrection((prev) => {
      const next = !prev;
      isMicroCorrectionRef.current = next;
      const cur = getRealPos();
      let offset = microCorrectionOffsetRef.current;
      if (next && offset === 0) {
        offset = 1;
        setMicroCorrectionOffset(1);
        microCorrectionOffsetRef.current = 1;
      }
      if (offset !== 0) {
        // When turning ON: add offset to video. When turning OFF: subtract offset back
        const target = next ? (cur + offset) : Math.max(0, cur - offset);
        blockSyncFor(2000);
        executeSeek(target, !getRealPaused());
      }
      return next;
    });
  }, [getRealPos, getRealPaused, executeSeek, blockSyncFor]);

  const forceSyncAll = useCallback(() => {
    if (!socket || !room?.id) return;
    const cur = getRealPos();
    socket.emit('room:force_sync_all', {
      roomId: room.id,
      position: cur,
    });
    setSyncDiffSec(0);
  }, [socket, room?.id, getRealPos]);

  const syncToHost = useCallback(() => {
    if (!socket || !room?.id) return;
    const hostMember = members.find((m) => m.userId === room.hostUserId);
    if (hostMember && hostMember.currentPosition > 0) {
      blockSyncFor(2500);
      const targetPos = isMicroCorrectionRef.current
        ? (hostMember.currentPosition + microCorrectionOffsetRef.current)
        : hostMember.currentPosition;
      executeSeek(Math.max(0, targetPos), roomStateRef.current === 'PLAYING');
      setSyncDiffSec(0);
    }
  }, [socket, room?.id, room?.hostUserId, members, executeSeek, blockSyncFor]);

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
    if (!socket || !room?.id || !emoji) return;
    const currentUser = userRef.current;
    socket.emit('room:reaction', {
      roomId: room.id,
      emoji,
      username: currentUser?.username,
    });
  }, [socket, room?.id]);

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
    syncDiffSec,
    isHost,
    isMicroCorrection,
    microCorrectionOffset,
    toggleMicroCorrection,
    adjustMicroCorrection,
    sendPlay,
    sendPause,
    sendSeek,
    forceSyncAll,
    syncToHost,
    sendMessage,
    sendReaction,
    sendFriendInvite,
  };
}
