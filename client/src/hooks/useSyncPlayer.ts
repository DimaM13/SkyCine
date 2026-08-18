import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { Room, RoomMember, RoomChatMessage, RoomReaction, RoomState } from '../types';

interface UseSyncPlayerProps {
  room: Room | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  onTimeUpdate?: (currentTime: number) => void;
  onSeekTo?: (pos: number, shouldPlay?: boolean) => void;
  getCurrentTime?: () => number;
}

export function useSyncPlayer({ room, videoRef, onTimeUpdate, onSeekTo, getCurrentTime }: UseSyncPlayerProps) {
  const { socket, isConnected, getSyncedServerTime } = useSocket();
  const { user } = useAuth();

  const [roomState, setRoomState] = useState<RoomState>(room?.state || 'PAUSED');
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [messages, setMessages] = useState<RoomChatMessage[]>([]);
  const [reactions, setReactions] = useState<RoomReaction[]>([]);
  const [syncDiffMs, setSyncDiffMs] = useState<number>(0);
  const [syncQuality, setSyncQuality] = useState<'perfect' | 'good' | 'adjusting' | 'seeking'>('perfect');
  const [isHost, setIsHost] = useState(false);

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

  const getCurrentTimeRef = useRef(getCurrentTime);
  useEffect(() => {
    getCurrentTimeRef.current = getCurrentTime;
  }, [getCurrentTime]);

  const syncToHostRef = useRef<(() => void) | null>(null);

  const getRealPos = useCallback(() => {
    if (getCurrentTimeRef.current) return getCurrentTimeRef.current();
    return videoRef.current?.currentTime || 0;
  }, [videoRef]);

  const executeSeek = useCallback((pos: number, shouldPlay?: boolean) => {
    if (onSeekToRef.current) {
      onSeekToRef.current(pos, shouldPlay);
    } else if (videoRef.current) {
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

          // Align video element on initial join
          if (videoRef.current) {
            isInternalAction.current = true;
            const video = videoRef.current;
            const shouldPlay = data.room.state === 'PLAYING';
            executeSeek(livePos, shouldPlay);
            if (shouldPlay) {
              video.play().catch(() => {});
            } else {
              video.pause();
            }
            setTimeout(() => { isInternalAction.current = false; }, 100);
          }

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
        if (shouldPlay && videoRef.current?.paused) {
          videoRef.current.play().catch(() => {});
        }
        setTimeout(() => { isInternalAction.current = false; }, 100);
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

      if (!videoRef.current) return;
      const video = videoRef.current;

      if (scheduledPlayTimer.current) {
        clearTimeout(scheduledPlayTimer.current);
        scheduledPlayTimer.current = null;
      }

      const shouldPlay = data.state === 'PLAYING';

      isInternalAction.current = true;
      if (data.action === 'SEEK') {
        executeSeek(data.currentPosition, shouldPlay);
      } else if (data.action === 'PAUSE') {
        video.pause();
        const cur = getRealPos();
        if (Math.abs(cur - data.currentPosition) > 0.5) {
          executeSeek(data.currentPosition);
        }
      } else if (data.action === 'PLAY') {
        const cur = getRealPos();
        if (Math.abs(cur - data.currentPosition) > 1.0) {
          executeSeek(data.currentPosition, true);
        } else {
          video.playbackRate = data.playbackRate || 1.0;
          video.play().catch(() => {});
        }
      }
      setTimeout(() => { isInternalAction.current = false; }, 100);
    });

    socket.on('room:time_anchor', (data: { currentPosition: number; serverTimestamp: number }) => {
      currentPosRef.current = data.currentPosition;
      serverTimestampRef.current = data.serverTimestamp;
    });

    socket.on('room:force_sync_all', (data: { position: number; serverTimestamp: number; isPlaying?: boolean; initiatedBy: string; initiatedByUserId?: string }) => {
      currentPosRef.current = data.position;
      serverTimestampRef.current = data.serverTimestamp;
      
      isInternalAction.current = true;
      executeSeek(data.position);

      if (scheduledPlayTimer.current) {
        clearTimeout(scheduledPlayTimer.current);
        scheduledPlayTimer.current = null;
      }

      if (data.isPlaying || roomStateRef.current === 'PLAYING') {
        const now = getSyncedServerTime();
        const delay = Math.max(0, data.serverTimestamp - now);

        if (delay > 0) {
          scheduledPlayTimer.current = setTimeout(() => {
            if (videoRef.current) {
              isInternalAction.current = true;
              videoRef.current.playbackRate = playbackRateRef.current;
              videoRef.current.play().catch(() => {});
              setTimeout(() => { isInternalAction.current = false; }, 100);
            }
          }, delay);
        } else {
          if (videoRef.current) {
            videoRef.current.playbackRate = playbackRateRef.current;
            videoRef.current.play().catch(() => {});
          }
        }
      } else {
        if (videoRef.current) {
          videoRef.current.pause();
        }
      }
      setTimeout(() => { isInternalAction.current = false; }, 100);

      smoothedDiffRef.current = 0;
      setSyncDiffMs(0);
      setSyncQuality('perfect');

      // Automatic 2-second secondary align for everyone EXCEPT the host who initiated forceSyncAll
      if (data.initiatedByUserId && userRef.current?.id !== data.initiatedByUserId) {
        setTimeout(() => {
          syncToHostRef.current?.();
        }, 2000);
      }
    });

    socket.on('room:members_status', (membersList: RoomMember[]) => {
      setMembers(membersList || []);
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
      socket.off('room:sync_state');
      socket.off('room:time_anchor');
      socket.off('room:force_sync_all');
      socket.off('room:chat_message');
      socket.off('room:reaction');
      socket.off('room:system_message');
    };
  }, [socket, room?.id, user?.id]);

  // Host Continuous Heartbeat Anchor (broadcast real position every 2 seconds while playing)
  useEffect(() => {
    if (!isHost || !socket || !room?.id || roomState !== 'PLAYING') return;

    const interval = setInterval(() => {
      const video = videoRef.current;
      if (video && !video.paused && !video.seeking) {
        const cur = getRealPos();
        socket.emit('room:host_heartbeat', {
          roomId: room.id,
          position: cur,
        });
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isHost, socket, room?.id, roomState, videoRef, getRealPos]);

  const smoothedDiffRef = useRef<number>(0);

  // Pure 1.0x Original Speed Tracking (Strictly 1.0x, zero speed changes)
  useEffect(() => {
    const interval = setInterval(() => {
      if (!videoRef.current || roomStateRef.current !== 'PLAYING') {
        setSyncQuality('perfect');
        setSyncDiffMs(0);
        return;
      }

      const video = videoRef.current;

      // Ensure playbackRate is strictly normal (1.0x) as original
      if (video.playbackRate !== playbackRateRef.current) {
        video.playbackRate = playbackRateRef.current;
      }

      const now = getSyncedServerTime();
      const elapsed = (now - serverTimestampRef.current) / 1000;
      const expectedPos = Math.max(0, currentPosRef.current + elapsed * playbackRateRef.current);
      const currentPos = getRealPos();

      const instantDiffSec = currentPos - expectedPos;
      // Exponential smoothing for steady UI ping/lag display
      smoothedDiffRef.current = smoothedDiffRef.current * 0.7 + instantDiffSec * 0.3;
      const diffSec = smoothedDiffRef.current;
      const diffMs = Math.round(diffSec * 1000);
      setSyncDiffMs(diffMs);

      const absDiff = Math.abs(diffSec);

      if (absDiff < 0.4) {
        setSyncQuality('perfect');
      } else if (absDiff < 1.5) {
        setSyncQuality('good');
      } else {
        setSyncQuality('adjusting');
      }
    }, 500);

    return () => clearInterval(interval);
  }, [videoRef, getSyncedServerTime, members.length, getRealPos]);

  // One-Click Instant Align with Host
  const syncToHost = useCallback(() => {
    if (!socket || !room?.id || !videoRef.current) return;
    const video = videoRef.current;

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
      executeSeek(targetPos);
      if (roomStateRef.current === 'PLAYING' && video.paused) {
        video.play().catch(() => {});
      }
      setTimeout(() => { isInternalAction.current = false; }, 100);
    }

    smoothedDiffRef.current = 0;
    setSyncDiffMs(0);
    setSyncQuality('perfect');
  }, [socket, room?.id, room?.hostUserId, members, getSyncedServerTime, executeSeek]);

  useEffect(() => {
    syncToHostRef.current = syncToHost;
  }, [syncToHost]);

  // Send local buffer status to room
  const reportBufferStatus = useCallback((isReady: boolean) => {
    if (!socket || !room?.id || !videoRef.current) return;
    const video = videoRef.current;
    let bufferedSec = 0;
    if (video.buffered.length > 0) {
      bufferedSec = video.buffered.end(video.buffered.length - 1);
    }

    const cur = getRealPos();
    socket.emit('room:buffer_status', {
      roomId: room.id,
      isReady,
      bufferedPosition: bufferedSec,
      currentPosition: cur,
    });
  }, [socket, room?.id, videoRef, getRealPos]);

  // Client Action Triggers
  const sendPlay = useCallback(() => {
    if (!socket || !room?.id || !videoRef.current) return;
    if (isInternalAction.current) return;
    const video = videoRef.current;
    video.play().catch(() => {});
    const cur = getRealPos();
    socket.emit('room:action', {
      roomId: room.id,
      action: 'PLAY',
      position: cur,
      playbackRate: playbackRateRef.current,
    });
  }, [socket, room?.id, videoRef, getRealPos]);

  const sendPause = useCallback(() => {
    if (!socket || !room?.id || !videoRef.current) return;
    if (isInternalAction.current) return;
    const video = videoRef.current;
    video.pause();
    const cur = getRealPos();
    socket.emit('room:action', {
      roomId: room.id,
      action: 'PAUSE',
      position: cur,
    });
  }, [socket, room?.id, videoRef, getRealPos]);

  const sendSeek = useCallback((pos: number) => {
    if (!socket || !room?.id) return;
    if (isInternalAction.current) return;
    const isPlayingNow = videoRef.current ? !videoRef.current.paused : (roomStateRef.current === 'PLAYING');
    socket.emit('room:action', {
      roomId: room.id,
      action: 'SEEK',
      position: pos,
      isPlaying: isPlayingNow,
    });
  }, [socket, room?.id, videoRef]);

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

  // Periodic live position & buffer reporter (every 1.5s while active)
  useEffect(() => {
    if (!socket || !room?.id) return;
    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const isReady = video.readyState >= 3;
      let bufSec = 0;
      if (video.buffered.length > 0) {
        bufSec = video.buffered.end(video.buffered.length - 1);
      }
      const cur = getRealPos();
      socket.emit('room:buffer_status', {
        roomId: room.id,
        isReady,
        bufferedPosition: bufSec,
        currentPosition: cur,
      });
    }, 1500);
    return () => clearInterval(interval);
  }, [socket, room?.id, videoRef, getRealPos]);

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
