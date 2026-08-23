import { LazyImage } from '../components/library/LazyImage';
import { InfiniteScroll } from '../components/library/InfiniteScroll';
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Tv, Play, Users, Star, ArrowLeft, Film, Lock, Calendar, Layers, Clock,
  CheckCircle2, ChevronRight, Sparkles, X, Search, Check, RotateCcw
} from 'lucide-react';
import { apiClient } from '../api/client';
import { MediaItem } from '../types';
import { useAuth } from '../context/AuthContext';
import { ShowAccessModal } from '../components/admin/ShowAccessModal';
import { EpisodeModal } from '../components/library/EpisodeModal';

export const ShowsPage: React.FC = () => {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [shows, setShows] = useState<any[]>([]);
  const [visibleCount, setVisibleCount] = useState(50);
  const [selectedShow, setSelectedShow] = useState<any | null>(null);
  const [episodes, setEpisodes] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<number | 'all'>('all');

  // Episode Modal state
  const [selectedEpisode, setSelectedEpisode] = useState<MediaItem | null>(null);
  const [isEpisodeModalOpen, setIsEpisodeModalOpen] = useState(false);

  // Show Access Modal state (for admin)
  const [accessModalShowTitle, setAccessModalShowTitle] = useState<string | null>(null);

  // TMDB Fix Match state (for admin)
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchYear, setSearchYear] = useState('');
  const [candidates, setCandidates] = useState<any[]>([]);
  const [isSearchingMatch, setIsSearchingMatch] = useState(false);
  const [isApplyingMatch, setIsApplyingMatch] = useState(false);
  const [matchSuccessMsg, setMatchSuccessMsg] = useState('');

  const fetchShows = () => {
    setLoading(true);
    apiClient.get('/media/shows')
      .then((res) => setShows(res.data.shows || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchShows();
  }, []);

  const handleSelectShow = (show: any) => {
    setSelectedShow(show);
    setSelectedSeason('all');
    setLoadingEpisodes(true);
    apiClient.get(`/media/shows/${encodeURIComponent(show.showTitle)}/episodes`)
      .then((res) => {
        const eps = res.data.episodes || [];
        setEpisodes(eps);
        // Auto select first season if available
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

  const handleOpenEpisodeModal = (ep: MediaItem) => {
    setSelectedEpisode(ep);
    setIsEpisodeModalOpen(true);
  };

  const handlePlayDirect = (media: MediaItem, startPos?: number) => {
    if (startPos !== undefined && startPos > 0) {
      navigate(`/watch/${media.id}?start=${Math.floor(startPos)}`);
    } else {
      navigate(`/watch/${media.id}`);
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

  const formatDuration = (sec: number) => {
    if (!sec || isNaN(sec)) return '';
    const m = Math.round(sec / 60);
    return `${m} мин`;
  };

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

  const handleOpenMatchModal = () => {
    if (!selectedShow) return;
    setSearchQuery(selectedShow.showTitle);
    setSearchYear(selectedShow.year ? String(selectedShow.year) : '');
    setCandidates([]);
    setMatchSuccessMsg('');
    setShowMatchModal(true);
    // Automatically trigger search
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
      setMatchSuccessMsg('Метаданные сериала и всех серий успешно обновлены!');
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

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-8">
      {selectedShow ? (
        <div className="flex flex-col gap-8 animate-fade-in">
          {/* Back button */}
          <button
            onClick={() => setSelectedShow(null)}
            className="flex items-center gap-2 text-xs font-bold text-cinema-gold hover:text-yellow-300 transition-colors w-fit group cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
            <span>Назад ко всем сериалам</span>
          </button>

          {/* Show Hero / Header */}
          <div className="relative rounded-3xl overflow-hidden bg-cinema-900 border border-white/10 shadow-2xl">
            {selectedShow.backdropPath && (
              <div className="absolute inset-0 z-0 opacity-25 bg-cover bg-center pointer-events-none" style={{ backgroundImage: `url(${selectedShow.backdropPath})` }}>
                <div className="absolute inset-0 bg-gradient-to-t from-cinema-950 via-cinema-950/80 to-transparent" />
              </div>
            )}

            <div className="relative z-10 p-6 md:p-8 flex flex-col md:flex-row gap-6 md:gap-8 items-start">
              {selectedShow.posterPath ? (
                <LazyImage
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
                      onClick={() => handleOpenEpisodeModal(episodes[0])}
                      className="px-5 py-2.5 rounded-xl bg-cinema-gold text-black font-extrabold text-xs flex items-center gap-2 hover:bg-yellow-400 shadow-glow-gold transition-all active:scale-95 cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                      <span>Смотреть с 1-й серии</span>
                    </button>
                  )}

                  {isAdmin && (
                    <>
                      <button
                        onClick={handleOpenMatchModal}
                        className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/20 text-xs font-bold transition-all flex items-center gap-2 active:scale-95 cursor-pointer"
                        title="Найти сериал в TMDB и автоматически загрузить названия, описания и постеры всех серий"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-cinema-gold" />
                        <span>Исправить сопоставление (TMDB)</span>
                      </button>

                      <button
                        onClick={() => setAccessModalShowTitle(selectedShow.showTitle)}
                        className="px-4 py-2.5 rounded-xl bg-cinema-gold/15 hover:bg-cinema-gold text-cinema-gold hover:text-black border border-cinema-gold/40 text-xs font-bold transition-all flex items-center gap-2 active:scale-95 cursor-pointer"
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
                        onClick={() => handleOpenEpisodeModal(ep)}
                        className="group relative flex flex-col rounded-2xl overflow-hidden bg-cinema-900 border border-white/10 hover:border-cinema-gold/50 transition-all duration-300 hover:shadow-cinema-card hover:-translate-y-1 cursor-pointer"
                      >
                        {/* 16:9 Episode Thumbnail with Badges */}
                        <div className="relative aspect-video w-full bg-cinema-950 overflow-hidden">
                          <LazyImage
                            src={posterUrl}
                            alt={epTitle}
                            loading="lazy"
                            onError={(e) => {
                              const target = e.currentTarget as HTMLImageElement;
                              if (!target.src.includes('/thumbnail')) {
                                target.src = `/api/media/item/${ep.id}/thumbnail`;
                              } else {
                                target.onerror = null;
                                target.style.opacity = '0.3';
                              }
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
                            <span>Нажмите для подробностей</span>
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
        /* Shows Catalog Grid View */
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
              <Tv className="w-7 h-7 text-cinema-gold" />
              Сериалы ({shows.length})
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Коллекция сериалов с разбивкой по сезонам, сериям и индивидуальным доступом
            </p>
          </div>

          {loading ? (
            <div className="py-24 flex flex-col items-center justify-center text-slate-400 gap-3">
              <div className="w-8 h-8 border-2 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
              <span className="text-xs">Загрузка каталога сериалов...</span>
            </div>
          ) : shows.length === 0 ? (
            <div className="p-12 rounded-3xl bg-cinema-900 border border-white/10 text-center text-slate-400">
              <Tv className="w-12 h-12 text-cinema-gold/40 mx-auto mb-3" />
              <h3 className="text-base font-bold text-white mb-1">Сериалы не найдены</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto mb-4">
                {isAdmin
                  ? 'Добавьте папку с сериалами в панели сервера'
                  : 'Администратор пока не добавил сериалы или не предоставил доступ к ним'}
              </p>
              {isAdmin && (
                <button
                  onClick={() => navigate('/admin')}
                  className="px-5 py-2.5 rounded-xl bg-cinema-gold text-black text-xs font-bold shadow-glow-gold hover:bg-yellow-400 transition-colors"
                >
                  Перейти в панель сервера
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {shows.slice(0, visibleCount).map((show, idx) => (
                <div
                  key={idx}
                  onClick={() => handleSelectShow(show)}
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
          )}
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

      {/* Show Access Modal */}
      {accessModalShowTitle && (
        <ShowAccessModal
          showTitle={accessModalShowTitle}
          isOpen={true}
          onClose={() => {
            setAccessModalShowTitle(null);
            fetchShows();
          }}
        />
      )}

      {/* TMDB Show Fix Match Modal */}
      {showMatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-2xl bg-cinema-900 border border-white/15 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-5 h-5 text-cinema-gold" />
                <h3 className="text-base font-extrabold text-white">Сопоставление сериала с TMDB</h3>
              </div>
              <button
                onClick={() => setShowMatchModal(false)}
                className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSearchMatch} className="p-6 border-b border-white/10 flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Название сериала (на русском или английском)..."
                  className="w-full bg-cinema-950 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cinema-gold/60"
                />
              </div>

              <input
                type="number"
                value={searchYear}
                onChange={(e) => setSearchYear(e.target.value)}
                placeholder="Год (опц.)"
                className="w-24 bg-cinema-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cinema-gold/60"
              />

              <button
                type="submit"
                disabled={isSearchingMatch}
                className="px-5 py-2.5 rounded-xl bg-cinema-gold text-black font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-glow-gold hover:bg-yellow-400 disabled:opacity-50 cursor-pointer"
              >
                {isSearchingMatch ? <div className="w-3.5 h-3.5 border-2 border-black/20 border-t-black rounded-full animate-spin"></div> : <Search className="w-3.5 h-3.5" />}
                <span>Найти</span>
              </button>
            </form>

            {matchSuccessMsg && (
              <div className="p-4 bg-green-500/20 border-b border-green-500/30 text-green-300 text-xs font-bold flex items-center gap-2">
                <Check className="w-4 h-4" />
                <span>{matchSuccessMsg}</span>
              </div>
            )}

            <div className="p-6 overflow-y-auto flex flex-col gap-3 flex-1">
              {isSearchingMatch ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                  <div className="w-6 h-6 border-2 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
                  <span className="text-xs">Поиск сериала в The Movie Database...</span>
                </div>
              ) : candidates.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">
                  Введите название сериала и нажмите «Найти» для поиска кандидатов
                </div>
              ) : (
                candidates.map((cand, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-2xl bg-white/5 border border-white/10 hover:border-cinema-gold/50 flex gap-4 items-start transition-all"
                  >
                    {cand.posterPath ? (
                      <LazyImage src={cand.posterPath} alt={cand.title} className="w-16 h-24 rounded-xl object-cover shrink-0" />
                    ) : (
                      <div className="w-16 h-24 rounded-xl bg-cinema-800 flex items-center justify-center text-slate-600 shrink-0">
                        <Tv className="w-6 h-6" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-xs font-bold text-white">{cand.title}</h4>
                        {cand.year && <span className="text-[10px] text-slate-400 font-semibold">({cand.year})</span>}
                        {cand.rating > 0 && (
                          <span className="flex items-center gap-0.5 text-[10px] text-cinema-gold font-bold bg-black/40 px-1.5 py-0.5 rounded">
                            <Star className="w-2.5 h-2.5 fill-current" />
                            {cand.rating.toFixed(1)}
                          </span>
                        )}
                      </div>

                      {cand.originalTitle && cand.originalTitle !== cand.title && (
                        <span className="text-[10px] text-slate-500 block mt-0.5">{cand.originalTitle}</span>
                      )}

                      {cand.overview && (
                        <p className="text-[11px] text-slate-400 mt-1.5 line-clamp-2 leading-relaxed">
                          {cand.overview}
                        </p>
                      )}

                      <button
                        onClick={() => handleApplyMatch(cand)}
                        disabled={isApplyingMatch}
                        className="mt-3 px-4 py-1.5 rounded-lg bg-cinema-gold text-black font-bold text-[11px] flex items-center gap-1 hover:bg-yellow-400 shadow-glow-gold disabled:opacity-50 cursor-pointer"
                      >
                        <Check className="w-3 h-3" />
                        <span>Выбрать это совпадение</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
