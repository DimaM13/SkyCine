import { LazyImage } from '../components/library/LazyImage';
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
 Film, Tv, Video, Radio, Clock, Play, Users, Star, Layers, Sparkles, Clapperboard
} from 'lucide-react';
import { apiClient } from '../api/client';
import { HeroBanner } from '../components/library/HeroBanner';
import { plural } from '../utils/plural';
import { MediaCard } from '../components/library/MediaCard';
import { MediaModal } from '../components/library/MediaModal';
import { MediaItem, ContinueWatchingItem, Room, Library } from '../types';
import { useScrollRestore } from '../hooks/useScrollRestore';
import { useAuth } from '../context/AuthContext';

interface LibrarySectionData {
 library: Library;
 items: any[];
}

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  // Stale-while-revalidate как в LibraryPage: возврат из плеера показывает
  // прошлый контент сразу, без спиннера на всю страницу, данные едут фоном.
  // (Обязан стоять ВЫШЕ useState-инициализаторов — иначе TDZ ReferenceError.)
  const cached = React.useMemo(() => {
    try {
      const raw = sessionStorage.getItem('skycine_home_cache');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && Array.isArray(parsed.librarySections) ? parsed : null;
    } catch {
      return null;
    }
  }, []);
  const [continueWatching, setContinueWatching] = useState<ContinueWatchingItem[]>(() => cached?.continueWatching || []);
  const [activeRooms, setActiveRooms] = useState<Room[]>(() => cached?.activeRooms || []);
  const [librarySections, setLibrarySections] = useState<LibrarySectionData[]>(() => cached?.librarySections || []);
  const [featuredMovie, setFeaturedMovie] = useState<MediaItem | null>(() => cached?.featuredMovie || null);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(() => !cached);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const homeStaleRef = useRef(false);

 // Возврат скролла после ухода в плеер (App сбрасывает в 0 при навигации)
 useScrollRestore('skycine_home_scroll', !loading);

  // Кэш вкладки для мгновенного возврата (см. cached выше)
  useEffect(() => {
    if (loading) return;
    try {
      sessionStorage.setItem(
        'skycine_home_cache',
        JSON.stringify({ continueWatching, activeRooms, librarySections, featuredMovie, at: Date.now() })
      );
    } catch {}
  }, [continueWatching, activeRooms, librarySections, featuredMovie, loading]);

  const fetchHomeData = async (opts?: { silent?: boolean }) => {
  const silent = !!opts?.silent;
  if (!silent) setLoading(true);
  setFetchError(null);
  try {
  const [cwRes, roomsRes, libsRes] = await Promise.all([
  apiClient.get('/media/continue-watching').catch(() => ({ data: { items: [] } })),
  apiClient.get('/rooms').catch(() => ({ data: { rooms: [] } })),
  apiClient.get('/libraries').catch(() => ({ data: { libraries: [] } })),
  ]);

  if (homeStaleRef.current) return;
  setContinueWatching(cwRes.data.items || []);
  setActiveRooms(roomsRes.data.rooms || []);

  const libs: Library[] = libsRes.data.libraries || [];

  // Fetch items for all libraries in parallel (was a sequential loop — slow with many libs)
  const sections: LibrarySectionData[] = await Promise.all(
  libs.map(async (lib) => {
  try {
  if (lib.type === 'SHOWS') {
  const res = await apiClient.get('/media/shows', { params: { libraryId: lib.id } });
  return { library: lib, items: res.data.shows || [] };
  }
  const res = await apiClient.get('/media/movies', { params: { libraryId: lib.id } });
  return { library: lib, items: res.data.movies || [] };
  } catch {
  return { library: lib, items: [] };
  }
  })
  );

  if (homeStaleRef.current) return;
  const firstLib = sections.find((s) => s.library.type === 'MOVIES' && s.items.length > 0);
  setFeaturedMovie(firstLib ? (firstLib.items[0] as MediaItem) : null);
  setLibrarySections(sections);
  } catch (err) {
  console.error('fetchHomeData error:', err);
  if (!homeStaleRef.current && !silent) setFetchError('Не удалось загрузить главную');
  } finally {
  if (!homeStaleRef.current && !silent) setLoading(false);
  }
  };

  useEffect(() => {
  homeStaleRef.current = false;
  // Есть кэш (возврат из плеера) — данные уже на экране, refetch тихий
  fetchHomeData({ silent: !!cached });
  return () => { homeStaleRef.current = true; };
  }, []);

  const handlePlayDirect = (media: MediaItem, startPos?: number) => {
    const state = { from: '/' };
    if (startPos !== undefined && startPos >= 0) {
      navigate(`/watch/${media.id}?start=${Math.floor(startPos)}`, { state });
    } else {
      navigate(`/watch/${media.id}`, { state });
    }
  };

 const handleCreateRoom = async (media: MediaItem) => {
 try {
 const res = await apiClient.post('/rooms', {
 mediaItemId: media.id,
 title: `Просмотр: ${media.title}`,
 });
 navigate(`/rooms/${res.data.room.code}`);
 } catch (err: any) {
 if (err.response?.status === 401) {
 navigate('/auth');
 } else {
 alert(err.response?.data?.error || 'Ошибка создания комнаты');
 }
 }
 };

 const handleOpenDetails = (media: MediaItem) => {
 setSelectedMediaId(media.id);
 setIsModalOpen(true);
 };

 const getLibraryIcon = (lib: Library) => {
 const name = (lib.name || '').toLowerCase();
 if (name.includes('аниме') || name.includes('anime')) return Sparkles;
 if (name.includes('мульт') || name.includes('cartoon') || name.includes('детск')) return Clapperboard;
 if (lib.type === 'SHOWS' || name.includes('сериал') || name.includes('show')) return Tv;
 if (lib.type === 'VIDEOS' || name.includes('видео') || name.includes('video') || name.includes('клип') || name.includes('ролик')) return Video;
 return Film;
 };

 const formatDuration = (sec: number) => {
 if (!sec || isNaN(sec)) return '';
 const m = Math.round(sec / 60);
 return `${m} мин`;
 };

 return (
 <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-10">
 {/* Hero Banner */}
 {featuredMovie && (
 <HeroBanner
 media={featuredMovie}
 onPlayDirect={handlePlayDirect}
 onCreateRoom={handleCreateRoom}
 onOpenDetails={handleOpenDetails}
 />
 )}

 {/* Continue Watching Section */}
 {continueWatching.length > 0 && (
 <section className="flex flex-col gap-4">
 <div className="flex items-center gap-2">
 <Clock className="w-5 h-5 text-cinema-gold" />
 <h2 className="text-lg font-bold text-white tracking-wide">Продолжить просмотр</h2>
 </div>

 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
  {continueWatching.map((item) => {
  const percent = item.durationSeconds > 0
  ? Math.min(100, Math.max(0, Math.round((item.progressSeconds / item.durationSeconds) * 100)))
  : 0;
  const remainingMin = Math.max(0, Math.round((item.durationSeconds - item.progressSeconds) / 60));

 const thumbUrl = item.stillPath || (item.type === 'EPISODE' ? `/api/media/item/${item.mediaId}/thumbnail` : (item.backdropPath || item.posterPath || `/api/media/item/${item.mediaId}/backdrop`));

 return (
 <div
 key={item.mediaId}
 onClick={() => handleOpenDetails({ id: item.mediaId } as any)}
 className="group relative rounded-2xl overflow-hidden bg-cinema-900 border border-white/10 hover:border-cinema-gold/50 cursor-pointer shadow-cinema-card transition-all duration-300 hover:-translate-y-1.5"
 >
 <div className="relative aspect-video w-full bg-cinema-950 overflow-hidden">
 <img
 src={thumbUrl}
 alt={item.title}
 loading="lazy"
 onError={(e) => {
 const target = e.currentTarget as HTMLImageElement;
 if (!target.src.includes('/thumbnail')) {
 target.src = `/api/media/item/${item.mediaId}/thumbnail`;
 } else {
 target.onerror = null;
 target.style.opacity = '0.3';
 }
 }}
 className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
 />
 {/* Progress Bar */}
 <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/50">
 <div className="h-full bg-cinema-gold shadow-[0_0_8px_rgba(229,160,13,0.9)]" style={{ width: `${percent}%` }} />
 </div>
 </div>
 <div className="p-3">
 <h4 className="text-xs font-bold text-slate-200 group-hover:text-cinema-gold transition-colors truncate">{item.title}</h4>
  <span className="text-[11px] text-slate-400 mt-0.5 block">Осталось {remainingMin} мин</span>
 </div>
 </div>
 );
 })}
 </div>
 </section>
 )}

 {/* Active Watch Together Rooms */}
 {activeRooms.length > 0 && (
 <section className="flex flex-col gap-4">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Radio className="w-5 h-5 text-cinema-gold animate-pulse" />
 <h2 className="text-lg font-bold text-white tracking-wide">Открытые комнаты просмотра</h2>
 </div>
 <button
 onClick={() => navigate('/rooms')}
 className="text-xs text-cinema-gold hover:underline font-semibold cursor-pointer"
 >
 Все комнаты →
 </button>
 </div>

 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
 {activeRooms.map((room) => (
 <div
 key={room.id}
 onClick={() => navigate(`/rooms/${room.code}`)}
 className="p-4 rounded-3xl bg-cinema-900 border border-white/10 hover:border-cinema-gold/40 cursor-pointer transition-all flex items-center justify-between group"
 >
 <div className="flex items-center gap-3">
 {room.posterPath ? (
 <LazyImage src={room.posterPath || ''} alt={room.title} className="w-12 h-16 rounded-xl object-cover" />
 ) : (
 <div className="w-12 h-16 rounded-xl bg-cinema-800 flex items-center justify-center text-slate-500">
 <Film className="w-6 h-6" />
 </div>
 )}
 <div>
 <h4 className="text-xs font-bold text-white group-hover:text-cinema-gold transition-colors line-clamp-1">
 {room.title}
 </h4>
 <span className="text-[11px] text-slate-400 block mt-0.5">Создатель: {room.hostUsername}</span>
 <span className="text-[10px] text-cinema-gold font-mono font-bold uppercase mt-1 block">
 Код: {room.code}
 </span>
 </div>
 </div>

 <div className="p-2.5 rounded-2xl bg-white/5 group-hover:bg-cinema-gold group-hover:text-black text-slate-300 transition-colors">
 <Play className="w-4 h-4 fill-current ml-0.5" />
 </div>
 </div>
 ))}
 </div>
 </section>
 )}

 {/* Dynamic User Libraries Sections */}
  {loading ? (
  <div className="p-16 flex justify-center items-center">
  <div className="w-8 h-8 border-2 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
  </div>
  ) : fetchError && librarySections.length === 0 ? (
  <div className="p-12 rounded-3xl bg-cinema-900 border border-white/10 text-center text-slate-400">
  <h3 className="text-base font-bold text-white mb-1">Не удалось загрузить данные</h3>
  <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">{fetchError}. Проверьте соединение и попробуйте снова.</p>
  <button
  onClick={() => fetchHomeData()}
  className="px-5 py-2.5 rounded-xl bg-cinema-gold text-black text-xs font-bold shadow-glow-gold hover:bg-yellow-400 cursor-pointer"
  >
  Повторить
  </button>
  </div>
  ) : librarySections.length === 0 ? (
 <div className="p-12 rounded-3xl bg-cinema-900 border border-white/10 text-center text-slate-400">
 <Film className="w-12 h-12 text-cinema-gold/40 mx-auto mb-3" />
 <h3 className="text-base font-bold text-white mb-1">Медиатека пока пуста</h3>
  <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
  {isAdmin
  ? 'Создайте вашу первую библиотеку фильмов, сериалов или видео в панели управления сервером'
  : 'Попросите администратора создать библиотеку и открыть вам доступ'}
  </p>
  {isAdmin && (
  <button
  onClick={() => navigate('/admin')}
  className="px-5 py-2.5 rounded-xl bg-cinema-gold text-black text-xs font-bold shadow-glow-gold hover:bg-yellow-400 cursor-pointer"
  >
  Перейти в управление медиатекой
  </button>
  )}
 </div>
 ) : (
 librarySections.map(({ library, items }) => {
 const Icon = getLibraryIcon(library);
 if (items.length === 0) return null;

 if (library.type === 'SHOWS') {
 return (
 <section key={library.id} className="flex flex-col gap-5">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2.5">
 <Icon className="w-5 h-5 text-cinema-gold" />
 <h2 className="text-lg font-bold text-white tracking-wide">{library.name}</h2>
 <span className="text-[10px] font-mono font-bold text-cinema-gold bg-cinema-gold/10 px-2 py-0.5 rounded-md border border-cinema-gold/20">
  {items.length} {plural(items.length, 'сериал', 'сериала', 'сериалов')}
 </span>
 </div>
 <button
 onClick={() => navigate(`/library/${library.id}`)}
 className="text-xs text-cinema-gold hover:underline font-semibold cursor-pointer"
 >
 Смотреть все ({items.length}) →
 </button>
 </div>

 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
  {items.slice(0, 6).map((show) => (
  <div
  key={`${(show as any).libraryId || library.id}:${(show as any).showTitle || (show as any).id}`}
  onClick={() => navigate(`/library/${library.id}`)}
 className="group relative flex flex-col rounded-2xl overflow-hidden bg-cinema-900 border border-white/10 hover:border-cinema-gold/50 cursor-pointer shadow-cinema-card transition-all duration-300 hover:-translate-y-1.5"
 >
 <div className="relative aspect-[2/3] w-full overflow-hidden bg-cinema-950">
 <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-slate-500">
 <Tv className="w-10 h-10 text-cinema-gold/30 mb-2" />
 <span className="text-xs text-center font-bold text-white">{show.showTitle}</span>
 </div>
 <LazyImage
 src={show.posterPath || `/api/media/item/${show.id}/poster`}
 alt={show.showTitle}
 onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
 className="relative w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
 />

 {show.rating && show.rating > 0 && (
 <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/70 px-2 py-0.5 rounded-lg border border-white/10 text-cinema-gold text-[10px] font-black shadow-lg">
 <Star className="w-3 h-3 fill-current" />
 <span>{show.rating.toFixed(1)}</span>
 </div>
 )}

 <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/80 px-2 py-0.5 rounded-md text-[10px] font-bold text-white border border-white/10">
 <Layers className="w-3 h-3 text-cinema-gold" />
  <span>{show.totalSeasons || 1} {plural(show.totalSeasons || 1, 'сезон', 'сезона', 'сезонов')}</span>
 </div>
 </div>

 <div className="p-3">
 <h3 className="text-xs font-bold text-slate-200 group-hover:text-cinema-gold transition-colors line-clamp-1">
 {show.showTitle}
 </h3>
 <span className="text-[11px] text-slate-400 mt-0.5 block">
  {show.totalEpisodes} {plural(show.totalEpisodes, 'серия', 'серии', 'серий')} {show.year ? `• ${show.year}` : ''}
 </span>
 </div>
 </div>
 ))}
 </div>
 </section>
 );
 }

 if (library.type === 'VIDEOS') {
 return (
 <section key={library.id} className="flex flex-col gap-5">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2.5">
 <Icon className="w-5 h-5 text-cinema-gold" />
 <h2 className="text-lg font-bold text-white tracking-wide">{library.name}</h2>
 <span className="text-[10px] font-mono font-bold text-cinema-gold bg-cinema-gold/10 px-2 py-0.5 rounded-md border border-cinema-gold/20">
  {items.length} {plural(items.length, 'видео', 'видео', 'видео')}
 </span>
 </div>
 <button
 onClick={() => navigate(`/library/${library.id}`)}
 className="text-xs text-cinema-gold hover:underline font-semibold cursor-pointer"
 >
 Смотреть все ({items.length}) →
 </button>
 </div>

 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
 {items.slice(0, 4).map((vid: MediaItem) => {
 const thumbUrl = vid.stillPath || vid.posterPath || `/api/media/item/${vid.id}/thumbnail`;
 return (
 <div
 key={vid.id}
 onClick={() => handleOpenDetails(vid)}
 className="group relative flex flex-col rounded-2xl overflow-hidden bg-cinema-900 border border-white/10 hover:border-cinema-gold/50 shadow-cinema-card transition-all duration-300 hover:-translate-y-1.5 cursor-pointer select-none"
 >
 <div className="relative aspect-video w-full overflow-hidden bg-cinema-950">
 <LazyImage
 src={thumbUrl}
 alt={vid.title}
 loading="lazy"
 onError={(e) => {
 (e.currentTarget as HTMLImageElement).src = `/api/media/item/${vid.id}/thumbnail`;
 }}
 className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
 />
 <div className="absolute top-2.5 right-2.5">
 {vid.durationSeconds > 0 && (
 <span className="text-[10px] font-bold text-cinema-gold bg-black/80 px-2 py-0.5 rounded-lg border border-white/10 font-mono">
 {formatDuration(vid.durationSeconds)}
 </span>
 )}
 </div>
 </div>

 <div className="p-3 flex flex-col justify-between flex-1">
 <h4 className="text-xs font-bold text-slate-200 group-hover:text-cinema-gold transition-colors line-clamp-1">
 {vid.title}
 </h4>
 <span className="text-[11px] text-slate-400 mt-1 block">
 {vid.year || 'Видео'} {vid.resolution ? `• ${vid.resolution}` : ''}
 </span>
 </div>
 </div>
 );
 })}
 </div>
 </section>
 );
 }

 // MOVIES library
 return (
 <section key={library.id} className="flex flex-col gap-5">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2.5">
 <Icon className="w-5 h-5 text-cinema-gold" />
 <h2 className="text-lg font-bold text-white tracking-wide">{library.name}</h2>
 <span className="text-[10px] font-mono font-bold text-cinema-gold bg-cinema-gold/10 px-2 py-0.5 rounded-md border border-cinema-gold/20">
  {items.length} {plural(items.length, 'фильм', 'фильма', 'фильмов')}
 </span>
 </div>
 <button
 onClick={() => navigate(`/library/${library.id}`)}
 className="text-xs text-cinema-gold hover:underline font-semibold cursor-pointer"
 >
 Смотреть все ({items.length}) →
 </button>
 </div>

 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
 {items.slice(0, 6).map((movie: MediaItem) => (
  <MediaCard
  key={movie.id}
  media={movie}
  onOpenDetails={handleOpenDetails}
  />
 ))}
 </div>
 </section>
 );
 })
 )}

 {/* Media Details Modal */}
  <MediaModal
  mediaId={selectedMediaId}
  isOpen={isModalOpen}
  onClose={() => setIsModalOpen(false)}
  onPlayDirect={handlePlayDirect}
  onCreateRoom={handleCreateRoom}
  onMediaUpdated={() => fetchHomeData({ silent: true })}
  />
 </div>
 );
};
