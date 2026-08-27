import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Radio, Plus, Users, Play, Key, Film, Search, Trash2,
  Video, Sparkles, CheckCircle2, AlertCircle, ExternalLink
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Room, MediaItem } from '../types';

export const RoomsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTab, setCreateTab] = useState<'LOCAL' | 'YOUTUBE'>('LOCAL');

  // Local media state
  const [availableMovies, setAvailableMovies] = useState<MediaItem[]>([]);
  const [selectedMediaId, setSelectedMediaId] = useState('');

  // YouTube state
  const [youtubeUrl, setYoutubeUrl] = useState('');

  // Common
  const [roomTitle, setRoomTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const fetchRooms = () => {
    apiClient.get('/rooms')
      .then((res) => setRooms(res.data.rooms || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchRooms();
  }, []);

  const handleJoinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCodeInput.trim()) return;
    navigate(`/rooms/${roomCodeInput.trim().toUpperCase()}`);
  };

  const handleOpenCreateModal = () => {
    setCreateError('');
    setYoutubeUrl('');
    setRoomTitle('');
    apiClient.get('/media/movies')
      .then((res) => {
        const movies: MediaItem[] = res.data.movies || [];
        setAvailableMovies(movies);
        if (movies.length > 0) {
          setSelectedMediaId(movies[0].id);
        } else {
          // If no local movies yet, default to YouTube tab
          setCreateTab('YOUTUBE');
        }
      })
      .catch(() => {
        setCreateTab('YOUTUBE');
      });
    setShowCreateModal(true);
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreating) return;
    setCreateError('');
    setIsCreating(true);

    try {
      if (createTab === 'YOUTUBE') {
        if (!youtubeUrl.trim()) {
          setCreateError('Укажите ссылку на YouTube видео');
          setIsCreating(false);
          return;
        }

        const res = await apiClient.post('/rooms', {
          sourceType: 'YOUTUBE',
          youtubeUrl: youtubeUrl.trim(),
          title: roomTitle.trim() || undefined,
        });
        navigate(`/rooms/${res.data.room.code}`);
      } else {
        if (!selectedMediaId) {
          setCreateError('Выберите фильм или ролик');
          setIsCreating(false);
          return;
        }

        const res = await apiClient.post('/rooms', {
          sourceType: 'LOCAL',
          mediaItemId: selectedMediaId,
          title: roomTitle.trim() || undefined,
        });
        navigate(`/rooms/${res.data.room.code}`);
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        navigate('/auth');
      } else {
        setCreateError(err.response?.data?.error || 'Ошибка при создании комнаты');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteRoom = async (e: React.MouseEvent, roomId: string) => {
    e.stopPropagation();
    if (!confirm('Вы уверены, что хотите закрыть эту комнату?')) return;
    try {
      await apiClient.delete(`/rooms/${roomId}`);
      fetchRooms();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка при закрытии комнаты');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-8">
      {/* Header & Quick Join */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <Radio className="w-7 h-7 text-cinema-gold animate-pulse" />
            Комнаты совместного просмотра (Watch Together)
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Смотрите фильмы, сериалы и YouTube видео синхронно с друзьями миллисекунда в миллисекунду
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Join by Code Form */}
          <form onSubmit={handleJoinByCode} className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Код комнаты (напр. AB12CD)"
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value)}
              className="bg-cinema-900 border border-white/10 rounded-2xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold font-mono uppercase w-48"
            />
            <button
              type="submit"
              disabled={!roomCodeInput.trim()}
              className="px-4 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/10 transition-colors disabled:opacity-40 cursor-pointer"
            >
              Войти
            </button>
          </form>

          {/* Create Room Button */}
          <button
            onClick={handleOpenCreateModal}
            className="px-5 py-2.5 rounded-2xl bg-cinema-gold text-black font-bold text-xs flex items-center gap-2 shadow-glow-gold hover:bg-yellow-400 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Создать комнату</span>
          </button>
        </div>
      </div>

      {/* Active Rooms Grid */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-white">Активные комнаты ({rooms.length})</h3>
        </div>

        {rooms.length === 0 ? (
          <div className="p-12 rounded-3xl bg-cinema-900 border border-white/10 text-center text-slate-400">
            <Radio className="w-12 h-12 text-cinema-gold/40 mx-auto mb-3" />
            <h4 className="text-sm font-bold text-white mb-1">Сейчас нет открытых комнат</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
              Создайте свою комнату с фильмом или YouTube роликом и пригласите друзей по коду!
            </p>
            <button
              onClick={handleOpenCreateModal}
              className="px-5 py-2.5 rounded-xl bg-cinema-gold text-black text-xs font-bold shadow-glow-gold hover:bg-yellow-400 cursor-pointer"
            >
              Создать первую комнату
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {rooms.map((room) => {
              const canDelete = user?.id === room.hostUserId || isAdmin;
              const isYouTube = room.sourceType === 'YOUTUBE';

              return (
                <div
                  key={room.id}
                  onClick={() => navigate(`/rooms/${room.code}`)}
                  className="p-5 rounded-3xl bg-cinema-900 border border-white/10 hover:border-cinema-gold/40 cursor-pointer shadow-lg hover:-translate-y-1 transition-all flex flex-col justify-between group relative select-none"
                >
                  <div className="flex items-start gap-4">
                    {/* Thumbnail / Poster */}
                    <div className="relative w-20 aspect-video rounded-xl overflow-hidden bg-cinema-950 shrink-0 border border-white/10">
                      {room.posterPath ? (
                        <img
                          src={room.posterPath}
                          alt={room.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-500">
                          {isYouTube ? <Video className="w-6 h-6 text-red-500" /> : <Film className="w-6 h-6 text-cinema-gold" />}
                        </div>
                      )}

                      {isYouTube && (
                        <div className="absolute top-1 left-1 bg-red-600 text-white font-black text-[8px] uppercase px-1 rounded">
                          YT
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          {isYouTube ? (
                            <span className="text-[10px] font-bold text-red-400 bg-red-600/15 border border-red-500/30 px-1.5 py-0.5 rounded">
                              YouTube
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-cinema-gold bg-cinema-gold/15 border border-cinema-gold/30 px-1.5 py-0.5 rounded">
                              Медиатека
                            </span>
                          )}
                          <span className="text-[10px] font-mono font-bold text-slate-300 bg-white/10 px-2 py-0.5 rounded-md">
                            {room.code}
                          </span>
                        </div>

                        {canDelete && (
                          <button
                            onClick={(e) => handleDeleteRoom(e, room.id)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                            title="Закрыть / удалить комнату"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <h4 className="text-sm font-bold text-white group-hover:text-cinema-gold transition-colors line-clamp-2 mt-1.5">
                        {room.title}
                      </h4>

                      <div className="flex items-center gap-2 mt-2">
                        <img
                          src={room.hostAvatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${room.hostUsername}`}
                          alt={room.hostUsername}
                          className="w-5 h-5 rounded-full object-cover"
                        />
                        <span className="text-xs text-slate-400 truncate">{room.hostUsername}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400 flex items-center gap-1">
                      <Users className="w-3.5 h-3.5 text-cinema-gold" />
                      Совместный просмотр
                    </span>
                    <div className="flex items-center gap-1 text-xs font-bold text-cinema-gold group-hover:underline">
                      <span>Войти в зал</span>
                      <Play className="w-3 h-3 fill-current ml-0.5" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Room Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-cinema-900 border border-white/15 rounded-3xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-1">Создание комнаты просмотра</h3>
            <p className="text-xs text-slate-400 mb-4">
              Выберите источник видео для синхронного совместного просмотра
            </p>

            {/* Mode Switcher Tabs */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                type="button"
                onClick={() => setCreateTab('LOCAL')}
                className={`py-2.5 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 border transition-all cursor-pointer ${
                  createTab === 'LOCAL'
                    ? 'bg-cinema-gold text-black border-cinema-gold shadow-glow-gold'
                    : 'bg-cinema-950 text-slate-400 border-white/10 hover:text-white'
                }`}
              >
                <Film className="w-4 h-4" />
                <span>Фильм из медиатеки</span>
              </button>

              <button
                type="button"
                onClick={() => setCreateTab('YOUTUBE')}
                className={`py-2.5 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 border transition-all cursor-pointer ${
                  createTab === 'YOUTUBE'
                    ? 'bg-red-600 text-white border-red-500 shadow-[0_0_15px_rgba(220,38,38,0.5)]'
                    : 'bg-cinema-950 text-slate-400 border-white/10 hover:text-white'
                }`}
              >
                <Video className="w-4 h-4" />
                <span>YouTube видео</span>
              </button>
            </div>

            {createError && (
              <div className="p-3 mb-4 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{createError}</span>
              </div>
            )}

            <form onSubmit={handleCreateRoom} className="flex flex-col gap-4">
              {createTab === 'LOCAL' ? (
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Выберите видеофайл
                  </label>
                  {availableMovies.length === 0 ? (
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
                      В медиатеке пока нет фильмов. Вы можете переключиться на вкладку «YouTube видео» или добавить файлы в панель управления.
                    </div>
                  ) : (
                    <select
                      value={selectedMediaId}
                      onChange={(e) => setSelectedMediaId(e.target.value)}
                      className="w-full bg-cinema-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cinema-gold cursor-pointer"
                    >
                      {availableMovies.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.title} ({m.year || 'Фильм'})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ) : (
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Ссылка на YouTube видео
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="https://www.youtube.com/watch?v=... или https://youtu.be/..."
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    className="w-full bg-cinema-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-red-500"
                  />
                  <span className="text-[11px] text-slate-400 mt-1 block">
                    Поддерживаются стандартные видео, Shorts и короткие ссылки youtu.be
                  </span>
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Название комнаты <span className="text-slate-500 font-normal">(необязательно)</span>
                </label>
                <input
                  type="text"
                  placeholder="Например: Смотрим стрим / клипы вместе"
                  value={roomTitle}
                  onChange={(e) => setRoomTitle(e.target.value)}
                  className="w-full bg-cinema-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold"
                />
              </div>

              <div className="flex items-center justify-end gap-3 mt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isCreating || (createTab === 'LOCAL' && availableMovies.length === 0)}
                  className={`px-5 py-2.5 rounded-xl font-bold text-xs shadow-lg transition-all disabled:opacity-50 cursor-pointer ${
                    createTab === 'YOUTUBE'
                      ? 'bg-red-600 hover:bg-red-500 text-white'
                      : 'bg-cinema-gold hover:bg-yellow-400 text-black shadow-glow-gold'
                  }`}
                >
                  {isCreating ? 'Создание...' : 'Создать комнату'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
