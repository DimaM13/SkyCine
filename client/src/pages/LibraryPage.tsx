import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Film, Tv, Video, Search, SlidersHorizontal, RefreshCw,
  Sparkles, Clapperboard, Layers, Star, Play, Lock, ArrowLeft, Clock, Calendar, X, Check,
  CheckCircle2, ChevronRight, Plus
} from 'lucide-react';
import { apiClient } from '../api/client';
import { MediaCard } from '../components/library/MediaCard';
import { MediaModal } from '../components/library/MediaModal';
import { EpisodeModal } from '../components/library/EpisodeModal';
import { ShowAccessModal } from '../components/admin/ShowAccessModal';
import { MediaItem, Library } from '../types';
import { useAuth } from '../context/AuthContext';

export const LibraryPage: React.FC = () => {
  const { id: libraryId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const [library, setLibrary] = useState<Library | null>(null);
  const [loading, setLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);

  // Movies state
  const [movies, setMovies] = useState<MediaItem[]>([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('recent');
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Shows state
  const [shows, setShows] = useState<any[]>([]);
  const [selectedShow, setSelectedShow] = useState<any | null>(null);
  const [episodes, setEpisodes] = useState<MediaItem[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<number | 'all'>('all');
  const [accessModalShowTitle, setAccessModalShowTitle] = useState<string | null>(null);

  // Episode Modal state
  const [selectedEpisode, setSelectedEpisode] = useState<MediaItem | null>(null);
  const [isEpisodeModalOpen, setIsEpisodeModalOpen] = useState(false);

  // TMDB Show Match Modal state
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchYear, setSearchYear] = useState('');
  const [candidates, setCandidates] = useState<any[]>([]);
  const [isSearchingMatch, setIsSearchingMatch] = useState(false);
  const [isApplyingMatch, setIsApplyingMatch] = useState(false);
  const [matchSuccessMsg, setMatchSuccessMsg] = useState('');

  const fetchLibraryInfoAndData = () => {
    if (!libraryId) return;
    setLoading(true);

    apiClient.get('/libraries')
      .then((res) => {
        const libs: Library[] = res.data.libraries || [];
        const found = libs.find((l) => l.id === libraryId);
        if (found) {
          setLibrary(found);
          if (found.type === 'SHOWS') {
            fetchShows(found.id);
          } else {
            fetchMovies(found.id);
          }
        } else {
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));
  };

  const fetchMovies = (libId = libraryId) => {
    setLoading(true);
    apiClient.get('/media/movies', {
      params: {
        libraryId: libId,
        search: search.trim() || undefined,
        sortBy
      },
    })
      .then((res) => setMovies(res.data.movies || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const fetchShows = (libId = libraryId) => {
    setLoading(true);
    apiClient.get('/media/shows', {
      params: { libraryId: libId }
    })
      .then((res) => setShows(res.data.shows || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setSelectedShow(null);
    setSearch('');
    fetchLibraryInfoAndData();
  }, [libraryId]);

  useEffect(() => {
    if (library && library.type === 'MOVIES') {
      fetchMovies(library.id);
    }
  }, [sortBy]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (library?.type === 'MOVIES') {
      fetchMovies();
    }
  };

  const handleScanLibrary = async () => {
    if (!libraryId || isScanning) return;
    setIsScanning(true);
    try {
      await apiClient.post(`/libraries/${libraryId}/scan`);
      alert('Сканирование библиотеки запущено в фоновом режиме!');
      setTimeout(() => {
        fetchLibraryInfoAndData();
        setIsScanning(false);
      }, 2500);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка запуска сканирования');
      setIsScanning(false);
    }
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

  const handleSelectShow = (show: any) => {
    setSelectedShow(show);
    setSelectedSeason('all');
    setLoadingEpisodes(true);
    apiClient.get(`/media/shows/${encodeURIComponent(show.showTitle)}/episodes`)
      .then((res) => {
        const eps = res.data.episodes || [];
        setEpisodes(eps);
        const seasons = Array.from(new Set(eps.map((e: any) => e.seasonNumber || 1))).sort((a: any, b: any) => a - b) as number[];
        if (seasons.length > 0) {
          setSelectedSeason(seasons[0]);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingEpisodes(false));
  };

  const availableSeasons = useMemo(() => {
    const sSet = new Set<number>();
    episodes.forEach((e) => {
      sSet.add(e.seasonNumber || 1);
    });
    return Array.from(sSet).sort((a, b) => a - b);
  }, [episodes]);

  const filteredEpisodes = useMemo(() => {
    if (selectedSeason === 'all') return episodes;
    return episodes.filter((e) => (e.seasonNumber || 1) === selectedSeason);
  }, [episodes, selectedSeason]);

  const cleanEpisodeTitle = (rawTitle: string, showTitle: string, seasonNum: number, epNum: number) => {
    let clean = rawTitle;
    if (clean.startsWith(showTitle)) {
      clean = clean.replace(showTitle, '').trim();
    }
    clean = clean.replace(/^[-–—:\s]+/, '').trim();
    if (!clean || clean.match(/^s\d+e\d+$/i)) {
      return `Серия ${epNum}`;
    }
    return clean;
  };

  const formatDuration = (sec: number) => {
    if (!sec || isNaN(sec)) return '';
    const m = Math.round(sec / 60);
    return `${m} мин`;
  };

  const handleOpenMatchModal = () => {
    if (!selectedShow) return;
    setSearchQuery(selectedShow.showTitle);
    setSearchYear(selectedShow.year ? String(selectedShow.year) : '');
    setCandidates([]);
    setMatchSuccessMsg('');
    setShowMatchModal(true);
    setIsSearchingMatch(true);
    apiClient.get('/media/shows/match-search', {
      params: { query: selectedShow.showTitle, year: selectedShow.year || undefined }
    })
      .then((res) => setCandidates(res.data.candidates || []))
      .catch(() => {})
      .finally(() => setIsSearchingMatch(false));
  };

  const handleSearchMatch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearchingMatch(true);
    try {
      const res = await apiClient.get('/media/shows/match-search', {
        params: { query: searchQuery.trim(), year: searchYear.trim() || undefined }
      });
      setCandidates(res.data.candidates || []);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка поиска сериала в TMDB');
    } finally {
      setIsSearchingMatch(false);
    }
  };

  const handleApplyMatch = async (cand: any) => {
    if (!selectedShow) return;
    setIsApplyingMatch(true);
    try {
      await apiClient.post(`/media/shows/${encodeURIComponent(selectedShow.showTitle)}/match-apply`, cand);
      setMatchSuccessMsg('Метаданные сериала успешно обновлены!');
      setTimeout(() => {
        setMatchSuccessMsg('');
        setShowMatchModal(false);
        fetchShows();
        handleSelectShow({
          ...selectedShow,
          showTitle: cand.title,
          posterPath: cand.posterPath,
          backdropPath: cand.backdropPath,
          year: cand.year,
          overview: cand.overview,
          rating: cand.rating
        });
      }, 1000);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка применения сопоставления');
    } finally {
      setIsApplyingMatch(false);
    }
  };

  const getLibraryIcon = (lib: Library | null) => {
    if (!lib) return Film;
    const name = (lib.name || '').toLowerCase();
    if (name.includes('аниме') || name.includes('anime')) return Sparkles;
    if (name.includes('мульт') || name.includes('cartoon') || name.includes('детск')) return Clapperboard;
    if (lib.type === 'SHOWS' || name.includes('сериал') || name.includes('show')) return Tv;
    if (lib.type === 'VIDEOS' || name.includes('видео') || name.includes('video') || name.includes('клип') || name.includes('ролик')) return Video;
    return Film;
  };

  const LibraryIcon = getLibraryIcon(library);

  if (!library && !loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-16 text-center text-slate-400">
        <Film className="w-12 h-12 text-cinema-gold/40 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-white mb-2">Библиотека не найдена</h3>
        <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
          Возможно, библиотека была удалена или у вас нет прав доступа
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-5 py-2.5 rounded-2xl bg-cinema-gold text-black text-xs font-bold shadow-glow-gold cursor-pointer"
        >
          На главную
        </button>
      </div>
    );
  }

  const getItemCountLabel = () => {
    if (!library) return '';
    if (library.type === 'SHOWS') {
      return `${shows.length} ${shows.length === 1 ? 'сериал' : 'сериалов'}`;
    }
    if (library.type === 'VIDEOS') {
      return `${movies.length} ${movies.length === 1 ? 'видео' : 'видео'}`;
    }
    return `${movies.length} ${movies.length === 1 ? 'фильм' : 'фильмов'}`;
  };

  const getLibrarySubheading = () => {
    if (!library) return '';
    if (library.type === 'SHOWS') return 'Коллекция сериалов со всеми сезонами и сериями';
    if (library.type === 'VIDEOS') return 'Коллекция видеороликов и записей';
    return 'Коллекция фильмов с поддержкой прямого воспроизведения';
  };

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-8">
      {/* Header & Controls */}
      {!selectedShow && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-cinema-gold/10 border border-cinema-gold/30 flex items-center justify-center text-cinema-gold shadow-glow-gold">
              <LibraryIcon className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
                {library?.name || 'Библиотека'}
                <span className="text-xs font-mono font-bold text-cinema-gold bg-cinema-gold/10 px-2.5 py-0.5 rounded-lg border border-cinema-gold/20">
                  {getItemCountLabel()}
                </span>
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                {getLibrarySubheading()}
              </p>
            </div>
          </div>

          {/* Action Bar (Search, Sort, Scan) */}
          <div className="flex flex-wrap items-center gap-3">
            {(library?.type === 'MOVIES' || library?.type === 'VIDEOS') && (
              <>
                <form onSubmit={handleSearchSubmit} className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Поиск в библиотеке..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="bg-cinema-900 border border-white/10 rounded-2xl pl-10 pr-4 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold w-44 sm:w-60"
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
                    <option value="title">По названию (А-Я)</option>
                    <option value="year">По дате / году</option>
                    {library.type === 'MOVIES' && <option value="rating">По рейтингу TMDB</option>}
                  </select>
                </div>
              </>
            )}

            {isAdmin && (
              <button
                onClick={() => navigate('/admin')}
                className="px-4 py-2.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-xs font-bold text-slate-300 hover:text-white flex items-center gap-2 transition-all cursor-pointer"
                title="Управление библиотеками и добавление файлов"
              >
                <Plus className="w-3.5 h-3.5 text-cinema-gold" />
                <span>Добавить медиа</span>
              </button>
            )}

            {isAdmin && library?.path && (
              <button
                onClick={handleScanLibrary}
                disabled={isScanning}
                className="px-4 py-2.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-xs font-bold text-slate-300 hover:text-white flex items-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
                title="Пересканировать папку библиотеки"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-cinema-gold ${isScanning ? 'animate-spin' : ''}`} />
                <span>{isScanning ? 'Сканирование...' : 'Обновить'}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content Section: Movies */}
      {library?.type === 'MOVIES' && (
        <>
          {loading ? (
            <div className="p-16 flex justify-center items-center">
              <div className="w-8 h-8 border-2 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
            </div>
          ) : movies.length === 0 ? (
            <div className="p-12 rounded-3xl bg-cinema-900 border border-white/10 text-center text-slate-400">
              <Film className="w-12 h-12 text-cinema-gold/40 mx-auto mb-3" />
              <h3 className="text-base font-bold text-white mb-1">Библиотека пуста</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto mb-5">
                В этой библиотеке пока нет фильмов. Вы можете добавить целую папку с фильмами или отдельные видеофайлы.
              </p>
              {isAdmin && (
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => navigate('/admin')}
                    className="px-5 py-2.5 rounded-xl bg-cinema-gold text-black text-xs font-bold shadow-glow-gold hover:bg-yellow-400 transition-all cursor-pointer flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Добавить фильмы в библиотеку</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {movies.map((movie) => (
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
            onMediaUpdated={() => fetchMovies(library.id)}
          />
        </>
      )}

      {/* Content Section: VIDEOS (Standalone Videos / Clips) */}
      {library?.type === 'VIDEOS' && (
        <>
          {loading ? (
            <div className="p-16 flex justify-center items-center">
              <div className="w-8 h-8 border-2 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
            </div>
          ) : movies.length === 0 ? (
            <div className="p-12 rounded-3xl bg-cinema-900 border border-white/10 text-center text-slate-400">
              <Video className="w-12 h-12 text-cinema-gold/40 mx-auto mb-3" />
              <h3 className="text-base font-bold text-white mb-1">Видео не найдены</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto mb-5">
                В этой библиотеке пока нет видеофайлов. Добавьте папку с видео или отдельные файлы.
              </p>
              {isAdmin && (
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => navigate('/admin')}
                    className="px-5 py-2.5 rounded-xl bg-cinema-gold text-black text-xs font-bold shadow-glow-gold hover:bg-yellow-400 transition-all cursor-pointer flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Добавить видео в библиотеку</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {movies.map((vid) => {
                const thumbUrl = vid.stillPath || vid.posterPath || `/api/media/item/${vid.id}/thumbnail`;
                const userProgress = (vid as any).userProgress || 0;
                const duration = vid.durationSeconds || 0;
                const hasProgress = userProgress > 15 && duration > 0;
                const progressPercent = hasProgress ? Math.min(100, Math.round((userProgress / duration) * 100)) : 0;

                return (
                  <div
                    key={vid.id}
                    onClick={() => {
                      setSelectedMediaId(vid.id);
                      setIsModalOpen(true);
                    }}
                    className="group relative flex flex-col rounded-2xl overflow-hidden bg-cinema-900 border border-white/10 hover:border-cinema-gold/50 shadow-cinema-card transition-all duration-300 hover:-translate-y-1.5 cursor-pointer select-none"
                  >
                    {/* 16:9 Thumbnail Container */}
                    <div className="relative aspect-video w-full overflow-hidden bg-cinema-950">
                      <img
                        src={thumbUrl}
                        alt={vid.title}
                        loading="lazy"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = `/api/media/item/${vid.id}/thumbnail`;
                        }}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />

                      {/* Quality & Duration Badges */}
                      <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between pointer-events-none z-10">
                        {vid.resolution ? (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-200 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded-lg border border-white/10 font-mono">
                            {vid.resolution}
                          </span>
                        ) : <span />}

                        {duration > 0 && (
                          <span className="text-[10px] font-bold text-cinema-gold bg-black/80 backdrop-blur-md px-2 py-0.5 rounded-lg border border-white/10 font-mono">
                            {formatDuration(duration)}
                          </span>
                        )}
                      </div>

                      {/* Progress Bar */}
                      {hasProgress && (
                        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/50 z-10">
                          <div
                            className="h-full bg-cinema-gold shadow-[0_0_8px_rgba(229,160,13,0.9)]"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Meta info */}
                    <div className="p-3.5 flex flex-col flex-1 justify-between gap-1.5">
                      <h3 className="text-xs font-bold text-slate-200 group-hover:text-cinema-gold transition-colors line-clamp-2">
                        {vid.title}
                      </h3>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium">
                        <span>{vid.year || 'Видео'}</span>
                        {vid.videoCodec && (
                          <span className="uppercase text-[10px] text-slate-500 font-mono">
                            {vid.videoCodec}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Details Modal */}
          <MediaModal
            mediaId={selectedMediaId}
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            onPlayDirect={handlePlayDirect}
            onCreateRoom={handleCreateRoom}
            onMediaUpdated={() => fetchMovies(library.id)}
          />
        </>
      )}

      {/* Content Section: Shows */}
      {library?.type === 'SHOWS' && (
        <>
          {selectedShow ? (
            <div className="flex flex-col gap-8 animate-fade-in">
              {/* Back button */}
              <button
                onClick={() => setSelectedShow(null)}
                className="flex items-center gap-2 text-xs font-bold text-cinema-gold hover:text-yellow-300 transition-colors w-fit group"
              >
                <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
                <span>Назад к сериалам библиотеки</span>
              </button>

              {/* Show Hero */}
              <div className="relative rounded-3xl overflow-hidden bg-cinema-900 border border-white/10 shadow-2xl">
                {selectedShow.backdropPath && (
                  <div className="absolute inset-0 z-0 opacity-20 bg-cover bg-center pointer-events-none" style={{ backgroundImage: `url(${selectedShow.backdropPath})` }}>
                    <div className="absolute inset-0 bg-gradient-to-t from-cinema-950 via-cinema-950/80 to-transparent" />
                  </div>
                )}

                <div className="relative z-10 p-6 md:p-8 flex flex-col md:flex-row gap-6 md:gap-8 items-start">
                  {selectedShow.posterPath ? (
                    <img
                      src={selectedShow.posterPath}
                      alt={selectedShow.showTitle}
                      className="w-36 md:w-52 aspect-[2/3] rounded-2xl object-cover shadow-2xl shrink-0 border border-white/10"
                    />
                  ) : (
                    <div className="w-36 md:w-52 aspect-[2/3] rounded-2xl bg-cinema-800 flex items-center justify-center text-slate-500 shrink-0 border border-white/10">
                      <Tv className="w-16 h-16 text-cinema-gold/40" />
                    </div>
                  )}

                  <div className="flex flex-col gap-3 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      {selectedShow.rating && selectedShow.rating > 0 && (
                        <span className="flex items-center gap-1 text-xs font-black bg-cinema-gold text-black px-2.5 py-0.5 rounded-lg shadow-glow-gold">
                          <Star className="w-3.5 h-3.5 fill-black" />
                          {selectedShow.rating.toFixed(1)}
                        </span>
                      )}
                      {selectedShow.year && (
                        <span className="flex items-center gap-1 text-xs text-slate-300 font-semibold bg-white/10 px-2.5 py-0.5 rounded-lg">
                          <Calendar className="w-3.5 h-3.5 text-cinema-gold" />
                          {selectedShow.year}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-xs text-slate-300 font-semibold bg-white/10 px-2.5 py-0.5 rounded-lg">
                        <Layers className="w-3.5 h-3.5 text-cinema-gold" />
                        {availableSeasons.length || selectedShow.totalSeasons || 1} {availableSeasons.length === 1 ? 'сезон' : 'сезона'} • {episodes.length || selectedShow.totalEpisodes} серий
                      </span>
                    </div>

                    <h1 className="text-2xl md:text-4xl font-extrabold text-white tracking-tight">{selectedShow.showTitle}</h1>

                    {selectedShow.overview && (
                      <p className="text-xs md:text-sm text-slate-300 leading-relaxed max-w-3xl">
                        {selectedShow.overview}
                      </p>
                    )}

                    {/* Actions & Admin Access */}
                    <div className="flex items-center gap-3 pt-2 flex-wrap">
                      {episodes.length > 0 && (
                        <button
                          onClick={() => handlePlayDirect(episodes[0])}
                          className="px-5 py-2.5 rounded-xl bg-cinema-gold text-black font-extrabold text-xs flex items-center gap-2 hover:bg-yellow-400 shadow-glow-gold transition-all active:scale-95"
                        >
                          <Play className="w-4 h-4 fill-current ml-0.5" />
                          <span>Смотреть с 1-й серии</span>
                        </button>
                      )}

                      {isAdmin && (
                        <>
                          <button
                            onClick={handleOpenMatchModal}
                            className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/20 text-xs font-bold transition-all flex items-center gap-2 active:scale-95"
                            title="Исправить сопоставление с TMDB"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-cinema-gold" />
                            <span>Исправить сопоставление</span>
                          </button>

                          <button
                            onClick={() => setAccessModalShowTitle(selectedShow.showTitle)}
                            className="px-4 py-2.5 rounded-xl bg-cinema-gold/15 hover:bg-cinema-gold text-cinema-gold hover:text-black border border-cinema-gold/40 text-xs font-bold transition-all flex items-center gap-2 active:scale-95"
                            title="Настроить доступ пользователей к этому сериалу"
                          >
                            <Lock className="w-3.5 h-3.5" />
                            <span>Управление доступом</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Large Modern Season Selector */}
              {availableSeasons.length > 0 && (
                <div className="flex flex-col gap-6">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <h3 className="text-base font-bold text-white tracking-wide">Выбор сезона</h3>
                      <span className="text-xs text-slate-400">Выберите сезон для просмотра списка серий</span>
                    </div>

                    <span className="text-xs text-slate-400 font-mono">
                      {filteredEpisodes.length} {filteredEpisodes.length === 1 ? 'серия' : 'серий'}
                    </span>
                  </div>

                  {/* Season Cards Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {availableSeasons.map((seasonNum) => {
                      const seasonEpisodes = episodes.filter((e) => (e.seasonNumber || 1) === seasonNum);
                      const isActive = selectedSeason === seasonNum;
                      const watchedCount = seasonEpisodes.filter((e: any) => e.userCompleted || (e.userProgress && e.durationSeconds && e.userProgress / e.durationSeconds > 0.9)).length;

                      return (
                        <div
                          key={seasonNum}
                          onClick={() => setSelectedSeason(seasonNum)}
                          className={`p-4 rounded-2xl cursor-pointer transition-all flex flex-col justify-between gap-3 border ${
                            isActive
                              ? 'bg-cinema-gold/15 border-cinema-gold shadow-glow-gold'
                              : 'bg-cinema-900 border-white/10 hover:border-white/25 hover:bg-cinema-850'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-md ${isActive ? 'bg-cinema-gold text-black' : 'bg-white/10 text-slate-300'}`}>
                              S{seasonNum < 10 ? '0' : ''}{seasonNum}
                            </span>
                            {watchedCount > 0 && (
                              <span className="text-[10px] text-green-400 font-semibold flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                {watchedCount}/{seasonEpisodes.length}
                              </span>
                            )}
                          </div>

                          <div>
                            <h4 className={`text-sm font-extrabold ${isActive ? 'text-cinema-gold' : 'text-white'}`}>
                              Сезон {seasonNum}
                            </h4>
                            <span className="text-[11px] text-slate-400 mt-0.5 block">
                              {seasonEpisodes.length} {seasonEpisodes.length === 1 ? 'эпизод' : 'эпизодов'}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {availableSeasons.length > 1 && (
                      <div
                        onClick={() => setSelectedSeason('all')}
                        className={`p-4 rounded-2xl cursor-pointer transition-all flex flex-col justify-between gap-3 border ${
                          selectedSeason === 'all'
                            ? 'bg-cinema-gold/15 border-cinema-gold shadow-glow-gold'
                            : 'bg-cinema-900 border-white/10 hover:border-white/25 hover:bg-cinema-850'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-md ${selectedSeason === 'all' ? 'bg-cinema-gold text-black' : 'bg-white/10 text-slate-300'}`}>
                            ALL
                          </span>
                        </div>

                        <div>
                          <h4 className={`text-sm font-extrabold ${selectedSeason === 'all' ? 'text-cinema-gold' : 'text-white'}`}>
                            Все сезоны
                          </h4>
                          <span className="text-[11px] text-slate-400 mt-0.5 block">
                            {episodes.length} серий
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Episodes Modernized Grid View */}
                  {loadingEpisodes ? (
                    <div className="py-20 flex flex-col items-center justify-center text-slate-400 gap-3">
                      <div className="w-8 h-8 border-2 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
                      <span className="text-xs">Загрузка серий...</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                      {filteredEpisodes.map((ep) => {
                        const epTitle = cleanEpisodeTitle(ep.title, selectedShow.showTitle, ep.seasonNumber || 1, ep.episodeNumber || 1);
                        const progressPercent = (ep as any).userProgress && ep.durationSeconds
                          ? Math.min(100, Math.round(((ep as any).userProgress / ep.durationSeconds) * 100))
                          : 0;
                        const posterUrl = ep.stillPath || `/api/media/item/${ep.id}/thumbnail`;

                        return (
                          <div
                            key={ep.id}
                            onClick={() => {
                              setSelectedEpisode(ep);
                              setIsEpisodeModalOpen(true);
                            }}
                            className="group relative flex flex-col rounded-2xl overflow-hidden bg-cinema-900 border border-white/10 hover:border-cinema-gold/50 transition-all duration-300 hover:shadow-cinema-card hover:-translate-y-1 cursor-pointer"
                          >
                            {/* 16:9 Episode Thumbnail with Badges */}
                            <div className="relative aspect-video w-full bg-cinema-950 overflow-hidden">
                              <img
                                src={posterUrl}
                                alt={epTitle}
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).src = `/api/media/item/${ep.id}/thumbnail`;
                                }}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-cinema-900 via-cinema-900/20 to-transparent" />

                              {/* Season & Episode pill */}
                              <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                                <span className="bg-black/80 backdrop-blur-md text-cinema-gold font-mono font-bold text-[10px] px-2 py-0.5 rounded-md border border-white/10">
                                  S{ep.seasonNumber || 1} • E{ep.episodeNumber || 1}
                                </span>
                                {ep.rating && ep.rating > 0 && (
                                  <span className="flex items-center gap-1 bg-black/80 backdrop-blur-md text-yellow-400 font-bold text-[10px] px-1.5 py-0.5 rounded-md border border-white/10">
                                    <Star className="w-2.5 h-2.5 fill-current" />
                                    {ep.rating.toFixed(1)}
                                  </span>
                                )}
                              </div>

                              {/* Quick Play Hover Button */}
                              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                                <div className="w-11 h-11 rounded-full bg-cinema-gold text-black flex items-center justify-center shadow-glow-gold transform group-hover:scale-105 transition-transform">
                                  <Play className="w-5 h-5 fill-current ml-0.5" />
                                </div>
                              </div>

                              {/* Bottom duration & resolution */}
                              <div className="absolute bottom-2 right-2 flex items-center gap-1">
                                {ep.durationSeconds > 0 && (
                                  <span className="bg-black/80 backdrop-blur-md text-slate-300 font-mono text-[10px] px-2 py-0.5 rounded-md border border-white/10">
                                    {formatDuration(ep.durationSeconds)}
                                  </span>
                                )}
                                {ep.resolution && (
                                  <span className="bg-black/80 backdrop-blur-md text-cinema-gold font-mono text-[10px] px-1.5 py-0.5 rounded-md border border-white/10">
                                    {ep.resolution}
                                  </span>
                                )}
                              </div>

                              {/* Progress Bar (if watched) */}
                              {progressPercent > 0 && (
                                <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                                  <div className="h-full bg-cinema-gold" style={{ width: `${progressPercent}%` }} />
                                </div>
                              )}
                            </div>

                            {/* Episode Card Text Info */}
                            <div className="p-4 flex flex-col gap-2 flex-1 justify-between">
                              <div>
                                <div className="flex items-center justify-between gap-2">
                                  <h4 className="text-xs font-bold text-white group-hover:text-cinema-gold transition-colors line-clamp-1">
                                    {epTitle}
                                  </h4>
                                  {progressPercent > 0 && (
                                    <span className="text-[10px] text-cinema-gold font-mono font-semibold shrink-0">
                                      {progressPercent}%
                                    </span>
                                  )}
                                </div>

                                {ep.overview && (
                                  <p className="text-[11px] text-slate-400 mt-1.5 line-clamp-2 leading-relaxed">
                                    {ep.overview}
                                  </p>
                                )}
                              </div>

                              {/* Quick Action Footer */}
                              <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[11px] text-slate-400">
                                <span>Нажмите для карточки серии</span>
                                <span className="text-cinema-gold font-bold flex items-center gap-0.5 group-hover:translate-x-1 transition-transform">
                                  <span>Смотреть</span>
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              {loading ? (
                <div className="p-16 flex justify-center items-center">
                  <div className="w-8 h-8 border-2 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
                </div>
              ) : shows.length === 0 ? (
                <div className="p-12 rounded-3xl bg-cinema-900 border border-white/10 text-center text-slate-400">
                  <Tv className="w-12 h-12 text-cinema-gold/40 mx-auto mb-3" />
                  <h3 className="text-base font-bold text-white mb-1">Сериалы не найдены</h3>
                  <p className="text-xs text-slate-500 max-w-md mx-auto mb-5">
                    В этой библиотеке пока нет сериалов. Вы можете добавить целую папку с сериалом или сезонами в панели управления.
                  </p>
                  {isAdmin && (
                    <div className="flex items-center justify-center gap-3">
                      <button
                        onClick={() => navigate('/admin')}
                        className="px-5 py-2.5 rounded-xl bg-cinema-gold text-black text-xs font-bold shadow-glow-gold hover:bg-yellow-400 transition-all cursor-pointer flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Добавить сериал в библиотеку</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {shows.map((show, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleSelectShow(show)}
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

                      <div className="p-3 flex flex-col justify-between flex-1">
                        <div>
                          <h3 className="text-xs font-bold text-slate-200 group-hover:text-cinema-gold transition-colors line-clamp-1">
                            {show.showTitle}
                          </h3>
                          <span className="text-[11px] text-slate-400 mt-0.5 block">
                            {show.totalEpisodes} серий {show.year ? `• ${show.year}` : ''}
                          </span>
                        </div>

                        {isAdmin && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setAccessModalShowTitle(show.showTitle);
                            }}
                            className="mt-2.5 py-1 px-2 rounded-lg bg-white/5 hover:bg-cinema-gold text-slate-400 hover:text-black border border-white/10 hover:border-cinema-gold text-[10px] font-bold transition-all flex items-center justify-center gap-1"
                            title="Настроить доступ к сериалу"
                          >
                            <Lock className="w-3 h-3" />
                            <span>Доступ</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Admin Show Access Modal */}
          {accessModalShowTitle && (
            <ShowAccessModal
              showTitle={accessModalShowTitle}
              isOpen={!!accessModalShowTitle}
              onClose={() => {
                setAccessModalShowTitle(null);
                fetchShows(library.id);
              }}
            />
          )}

          {/* TMDB Show Fix Match Modal */}
          {showMatchModal && (
            <div className="fixed inset-0 bg-black/90 backdrop-blur-xl flex items-center justify-center p-4 z-50 animate-fade-in">
              <div className="bg-cinema-900 border border-white/15 rounded-3xl w-full max-w-2xl p-6 shadow-2xl flex flex-col gap-5 max-h-[85vh] overflow-hidden">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-cinema-gold/10 border border-cinema-gold/20 flex items-center justify-center text-cinema-gold">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white">Исправить сопоставление (TMDB)</h3>
                      <p className="text-xs text-slate-400">Поиск информации о сериале в базе The Movie Database</p>
                    </div>
                  </div>

                  <button
                    onClick={() => setShowMatchModal(false)}
                    className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {matchSuccessMsg && (
                  <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                    <Check className="w-4 h-4 shrink-0" />
                    <span>{matchSuccessMsg}</span>
                  </div>
                )}

                <form onSubmit={handleSearchMatch} className="flex items-center gap-3">
                  <div className="flex-1 relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Название сериала..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-cinema-950 border border-white/10 rounded-2xl pl-10 pr-4 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold"
                    />
                  </div>

                  <input
                    type="text"
                    placeholder="Год (напр. 2018)"
                    value={searchYear}
                    onChange={(e) => setSearchYear(e.target.value)}
                    className="w-28 bg-cinema-950 border border-white/10 rounded-2xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold font-mono"
                  />

                  <button
                    type="submit"
                    disabled={isSearchingMatch || !searchQuery.trim()}
                    className="px-5 py-2.5 rounded-2xl bg-cinema-gold text-black font-bold text-xs shadow-glow-gold hover:bg-yellow-400 transition-all disabled:opacity-50 shrink-0"
                  >
                    {isSearchingMatch ? 'Поиск...' : 'Найти'}
                  </button>
                </form>

                <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
                  {isSearchingMatch ? (
                    <div className="p-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
                      <div className="w-8 h-8 border-2 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
                      <span>Ищем совпадения сериала в базе TMDB...</span>
                    </div>
                  ) : candidates.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs bg-white/5 rounded-2xl border border-white/5">
                      <span>Введите название сериала и нажмите «Найти» для поиска в TMDB</span>
                    </div>
                  ) : (
                    candidates.map((cand, idx) => (
                      <div
                        key={idx}
                        className="p-3.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/15 transition-all flex items-start gap-4"
                      >
                        {cand.posterPath ? (
                          <img
                            src={cand.posterPath}
                            alt={cand.title}
                            className="w-14 aspect-[2/3] object-cover rounded-xl shadow-md shrink-0"
                          />
                        ) : (
                          <div className="w-14 aspect-[2/3] bg-cinema-800 rounded-xl flex items-center justify-center text-slate-600 shrink-0">
                            <Tv className="w-6 h-6" />
                          </div>
                        )}

                        <div className="flex flex-col flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-sm font-bold text-white">{cand.title}</h4>
                            {cand.year && (
                              <span className="text-[10px] text-slate-400 font-mono bg-white/10 px-1.5 py-0.5 rounded">
                                {cand.year}
                              </span>
                            )}
                            {cand.rating && (
                              <span className="text-[10px] text-black font-bold bg-cinema-gold px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                <Star className="w-2.5 h-2.5 fill-black" />
                                {cand.rating.toFixed(1)}
                              </span>
                            )}
                          </div>

                          {cand.originalTitle && cand.originalTitle !== cand.title && (
                            <span className="text-[11px] text-slate-400 mt-0.5">{cand.originalTitle}</span>
                          )}

                          <p className="text-xs text-slate-300 line-clamp-2 mt-1.5 leading-relaxed">
                            {cand.overview || 'Описание отсутствует'}
                          </p>
                        </div>

                        <button
                          onClick={() => handleApplyMatch(cand)}
                          disabled={isApplyingMatch}
                          className="px-4 py-2 rounded-xl bg-cinema-gold hover:bg-yellow-400 text-black text-xs font-bold shadow-glow-gold transition-all shrink-0 self-center disabled:opacity-50"
                        >
                          {isApplyingMatch ? 'Применение...' : 'Выбрать'}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Episode Details Modal */}
          <EpisodeModal
            episode={selectedEpisode}
            showTitle={selectedShow?.showTitle}
            isOpen={isEpisodeModalOpen}
            onClose={() => setIsEpisodeModalOpen(false)}
            onPlayDirect={handlePlayDirect}
            onCreateRoom={handleCreateRoom}
          />
        </>
      )}
    </div>
  );
};
