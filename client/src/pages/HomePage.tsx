import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Film, Tv, Radio, Clock, Play, Users, Star, Layers, Sparkles } from 'lucide-react';
import { apiClient } from '../api/client';
import { HeroBanner } from '../components/library/HeroBanner';
import { MediaCard } from '../components/library/MediaCard';
import { MediaModal } from '../components/library/MediaModal';
import { MediaItem, ContinueWatchingItem, Room } from '../types';

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [movies, setMovies] = useState<MediaItem[]>([]);
  const [shows, setShows] = useState<any[]>([]);
  const [continueWatching, setContinueWatching] = useState<ContinueWatchingItem[]>([]);
  const [activeRooms, setActiveRooms] = useState<Room[]>([]);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchHomeData = () => {
    Promise.all([
      apiClient.get('/media/movies').catch(() => ({ data: { movies: [] } })),
      apiClient.get('/media/shows').catch(() => ({ data: { shows: [] } })),
      apiClient.get('/media/continue-watching').catch(() => ({ data: { items: [] } })),
      apiClient.get('/rooms').catch(() => ({ data: { rooms: [] } })),
    ])
      .then(([moviesRes, showsRes, cwRes, roomsRes]) => {
        setMovies(moviesRes.data.movies || []);
        setShows(showsRes.data.shows || []);
        setContinueWatching(cwRes.data.items || []);
        setActiveRooms(roomsRes.data.rooms || []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchHomeData();
  }, []);

  const featuredMovie = movies.length > 0 ? movies[0] : null;

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

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-10">
      {/* Hero Banner */}
      <HeroBanner
        media={featuredMovie}
        onPlayDirect={handlePlayDirect}
        onCreateRoom={handleCreateRoom}
        onOpenDetails={handleOpenDetails}
      />

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

              return (
                <div
                  key={item.mediaId}
                  onClick={() => navigate(`/watch/${item.mediaId}`)}
                  className="group relative rounded-2xl overflow-hidden bg-cinema-900 border border-white/10 hover:border-cinema-gold/50 cursor-pointer shadow-lg transition-all"
                >
                  <div className="relative aspect-video w-full bg-cinema-950">
                    <img
                      src={item.backdropPath || item.posterPath}
                      alt={item.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="w-10 h-10 rounded-full bg-cinema-gold text-black flex items-center justify-center shadow-glow-gold">
                        <Play className="w-4 h-4 fill-current ml-0.5" />
                      </div>
                    </div>
                    {/* Progress Bar */}
                    <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-white/20">
                      <div className="h-full bg-cinema-gold" style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                  <div className="p-3">
                    <h4 className="text-xs font-bold text-white truncate">{item.title}</h4>
                    <span className="text-[10px] text-slate-400">Осталось {Math.round((item.durationSeconds - item.progressSeconds) / 60)} мин</span>
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
              className="text-xs text-cinema-gold hover:underline font-semibold"
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
                    <img src={room.posterPath} alt={room.title} className="w-12 h-16 rounded-xl object-cover" />
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

      {/* Shows Section */}
      {shows.length > 0 && (
        <section className="flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tv className="w-5 h-5 text-cinema-gold" />
              <h2 className="text-lg font-bold text-white tracking-wide">Сериалы</h2>
            </div>
            <button
              onClick={() => navigate('/shows')}
              className="text-xs text-cinema-gold hover:underline font-semibold"
            >
              Все сериалы ({shows.length}) →
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {shows.map((show, idx) => (
              <div
                key={idx}
                onClick={() => navigate('/shows')}
                className="group relative flex flex-col rounded-2xl overflow-hidden bg-cinema-900 border border-white/10 hover:border-cinema-gold/50 cursor-pointer shadow-cinema-card transition-all duration-300 hover:-translate-y-1.5"
              >
                <div className="relative aspect-[2/3] w-full overflow-hidden bg-cinema-950">
                  {show.posterPath ? (
                    <img
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
                    <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/70 backdrop-blur-md px-2 py-0.5 rounded-lg border border-white/10 text-cinema-gold text-[10px] font-black shadow-lg">
                      <Star className="w-3 h-3 fill-current" />
                      <span>{show.rating.toFixed(1)}</span>
                    </div>
                  )}

                  <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded-md text-[10px] font-bold text-white border border-white/10">
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
      )}

      {/* Movies Grid */}
      <section className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Film className="w-5 h-5 text-cinema-gold" />
            <h2 className="text-lg font-bold text-white tracking-wide">Фильмы в библиотеке</h2>
          </div>
          <button
            onClick={() => navigate('/movies')}
            className="text-xs text-cinema-gold hover:underline font-semibold"
          >
            Смотреть все ({movies.length}) →
          </button>
        </div>

        {movies.length === 0 ? (
          <div className="p-12 rounded-3xl bg-cinema-900 border border-white/10 text-center text-slate-400">
            <Film className="w-12 h-12 text-cinema-gold/40 mx-auto mb-3" />
            <h3 className="text-base font-bold text-white mb-1">Медиатека пока пуста</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
              Добавьте вашу первую папку с фильмами в панели управления сервером
            </p>
            <button
              onClick={() => navigate('/admin')}
              className="px-5 py-2.5 rounded-xl bg-cinema-gold text-black text-xs font-bold shadow-glow-gold"
            >
              Перейти в настройки сервера
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {movies.map((movie) => (
              <MediaCard
                key={movie.id}
                media={movie}
                onPlayDirect={handlePlayDirect}
                onCreateRoom={handleCreateRoom}
                onOpenDetails={handleOpenDetails}
              />
            ))}
          </div>
        )}
      </section>

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
