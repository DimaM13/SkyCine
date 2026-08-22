import React from 'react';
import { Play, Users, Star, Clock, Film } from 'lucide-react';
import { MediaItem } from '../../types';

interface HeroBannerProps {
 media: MediaItem | null;
 onPlayDirect: (media: MediaItem) => void;
 onCreateRoom: (media: MediaItem) => void;
 onOpenDetails: (media: MediaItem) => void;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({
 media,
 onPlayDirect,
 onCreateRoom,
 onOpenDetails,
}) => {
 if (!media) {
 return (
 <div className="w-full h-80 md:h-[450px] bg-cinema-900 rounded-3xl border border-white/10 flex flex-col items-center justify-center text-slate-400 p-6">
 <Film className="w-12 h-12 text-cinema-gold/40 mb-3" />
 <h2 className="text-lg font-bold text-white mb-1">Медиатека пуста или сканируется</h2>
 <p className="text-xs text-slate-400 max-w-md text-center">
 Перейдите в панель управления сервером, добавьте папки с фильмами на диске и запустите сканирование.
 </p>
 </div>
 );
 }

 const formatDuration = (secs: number) => {
 const h = Math.floor(secs / 3600);
 const m = Math.floor((secs % 3600) / 60);
 return `${h > 0 ? `${h}ч ` : ''}${m}мин`;
 };

 const backdropUrl = media.backdropPath || media.posterPath;

 return (
 <div className="relative w-full h-80 md:h-[480px] rounded-3xl overflow-hidden shadow-2xl border border-white/10 group mb-8">
 {/* Background Backdrop Image */}
 {backdropUrl && (
 <img
 src={backdropUrl}
 alt={media.title}
 className="absolute inset-0 w-full h-full object-cover object-top scale-105 group-hover:scale-100 transition-transform duration-1000 filter brightness-90"
 />
 )}

 {/* Cinematic Gradient Overlays */}
 <div className="absolute inset-0 bg-gradient-to-r from-cinema-950 via-cinema-950/70 to-transparent" />
 <div className="absolute inset-0 bg-gradient-to-t from-cinema-950 via-transparent to-transparent" />

 {/* Content */}
 <div className="absolute inset-0 p-8 md:p-12 flex flex-col justify-end max-w-2xl z-10">
 {/* Badges */}
 <div className="flex flex-wrap items-center gap-2.5 mb-3">
 {media.rating && media.rating > 0 && (
 <span className="flex items-center gap-1 text-xs font-bold bg-cinema-gold text-black px-2.5 py-1 rounded-full shadow-glow-gold">
 <Star className="w-3.5 h-3.5 fill-black" />
 {media.rating.toFixed(1)}
 </span>
 )}

 {media.resolution && (
 <span className="text-xs font-bold uppercase tracking-wider text-slate-200 bg-white/10 px-2.5 py-1 rounded-full border border-white/10">
 {media.resolution}
 </span>
 )}

 {media.year && (
 <span className="text-xs text-slate-300 bg-white/5 px-2.5 py-1 rounded-full border border-white/5">
 {media.year}
 </span>
 )}

 {media.durationSeconds > 0 && (
 <span className="text-xs text-slate-300 flex items-center gap-1 bg-white/5 px-2.5 py-1 rounded-full border border-white/5">
 <Clock className="w-3 h-3" />
 {formatDuration(media.durationSeconds)}
 </span>
 )}
 </div>

 {/* Title */}
 <h1 className="text-3xl md:text-5xl font-extrabold text-white tracking-tight mb-3 line-clamp-2 drop-shadow-md">
 {media.title}
 </h1>

 {/* Overview */}
 {media.overview && (
 <p className="text-xs md:text-sm text-slate-300 line-clamp-3 mb-6 leading-relaxed drop-shadow">
 {media.overview}
 </p>
 )}

 {/* Action Buttons */}
 <div className="flex flex-wrap items-center gap-3">
 <button
 onClick={() => onPlayDirect(media)}
 className="px-6 py-3 rounded-2xl bg-cinema-gold text-black font-bold text-sm flex items-center gap-2 shadow-glow-gold hover:bg-yellow-400 hover:scale-105 active:scale-95 transition-all"
 >
 <Play className="w-4 h-4 fill-current ml-0.5" />
 <span>Смотреть</span>
 </button>

 <button
 onClick={() => onCreateRoom(media)}
 className="px-6 py-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-semibold text-sm flex items-center gap-2 border border-white/15 hover:scale-105 active:scale-95 transition-all"
 >
 <Users className="w-4 h-4 text-cinema-gold" />
 <span>Смотреть с друзьями</span>
 </button>

 <button
 onClick={() => onOpenDetails(media)}
 className="px-4 py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs font-semibold border border-white/5 transition-all"
 >
 Подробнее
 </button>
 </div>
 </div>
 </div>
 );
};
