import React, { useState, useEffect } from 'react';
import { X, Lock, Check, Shield, Search, UserCheck, UserX, Tv } from 'lucide-react';
import { apiClient } from '../../api/client';

interface ShowAccessModalProps {
  showTitle: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export const ShowAccessModal: React.FC<ShowAccessModalProps> = ({
  showTitle,
  isOpen,
  onClose,
}) => {
  const [users, setUsers] = useState<any[]>([]);
  const [totalEpisodes, setTotalEpisodes] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const fetchAccess = () => {
    if (!showTitle) return;
    setLoading(true);
    apiClient.get(`/admin/permissions/show/${encodeURIComponent(showTitle)}`)
      .then((res) => {
        setUsers(res.data.users || []);
        setTotalEpisodes(res.data.totalEpisodes || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (isOpen && showTitle) {
      fetchAccess();
    }
  }, [isOpen, showTitle]);

  if (!isOpen || !showTitle) return null;

  const toggleUserAccess = (userId: string) => {
    setUsers((prev) =>
      prev.map((u) => {
        if (u.id === userId) {
          const nextState = u.hasAccess ? 0 : 1;
          return { ...u, hasAccess: nextState, hasDirectAccess: nextState };
        }
        return u;
      })
    );
  };

  const handleGrantAll = () => {
    setUsers((prev) => prev.map((u) => ({ ...u, hasAccess: 1, hasDirectAccess: 1 })));
  };

  const handleRevokeAll = () => {
    setUsers((prev) =>
      prev.map((u) => (u.role === 'ADMIN' ? u : { ...u, hasAccess: 0, hasDirectAccess: 0 }))
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const allowedUserIds = users
        .filter((u) => u.role !== 'ADMIN' && (u.hasAccess === 1 || u.hasDirectAccess === 1))
        .map((u) => u.id);

      await apiClient.post(`/admin/permissions/show/${encodeURIComponent(showTitle)}`, { userIds: allowedUserIds });
      setSuccessMsg('Права доступа ко всем сериям сериала сохранены!');
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

  const filteredUsers = users.filter(
    (u) =>
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-lg rounded-3xl bg-cinema-900 border border-white/10 p-6 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cinema-gold/20 flex items-center justify-center text-cinema-gold border border-cinema-gold/30">
              <Tv className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Доступ к сериалу</h3>
              <p className="text-xs text-slate-400 line-clamp-1">
                «{showTitle}» {totalEpisodes > 0 && <span className="text-cinema-gold font-semibold">({totalEpisodes} серий)</span>}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success Alert */}
        {successMsg && (
          <div className="mt-4 p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Action Controls & Search */}
        <div className="flex items-center justify-between gap-2 mt-4 shrink-0">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Поиск пользователей..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cinema-gold/50"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleGrantAll}
              className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-[11px] font-bold text-slate-300 hover:text-white border border-white/10 transition-colors flex items-center gap-1"
              title="Открыть всем"
            >
              <UserCheck className="w-3 h-3 text-emerald-400" />
              <span>Всем</span>
            </button>
            <button
              onClick={handleRevokeAll}
              className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-[11px] font-bold text-slate-300 hover:text-white border border-white/10 transition-colors flex items-center gap-1"
              title="Забрать у всех"
            >
              <UserX className="w-3 h-3 text-red-400" />
              <span>Никому</span>
            </button>
          </div>
        </div>

        {/* Users List */}
        <div className="flex-1 overflow-y-auto my-4 pr-1 flex flex-col gap-2 min-h-[220px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
              <div className="w-6 h-6 border-2 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
              <span className="text-xs">Загрузка пользователей...</span>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500">
              Пользователи не найдены
            </div>
          ) : (
            filteredUsers.map((u) => {
              const isAdmin = u.role === 'ADMIN';
              const hasAccess = isAdmin || u.hasAccess === 1;

              return (
                <div
                  key={u.id}
                  onClick={() => !isAdmin && toggleUserAccess(u.id)}
                  className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                    isAdmin
                      ? 'bg-cinema-gold/10 border-cinema-gold/30 opacity-90 cursor-default'
                      : hasAccess
                      ? 'bg-cinema-gold/15 border-cinema-gold/40 cursor-pointer shadow-glow-gold'
                      : 'bg-white/5 border-white/5 hover:bg-white/10 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={u.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${u.username}`}
                      alt={u.username}
                      className="w-9 h-9 rounded-full bg-cinema-800 object-cover shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-white truncate">{u.username}</span>
                        {isAdmin && (
                          <span className="text-[9px] bg-cinema-gold text-black font-extrabold px-1.5 py-0.2 rounded shrink-0">
                            ADMIN
                          </span>
                        )}
                        {!isAdmin && u.hasLibraryAccess === 1 && (
                          <span className="text-[9px] bg-sky-500/20 text-sky-300 font-bold px-1.5 py-0.2 rounded shrink-0 border border-sky-500/30">
                            Вся библиотека
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 truncate block">{u.email}</span>
                    </div>
                  </div>

                  <div className="shrink-0">
                    {isAdmin ? (
                      <span className="text-[11px] text-cinema-gold font-bold flex items-center gap-1">
                        <Shield className="w-3.5 h-3.5" />
                        Полный доступ
                      </span>
                    ) : (
                      <div
                        className={`w-6 h-6 rounded-lg flex items-center justify-center border transition-all ${
                          hasAccess
                            ? 'bg-cinema-gold text-black border-cinema-gold shadow-glow-gold'
                            : 'border-white/20 text-transparent'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-white/10 flex items-center justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-5 py-2 rounded-xl bg-cinema-gold text-black hover:bg-yellow-400 text-xs font-bold transition-all shadow-glow-gold disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? 'Сохранение...' : 'Сохранить доступ'}
          </button>
        </div>
      </div>
    </div>
  );
};
