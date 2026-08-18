import React from 'react';
import { Play, Users, Star, Info, Film } from 'lucide-react';
import { MediaItem } from '../../types';

interface MediaCardProps {
  media: MediaItem;
  onPlayDirect: (media: MediaItem) => void;
  onCreateRoom: (media: MediaItem) => void;
  onOpenDetails: (media: MediaItem) => void;
}

export const MediaCard: React.FC<MediaCardProps> = ({
  media,
  onPlayDirect,
  onCreateRoom,
  onOpenDetails,
}) => {
  const hasProgress = media.userProgress && media.durationSeconds && media.userProgress > 15;
  const progressPercent = hasProgress
    ? Math.min(100, Math.round((media.userProgress! / media.durationSeconds) * 100))
    : 0;

  return (
    <div className="group relative flex flex-col rounded-2xl overflow-hidden bg-cinema-900 border border-white/10 hover:border-cinema-gold/50 shadow-cinema-card transition-all duration-300 hover:-translate-y-1.5">
      {/* Poster Image Container */}
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-cinema-950">
        {media.posterPath ? (
          <img
            src={media.posterPath}
            alt={media.title}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-4 text-slate-500 bg-gradient-to-br from-cinema-900 to-cinema-950">
            <Film className="w-10 h-10 text-cinema-gold/30 mb-2" />
            <span className="text-xs text-center line-clamp-2 text-slate-300 font-semibold">{media.title}</span>
          </div>
        )}

        {/* Top Badges (Rating, Quality) */}
        <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between pointer-events-none">
          {media.rating && media.rating > 0 ? (
            <span className="flex items-center gap-1 text-[11px] font-bold bg-black/70 backdrop-blur-md text-cinema-gold px-2 py-0.5 rounded-lg border border-white/10">
              <Star className="w-3 h-3 fill-cinema-gold" />
              {media.rating.toFixed(1)}
            </span>
          ) : <span />}

          {media.resolution && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-200 bg-black/70 backdrop-blur-md px-1.5 py-0.5 rounded-lg border border-white/10">
              {media.resolution}
            </span>
          )}
        </div>

        {/* Progress Bar */}
        {hasProgress && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
            <div
              className="h-full bg-cinema-gold shadow-[0_0_8px_rgba(229,160,13,0.9)]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}

        {/* Hover Action Overlay */}
        <div className="absolute inset-0 bg-black/75 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center gap-2 p-3">
          <button
            onClick={() => onPlayDirect(media)}
            className="w-12 h-12 rounded-full bg-cinema-gold text-black flex items-center justify-center shadow-glow-gold hover:scale-110 active:scale-95 transition-transform"
            title="Воспроизвести прямо сейчас"
          >
            <Play className="w-5 h-5 fill-current ml-0.5" />
          </button>

          <button
            onClick={() => onCreateRoom(media)}
            className="w-full py-2 px-3 rounded-xl bg-white/15 hover:bg-white/25 text-white font-semibold text-xs flex items-center justify-center gap-1.5 border border-white/15 backdrop-blur-md transition-colors"
          >
            <Users className="w-3.5 h-3.5 text-cinema-gold" />
            <span>Смотреть вместе</span>
          </button>

          <button
            onClick={() => onOpenDetails(media)}
            className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 mt-1 transition-colors"
          >
            <Info className="w-3 h-3" />
            <span>Инфо</span>
          </button>
        </div>
      </div>

      {/* Title & Metadata */}
      <div className="p-3 flex flex-col flex-1 justify-between">
        <h3 className="text-xs font-bold text-slate-200 group-hover:text-cinema-gold transition-colors line-clamp-1">
          {media.title}
        </h3>
        <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
          <span>{media.year || 'Фильм'}</span>
          {media.videoCodec && (
            <span className="uppercase text-[10px] text-slate-500 font-mono">
              {media.videoCodec}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
