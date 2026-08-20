import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX,
  Maximize, Minimize, ArrowLeft, Users, Share2,
  RefreshCw, Video, AlertCircle, X, Clock
} from 'lucide-react';
import { useSocket } from '../../context/SocketContext';
import { Room, RoomMember, RoomReaction, RoomState } from '../../types';
import { ReactionOverlay } from './ReactionOverlay';
import { BufferBarrierBanner } from '../rooms/BufferBarrierBanner';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

interface YouTubeSyncPlayerProps {
  room: Room;
  roomState: RoomState;
  syncDiffMs: number;
  syncQuality: 'perfect' | 'good' | 'adjusting' | 'seeking';
  isHost: boolean;
  allMembersReady?: boolean;
  onForceSyncAll: () => void;
  onSyncToHost: () => void;
  members: RoomMember[];
  currentUserId?: string;
  hostUserId: string;
  reactions: RoomReaction[];
  isBufferingBarrier?: boolean;
  onForceBarrierPlay?: () => void;
  onPlayRequest: () => void;
  onPauseRequest: () => void;
  onSeekRequest: (pos: number) => void;
  onBufferStatusChange: (isReady: boolean, bufferedPos?: number, currentPos?: number, bufferPercent?: number) => void;
  onToggleSidebar: () => void;
  isSidebarOpen: boolean;
  onBack: () => void;
  onInvite: () => void;
  onSendReaction?: (emoji: string) => void;
  onAttachSeekHandler?: (fn: (pos: number, shouldPlay?: boolean) => void) => void;
  onAttachPlayHandler?: (fn: () => void) => void;
  onAttachPauseHandler?: (fn: () => void) => void;
  onAttachGetCurrentTime?: (fn: () => number) => void;
  onAttachGetIsPaused?: (fn: () => boolean) => void;
}

export const YouTubeSyncPlayer: React.FC<YouTubeSyncPlayerProps> = ({
  room,
  roomState,
  syncDiffMs,
  syncQuality,
  isHost,
  allMembersReady = true,
  onForceSyncAll,
  onSyncToHost,
  members,
  currentUserId,
  hostUserId,
  reactions,
  isBufferingBarrier = false,
  onForceBarrierPlay,
  onPlayRequest,
  onPauseRequest,
  onSeekRequest,
  onBufferStatusChange,
  onToggleSidebar,
  isSidebarOpen,
  onBack,
  onInvite,
  onAttachSeekHandler,
  onAttachPlayHandler,
  onAttachPauseHandler,
  onAttachGetCurrentTime,
  onAttachGetIsPaused,
}) => {
  const { socket } = useSocket();
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const targetSeekPosRef = useRef<number>(room.currentPosition || 0);

  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(roomState === 'PLAYING');
  const [currentTime, setCurrentTime] = useState(room.currentPosition || 0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);

  // Change Video Modal
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [newVideoUrl, setNewVideoUrl] = useState('');
  const [isChangingVideo, setIsChangingVideo] = useState(false);
  const [changeError, setChangeError] = useState('');

  // Active YouTube ID
  const [currentYtId, setCurrentYtId] = useState<string>(room.youtubeId || '');
  const [videoTitle, setVideoTitle] = useState<string>(room.youtubeTitle || room.title);

  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Attach callbacks to parent hook
  useEffect(() => {
    onAttachSeekHandler?.((pos: number, shouldPlay?: boolean) => {
      targetSeekPosRef.current = pos;
      if (playerRef.current && isPlayerReady) {
        try {
          playerRef.current.seekTo(pos, true);
          if (shouldPlay) {
            playerRef.current.playVideo();
            setIsPlaying(true);
          } else {
            playerRef.current.pauseVideo();
            setIsPlaying(false);
          }
        } catch (e) {}
      }
    });

    onAttachPlayHandler?.(() => {
      if (playerRef.current && isPlayerReady) {
        try {
          playerRef.current.playVideo();
          setIsPlaying(true);
        } catch (e) {}
      }
    });

    onAttachPauseHandler?.(() => {
      if (playerRef.current && isPlayerReady) {
        try {
          playerRef.current.pauseVideo();
          setIsPlaying(false);
        } catch (e) {}
      }
    });

    onAttachGetCurrentTime?.(() => {
      if (playerRef.current && isPlayerReady) {
        try {
          return playerRef.current.getCurrentTime() || 0;
        } catch (e) {}
      }
      return currentTime;
    });

    onAttachGetIsPaused?.(() => {
      if (playerRef.current && isPlayerReady) {
        try {
          const state = playerRef.current.getPlayerState();
          return state !== 1; // 1 is PLAYING
        } catch (e) {}
      }
      return !isPlaying;
    });
  }, [
    isPlayerReady,
    isPlaying,
    currentTime,
    onAttachSeekHandler,
    onAttachPlayHandler,
    onAttachPauseHandler,
    onAttachGetCurrentTime,
    onAttachGetIsPaused,
  ]);

  // 2. Load YouTube IFrame API script
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag?.parentNode?.insertBefore(tag, firstScriptTag);
    }
  }, []);

  // 3. Initialize YouTube Player
  const initPlayer = useCallback((videoId: string) => {
    if (!videoId) return;

    const createYTPlayer = () => {
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch (e) {}
      }

      playerRef.current = new window.YT.Player('yt-sync-iframe-holder', {
        videoId: videoId,
        playerVars: {
          autoplay: 0,
          controls: 0,
          rel: 0,
          modestbranding: 1,
          fs: 0,
          disablekb: 1,
          iv_load_policy: 3,
          cc_load_policy: 0,
          cc_lang_pref: 'none',
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (event: any) => {
            setIsPlayerReady(true);
            const d = event.target.getDuration();
            if (d && d > 0) setDuration(d);

            // Disable subtitles explicitly
            try {
              event.target.unloadModule('captions');
              event.target.unloadModule('cc');
            } catch (e) {}

            // Seek to initial position if any
            if (room.currentPosition && room.currentPosition > 0) {
              targetSeekPosRef.current = room.currentPosition;
              event.target.seekTo(room.currentPosition, true);
            }

            if (roomState === 'PLAYING') {
              event.target.playVideo();
              setIsPlaying(true);
            } else {
              event.target.pauseVideo();
              setIsPlaying(false);
            }
          },
          onStateChange: (event: any) => {
            // Disable subtitles if loaded dynamically
            try {
              event.target.unloadModule('captions');
              event.target.unloadModule('cc');
            } catch (e) {}

            // YT.PlayerState: UNSTARTED (-1), ENDED (0), PLAYING (1), PAUSED (2), BUFFERING (3), CUED (5)
            if (event.data === 1) {
              setIsPlaying(true);
              const d = event.target.getDuration();
              if (d && d > 0) setDuration(d);
            } else if (event.data === 2 || event.data === 0) {
              setIsPlaying(false);
            }
          },
        },
      });
    };

    if (window.YT && window.YT.Player) {
      createYTPlayer();
    } else {
      window.onYouTubeIframeAPIReady = () => {
        createYTPlayer();
      };
    }
  }, [room.currentPosition, roomState]);

  useEffect(() => {
    if (currentYtId) {
      initPlayer(currentYtId);
    }

    return () => {
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch (e) {}
      }
    };
  }, [currentYtId]);

  // 4. Listen to YouTube Changed Socket Event
  useEffect(() => {
    if (!socket) return;

    const handleYtChanged = (data: any) => {
      if (data.youtubeId) {
        setCurrentYtId(data.youtubeId);
        setVideoTitle(data.youtubeTitle || data.title);
        setCurrentTime(0);
        targetSeekPosRef.current = 0;
        setIsPlaying(false);
        if (playerRef.current && isPlayerReady) {
          try {
            playerRef.current.loadVideoById(data.youtubeId, 0);
            playerRef.current.pauseVideo();
            playerRef.current.unloadModule('captions');
            playerRef.current.unloadModule('cc');
          } catch (e) {}
        }
      }
    };

    socket.on('room:youtube_changed', handleYtChanged);
    return () => {
      socket.off('room:youtube_changed', handleYtChanged);
    };
  }, [socket, isPlayerReady]);

  // 5. Periodic Time Tracker & Accurate Buffer Reporter
  useEffect(() => {
    const interval = setInterval(() => {
      if (!playerRef.current || !isPlayerReady) return;

      try {
        const cur = playerRef.current.getCurrentTime() || 0;
        const dur = playerRef.current.getDuration() || 0;
        const fraction = playerRef.current.getVideoLoadedFraction() || 0;
        const loadedSec = fraction * dur;
        const ytState = playerRef.current.getPlayerState();

        setCurrentTime(cur);
        if (dur > 0 && dur !== duration) setDuration(dur);

        // YT state: -1 (unstarted), 0 (ended), 1 (playing), 2 (paused), 3 (buffering), 5 (cued)
        const isBufferingYT = ytState === 3 || ytState === -1;
        const isCloseToSeek = Math.abs(cur - targetSeekPosRef.current) < 2.5 || targetSeekPosRef.current === 0;
        const isReady = isPlayerReady && !isBufferingYT && isCloseToSeek;

        const bufferPercent = isReady ? 100 : Math.min(99, Math.round(fraction * 100));
        onBufferStatusChange(isReady, loadedSec, cur, bufferPercent);
      } catch (e) {}
    }, 400);

    return () => clearInterval(interval);
  }, [isPlayerReady, duration, onBufferStatusChange]);

  // 6. Auto-hide Controls
  const resetControlsTimeout = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3500);
  };

  const handlePlayPauseToggle = () => {
    if (isPlaying) {
      onPauseRequest();
    } else {
      if (!allMembersReady && members.length > 1) {
        // Block play request until everyone is ready
        return;
      }
      onPlayRequest();
    }
    resetControlsTimeout();
  };

  const handleSeek = (seconds: number) => {
    const target = Math.max(0, Math.min(duration, seconds));
    targetSeekPosRef.current = target;
    setCurrentTime(target);
    if (playerRef.current && isPlayerReady) {
      try {
        playerRef.current.seekTo(target, true);
        playerRef.current.pauseVideo();
        setIsPlaying(false);
      } catch (e) {}
    }
    onSeekRequest(target);
    resetControlsTimeout();
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    setIsMuted(newVol === 0);
    if (playerRef.current && isPlayerReady) {
      try {
        playerRef.current.setVolume(newVol * 100);
        if (newVol === 0) playerRef.current.mute();
        else playerRef.current.unMute();
      } catch (e) {}
    }
  };

  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      handleVolumeChange(volume || 0.5);
    } else {
      setIsMuted(true);
      if (playerRef.current && isPlayerReady) {
        playerRef.current.mute();
      }
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const handleChangeVideoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVideoUrl.trim() || !socket) return;

    setChangeError('');
    setIsChangingVideo(true);

    socket.emit('room:change_youtube', {
      roomId: room.id,
      youtubeUrl: newVideoUrl.trim(),
    });

    setTimeout(() => {
      setIsChangingVideo(false);
      setShowChangeModal(false);
      setNewVideoUrl('');
    }, 600);
  };

  const formatTime = (sec: number) => {
    if (!sec || isNaN(sec)) return '00:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) {
      return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const isBlockedByBuffer = !isPlaying && !allMembersReady && members.length > 1;

  return (
    <div
      ref={containerRef}
      onMouseMove={resetControlsTimeout}
      onClick={resetControlsTimeout}
      className="relative w-full h-full bg-black select-none overflow-hidden group flex items-center justify-center"
    >
      {/* YouTube IFrame Holder */}
      <div className="absolute inset-0 w-full h-full pointer-events-none flex items-center justify-center">
        <div id="yt-sync-iframe-holder" className="w-full h-full scale-[1.01] pointer-events-none" />
      </div>

      {/* Transparent Click Overlay to Intercept Play/Pause */}
      <div
        onClick={handlePlayPauseToggle}
        className="absolute inset-0 z-10 cursor-pointer"
      />

      {/* Buffer Barrier Readiness Banner */}
      <BufferBarrierBanner
        isVisible={!isPlaying && members.length > 1}
        members={members}
        isHost={isHost}
        onForcePlay={() => {
          if (isHost) onPlayRequest();
        }}
      />

      {/* Synchronized Flying Reactions Overlay */}
      {reactions && reactions.length > 0 && (
        <ReactionOverlay reactions={reactions} />
      )}

      {/* TOP BAR OVERLAY */}
      <div
        className={`absolute top-0 left-0 right-0 p-4 md:p-6 bg-gradient-to-b from-black/90 via-black/50 to-transparent z-30 transition-opacity duration-300 flex items-center justify-between ${
          showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Left: Back & Title */}
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          <button
            onClick={onBack}
            className="p-2 md:p-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white transition-all backdrop-blur-md cursor-pointer shrink-0"
            title="Выйти из комнаты"
          >
            <ArrowLeft className="w-4 h-4 md:w-5 md:h-5" />
          </button>

          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className="bg-red-600 text-white font-extrabold text-[10px] uppercase px-2 py-0.5 rounded-md flex items-center gap-1 shadow-md shrink-0">
                <Video className="w-3 h-3 fill-current" />
                YouTube
              </span>
              <span className="bg-cinema-gold/15 text-cinema-gold font-mono text-[10px] font-bold px-2 py-0.5 rounded-md border border-cinema-gold/30 shrink-0">
                {room.code}
              </span>
            </div>
            <h2 className="text-xs md:text-sm font-bold text-white truncate max-w-xs sm:max-w-md md:max-w-lg mt-0.5">
              {videoTitle}
            </h2>
          </div>
        </div>

        {/* Right: Actions (Change video, Invite, Sync, Sidebar) */}
        <div className="flex items-center gap-2 shrink-0">
          {isHost && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowChangeModal(true);
              }}
              className="px-3 py-1.5 rounded-xl bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white border border-red-500/30 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
              title="Сменить YouTube видео для всех участников"
            >
              <Video className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Сменить видео</span>
            </button>
          )}

          {isHost && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onForceSyncAll();
              }}
              className="p-2 rounded-xl bg-white/10 hover:bg-cinema-gold hover:text-black text-slate-200 transition-all cursor-pointer"
              title="Синхронизировать всех участников по мне"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onInvite();
            }}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 transition-all cursor-pointer"
            title="Пригласить друзей"
          >
            <Share2 className="w-4 h-4" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSidebar();
            }}
            className={`p-2 rounded-xl transition-all cursor-pointer ${
              isSidebarOpen ? 'bg-cinema-gold text-black' : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }`}
            title="Чат и список участников"
          >
            <Users className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* BOTTOM CONTROLS BAR */}
      <div
        className={`absolute bottom-0 left-0 right-0 p-4 md:p-6 bg-gradient-to-t from-black/95 via-black/70 to-transparent z-30 transition-opacity duration-300 flex flex-col gap-3 ${
          showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Timeline Scrubber */}
        <div className="flex items-center gap-3 group/timeline">
          <span className="text-[11px] font-mono text-slate-300 w-12 text-right">
            {formatTime(currentTime)}
          </span>

          <div
            className="flex-1 h-2 hover:h-3 bg-white/20 rounded-full cursor-pointer relative transition-all"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pos = ((e.clientX - rect.left) / rect.width) * duration;
              handleSeek(pos);
            }}
          >
            <div
              className="h-full bg-red-600 rounded-full relative shadow-[0_0_12px_rgba(220,38,38,0.8)]"
              style={{ width: `${progressPercent}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-md scale-0 group-hover/timeline:scale-100 transition-transform" />
            </div>
          </div>

          <span className="text-[11px] font-mono text-slate-400 w-12">
            {formatTime(duration)}
          </span>
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between">
          {/* Left: Play/Pause, Rewind, Forward, Volume */}
          <div className="flex items-center gap-3">
            {/* Play/Pause Button with readiness state */}
            {isBlockedByBuffer ? (
              <button
                disabled
                className="p-2.5 md:p-3 rounded-2xl bg-amber-500/20 text-amber-300 border border-amber-500/30 opacity-80 cursor-not-allowed flex items-center justify-center"
                title="Ожидание загрузки у всех участников..."
              >
                <Clock className="w-5 h-5 animate-pulse" />
              </button>
            ) : (
              <button
                onClick={handlePlayPauseToggle}
                className="p-2.5 md:p-3 rounded-2xl bg-white text-black hover:bg-cinema-gold hover:text-black transition-all active:scale-95 shadow-glow-gold cursor-pointer"
                title={isPlaying ? 'Пауза' : 'Снять с паузы'}
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
              </button>
            )}

            <button
              onClick={() => handleSeek(currentTime - 10)}
              className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Назад на 10 сек"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              onClick={() => handleSeek(currentTime + 10)}
              className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Вперед на 10 сек"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            {/* Volume */}
            <div className="flex items-center gap-2 group/volume ml-2">
              <button
                onClick={toggleMute}
                className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                className="w-16 md:w-24 h-1.5 bg-white/20 accent-red-600 rounded-lg cursor-pointer"
              />
            </div>
          </div>

          {/* Right: Sync Status badge & Fullscreen */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-black/60 border border-white/10 text-[11px] font-mono text-slate-300">
              <span className={`w-2 h-2 rounded-full ${!allMembersReady && members.length > 1 ? 'bg-amber-400 animate-spin' : syncQuality === 'perfect' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              <span>{!allMembersReady && members.length > 1 ? 'Буферизация' : syncQuality === 'perfect' ? 'Синхронизировано' : 'Подгонка'}</span>
            </div>

            <button
              onClick={toggleFullscreen}
              className="p-2.5 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Полноэкранный режим"
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* CHANGE YOUTUBE VIDEO MODAL (Host only) */}
      {showChangeModal && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in"
        >
          <div className="bg-cinema-900 border border-white/15 rounded-3xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-red-600/20 text-red-500 flex items-center justify-center">
                  <Video className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-white">Сменить YouTube видео</h3>
              </div>
              <button
                onClick={() => setShowChangeModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400 mb-4">
              Вставьте новую ссылку на видео YouTube. Воспроизведение мгновенно переключится у всех участников комнаты.
            </p>

            {changeError && (
              <div className="p-3 mb-3 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{changeError}</span>
              </div>
            )}

            <form onSubmit={handleChangeVideoSubmit} className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Ссылка на видео
                </label>
                <input
                  type="text"
                  required
                  placeholder="https://www.youtube.com/watch?v=... или youtu.be/..."
                  value={newVideoUrl}
                  onChange={(e) => setNewVideoUrl(e.target.value)}
                  className="w-full bg-cinema-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-red-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => setShowChangeModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isChangingVideo || !newVideoUrl.trim()}
                  className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-lg transition-all disabled:opacity-50 cursor-pointer"
                >
                  {isChangingVideo ? 'Переключение...' : 'Включить для всех'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
