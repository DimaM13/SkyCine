import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { Room, RoomMember, RoomChatMessage, RoomReaction, RoomState } from '../types';

interface UseSyncPlayerProps {
  room: Room | null;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onSeekTo?: (pos: number, shouldPlay?: boolean) => void;
  onPlay?: () => void;
  onPause?: () => void;
  getCurrentTime?: () => number;
  getIsPaused?: () => boolean;
}

export function useSyncPlayer({
  room,
  videoRef,
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

  const roomStateRef = useRef<RoomState>(room?.state || 'PAUSED');
  const isInternalAction = useRef<boolean>(false);
  const scheduledPlayTimer = useRef<NodeJS.Timeout | null>(null);

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
          const livePos = data.livePosition || data.room.currentPosition || 0;
          const shouldPlay = data.room.state === 'PLAYING';

          isInternalAction.current = true;
          executeSeek(livePos, shouldPlay);
          if (shouldPlay) {
            executePlay();
          } else {
            executePause();
          }
          setTimeout(() => { isInternalAction.current = false; }, 200);
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
    }) => {
      roomStateRef.current = data.state;
      setRoomState(data.state);

      if (scheduledPlayTimer.current) {
        clearTimeout(scheduledPlayTimer.current);
        scheduledPlayTimer.current = null;
      }

      isInternalAction.current = true;

      if (data.action === 'PAUSE') {
        executePause();
        const cur = getRealPos();
        if (Math.abs(cur - data.currentPosition) > 0.8) {
          executeSeek(data.currentPosition, false);
        }
      } else if (data.action === 'PLAY') {
        const now = getSyncedServerTimeRef.current();
        const delay = Math.max(0, data.serverTimestamp - now);
        const cur = getRealPos();

        if (Math.abs(cur - data.currentPosition) > 1.5) {
          executeSeek(data.currentPosition, true);
        }

        if (delay > 0) {
          scheduledPlayTimer.current = setTimeout(() => {
            isInternalAction.current = true;
            executePlay();
            setTimeout(() => { isInternalAction.current = false; }, 100);
          }, delay);
        } else {
          executePlay();
        }
      } else if (data.action === 'SEEK') {
        const shouldPlay = data.state === 'PLAYING';
        executeSeek(data.currentPosition, shouldPlay);
        if (!shouldPlay) {
          executePause();
        }
      }

      setTimeout(() => { isInternalAction.current = false; }, 1500);
    });

    // Host Heartbeat Time Anchor
    socket.on('room:time_anchor', (data: { currentPosition: number; serverTimestamp: number }) => {
      if (isHostRef.current || isInternalAction.current) return;

      const now = getSyncedServerTimeRef.current();
      const elapsed = Math.max(0, (now - data.serverTimestamp) / 1000);
      const hostExpectedPos = data.currentPosition + (roomStateRef.current === 'PLAYING' ? elapsed : 0);
      const myPos = getRealPos();
      const diff = myPos - hostExpectedPos;

      setSyncDiffSec(Math.round(diff * 10) / 10);

      // Auto-correct only if drift is between 3.0s and 20.0s (avoid micro-stutter and don't fight major seeks)
      if (roomStateRef.current === 'PLAYING' && Math.abs(diff) > 3.0 && Math.abs(diff) < 20.0 && !isInternalAction.current) {
        console.log(`[WatchTogether] 🔄 Auto-aligning drift of ${diff.toFixed(1)}s to host pos: ${hostExpectedPos.toFixed(1)}s`);
        isInternalAction.current = true;
        executeSeek(hostExpectedPos, true);
        setTimeout(() => { isInternalAction.current = false; }, 1500);
      }
    });

    // Force Sync All from Host
    socket.on('room:force_sync_all', (data: { position: number; serverTimestamp: number; initiatedBy: string }) => {
      isInternalAction.current = true;
      const shouldPlay = roomStateRef.current === 'PLAYING';
      executeSeek(data.position, shouldPlay);
      if (shouldPlay) {
        executePlay();
      } else {
        executePause();
      }
      setTimeout(() => { isInternalAction.current = false; }, 200);
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

  // Host Periodic Heartbeat (every 3 seconds while playing)
  useEffect(() => {
    if (!isHost || !socket || !room?.id || roomState !== 'PLAYING') return;

    const interval = setInterval(() => {
      if (!getRealPaused()) {
        const cur = getRealPos();
        socket.emit('room:host_heartbeat', {
          roomId: room.id,
          position: cur,
        });
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isHost, socket, room?.id, roomState, getRealPaused, getRealPos]);

  // ── Action Triggers ──
  const sendPlay = useCallback(() => {
    if (!socket || !room?.id || isInternalAction.current) return;
    const cur = getRealPos();
    socket.emit('room:action', {
      roomId: room.id,
      action: 'PLAY',
      position: cur,
    });
  }, [socket, room?.id, getRealPos]);

  const sendPause = useCallback(() => {
    if (!socket || !room?.id || isInternalAction.current) return;
    executePause();
    const cur = getRealPos();
    socket.emit('room:action', {
      roomId: room.id,
      action: 'PAUSE',
      position: cur,
    });
  }, [socket, room?.id, executePause, getRealPos]);

  const seekDebounceTimer = useRef<NodeJS.Timeout | null>(null);

  const sendSeek = useCallback((pos: number, shouldPlay?: boolean) => {
    if (!socket || !room?.id) return;
    const willPlay = shouldPlay !== undefined ? shouldPlay : !getRealPaused();
    isInternalAction.current = true;
    executeSeek(pos, willPlay);

    if (seekDebounceTimer.current) {
      clearTimeout(seekDebounceTimer.current);
    }

    seekDebounceTimer.current = setTimeout(() => {
      socket.emit('room:action', {
        roomId: room.id,
        action: 'SEEK',
        position: pos,
        shouldPlay: willPlay,
      });
      seekDebounceTimer.current = null;
      setTimeout(() => { isInternalAction.current = false; }, 1500);
    }, 150);
  }, [socket, room?.id, executeSeek, getRealPaused]);

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
      isInternalAction.current = true;
      executeSeek(hostMember.currentPosition, roomStateRef.current === 'PLAYING');
      setTimeout(() => { isInternalAction.current = false; }, 200);
      setSyncDiffSec(0);
    }
  }, [socket, room?.id, room?.hostUserId, members, executeSeek]);

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
