import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { Room, RoomMember, RoomChatMessage, RoomReaction, RoomState, RoomHealthUpdate, RoomHealthEntry, RoomActionFeedEntry, RoomRollbackNotice } from '../types';

interface UseSyncPlayerProps {
  room: Room | null;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  streamMode?: 'direct' | 'fmp4';
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
  const { socket, getSyncedServerTime, getRtt } = useSocket();
  const { user } = useAuth();

  const [roomState, setRoomState] = useState<RoomState>(room?.state || 'PAUSED');
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [messages, setMessages] = useState<RoomChatMessage[]>([]);
  const [reactions, setReactions] = useState<RoomReaction[]>([]);
  const [syncDiffSec, setSyncDiffSec] = useState<number>(0);
  const [isHost, setIsHost] = useState(false);
  // ── Room Health (диагностика "кто тормозит") ──
  const [health, setHealth] = useState<RoomHealthEntry[]>([]);
  const [culpritIds, setCulpritIds] = useState<string[]>([]);
  const [waitingFor, setWaitingFor] = useState<string[]>([]);
  const [waitingText, setWaitingText] = useState<string | null>(null);
  const [actionFeed, setActionFeed] = useState<RoomActionFeedEntry[]>([]);
  const [rollbackNotice, setRollbackNotice] = useState<RoomRollbackNotice | null>(null);

  // Локальная телеметрия воспроизведения
  const isBufferingRef = useRef<boolean>(false);
  const stallCountRef = useRef<number>(0);
  const stallMsRef = useRef<number>(0);
  const stallStartRef = useRef<number>(0);
  const droppedFramesRef = useRef<number>(0);
  const droppedBaseRef = useRef<number>(0);
  const lastBufferingEmitRef = useRef<number>(0);

  const roomStateRef = useRef<RoomState>(room?.state || 'PAUSED');
  const isInternalAction = useRef<boolean>(false);

  const streamModeRef = useRef<'direct' | 'fmp4'>(streamMode);
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

  const hasInitializedRef = useRef(false);

  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;

  const getSyncedServerTimeRef = useRef(getSyncedServerTime);
  getSyncedServerTimeRef.current = getSyncedServerTime;

  const getRttRef = useRef(getRtt);
  getRttRef.current = getRtt;

  const detectPlatform = useCallback((): string => {
    if (typeof window !== 'undefined' && (window as any).desktopPlayer?.isDesktop) return 'desktop';
    if (typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return 'mobile';
    return 'web';
  }, []);

  // Снепшот локального здоровья для отправки на сервер.
  // ВАЖНО: флаг isBufferingRef — только сырьё. Эффективная буферизация считается здесь:
  // paused-видео НЕ буферизуется (пауза — намеренное состояние, а seek на паузе и есть
  // главный источник залипшего флага: 'waiting' без последующего 'playing').
  // readyState>=3 (HAVE_FUTURE_DATA) при играющем видео тоже гасит залипший флаг.
  // stallCount/stallMs/droppedFrames — значения ЗА ОКНО с прошлой отправки (report-and-clear),
  // иначе накопительные счётчики со временем пометят лагающими всех.
  const getHealthSnapshot = useCallback(() => {
    let bufferedAhead = -1; // -1 = неизвестно; 0 может быть ложью (нет данных)
    let bufferedEnd: number | undefined;
    let droppedWindow = 0;
    let paused = true;
    let readyState = 0;
    try {
      const v = videoRef?.current;
      if (v) {
        paused = v.paused;
        readyState = v.readyState || 0;
        const cur = typeof getCurrentTimeRef.current === 'function' && (window as any).desktopPlayer?.isDesktop
          ? getCurrentTimeRef.current!()
          : (v.currentTime || 0);
        if (v.buffered && v.buffered.length > 0) {
          try {
            bufferedEnd = v.buffered.end(v.buffered.length - 1);
            bufferedAhead = Math.max(0, bufferedEnd - cur);
          } catch {}
        }
        try {
          const q = (v as any).getVideoPlaybackQuality ? (v as any).getVideoPlaybackQuality() : null;
          if (q && typeof q.droppedVideoFrames === 'number') {
            const abs = q.droppedVideoFrames;
            droppedWindow = Math.max(0, abs - droppedBaseRef.current);
            droppedBaseRef.current = abs;
            droppedFramesRef.current = abs;
          }
        } catch {}
      } else if (typeof getCurrentTimeRef.current === 'function') {
        // Desktop MPV / YouTube iframe: своего <video> нет — состояние из колбэков
        try { paused = getRealPaused(); } catch { paused = true; }
        droppedWindow = Math.max(0, droppedFramesRef.current - droppedBaseRef.current);
        droppedBaseRef.current = droppedFramesRef.current;
      } else {
        try { paused = getRealPaused(); } catch { paused = true; }
      }
    } catch {}
    const rawFlag = isBufferingRef.current;
    // Самолечение залипшего флага: есть данные и играем — значит не буферизуемся
    const effectiveBuffering = rawFlag && !paused && (videoRef?.current ? readyState < 3 : true);
    if (!effectiveBuffering && rawFlag && (!videoRef?.current || paused || readyState >= 3)) {
      // флаг врёт — гасим, чтобы не слать ложь до следующего события
      isBufferingRef.current = false;
      stallStartRef.current = 0;
    }
    return {
      isBuffering: effectiveBuffering,
      isPlaying: !paused,
      bufferedAheadSec: bufferedAhead >= 0 ? Math.round(bufferedAhead * 10) / 10 : -1,
      bufferedEnd,
      stallCount: stallCountRef.current,
      stallMs: Math.round(stallMsRef.current),
      rttMs: Math.round(getRttRef.current ? getRttRef.current() : 0),
      droppedFrames: droppedWindow,
      platform: detectPlatform(),
    };
  }, [videoRef, detectPlatform, getRealPaused]);

  // Трекинг буферизации/сталов на <video> (веб). Desktop MPV пушит через reportDesktopHealth извне.
  useEffect(() => {
    const v = videoRef?.current;
    if (!v) return;
    const beginStall = () => {
      if (!isBufferingRef.current) {
        isBufferingRef.current = true;
        stallStartRef.current = Date.now();
        stallCountRef.current += 1;
      }
    };
    const endStall = () => {
      if (isBufferingRef.current) {
        isBufferingRef.current = false;
        if (stallStartRef.current) {
          stallMsRef.current += Date.now() - stallStartRef.current;
          stallStartRef.current = 0;
        }
      }
    };
    const onWaiting = () => beginStall();
    const onStalled = () => beginStall();
    const onPlaying = () => endStall();
    const onCanPlay = () => endStall();
    // Пауза — НЕ буферизация: seek на паузе даёт 'waiting' без 'playing',
    // именно так флаг залипал навсегда. Гасим флаг сразу.
    const onPause = () => endStall();
    // Seek завершён: если стоим на паузе или данные уже есть — точно не буферизация
    const onSeeked = () => {
      try {
        if (v.paused || (v.readyState || 0) >= 3) endStall();
      } catch { endStall(); }
    };
    const onError = () => { stallCountRef.current += 1; };
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('stalled', onStalled);
    v.addEventListener('playing', onPlaying);
    v.addEventListener('canplay', onCanPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('error', onError);
    // Холодный старт: если элемент уже на паузе — флаг обязан быть сброшен
    try { if (v.paused) endStall(); } catch {}
    return () => {
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('stalled', onStalled);
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('canplay', onCanPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('error', onError);
      endStall();
    };
  }, [videoRef, room?.id]);

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
          const livePos = rawPos;
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
        const targetPos = data.currentPosition;
        if (!isInitiator && Math.abs(cur - targetPos) > 0.8) {
          executeSeek(Math.max(0, targetPos), false);
        }
        blockSyncFor(1500);
      } else if (data.action === 'PLAY') {
        const serverNow = getSyncedServerTimeRef.current();
        const delay = Math.max(0, data.serverTimestamp - serverNow);
        const cur = getRealPos();
        const targetPos = data.currentPosition;

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
          const targetPos = data.currentPosition;
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
      const effectivePos = myPos;
      const diff = effectivePos - hostExpectedPos;

      setSyncDiffSec(Math.round(diff * 10) / 10);

      // Auto-correct при дрейфе от 1.5с (было 3.0с — мелкий рассинхрон копился и давал "у одного мотается, у другого нет")
      if (roomStateRef.current === 'PLAYING' && Math.abs(diff) > 1.5 && Math.abs(diff) < 20.0 && !isInternalAction.current) {
        console.log(`[WatchTogether] 🔄 Auto-aligning drift of ${diff.toFixed(1)}s to host pos: ${hostExpectedPos.toFixed(1)}s`);
        blockSyncFor(2500);
        const targetPos = hostExpectedPos;
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

    socket.on('room:health', (data: RoomHealthUpdate) => {
      if (!data) return;
      setHealth(data.health || []);
      setCulpritIds(data.culpritIds || []);
      setWaitingFor(data.waitingFor || []);
      setWaitingText(data.waitingText || null);
    });

    socket.on('room:action_feed', (entry: RoomActionFeedEntry) => {
      if (!entry) return;
      setActionFeed((prev) => [...prev.slice(-19), entry]);
      setTimeout(() => {
        setActionFeed((prev) => prev.filter((e) => e.id !== entry.id));
      }, 6000);
    });

    socket.on('room:rollback_notice', (notice: RoomRollbackNotice) => {
      if (!notice) return;
      setRollbackNotice(notice);
      setTimeout(() => {
        setRollbackNotice((prev) => (prev && prev.timestamp === notice.timestamp ? null : prev));
      }, 9000);
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
      socket.off('room:health');
      socket.off('room:action_feed');
      socket.off('room:rollback_notice');
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
    try {
      const snap = getHealthSnapshot();
      socket.emit('room:member_status', {
        roomId: room.id,
        currentPosition: getRealPos(),
        streamMode,
        isBuffering: snap.isBuffering,
        isPlaying: snap.isPlaying,
        bufferedAheadSec: snap.bufferedAheadSec,
        rttMs: snap.rttMs,
        platform: snap.platform,
      });
    } catch {
      socket.emit('room:member_status', {
        roomId: room.id,
        currentPosition: getRealPos(),
        streamMode,
      });
    }
  }, [socket, room?.id, streamMode, getRealPos, getHealthSnapshot]);

  // Periodic position + health report (каждые 3с) — сервер считает "кто тормозит"
  useEffect(() => {
    if (!socket || !room?.id) return;
    const sendStatus = (immediate = false) => {
      try {
        const cur = getRealPos();
        const snap = getHealthSnapshot();
        let buffered: number | undefined = snap.bufferedEnd;
        if (buffered === undefined) {
          const v = videoRef?.current;
          if (v && v.buffered && v.buffered.length > 0) {
            try { buffered = v.buffered.end(v.buffered.length - 1); } catch {}
          }
        }
        // Мгновенный репорт при смене буферизации — троттлинг 1с чтобы не спамить
        if (immediate) {
          const nowMs = Date.now();
          if (nowMs - lastBufferingEmitRef.current < 1000) return;
          lastBufferingEmitRef.current = nowMs;
        }
        socket.emit('room:member_status', {
          roomId: room!.id,
          currentPosition: cur,
          bufferedPosition: buffered,
          streamMode: streamModeRef.current,
          isBuffering: snap.isBuffering,
          isPlaying: snap.isPlaying,
          bufferedAheadSec: snap.bufferedAheadSec,
          stallCount: snap.stallCount,
          stallMs: snap.stallMs,
          rttMs: snap.rttMs,
          droppedFrames: snap.droppedFrames,
          platform: snap.platform,
        });
        // Окно сталов закрыто и отправлено — обнуляем, иначе накопительный
        // счётчик со временем пометит лагающими всех (ложные "тормозит")
        stallCountRef.current = 0;
        stallMsRef.current = 0;
      } catch {}
    };
    sendStatus();
    const interval = setInterval(() => sendStatus(), 3000);
    // Досылаем смену флага между тиками — чтобы "ожидаем X" появлялось сразу.
    // Шлём только честную буферизацию: флаг + реально играет + данных нет.
    const fastPoll = setInterval(() => {
      try {
        const v = videoRef?.current;
        const playing = v ? !v.paused : getRealPos() !== undefined && !getRealPaused();
        const noData = v ? (v.readyState || 0) < 3 : true;
        if (isBufferingRef.current && playing && noData) {
          sendStatus(true);
        }
      } catch {}
    }, 2000);
    return () => { clearInterval(interval); clearInterval(fastPoll); };
  }, [socket, room?.id, getHealthSnapshot]);

  const sendSeek = useCallback((pos: number, shouldPlay?: boolean) => {
    if (!socket || !room?.id) return;
    const willPlay = shouldPlay !== undefined ? shouldPlay : !getRealPaused();
    blockSyncFor(2500);
    lastSentSeekPosRef.current = pos;
    lastSentSeekTimeRef.current = Date.now();
    const localTarget = pos;
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
      const targetPos = hostMember.currentPosition;
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

  // Внешний пуш телеметрии (Desktop MPV: paused-for-cache, demuxer-cache, drops, hwdec).
  // Веб этим не пользуется — у него события <video>.
  const reportDesktopHealth = useCallback((patch: {
    isBuffering?: boolean; bufferedAheadSec?: number; stallCount?: number;
    stallMs?: number; droppedFrames?: number; hwdec?: string;
  }) => {
    if (patch.isBuffering !== undefined) {
      if (patch.isBuffering && !isBufferingRef.current) {
        isBufferingRef.current = true;
        stallStartRef.current = Date.now();
        stallCountRef.current += 1;
      } else if (!patch.isBuffering && isBufferingRef.current) {
        isBufferingRef.current = false;
        if (stallStartRef.current) {
          stallMsRef.current += Date.now() - stallStartRef.current;
          stallStartRef.current = 0;
        }
      }
    }
    if (patch.bufferedAheadSec !== undefined && Number.isFinite(patch.bufferedAheadSec)) {
      // храним через droppedFramesRef-паттерн: отдельногo ref нет, поэтому шлём сразу.
      // Честность: paused-MPV не буферизуется, даже если paused-for-cache пришёл.
      try {
        if (socket && room?.id) {
          let paused = true;
          try { paused = getRealPaused(); } catch {}
          const effective = isBufferingRef.current && !paused;
          socket.emit('room:member_status', {
            roomId: room.id,
            currentPosition: getRealPos(),
            streamMode: streamModeRef.current,
            isBuffering: effective,
            isPlaying: !paused,
            bufferedAheadSec: Math.max(0, patch.bufferedAheadSec),
            stallCount: patch.stallCount ?? stallCountRef.current,
            stallMs: Math.round(patch.stallMs ?? stallMsRef.current),
            rttMs: Math.round(getRttRef.current ? getRttRef.current() : 0),
            droppedFrames: patch.droppedFrames ?? droppedFramesRef.current,
            platform: 'desktop',
            hwdec: patch.hwdec,
          });
          stallCountRef.current = 0;
          stallMsRef.current = 0;
          return;
        }
      } catch {}
    }
    if (patch.stallCount !== undefined) stallCountRef.current = patch.stallCount;
    if (patch.stallMs !== undefined) stallMsRef.current = patch.stallMs;
    if (patch.droppedFrames !== undefined) droppedFramesRef.current = patch.droppedFrames;
  }, [socket, room?.id, getRealPos, getRealPaused]);

  return {
    roomState,
    members,
    messages,
    reactions,
    syncDiffSec,
    isHost,
    health,
    culpritIds,
    waitingFor,
    waitingText,
    actionFeed,
    rollbackNotice,
    reportDesktopHealth,
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
