import React, { useState, useRef, useCallback } from 'react';
import {
  Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX,
  Maximize, Minimize, ArrowLeft, Users, Share2,
  Video, AlertCircle, X, Zap
} from 'lucide-react';
import { useSocket } from '../../context/SocketContext';
import { Room, RoomMember, RoomReaction, RoomState } from '../../types';
import { ReactionOverlay } from './ReactionOverlay';
import { YouTubeIFrameEngine } from './youtube/YouTubeIFrameEngine';
import { YouTubeStreamEngine } from './youtube/YouTubeStreamEngine';

interface YouTubeSyncPlayerProps {
  room: Room;
  roomState: RoomState;
  isHost: boolean;
  onForceSyncAll: () => void;
  onSyncToHost: () => void;
  members: RoomMember[];
  currentUserId?: string;
  hostUserId: string;
  reactions: RoomReaction[];
  onPlayRequest: () => void;
  onPauseRequest: () => void;
  onSeekRequest: (pos: number) => void;
  onToggleSidebar: () => void;
  isSidebarOpen: boolean;
  onBack: () => void;
  onInvite: () => void;
  onAttachSeekHandler?: (fn: (pos: number, shouldPlay?: boolean) => void) => void;
  onAttachPlayHandler?: (fn: () => void) => void;
  onAttachPauseHandler?: (fn: () => void) => void;
  onAttachGetCurrentTime?: (fn: () => number) => void;
  onAttachGetIsPaused?: (fn: () => boolean) => void;
}

export const YouTubeSyncPlayer: React.FC<YouTubeSyncPlayerProps> = ({
  room,
  roomState,
  isHost,
  onForceSyncAll,
  reactions,
  onPlayRequest,
  onPauseRequest,
  onSeekRequest,
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

  const [engine, setEngine] = useState<'iframe' | 'server_stream'>('iframe');
  const [currentYtId, setCurrentYtId] = useState<string>(room.youtubeId || '');
  const [videoTitle] = useState<string>(room.youtubeTitle || room.title);

  const [isPlaying, setIsPlaying] = useState(roomState === 'PLAYING');
  const [currentTime, setCurrentTime] = useState(room.currentPosition || 0);
  const [duration, setDuration] = useState(room.durationSeconds || 0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);

  // Change Video Modal
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [newVideoUrl, setNewVideoUrl] = useState('');
  const [isChangingVideo, setIsChangingVideo] = useState(false);
  const [changeError, setChangeError] = useState('');

  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
      onPlayRequest();
    }
    resetControlsTimeout();
  };

  const handleSeek = (seconds: number) => {
    const target = Math.max(0, Math.min(duration || 99999, seconds));
    setCurrentTime(target);
    onSeekRequest(target);
    resetControlsTimeout();
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    setIsMuted(newVol === 0);
  };

  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      setVolume(volume || 0.5);
    } else {
      setIsMuted(true);
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
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      onMouseMove={resetControlsTimeout}
      onClick={resetControlsTimeout}
      className="relative w-full h-full bg-black select-none overflow-hidden group flex items-center justify-center"
    >
      {engine === 'iframe' && (
        <YouTubeIFrameEngine
          videoId={currentYtId}
          roomState={roomState}
          initialPosition={room.currentPosition || 0}
          volume={volume}
          isMuted={isMuted}
          onTimeUpdate={(cur, dur) => {
            setCurrentTime(cur);
            if (dur > 0) setDuration(dur);
          }}
          onPlayingChange={(playing) => setIsPlaying(playing)}
          onAgeRestrictedFallback={() => setEngine('server_stream')}
          onAttachSeekHandler={onAttachSeekHandler}
          onAttachPlayHandler={onAttachPlayHandler}
          onAttachPauseHandler={onAttachPauseHandler}
          onAttachGetCurrentTime={onAttachGetCurrentTime}
          onAttachGetIsPaused={onAttachGetIsPaused}
        />
      )}

      {engine === 'server_stream' && (
        <YouTubeStreamEngine
          videoId={currentYtId}
          roomState={roomState}
          initialPosition={room.currentPosition || 0}
          volume={volume}
          isMuted={isMuted}
          onTimeUpdate={(cur, dur) => {
            setCurrentTime(cur);
            if (dur > 0) setDuration(dur);
          }}
          onPlayingChange={(playing) => setIsPlaying(playing)}
          onAttachSeekHandler={onAttachSeekHandler}
          onAttachPlayHandler={onAttachPlayHandler}
          onAttachPauseHandler={onAttachPauseHandler}
          onAttachGetCurrentTime={onAttachGetCurrentTime}
          onAttachGetIsPaused={onAttachGetIsPaused}
        />
      )}

      {/* Transparent Click Overlay to Intercept Play/Pause */}
      <div
        onClick={handlePlayPauseToggle}
        className="absolute inset-0 z-10 cursor-pointer"
      />

      {/* Flying Reactions Overlay */}
      {reactions && reactions.length > 0 && (
        <ReactionOverlay reactions={reactions} />
      )}

      {/* Top Controls Overlay */}
      <div
        className={`absolute top-0 left-0 right-0 p-4 md:p-6 bg-gradient-to-b from-black/90 via-black/50 to-transparent z-30 transition-opacity duration-300 flex items-center justify-between ${
          showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          <button
            onClick={onBack}
            className="p-2 md:p-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer shrink-0"
            title="Выйти"
          >
            <ArrowLeft className="w-4 h-4 md:w-5 md:h-5" />
          </button>

          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className="bg-red-600 text-white font-extrabold text-[10px] uppercase px-2 py-0.5 rounded-md flex items-center gap-1">
                <Video className="w-3 h-3 fill-current" /> YouTube
              </span>
              {engine === 'server_stream' && (
                <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5 fill-current" /> 1080p Bypass
                </span>
              )}
            </div>
            <h2 className="text-xs md:text-sm font-bold text-white truncate max-w-xs sm:max-w-md md:max-w-lg mt-0.5">
              {videoTitle}
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {engine === 'iframe' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEngine('server_stream');
              }}
              className="px-2.5 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold hidden sm:flex items-center gap-1.5 cursor-pointer"
              title="Переключить на 1080p стрим"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>1080p Bypass</span>
            </button>
          )}

          {isHost && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowChangeModal(true);
              }}
              className="px-3 py-1.5 rounded-xl bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white border border-red-500/30 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Video className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Сменить видео</span>
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onInvite();
            }}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 cursor-pointer"
            title="Пригласить друзей"
          >
            <Share2 className="w-4 h-4" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSidebar();
            }}
            className={`p-2 rounded-xl cursor-pointer ${
              isSidebarOpen ? 'bg-cinema-gold text-black' : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }`}
            title="Чат"
          >
            <Users className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Bottom Controls Bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 p-4 md:p-6 bg-gradient-to-t from-black/95 via-black/70 to-transparent z-30 transition-opacity duration-300 flex flex-col gap-3 ${
          showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Timeline Scrubber */}
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-mono text-slate-300 w-12 text-right">
            {formatTime(currentTime)}
          </span>

          <div
            className="flex-1 h-2 bg-white/20 rounded-full cursor-pointer relative"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pos = ((e.clientX - rect.left) / rect.width) * (duration || 1);
              handleSeek(pos);
            }}
          >
            <div
              className="h-full bg-red-600 rounded-full relative"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <span className="text-[11px] font-mono text-slate-400 w-12">
            {formatTime(duration)}
          </span>
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={handlePlayPauseToggle}
              className="p-2.5 md:p-3 rounded-2xl bg-white text-black hover:bg-cinema-gold transition-all cursor-pointer"
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </button>

            <button
              onClick={() => handleSeek(currentTime - 10)}
              className="p-2 rounded-xl text-slate-300 hover:text-white cursor-pointer"
              title="Назад 10с"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              onClick={() => handleSeek(currentTime + 10)}
              className="p-2 rounded-xl text-slate-300 hover:text-white cursor-pointer"
              title="Вперед 10с"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 ml-2">
              <button onClick={toggleMute} className="p-2 text-slate-300 hover:text-white cursor-pointer">
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

          <button
            onClick={toggleFullscreen}
            className="p-2.5 rounded-xl text-slate-300 hover:text-white cursor-pointer"
            title="Полноэкранный режим"
          >
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Change Video Modal */}
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
              <button onClick={() => setShowChangeModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {changeError && (
              <div className="p-3 mb-3 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{changeError}</span>
              </div>
            )}

            <form onSubmit={handleChangeVideoSubmit} className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Ссылка на видео</label>
                <input
                  type="text"
                  required
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={newVideoUrl}
                  onChange={(e) => setNewVideoUrl(e.target.value)}
                  className="w-full bg-cinema-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-red-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => setShowChangeModal(false)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isChangingVideo || !newVideoUrl.trim()}
                  className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs cursor-pointer"
                >
                  {isChangingVideo ? 'Переключение...' : 'Включить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
