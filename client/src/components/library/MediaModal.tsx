import React, { useState, useEffect } from 'react';
import { X, Play, Users, Star, Clock, Disc3, Subtitles, Film, HardDrive, Sparkles, Search, Check, Trash2, Edit3, Lock } from 'lucide-react';
import { apiClient } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { MediaItem } from '../../types';
import { MediaAccessModal } from '../admin/MediaAccessModal';

interface MediaModalProps {
  mediaId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onPlayDirect: (media: MediaItem) => void;
  onCreateRoom: (media: MediaItem) => void;
  onMediaUpdated?: () => void;
}

export const MediaModal: React.FC<MediaModalProps> = ({
  mediaId,
  isOpen,
  onClose,
  onPlayDirect,
  onCreateRoom,
  onMediaUpdated,
}) => {
  const { isAdmin } = useAuth();
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAccessModal, setShowAccessModal] = useState(false);

  // Fix Match State
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchYear, setSearchYear] = useState<string>('');
  const [candidates, setCandidates] = useState<any[]>([]);
  const [isSearchingMatch, setIsSearchingMatch] = useState(false);
  const [isApplyingMatch, setIsApplyingMatch] = useState(false);
  const [matchSuccessMsg, setMatchSuccessMsg] = useState('');

  const fetchMedia = () => {
    if (!mediaId) return;
    setLoading(true);
    apiClient.get(`/media/item/${mediaId}`)
      .then((res) => {
        setMedia(res.data.media);
        setSearchQuery(res.data.media?.title || '');
        setSearchYear(res.data.media?.year ? String(res.data.media.year) : '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (isOpen && mediaId) {
      fetchMedia();
    }
  }, [isOpen, mediaId]);

  const handleSearchMatch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!mediaId || !searchQuery.trim()) return;

    setIsSearchingMatch(true);
    try {
      const type = media?.type === 'EPISODE' ? 'SHOW' : 'MOVIE';
      const res = await apiClient.get(`/media/${mediaId}/match-search`, {
        params: {
          query: searchQuery.trim(),
          year: searchYear.trim() ? parseInt(searchYear.trim(), 10) : undefined,
          type,
        },
      });
      setCandidates(res.data.candidates || []);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка поиска в TMDB');
    } finally {
      setIsSearchingMatch(false);
    }
  };

  const handleApplyMatch = async (candidate: any) => {
    if (!mediaId) return;
    setIsApplyingMatch(true);
    try {
      const res = await apiClient.post(`/media/${mediaId}/match-apply`, candidate);
      setMedia(res.data.media);
      setMatchSuccessMsg('Метаданные фильма успешно обновлены!');
      setTimeout(() => {
        setMatchSuccessMsg('');
        setShowMatchModal(false);
      }, 1200);
      onMediaUpdated?.();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка применения сопоставления');
    } finally {
      setIsApplyingMatch(false);
    }
  };

  const handleDeleteMedia = async () => {
    if (!mediaId) return;
    if (!confirm('Вы действительно хотите удалить этот медиафайл из базы данных? (Исходный файл на диске останется)')) return;
    try {
      await apiClient.delete(`/media/${mediaId}`);
      onMediaUpdated?.();
      onClose();
    } catch (err: any) {
      alert('Ошибка при удалении медиафайла');
    }
  };

  if (!isOpen || !mediaId) return null;

  const formatDuration = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return `${h > 0 ? `${h}ч ` : ''}${m}мин`;
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '';
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(2)} ГБ`;
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-cinema-900 border border-white/15 rounded-3xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col relative max-h-[90vh]">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-30 p-2.5 rounded-full bg-black/60 hover:bg-black text-slate-300 hover:text-white border border-white/10 backdrop-blur-md transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {loading || !media ? (
          <div className="p-16 flex flex-col items-center justify-center gap-3 text-slate-400">
            <div className="w-10 h-10 border-4 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
            <span className="text-xs">Загрузка информации о медиа...</span>
          </div>
        ) : (
          <div className="overflow-y-auto">
            {/* Header Backdrop Banner */}
            <div className="relative h-64 md:h-80 w-full overflow-hidden bg-cinema-950">
              {media.backdropPath || media.posterPath ? (
                <img
                  src={media.backdropPath || media.posterPath}
                  alt={media.title}
                  className="w-full h-full object-cover object-top filter brightness-85"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-600">
                  <Film className="w-16 h-16" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-cinema-900 via-cinema-900/40 to-transparent" />

              <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    {media.rating && media.rating > 0 && (
                      <span className="flex items-center gap-1 text-xs font-bold bg-cinema-gold text-black px-2.5 py-0.5 rounded-lg shadow-glow-gold">
                        <Star className="w-3.5 h-3.5 fill-black" />
                        {media.rating.toFixed(1)}
                      </span>
                    )}
                    {media.year && (
                      <span className="text-xs text-slate-300 bg-white/10 px-2 py-0.5 rounded-lg backdrop-blur-md">
                        {media.year}
                      </span>
                    )}
                    {media.durationSeconds > 0 && (
                      <span className="text-xs text-slate-300 flex items-center gap-1 bg-white/10 px-2 py-0.5 rounded-lg backdrop-blur-md">
                        <Clock className="w-3 h-3" />
                        {formatDuration(media.durationSeconds)}
                      </span>
                    )}
                  </div>
                  <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">{media.title}</h2>
                  {media.originalTitle && media.originalTitle !== media.title && (
                    <span className="text-xs text-slate-400 font-medium">{media.originalTitle}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Body Info */}
            <div className="p-6 md:p-8 flex flex-col gap-6">
              {/* Actions */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => {
                    onClose();
                    onPlayDirect(media);
                  }}
                  className="px-6 py-3 rounded-2xl bg-cinema-gold text-black font-bold text-xs md:text-sm flex items-center gap-2 shadow-glow-gold hover:bg-yellow-400 transition-all"
                >
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                  <span>Смотреть</span>
                </button>

                <button
                  onClick={() => {
                    onClose();
                    onCreateRoom(media);
                  }}
                  className="px-6 py-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs md:text-sm flex items-center gap-2 border border-white/10 backdrop-blur-md transition-all"
                >
                  <Users className="w-4 h-4 text-cinema-gold" />
                  <span>Создать комнату совместного просмотра</span>
                </button>

                {isAdmin && (
                  <>
                    <button
                      onClick={() => setShowAccessModal(true)}
                      className="px-4 py-3 rounded-2xl bg-cinema-gold/15 hover:bg-cinema-gold text-cinema-gold hover:text-black font-semibold text-xs md:text-sm flex items-center gap-2 border border-cinema-gold/30 transition-all active:scale-95"
                      title="Управление доступом пользователей к этому фильму/сериалу"
                    >
                      <Lock className="w-4 h-4" />
                      <span>Доступ</span>
                    </button>

                    <button
                      onClick={() => {
                        setShowMatchModal(true);
                        handleSearchMatch();
                      }}
                      className="px-4 py-3 rounded-2xl bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white font-semibold text-xs md:text-sm flex items-center gap-2 border border-white/10 transition-all"
                      title="Найти фильм в базе TMDB и обновить постер, описание и год"
                    >
                      <Sparkles className="w-4 h-4 text-cinema-gold" />
                      <span>Исправить сопоставление (TMDB)</span>
                    </button>

                    <button
                      onClick={handleDeleteMedia}
                      className="p-3 rounded-2xl bg-white/5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 border border-white/10 transition-all ml-auto"
                      title="Удалить из медиатеки"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>

              {/* Synopsis */}
              {media.overview && (
                <div className="flex flex-col gap-1.5">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Описание</h4>
                  <p className="text-xs md:text-sm text-slate-200 leading-relaxed">{media.overview}</p>
                </div>
              )}

              {/* Technical Specifications */}
              <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex flex-col gap-3">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <HardDrive className="w-3.5 h-3.5 text-cinema-gold" />
                  Технические параметры файла
                </h4>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Разрешение:</span>
                    <span className="font-semibold text-slate-200">{media.resolution || 'Auto'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Видеокодек:</span>
                    <span className="font-semibold text-slate-200 uppercase font-mono">{media.videoCodec || 'h264'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Основной звук:</span>
                    <span className="font-semibold text-slate-200 uppercase font-mono">{media.audioCodec || 'aac'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Размер файла:</span>
                    <span className="font-semibold text-slate-200">{formatFileSize(media.fileSize)}</span>
                  </div>
                </div>

                {/* Available Audio and Subtitle Tracks */}
                {media.tracks && media.tracks.length > 0 && (
                  <div className="mt-2 pt-3 border-t border-white/10 flex flex-col gap-2">
                    <span className="text-[11px] font-semibold text-slate-300">Доступные дорожки в контейнере:</span>
                    <div className="flex flex-wrap gap-2">
                      {media.tracks.map((t, idx) => (
                        <span
                          key={t.id || idx}
                          className="flex items-center gap-1 text-[11px] bg-white/10 px-2.5 py-1 rounded-lg text-slate-200 border border-white/5"
                        >
                          {t.type === 'AUDIO' ? (
                            <Disc3 className="w-3 h-3 text-cinema-gold" />
                          ) : (
                            <Subtitles className="w-3 h-3 text-cyan-400" />
                          )}
                          <span>
                            {t.title || `${t.type === 'AUDIO' ? 'Аудио' : 'Субтитры'} #${t.streamIndex}`}
                            {t.language ? ` (${t.language.toUpperCase()})` : ''}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* TMDB Fix Match Modal */}
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
                  <p className="text-xs text-slate-400">Поиск информации о фильме в базе The Movie Database</p>
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

            {/* Search Input Bar */}
            <form onSubmit={handleSearchMatch} className="flex items-center gap-3">
              <div className="flex-1 relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Название фильма или сериала..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-cinema-950 border border-white/10 rounded-2xl pl-10 pr-4 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold"
                />
              </div>

              <input
                type="text"
                placeholder="Год (напр. 2012)"
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

            {/* Candidate List */}
            <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
              {isSearchingMatch ? (
                <div className="p-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-2 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
                  <span>Ищем совпадения в базе TMDB...</span>
                </div>
              ) : candidates.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs bg-white/5 rounded-2xl border border-white/5">
                  <span>Введите название и нажмите «Найти» для поиска в TMDB</span>
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
                        <Film className="w-6 h-6" />
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

      {/* Media Access Modal */}
      <MediaAccessModal
        mediaId={media?.id || null}
        mediaTitle={media?.title || ''}
        isOpen={showAccessModal}
        onClose={() => setShowAccessModal(false)}
      />
    </div>
  );
};
