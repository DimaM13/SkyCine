import { InfiniteScroll } from '../components/library/InfiniteScroll';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Film, Search, SlidersHorizontal } from 'lucide-react';
import { apiClient } from '../api/client';
import { MediaCard } from '../components/library/MediaCard';
import { MediaModal } from '../components/library/MediaModal';
import { MediaItem } from '../types';
import { useAuth } from '../context/AuthContext';

export const MoviesPage: React.FC = () => {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [movies, setMovies] = useState<MediaItem[]>([]);
  const [visibleCount, setVisibleCount] = useState(50);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('recent');
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchMovies = () => {
    setLoading(true);
    apiClient.get('/media/movies', {
      params: { search: search.trim() || undefined, sortBy },
    })
      .then((res) => { setMovies(res.data.movies || []); setVisibleCount(50); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchMovies();
  }, [sortBy]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchMovies();
  };

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

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-8">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <Film className="w-7 h-7 text-cinema-gold" />
            Фильмы ({movies.length})
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Ваша коллекция фильмов с поддержкой прямого воспроизведения и транскодирования
          </p>
        </div>

        {/* Search and Sort Form */}
        <div className="flex flex-wrap items-center gap-3">
          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Поиск фильма..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-cinema-900 border border-white/10 rounded-2xl pl-10 pr-4 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold w-48 sm:w-64"
            />
          </form>

          <div className="flex items-center gap-2 bg-cinema-900 border border-white/10 px-3 py-1.5 rounded-2xl">
            <SlidersHorizontal className="w-3.5 h-3.5 text-cinema-gold" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-transparent text-xs text-slate-300 focus:outline-none cursor-pointer"
            >
              <option value="recent">Недавно добавленные</option>
              <option value="rating">По рейтингу TMDB</option>
              <option value="year">По году выпуска</option>
              <option value="title">По названию (А-Я)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Movies Grid */}
      {loading ? (
        <div className="p-16 flex justify-center items-center">
          <div className="w-8 h-8 border-2 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
        </div>
      ) : movies.length === 0 ? (
        <div className="p-12 rounded-3xl bg-cinema-900 border border-white/10 text-center text-slate-400">
          <Film className="w-12 h-12 text-cinema-gold/40 mx-auto mb-3" />
          <h3 className="text-base font-bold text-white mb-1">Фильмы не найдены</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {isAdmin
              ? 'Попробуйте изменить поисковый запрос или запустите сканирование библиотеки в панели управления'
              : 'Вам пока не открыт доступ к фильмам медиатеки. Администратор сервера может открыть вам доступ к отдельным фильмам или библиотекам.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {movies.slice(0, visibleCount).map((movie) => (
            <MediaCard
              key={movie.id}
              media={movie}
              onPlayDirect={handlePlayDirect}
              onCreateRoom={handleCreateRoom}
              onOpenDetails={(m) => {
                setSelectedMediaId(m.id);
                setIsModalOpen(true);
              }}
            />
          ))}
        </div>
      )}

      {/* Details Modal */}
      <MediaModal
        mediaId={selectedMediaId}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onPlayDirect={handlePlayDirect}
        onCreateRoom={handleCreateRoom}
        onMediaUpdated={fetchMovies}
      />
    </div>
  );
};
