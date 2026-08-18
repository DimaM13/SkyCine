import React, { useState, useEffect } from 'react';
import { X, Folder, Film, Tv, Check, Search, Lock } from 'lucide-react';
import { apiClient } from '../../api/client';

interface UserAccessModalProps {
  userId: string | null;
  username: string;
  isOpen: boolean;
  onClose: () => void;
}

export const UserAccessModal: React.FC<UserAccessModalProps> = ({
  userId,
  username,
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'libraries' | 'shows' | 'movies'>('libraries');
  const [libraries, setLibraries] = useState<any[]>([]);
  const [movies, setMovies] = useState<any[]>([]);
  const [shows, setShows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const fetchPermissions = () => {
    if (!userId) return;
    setLoading(true);
    apiClient.get(`/admin/permissions/user/${userId}`)
      .then((res) => {
        setLibraries(res.data.libraries || []);
        setMovies(res.data.movies || res.data.mediaItems || []);
        setShows(res.data.shows || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (isOpen && userId) {
      fetchPermissions();
    }
  }, [isOpen, userId]);

  if (!isOpen || !userId) return null;

  const toggleLibrary = (libId: string) => {
    setLibraries((prev) =>
      prev.map((l) => (l.id === libId ? { ...l, hasAccess: l.hasAccess ? 0 : 1 } : l))
    );
  };

  const toggleMovie = (movieId: string) => {
    setMovies((prev) =>
      prev.map((m) =>
        m.id === movieId ? { ...m, hasDirectAccess: m.hasDirectAccess ? 0 : 1 } : m
      )
    );
  };

  const toggleShow = (showTitle: string) => {
    setShows((prev) =>
      prev.map((s) =>
        s.showTitle === showTitle ? { ...s, hasDirectAccess: s.hasDirectAccess ? 0 : 1 } : s
      )
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const allowedLibraryIds = libraries.filter((l) => l.hasAccess === 1).map((l) => l.id);
      const allowedMovieIds = movies.filter((m) => m.hasDirectAccess === 1).map((m) => m.id);
      const allowedShowTitles = shows.filter((s) => s.hasDirectAccess === 1).map((s) => s.showTitle);

      await apiClient.post(`/admin/permissions/user/${userId}`, {
        libraryIds: allowedLibraryIds,
        mediaItemIds: allowedMovieIds,
        showTitles: allowedShowTitles,
      });

      setSuccessMsg('Права пользователя успешно сохранены!');
      setTimeout(() => {
        setSuccessMsg('');
        onClose();
      }, 1000);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка сохранения прав');
    } finally {
      setSaving(false);
    }
  };

  const filteredMovies = movies.filter(
    (m) =>
      m.title.toLowerCase().includes(search.toLowerCase()) ||
      (m.libraryName && m.libraryName.toLowerCase().includes(search.toLowerCase()))
  );

  const filteredShows = shows.filter(
    (s) =>
      s.showTitle.toLowerCase().includes(search.toLowerCase()) ||
      (s.libraryName && s.libraryName.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-xl rounded-3xl bg-cinema-900 border border-white/10 p-6 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cinema-gold/20 flex items-center justify-center text-cinema-gold border border-cinema-gold/30">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Настройка прав доступа</h3>
              <p className="text-xs text-slate-400">Пользователь: <strong className="text-cinema-gold">{username}</strong></p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 my-3 shrink-0">
          <button
            onClick={() => setActiveTab('libraries')}
            className={`flex-1 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border transition-all ${
              activeTab === 'libraries'
                ? 'bg-cinema-gold text-black border-cinema-gold shadow-glow-gold'
                : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Folder className="w-3.5 h-3.5" />
            <span>Библиотеки ({libraries.filter(l => l.hasAccess).length})</span>
          </button>

          <button
            onClick={() => setActiveTab('shows')}
            className={`flex-1 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border transition-all ${
              activeTab === 'shows'
                ? 'bg-cinema-gold text-black border-cinema-gold shadow-glow-gold'
                : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Tv className="w-3.5 h-3.5" />
            <span>Сериалы ({shows.filter(s => s.hasDirectAccess || s.hasAccess).length})</span>
          </button>

          <button
            onClick={() => setActiveTab('movies')}
            className={`flex-1 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border transition-all ${
              activeTab === 'movies'
                ? 'bg-cinema-gold text-black border-cinema-gold shadow-glow-gold'
                : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Фильмы ({movies.filter(m => m.hasDirectAccess || m.hasAccess).length})</span>
          </button>
        </div>

        {successMsg && (
          <div className="mb-3 p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
            <Check className="w-4 h-4" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Tab Content: Libraries */}
        {activeTab === 'libraries' && (
          <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2 min-h-[200px]">
            {loading ? (
              <div className="flex items-center justify-center h-40 text-slate-400 text-xs">Загрузка...</div>
            ) : libraries.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-slate-500 text-xs">Библиотеки отсутствуют</div>
            ) : (
              libraries.map((lib) => (
                <div
                  key={lib.id}
                  onClick={() => toggleLibrary(lib.id)}
                  className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between cursor-pointer ${
                    lib.hasAccess
                      ? 'bg-cinema-gold/10 border-cinema-gold/40 hover:bg-cinema-gold/15'
                      : 'bg-white/5 border-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-cinema-800 flex items-center justify-center text-slate-300">
                      <Folder className="w-5 h-5 text-cinema-gold" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white">{lib.name}</h4>
                      <span className="text-[11px] text-slate-400 uppercase tracking-wider font-mono">
                        {lib.type === 'MOVIES' ? 'Фильмы' : 'Сериалы'}
                      </span>
                    </div>
                  </div>

                  <div
                    className={`w-6 h-6 rounded-lg border flex items-center justify-center transition-colors ${
                      lib.hasAccess
                        ? 'bg-cinema-gold border-cinema-gold text-black'
                        : 'border-white/20 bg-black/40 text-transparent'
                    }`}
                  >
                    <Check className="w-4 h-4 stroke-[3]" />
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab Content: Shows */}
        {activeTab === 'shows' && (
          <div className="flex-1 flex flex-col min-h-[200px] overflow-hidden">
            <div className="mb-2 shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Поиск сериалов..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cinema-gold"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2">
              {loading ? (
                <div className="flex items-center justify-center h-40 text-slate-400 text-xs">Загрузка...</div>
              ) : filteredShows.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-slate-500 text-xs">Сериалы не найдены</div>
              ) : (
                filteredShows.map((s) => {
                  const isViaLib = libraries.find((l) => l.id === s.libraryId)?.hasAccess === 1;
                  const isChecked = isViaLib || s.hasDirectAccess === 1;

                  return (
                    <div
                      key={s.showTitle}
                      onClick={() => !isViaLib && toggleShow(s.showTitle)}
                      className={`p-3 rounded-2xl border transition-all flex items-center justify-between cursor-pointer ${
                        isChecked
                          ? 'bg-cinema-gold/10 border-cinema-gold/40 hover:bg-cinema-gold/15'
                          : 'bg-white/5 border-white/5 hover:bg-white/10'
                      } ${isViaLib ? 'opacity-70 cursor-default' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        {s.posterPath ? (
                          <img src={s.posterPath} alt={s.showTitle} className="w-9 h-12 object-cover rounded-lg bg-cinema-800 shrink-0" />
                        ) : (
                          <div className="w-9 h-12 bg-cinema-800 rounded-lg flex items-center justify-center shrink-0">
                            <Tv className="w-5 h-5 text-cinema-gold/50" />
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs font-bold text-white line-clamp-1">{s.showTitle}</h4>
                            {isViaLib && (
                              <span className="text-[9px] bg-sky-500/20 text-sky-300 border border-sky-500/30 px-1.5 py-0.2 rounded shrink-0">
                                Из библиотеки
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400 block">
                            {s.totalEpisodes} серий • {s.libraryName || 'Медиатека'}
                          </span>
                        </div>
                      </div>

                      <div
                        className={`w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                          isChecked
                            ? 'bg-cinema-gold border-cinema-gold text-black'
                            : 'border-white/20 bg-black/40 text-transparent'
                        }`}
                      >
                        <Check className="w-4 h-4 stroke-[3]" />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Tab Content: Movies */}
        {activeTab === 'movies' && (
          <div className="flex-1 flex flex-col min-h-[200px] overflow-hidden">
            <div className="mb-2 shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Поиск фильмов..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cinema-gold"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2">
              {loading ? (
                <div className="flex items-center justify-center h-40 text-slate-400 text-xs">Загрузка...</div>
              ) : filteredMovies.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-slate-500 text-xs">Фильмы не найдены</div>
              ) : (
                filteredMovies.map((m) => {
                  const isViaLib = libraries.find((l) => l.id === m.libraryId)?.hasAccess === 1;
                  const isChecked = isViaLib || m.hasDirectAccess === 1;

                  return (
                    <div
                      key={m.id}
                      onClick={() => !isViaLib && toggleMovie(m.id)}
                      className={`p-2.5 rounded-2xl border transition-all flex items-center justify-between cursor-pointer ${
                        isChecked
                          ? 'bg-cinema-gold/10 border-cinema-gold/40 hover:bg-cinema-gold/15'
                          : 'bg-white/5 border-white/5 hover:bg-white/10'
                      } ${isViaLib ? 'opacity-70 cursor-default' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        {m.posterPath ? (
                          <img src={m.posterPath} alt={m.title} className="w-8 h-11 object-cover rounded-lg bg-cinema-800 shrink-0" />
                        ) : (
                          <div className="w-8 h-11 bg-cinema-800 rounded-lg flex items-center justify-center shrink-0">
                            <Film className="w-4 h-4 text-cinema-gold/40" />
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs font-bold text-white line-clamp-1">{m.title}</h4>
                            {isViaLib && (
                              <span className="text-[9px] bg-sky-500/20 text-sky-300 border border-sky-500/30 px-1.5 py-0.2 rounded shrink-0">
                                Из библиотеки
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400 block">
                            {m.year || ''} • {m.libraryName || 'Медиатека'}
                          </span>
                        </div>
                      </div>

                      <div
                        className={`w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                          isChecked
                            ? 'bg-cinema-gold border-cinema-gold text-black'
                            : 'border-white/20 bg-black/40 text-transparent'
                        }`}
                      >
                        <Check className="w-4 h-4 stroke-[3]" />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="pt-4 mt-3 border-t border-white/10 flex items-center justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 text-xs font-semibold transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-xl bg-cinema-gold text-black font-bold text-xs shadow-glow-gold hover:bg-yellow-400 active:scale-95 transition-all disabled:opacity-50"
          >
            {saving ? 'Сохранение...' : 'Сохранить доступ'}
          </button>
        </div>
      </div>
    </div>
  );
};
