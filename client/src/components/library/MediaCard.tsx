import React from 'react';
import { Star, Film } from 'lucide-react';
import { MediaItem } from '../../types';

interface MediaCardProps {
  media: MediaItem;
  onPlayDirect?: (media: MediaItem) => void;
  onCreateRoom?: (media: MediaItem) => void;
  onOpenDetails: (media: MediaItem) => void;
}

export const MediaCard: React.FC<MediaCardProps> = ({
  media,
  onOpenDetails,
}) => {
  const userProgress = (media as any).userProgress || 0;
  const duration = media.durationSeconds || 0;
  const hasProgress = userProgress > 15 && duration > 0;
  const progressPercent = hasProgress
    ? Math.min(100, Math.round((userProgress / duration) * 100))
    : 0;

  const formatDuration = (secs: number) => {
    if (!secs || isNaN(secs)) return '';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h > 0) return `${h} ч ${m} мин`;
    return `${m} мин`;
  };

  return (
    <div
      onClick={() => onOpenDetails(media)}
      className="group relative flex flex-col rounded-2xl overflow-hidden bg-cinema-900 border border-white/10 hover:border-cinema-gold/50 shadow-cinema-card transition-all duration-300 hover:-translate-y-1.5 cursor-pointer select-none"
    >
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
        <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between pointer-events-none z-10">
          {media.rating && media.rating > 0 ? (
            <span className="flex items-center gap-1 text-[11px] font-black bg-black/75 backdrop-blur-md text-cinema-gold px-2 py-0.5 rounded-lg border border-white/10 shadow-lg">
              <Star className="w-3 h-3 fill-cinema-gold" />
              {media.rating.toFixed(1)}
            </span>
          ) : <span />}

          {media.resolution && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-200 bg-black/75 backdrop-blur-md px-2 py-0.5 rounded-lg border border-white/10 shadow-lg font-mono">
              {media.resolution}
            </span>
          )}
        </div>

        {/* Progress Bar (if partially watched) */}
        {hasProgress && (
          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/50 z-10">
            <div
              className="h-full bg-cinema-gold shadow-[0_0_8px_rgba(229,160,13,0.9)]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>

      {/* Title & Symmetrical Sub-Row */}
      <div className="p-3 flex flex-col flex-1 justify-between gap-1.5">
        <h3 className="text-xs font-bold text-slate-200 group-hover:text-cinema-gold transition-colors line-clamp-1">
          {media.title}
        </h3>

        <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium">
          <div className="flex items-center gap-1.5">
            {media.year ? <span>{media.year}</span> : <span>Фильм</span>}
            {duration > 0 && (
              <>
                <span className="opacity-40">•</span>
                <span>{formatDuration(duration)}</span>
              </>
            )}
          </div>

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
