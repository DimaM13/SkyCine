import { LazyImage } from '../components/library/LazyImage';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
 Film, Tv, Video, Radio, Clock, Play, Users, Star, Layers, Sparkles, Clapperboard
} from 'lucide-react';
import { apiClient } from '../api/client';
import { HeroBanner } from '../components/library/HeroBanner';
import { MediaCard } from '../components/library/MediaCard';
import { MediaModal } from '../components/library/MediaModal';
import { MediaItem, ContinueWatchingItem, Room, Library } from '../types';

interface LibrarySectionData {
 library: Library;
 items: any[];
}

export const HomePage: React.FC = () => {
 const navigate = useNavigate();
 const [continueWatching, setContinueWatching] = useState<ContinueWatchingItem[]>([]);
 const [activeRooms, setActiveRooms] = useState<Room[]>([]);
 const [librarySections, setLibrarySections] = useState<LibrarySectionData[]>([]);
 const [featuredMovie, setFeaturedMovie] = useState<MediaItem | null>(null);
 const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
 const [isModalOpen, setIsModalOpen] = useState(false);
 const [loading, setLoading] = useState(true);

 const fetchHomeData = async () => {
 setLoading(true);
 try {
 const [cwRes, roomsRes, libsRes] = await Promise.all([
 apiClient.get('/media/continue-watching').catch(() => ({ data: { items: [] } })),
 apiClient.get('/rooms').catch(() => ({ data: { rooms: [] } })),
 apiClient.get('/libraries').catch(() => ({ data: { libraries: [] } })),
 ]);

 setContinueWatching(cwRes.data.items || []);
 setActiveRooms(roomsRes.data.rooms || []);

 const libs: Library[] = libsRes.data.libraries || [];
 const sections: LibrarySectionData[] = [];
 let firstMovie: MediaItem | null = null;

 // Fetch items for each library dynamically
 for (const lib of libs) {
 if (lib.type === 'SHOWS') {
 try {
 const res = await apiClient.get('/media/shows', { params: { libraryId: lib.id } });
 sections.push({ library: lib, items: res.data.shows || [] });
 } catch {
 sections.push({ library: lib, items: [] });
 }
 } else {
 try {
 const res = await apiClient.get('/media/movies', { params: { libraryId: lib.id } });
 const moviesList: MediaItem[] = res.data.movies || [];
 sections.push({ library: lib, items: moviesList });
 if (!firstMovie && moviesList.length > 0 && lib.type === 'MOVIES') {
 firstMovie = moviesList[0];
 }
 } catch {
 sections.push({ library: lib, items: [] });
 }
 }
 }

 setFeaturedMovie(firstMovie);
 setLibrarySections(sections);
 } catch (err) {
 console.error('fetchHomeData error:', err);
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 fetchHomeData();
 }, []);

 const handlePlayDirect = (media: MediaItem) => {
 navigate(`/watch/${media.id}`);
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
 ? Math.round((item.progressSeconds / item.durationSeconds) * 100)
 : 0;

 const thumbUrl = item.stillPath || (item.type === 'EPISODE' ? `/api/media/item/${item.mediaId}/thumbnail` : (item.backdropPath || item.posterPath));

 return (
 <div
 key={item.mediaId}
 onClick={() => handleOpenDetails({ id: item.mediaId } as any)}
 className="group relative rounded-2xl overflow-hidden bg-cinema-900 border border-white/10 hover:border-cinema-gold/50 cursor-pointer shadow-cinema-card transition-all duration-300 hover:-translate-y-1.5"
 >
 <div className="relative aspect-video w-full bg-cinema-950 overflow-hidden">
 <LazyImage
 src={thumbUrl}
 alt={item.title}
 onError={(e) => {
 (e.currentTarget as HTMLImageElement).src = `/api/media/item/${item.mediaId}/thumbnail`;
 }}
 className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
 />
 {/* Progress Bar */}
 <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/80">
 <div className="h-full bg-cinema-gold shadow-[0_0_8px_rgba(229,160,13,0.9)]" style={{ width: `${percent}%` }} />
 </div>
 </div>
 <div className="p-3">
 <h4 className="text-xs font-bold text-slate-200 group-hover:text-cinema-gold transition-colors truncate">{item.title}</h4>
 <span className="text-[11px] text-slate-400 mt-0.5 block">Осталось {Math.max(1, Math.round((item.durationSeconds - item.progressSeconds) / 60))} мин</span>
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
 ) : librarySections.length === 0 ? (
 <div className="p-12 rounded-3xl bg-cinema-900 border border-white/10 text-center text-slate-400">
 <Film className="w-12 h-12 text-cinema-gold/40 mx-auto mb-3" />
 <h3 className="text-base font-bold text-white mb-1">Медиатека пока пуста</h3>
 <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
 Создайте вашу первую библиотеку фильмов, сериалов или видео в панели управления сервером
 </p>
 <button
 onClick={() => navigate('/admin')}
 className="px-5 py-2.5 rounded-xl bg-cinema-gold text-black text-xs font-bold shadow-glow-gold hover:bg-yellow-400 cursor-pointer"
 >
 Перейти в управление медиатекой
 </button>
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
 {items.length} {items.length === 1 ? 'сериал' : 'сериала'}
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
 {items.slice(0, 6).map((show, idx) => (
 <div
 key={idx}
 onClick={() => navigate(`/library/${library.id}`)}
 className="group relative flex flex-col rounded-2xl overflow-hidden bg-cinema-900 border border-white/10 hover:border-cinema-gold/50 cursor-pointer shadow-cinema-card transition-all duration-300 hover:-translate-y-1.5"
 >
 <div className="relative aspect-[2/3] w-full overflow-hidden bg-cinema-950">
 {show.posterPath ? (
 <LazyImage
 src={show.posterPath}
 alt={show.showTitle}
 className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
 />
 ) : (
 <div className="w-full h-full flex flex-col items-center justify-center p-4 text-slate-500">
 <Tv className="w-10 h-10 text-cinema-gold/30 mb-2" />
 <span className="text-xs text-center font-bold text-white">{show.showTitle}</span>
 </div>
 )}

 {show.rating && show.rating > 0 && (
 <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/70 px-2 py-0.5 rounded-lg border border-white/10 text-cinema-gold text-[10px] font-black shadow-lg">
 <Star className="w-3 h-3 fill-current" />
 <span>{show.rating.toFixed(1)}</span>
 </div>
 )}

 <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/80 px-2 py-0.5 rounded-md text-[10px] font-bold text-white border border-white/10">
 <Layers className="w-3 h-3 text-cinema-gold" />
 <span>{show.totalSeasons || 1} {show.totalSeasons === 1 ? 'сезон' : 'сезона'}</span>
 </div>
 </div>

 <div className="p-3">
 <h3 className="text-xs font-bold text-slate-200 group-hover:text-cinema-gold transition-colors line-clamp-1">
 {show.showTitle}
 </h3>
 <span className="text-[11px] text-slate-400 mt-0.5 block">
 {show.totalEpisodes} серий {show.year ? `• ${show.year}` : ''}
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
 {items.length} {items.length === 1 ? 'видео' : 'видео'}
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
 {items.length} {items.length === 1 ? 'фильм' : 'фильмов'}
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
 onPlayDirect={handlePlayDirect}
 onCreateRoom={handleCreateRoom}
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
 onMediaUpdated={fetchHomeData}
 />
 </div>
 );
};
