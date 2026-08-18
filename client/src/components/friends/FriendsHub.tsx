import React, { useState, useEffect } from 'react';
import { Users, UserPlus, UserCheck, Clock, Search, Check, X, Sparkles, Film } from 'lucide-react';
import { apiClient } from '../../api/client';
import { Friend, FriendRequest } from '../../types';

export const FriendsHub: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'friends' | 'requests' | 'search'>('friends');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }>({
    incoming: [],
    outgoing: [],
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionSuccess, setActionSuccess] = useState('');

  const fetchFriends = () => {
    apiClient.get('/friends')
      .then((res) => setFriends(res.data.friends || []))
      .catch(() => {});
  };

  const fetchRequests = () => {
    apiClient.get('/friends/requests')
      .then((res) => setRequests(res.data))
      .catch(() => {});
  };

  useEffect(() => {
    fetchFriends();
    fetchRequests();
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setLoading(true);
    try {
      const res = await apiClient.get('/friends/search', { params: { q: searchQuery } });
      setSearchResults(res.data.users || []);
    } catch (err) {}
    setLoading(false);
  };

  const sendRequest = async (targetUserId: string) => {
    try {
      await apiClient.post('/friends/request', { targetUserId });
      setActionSuccess('Запрос в друзья отправлен!');
      setTimeout(() => setActionSuccess(''), 3000);
      handleSearch({ preventDefault: () => {} } as any);
      fetchRequests();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка отправки запроса');
    }
  };

  const acceptRequest = async (requestId: string) => {
    try {
      await apiClient.post(`/friends/accept/${requestId}`);
      fetchFriends();
      fetchRequests();
    } catch (err) {}
  };

  const declineRequest = async (requestId: string) => {
    try {
      await apiClient.delete(`/friends/decline/${requestId}`);
      fetchRequests();
    } catch (err) {}
  };

  const removeFriend = async (friendId: string) => {
    if (!confirm('Удалить из друзей?')) return;
    try {
      await apiClient.delete(`/friends/remove/${friendId}`);
      fetchFriends();
    } catch (err) {}
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-cinema-900 border border-white/10 w-fit">
        <button
          onClick={() => setActiveTab('friends')}
          className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
            activeTab === 'friends'
              ? 'bg-cinema-gold text-black shadow-glow-gold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Друзья ({friends.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('requests')}
          className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all relative ${
            activeTab === 'requests'
              ? 'bg-cinema-gold text-black shadow-glow-gold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Заявки ({requests.incoming.length})</span>
          {requests.incoming.length > 0 && (
            <span className="w-2 h-2 rounded-full bg-red-500 absolute top-1 right-1 animate-ping" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('search')}
          className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
            activeTab === 'search'
              ? 'bg-cinema-gold text-black shadow-glow-gold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <UserPlus className="w-4 h-4" />
          <span>Поиск пользователей</span>
        </button>
      </div>

      {actionSuccess && (
        <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2 animate-fade-in">
          <Check className="w-4 h-4 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Tab: Friends List */}
      {activeTab === 'friends' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {friends.length === 0 ? (
            <div className="col-span-2 p-12 rounded-3xl bg-cinema-900 border border-white/10 text-center text-slate-400">
              <Users className="w-12 h-12 text-cinema-gold/40 mx-auto mb-3" />
              <h4 className="text-sm font-bold text-white mb-1">Список друзей пуст</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
                Найдите друзей через вкладку «Поиск пользователей» или отправьте им приглашение!
              </p>
              <button
                onClick={() => setActiveTab('search')}
                className="px-4 py-2 rounded-xl bg-cinema-gold text-black text-xs font-bold"
              >
                Найти друзей
              </button>
            </div>
          ) : (
            friends.map((friend) => (
              <div
                key={friend.id}
                className="p-4 rounded-3xl bg-cinema-900 border border-white/10 flex items-center justify-between hover:border-cinema-gold/30 transition-colors"
              >
                <div className="flex items-center gap-3.5">
                  <div className="relative">
                    <img
                      src={friend.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${friend.username}`}
                      alt={friend.username}
                      className="w-11 h-11 rounded-full bg-cinema-800 object-cover"
                    />
                    <span
                      className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-cinema-900 ${
                        friend.isOnline ? 'bg-emerald-400' : 'bg-slate-600'
                      }`}
                    />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">{friend.username}</h4>
                    <span className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                      {friend.currentActivity ? (
                        <>
                          <Film className="w-3 h-3 text-cinema-gold" />
                          <span className="text-cinema-gold font-medium truncate max-w-[160px]">
                            {friend.currentActivity}
                          </span>
                        </>
                      ) : (
                        <span>{friend.isOnline ? 'В сети' : 'Не в сети'}</span>
                      )}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => removeFriend(friend.id)}
                  className="p-2 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Удалить из друзей"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: Requests */}
      {activeTab === 'requests' && (
        <div className="flex flex-col gap-6">
          {/* Incoming */}
          <div className="p-6 rounded-3xl bg-cinema-900 border border-white/10">
            <h3 className="text-sm font-bold text-white mb-4">Входящие заявки ({requests.incoming.length})</h3>
            {requests.incoming.length === 0 ? (
              <p className="text-xs text-slate-500">Нет новых входящих заявок</p>
            ) : (
              <div className="flex flex-col gap-3">
                {requests.incoming.map((req) => (
                  <div
                    key={req.id}
                    className="p-3.5 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <img
                        src={req.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${req.username}`}
                        alt={req.username}
                        className="w-9 h-9 rounded-full bg-cinema-800 object-cover"
                      />
                      <div>
                        <span className="text-xs font-bold text-white block">{req.username}</span>
                        <span className="text-[10px] text-slate-400">Хочет добавить вас в друзья</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => acceptRequest(req.id)}
                        className="p-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 transition-colors"
                        title="Принять"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => declineRequest(req.id)}
                        className="p-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-300 transition-colors"
                        title="Отклонить"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Outgoing */}
          <div className="p-6 rounded-3xl bg-cinema-900 border border-white/10">
            <h3 className="text-sm font-bold text-white mb-4">Исходящие заявки ({requests.outgoing.length})</h3>
            {requests.outgoing.length === 0 ? (
              <p className="text-xs text-slate-500">Нет ожидающих исходящих заявок</p>
            ) : (
              <div className="flex flex-col gap-3">
                {requests.outgoing.map((req) => (
                  <div
                    key={req.id}
                    className="p-3.5 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <img
                        src={req.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${req.username}`}
                        alt={req.username}
                        className="w-9 h-9 rounded-full bg-cinema-800 object-cover"
                      />
                      <div>
                        <span className="text-xs font-bold text-white block">{req.username}</span>
                        <span className="text-[10px] text-slate-400">Ожидает подтверждения</span>
                      </div>
                    </div>

                    <button
                      onClick={() => declineRequest(req.id)}
                      className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-xs transition-colors"
                    >
                      Отозвать
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Search */}
      {activeTab === 'search' && (
        <div className="p-6 rounded-3xl bg-cinema-900 border border-white/10 flex flex-col gap-5">
          <form onSubmit={handleSearch} className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Поиск по имени пользователя или email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-cinema-950 border border-white/10 rounded-2xl pl-10 pr-4 py-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !searchQuery.trim()}
              className="px-5 py-3 rounded-2xl bg-cinema-gold text-black text-xs font-bold shadow-glow-gold hover:bg-yellow-400 transition-all disabled:opacity-50"
            >
              Поиск
            </button>
          </form>

          {/* Results */}
          <div className="flex flex-col gap-2">
            {searchResults.map((u) => (
              <div
                key={u.id}
                className="p-3.5 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <img
                    src={u.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${u.username}`}
                    alt={u.username}
                    className="w-9 h-9 rounded-full bg-cinema-800 object-cover"
                  />
                  <div>
                    <span className="text-xs font-bold text-white block">{u.username}</span>
                  </div>
                </div>

                <div>
                  {u.friendshipStatus === 'ACCEPTED' ? (
                    <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                      <UserCheck className="w-3.5 h-3.5" />
                      В друзьях
                    </span>
                  ) : u.friendshipStatus === 'PENDING' ? (
                    <span className="text-xs text-slate-400 font-medium">Запрос отправлен</span>
                  ) : (
                    <button
                      onClick={() => sendRequest(u.id)}
                      className="px-3.5 py-1.5 rounded-xl bg-cinema-gold text-black font-bold text-xs flex items-center gap-1.5 shadow-glow-gold hover:bg-yellow-400 transition-all"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Добавить</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
