import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Play, RotateCcw, Users, Clock, Star, Film, Tv, CheckCircle2,
  Volume2, Subtitles, Layers, Sparkles
} from 'lucide-react';
import { MediaItem } from '../../types';
import { apiClient } from '../../api/client';

interface EpisodeModalProps {
  episode: MediaItem | null;
  showTitle?: string;
  isOpen: boolean;
  onClose: () => void;
  onPlayDirect?: (media: MediaItem, startPos?: number) => void;
  onCreateRoom?: (media: MediaItem) => void;
}

export const EpisodeModal: React.FC<EpisodeModalProps> = ({
  episode,
  showTitle,
  isOpen,
  onClose,
  onPlayDirect,
  onCreateRoom,
}) => {
  const navigate = useNavigate();

  if (!isOpen || !episode) return null;

  const userProgress = (episode as any).userProgress || 0;
  const duration = episode.durationSeconds || 0;
  const progressPercent = duration > 0 && userProgress > 15
    ? Math.min(100, Math.round((userProgress / duration) * 100))
    : 0;

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleStartPlay = (resume: boolean) => {
    const startPos = resume ? userProgress : 0;
    if (onPlayDirect) {
      onPlayDirect(episode, startPos);
    } else {
      navigate(`/watch/${episode.id}${startPos > 0 ? `?start=${Math.floor(startPos)}` : '?start=0'}`);
    }
    onClose();
  };

  const handleCreateRoomAction = async () => {
    if (onCreateRoom) {
      onCreateRoom(episode);
      onClose();
      return;
    }

    try {
      const res = await apiClient.post('/rooms', {
        mediaItemId: episode.id,
        title: `${showTitle || episode.showTitle || 'Сериал'} - S${episode.seasonNumber || 1}E${episode.episodeNumber || 1}: ${episode.title}`,
      });
      navigate(`/rooms/${res.data.room.code}`);
      onClose();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка создания совместной комнаты');
    }
  };

  const episodePoster = episode.stillPath || episode.posterPath || `/api/media/item/${episode.id}/thumbnail`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl bg-cinema-900 border border-white/15 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 p-2 rounded-full bg-black/60 text-slate-300 hover:text-white hover:bg-black/90 border border-white/10 transition-all cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Episode Still / Thumbnail Banner */}
        <div className="relative aspect-video w-full bg-cinema-950 overflow-hidden shrink-0">
          <img
            src={episodePoster}
            alt={episode.title}
            onError={(e) => {
              // If image fails, fallback to thumbnail generator
              (e.currentTarget as HTMLImageElement).src = `/api/media/item/${episode.id}/thumbnail`;
            }}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-cinema-900 via-cinema-900/30 to-transparent" />

          {/* Badges on Banner */}
          <div className="absolute top-4 left-4 flex items-center gap-2">
            <span className="bg-cinema-gold text-black font-black text-xs px-2.5 py-1 rounded-lg shadow-glow-gold">
              Сезон {episode.seasonNumber || 1} • Серия {episode.episodeNumber || 1}
            </span>
            {episode.rating && episode.rating > 0 && (
              <span className="flex items-center gap-1 bg-black/70 backdrop-blur-md text-cinema-gold font-bold text-xs px-2 py-1 rounded-lg border border-white/10">
                <Star className="w-3.5 h-3.5 fill-current" />
                {episode.rating.toFixed(1)}
              </span>
            )}
          </div>

          {/* Quick Play overlay icon on banner */}
          <button
            onClick={() => handleStartPlay(progressPercent > 0)}
            className="absolute inset-0 m-auto w-14 h-14 rounded-full bg-cinema-gold text-black flex items-center justify-center shadow-glow-gold hover:scale-110 active:scale-95 transition-all cursor-pointer group"
          >
            <Play className="w-6 h-6 fill-current ml-0.5" />
          </button>

          {/* Progress Bar on Bottom of Banner */}
          {progressPercent > 0 && (
            <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-white/20">
              <div className="h-full bg-cinema-gold" style={{ width: `${progressPercent}%` }} />
            </div>
          )}
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex flex-col gap-5">
          {/* Header Info */}
          <div>
            <span className="text-xs font-bold text-cinema-gold tracking-wide uppercase block mb-1">
              {showTitle || episode.showTitle || 'Сериал'}
            </span>
            <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight leading-snug">
              {episode.title}
            </h2>

            {/* Technical Metadata Pills */}
            <div className="flex items-center gap-2.5 mt-2.5 flex-wrap text-xs text-slate-300">
              {duration > 0 && (
                <span className="flex items-center gap-1 bg-white/5 px-2.5 py-1 rounded-lg border border-white/10 font-mono text-[11px]">
                  <Clock className="w-3.5 h-3.5 text-cinema-gold" />
                  {formatTime(duration)}
                </span>
              )}
              {episode.resolution && (
                <span className="bg-white/5 px-2.5 py-1 rounded-lg border border-white/10 font-mono text-[11px] text-cinema-gold font-bold">
                  {episode.resolution}
                </span>
              )}
              {episode.videoCodec && (
                <span className="bg-white/5 px-2.5 py-1 rounded-lg border border-white/10 font-mono text-[11px] uppercase">
                  {episode.videoCodec}
                </span>
              )}
              {episode.audioCodec && (
                <span className="bg-white/5 px-2.5 py-1 rounded-lg border border-white/10 font-mono text-[11px] uppercase">
                  {episode.audioCodec}
                </span>
              )}
            </div>
          </div>

          {/* Progress Indicator Card if watched */}
          {progressPercent > 0 && (
            <div className="p-3.5 rounded-2xl bg-cinema-gold/10 border border-cinema-gold/25 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-cinema-gold shrink-0" />
                <div className="text-xs">
                  <span className="text-white font-bold block">
                    Вы остановились на {formatTime(userProgress)}
                  </span>
                  <span className="text-slate-400 text-[11px]">
                    Осталось {Math.max(1, Math.round((duration - userProgress) / 60))} мин ({progressPercent}%)
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold text-cinema-gold bg-cinema-gold/20 px-2 py-0.5 rounded-md">
                В процессе
              </span>
            </div>
          )}

          {/* Overview / Synopsis */}
          {episode.overview ? (
            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Описание серии</h4>
              <p className="text-xs md:text-sm text-slate-300 leading-relaxed">
                {episode.overview}
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic">
              Описание серии не указано. Нажмите «Исправить сопоставление» в заголовке сериала для загрузки из TMDB.
            </p>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3 pt-3 border-t border-white/10">
            {progressPercent > 0 ? (
              <>
                <button
                  onClick={() => handleStartPlay(true)}
                  className="w-full sm:flex-1 py-3 px-4 rounded-xl bg-cinema-gold text-black hover:bg-yellow-400 font-extrabold text-xs flex items-center justify-center gap-2 shadow-glow-gold transition-all active:scale-95 cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                  <span>Продолжить с {formatTime(userProgress)}</span>
                </button>

                <button
                  onClick={() => handleStartPlay(false)}
                  className="w-full sm:w-auto py-3 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs flex items-center justify-center gap-2 border border-white/15 transition-colors cursor-pointer"
                  title="Начать воспроизведение с 00:00"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>С начала</span>
                </button>
              </>
            ) : (
              <button
                onClick={() => handleStartPlay(false)}
                className="w-full sm:flex-1 py-3 px-4 rounded-xl bg-cinema-gold text-black hover:bg-yellow-400 font-extrabold text-xs flex items-center justify-center gap-2 shadow-glow-gold transition-all active:scale-95 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current ml-0.5" />
                <span>Смотреть серию</span>
              </button>
            )}

            <button
              onClick={handleCreateRoomAction}
              className="w-full sm:w-auto py-3 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-cinema-gold font-bold text-xs flex items-center justify-center gap-2 border border-cinema-gold/30 hover:border-cinema-gold transition-all cursor-pointer"
              title="Создать комнату для совместного просмотра с друзьями"
            >
              <Users className="w-4 h-4" />
              <span>Смотреть вместе</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
