import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tv, Play, Users, Star, ArrowLeft, Film, Lock, Calendar, Layers, Clock, CheckCircle2, ChevronRight } from 'lucide-react';
import { apiClient } from '../api/client';
import { MediaItem } from '../types';
import { useAuth } from '../context/AuthContext';
import { ShowAccessModal } from '../components/admin/ShowAccessModal';

export const ShowsPage: React.FC = () => {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [shows, setShows] = useState<any[]>([]);
  const [selectedShow, setSelectedShow] = useState<any | null>(null);
  const [episodes, setEpisodes] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<number | 'all'>('all');

  // Show Access Modal state (for admin)
  const [accessModalShowTitle, setAccessModalShowTitle] = useState<string | null>(null);

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

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-8">
      {selectedShow ? (
        <div className="flex flex-col gap-8 animate-fade-in">
          {/* Back button */}
          <button
            onClick={() => setSelectedShow(null)}
            className="flex items-center gap-2 text-xs font-bold text-cinema-gold hover:text-yellow-300 transition-colors w-fit group"
          >
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
            <span>Назад ко всем сериалам</span>
          </button>

          {/* Show Hero / Header */}
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
                    <button
                      onClick={() => setAccessModalShowTitle(selectedShow.showTitle)}
                      className="px-4 py-2.5 rounded-xl bg-cinema-gold/15 hover:bg-cinema-gold text-cinema-gold hover:text-black border border-cinema-gold/40 text-xs font-bold transition-all flex items-center gap-2 active:scale-95"
                      title="Настроить доступ пользователей к этому сериалу"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Управление доступом</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Season Selector Tabs */}
          {availableSeasons.length > 0 && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4 flex-wrap pb-2 border-b border-white/10">
                <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full">
                  {availableSeasons.map((seasonNum) => {
                    const count = episodes.filter((e) => (e.seasonNumber || 1) === seasonNum).length;
                    const isActive = selectedSeason === seasonNum;
                    return (
                      <button
                        key={seasonNum}
                        onClick={() => setSelectedSeason(seasonNum)}
                        className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 whitespace-nowrap transition-all border ${
                          isActive
                            ? 'bg-cinema-gold text-black border-cinema-gold shadow-glow-gold'
                            : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        <span>Сезон {seasonNum}</span>
                        <span className={`text-[10px] px-1.5 py-0.2 rounded-md ${isActive ? 'bg-black/20 text-black' : 'bg-white/10 text-slate-300'}`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}

                  {availableSeasons.length > 1 && (
                    <button
                      onClick={() => setSelectedSeason('all')}
                      className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 whitespace-nowrap transition-all border ${
                        selectedSeason === 'all'
                          ? 'bg-cinema-gold text-black border-cinema-gold shadow-glow-gold'
                            : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <span>Все сезоны</span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-md ${selectedSeason === 'all' ? 'bg-black/20 text-black' : 'bg-white/10 text-slate-300'}`}>
                        {episodes.length}
                      </span>
                    </button>
                  )}
                </div>

                <span className="text-xs text-slate-400 font-mono">
                  {filteredEpisodes.length} {filteredEpisodes.length === 1 ? 'эпизод' : 'эпизодов'}
                </span>
              </div>

              {/* Episodes Grid */}
              {loadingEpisodes ? (
                <div className="py-20 flex flex-col items-center justify-center text-slate-400 gap-3">
                  <div className="w-8 h-8 border-2 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
                  <span className="text-xs">Загрузка серий...</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredEpisodes.map((ep) => {
                    const epTitle = cleanEpisodeTitle(ep.title, selectedShow.showTitle, ep.seasonNumber || 1, ep.episodeNumber || 1);
                    const progressPercent = ep.userProgress && ep.durationSeconds
                      ? Math.min(100, Math.round((ep.userProgress / ep.durationSeconds) * 100))
                      : 0;

                    return (
                      <div
                        key={ep.id}
                        className="group relative flex flex-col justify-between p-4 rounded-2xl bg-cinema-900 border border-white/10 hover:border-cinema-gold/50 transition-all duration-300 hover:shadow-cinema-card"
                      >
                        <div className="flex flex-col gap-3">
                          {/* Top Row: Episode Badge & Meta */}
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-11 h-11 rounded-xl bg-cinema-gold/15 text-cinema-gold font-extrabold text-xs flex flex-col items-center justify-center shrink-0 border border-cinema-gold/25 group-hover:bg-cinema-gold group-hover:text-black transition-colors">
                                <span className="text-[10px] leading-tight opacity-75">S{ep.seasonNumber || 1}</span>
                                <span className="text-xs leading-tight font-black">E{ep.episodeNumber || 1}</span>
                              </div>
                              <div className="min-w-0">
                                <h4 className="text-xs font-bold text-white group-hover:text-cinema-gold transition-colors line-clamp-1">
                                  {epTitle}
                                </h4>
                                <span className="text-[11px] text-slate-400 block mt-0.5">
                                  Сезон {ep.seasonNumber || 1} • Серия {ep.episodeNumber || 1}
                                </span>
                              </div>
                            </div>

                            {ep.resolution && (
                              <span className="text-[10px] font-mono text-cinema-gold bg-cinema-gold/10 px-2 py-0.5 rounded-md shrink-0 border border-cinema-gold/20">
                                {ep.resolution}
                              </span>
                            )}
                          </div>

                          {/* Technical info pill tags */}
                          <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono flex-wrap">
                            {ep.durationSeconds > 0 && (
                              <span className="flex items-center gap-1 bg-white/5 px-2 py-0.5 rounded-md">
                                <Clock className="w-3 h-3 text-slate-500" />
                                {formatDuration(ep.durationSeconds)}
                              </span>
                            )}
                            {ep.videoCodec && (
                              <span className="bg-white/5 px-2 py-0.5 rounded-md uppercase">
                                {ep.videoCodec}
                              </span>
                            )}
                            {ep.audioCodec && (
                              <span className="bg-white/5 px-2 py-0.5 rounded-md uppercase">
                                {ep.audioCodec}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Progress Bar (if watched) */}
                        {progressPercent > 0 && (
                          <div className="mt-3">
                            <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-cinema-gold transition-all duration-300"
                                style={{ width: `${progressPercent}%` }}
                              />
                            </div>
                            <span className="text-[9px] text-slate-400 mt-1 block font-mono">
                              Просмотрено {progressPercent}%
                            </span>
                          </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-white/5">
                          <button
                            onClick={() => handlePlayDirect(ep)}
                            className="flex-1 py-2 px-3 rounded-xl bg-cinema-gold text-black hover:bg-yellow-400 font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-glow-gold transition-all active:scale-95"
                          >
                            <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                            <span>Смотреть</span>
                          </button>

                          <button
                            onClick={() => handleCreateRoom(ep)}
                            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 transition-colors"
                            title="Смотреть совместно с друзьями в комнате"
                          >
                            <Users className="w-4 h-4 text-cinema-gold" />
                          </button>
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
                  : 'Вам пока не открыт доступ к сериалам медиатеки. Администратор сервера может открыть вам доступ к отдельным сериалам или библиотекам.'}
              </p>
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

                    {/* Rating Badge */}
                    {show.rating && show.rating > 0 && (
                      <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/70 backdrop-blur-md px-2 py-0.5 rounded-lg border border-white/10 text-cinema-gold text-[10px] font-black shadow-lg">
                        <Star className="w-3 h-3 fill-current" />
                        <span>{show.rating.toFixed(1)}</span>
                      </div>
                    )}

                    {/* Seasons pill */}
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
        </div>
      )}

      {/* Admin Show Access Modal */}
      {accessModalShowTitle && (
        <ShowAccessModal
          showTitle={accessModalShowTitle}
          isOpen={!!accessModalShowTitle}
          onClose={() => {
            setAccessModalShowTitle(null);
            fetchShows();
          }}
        />
      )}
    </div>
  );
};
