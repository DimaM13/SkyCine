import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Radio, Plus, Users, Play, Key, Film, Search, Trash2 } from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Room, MediaItem } from '../types';

export const RoomsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [availableMovies, setAvailableMovies] = useState<MediaItem[]>([]);
  const [selectedMediaId, setSelectedMediaId] = useState('');
  const [roomTitle, setRoomTitle] = useState('');
  const [loading, setLoading] = useState(true);

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
    apiClient.get('/media/movies')
      .then((res) => {
        setAvailableMovies(res.data.movies || []);
        if (res.data.movies?.length > 0) {
          setSelectedMediaId(res.data.movies[0].id);
        }
      });
    setShowCreateModal(true);
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMediaId) return;

    try {
      const res = await apiClient.post('/rooms', {
        mediaItemId: selectedMediaId,
        title: roomTitle.trim() || undefined,
      });
      navigate(`/rooms/${res.data.room.code}`);
    } catch (err: any) {
      if (err.response?.status === 401) {
        navigate('/auth');
      } else {
        alert(err.response?.data?.error || 'Ошибка при создании комнаты');
      }
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
            Смотрите фильмы и сериалы синхронно с друзьями миллисекунда в миллисекунду
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
              className="px-4 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/10 transition-colors disabled:opacity-40"
            >
              Войти
            </button>
          </form>

          {/* Create Room Button */}
          <button
            onClick={handleOpenCreateModal}
            className="px-5 py-2.5 rounded-2xl bg-cinema-gold text-black font-bold text-xs flex items-center gap-2 shadow-glow-gold hover:bg-yellow-400 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Создать комнату</span>
          </button>
        </div>
      </div>

      {/* Active Rooms Grid */}
      <div className="flex flex-col gap-4">
        <h3 className="text-base font-bold text-white">Активные комнаты ({rooms.length})</h3>

        {rooms.length === 0 ? (
          <div className="p-12 rounded-3xl bg-cinema-900 border border-white/10 text-center text-slate-400">
            <Radio className="w-12 h-12 text-cinema-gold/40 mx-auto mb-3" />
            <h4 className="text-sm font-bold text-white mb-1">Сейчас нет открытых комнат</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
              Создайте свою комнату и пригласите друзей по ссылке или коду!
            </p>
            <button
              onClick={handleOpenCreateModal}
              className="px-5 py-2.5 rounded-xl bg-cinema-gold text-black text-xs font-bold shadow-glow-gold"
            >
              Создать первую комнату
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {rooms.map((room) => {
              const canDelete = user?.id === room.hostUserId || isAdmin;

              return (
                <div
                  key={room.id}
                  onClick={() => navigate(`/rooms/${room.code}`)}
                  className="p-5 rounded-3xl bg-cinema-900 border border-white/10 hover:border-cinema-gold/40 cursor-pointer shadow-lg hover:-translate-y-1 transition-all flex flex-col justify-between group relative"
                >
                  <div className="flex items-start gap-4">
                    {room.posterPath ? (
                      <img
                        src={room.posterPath}
                        alt={room.title}
                        className="w-16 aspect-[2/3] rounded-xl object-cover shadow-md shrink-0"
                      />
                    ) : (
                      <div className="w-16 aspect-[2/3] rounded-xl bg-cinema-800 flex items-center justify-center text-slate-500 shrink-0">
                        <Film className="w-6 h-6" />
                      </div>
                    )}

                    <div className="flex flex-col flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono font-bold text-cinema-gold bg-cinema-gold/10 px-2 py-0.5 rounded-md">
                          {room.code}
                        </span>

                        {canDelete && (
                          <button
                            onClick={(e) => handleDeleteRoom(e, room.id)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
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
            <p className="text-xs text-slate-400 mb-5">Выберите фильм или сериал для совместного просмотра</p>

            <form onSubmit={handleCreateRoom} className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Выберите фильм</label>
                <select
                  value={selectedMediaId}
                  onChange={(e) => setSelectedMediaId(e.target.value)}
                  className="w-full bg-cinema-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cinema-gold"
                >
                  {availableMovies.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title} ({m.year || 'Фильм'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Название комнаты (необязательно)</label>
                <input
                  type="text"
                  placeholder="Например: Смотрим с пацанами в 20:00"
                  value={roomTitle}
                  onChange={(e) => setRoomTitle(e.target.value)}
                  className="w-full bg-cinema-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold"
                />
              </div>

              <div className="flex items-center justify-end gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={!selectedMediaId}
                  className="px-5 py-2.5 rounded-xl bg-cinema-gold text-black text-xs font-bold shadow-glow-gold hover:bg-yellow-400 transition-all"
                >
                  Создать и пригласить друзей
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
