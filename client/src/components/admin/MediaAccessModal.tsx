import React, { useState, useEffect } from 'react';
import { X, Lock, Check, Shield, Search, UserCheck, UserX } from 'lucide-react';
import { apiClient } from '../../api/client';

interface MediaAccessModalProps {
  mediaId: string | null;
  mediaTitle: string;
  isOpen: boolean;
  onClose: () => void;
}

export const MediaAccessModal: React.FC<MediaAccessModalProps> = ({
  mediaId,
  mediaTitle,
  isOpen,
  onClose,
}) => {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const fetchAccess = () => {
    if (!mediaId) return;
    setLoading(true);
    apiClient.get(`/admin/permissions/media/${mediaId}`)
      .then((res) => setUsers(res.data.users || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (isOpen && mediaId) {
      fetchAccess();
    }
  }, [isOpen, mediaId]);

  if (!isOpen || !mediaId) return null;

  const toggleUserAccess = (userId: string) => {
    setUsers((prev) =>
      prev.map((u) => {
        if (u.id === userId) {
          // If has access via library, toggle direct access
          return { ...u, hasAccess: u.hasAccess ? 0 : 1, hasDirectAccess: u.hasDirectAccess ? 0 : 1 };
        }
        return u;
      })
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const allowedUserIds = users
        .filter((u) => u.role !== 'ADMIN' && (u.hasAccess === 1 || u.hasDirectAccess === 1))
        .map((u) => u.id);

      await apiClient.post(`/admin/permissions/media/${mediaId}`, { userIds: allowedUserIds });
      setSuccessMsg('Права доступа успешно сохранены!');
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
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Доступ к фильму/сериалу</h3>
              <p className="text-xs text-slate-400 line-clamp-1">{mediaTitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="my-3 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Поиск пользователей..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cinema-gold"
            />
          </div>
        </div>

        {successMsg && (
          <div className="mb-3 p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
            <Check className="w-4 h-4" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Users List */}
        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2 min-h-[200px]">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-slate-400 text-xs">
              Загрузка списка пользователей...
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-slate-500 text-xs">
              Пользователи не найдены
            </div>
          ) : (
            filteredUsers.map((u) => {
              const isAdmin = u.role === 'ADMIN';
              const isViaLibrary = u.hasLibraryAccess === 1;
              const isAllowed = isAdmin || u.hasAccess === 1 || u.hasDirectAccess === 1;

              return (
                <div
                  key={u.id}
                  onClick={() => !isAdmin && toggleUserAccess(u.id)}
                  className={`p-3 rounded-2xl border transition-all flex items-center justify-between cursor-pointer ${
                    isAllowed
                      ? 'bg-cinema-gold/10 border-cinema-gold/30 hover:bg-cinema-gold/15'
                      : 'bg-white/5 border-white/5 hover:bg-white/10'
                  } ${isAdmin ? 'opacity-80 cursor-default' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <img
                      src={u.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${u.username}`}
                      alt={u.username}
                      className="w-8 h-8 rounded-full bg-cinema-800 object-cover"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">{u.username}</span>
                        {isAdmin && (
                          <span className="text-[9px] bg-cinema-gold/20 text-cinema-gold border border-cinema-gold/30 px-1.5 py-0.2 rounded font-bold">
                            Админ (всегда)
                          </span>
                        )}
                        {!isAdmin && isViaLibrary && (
                          <span className="text-[9px] bg-sky-500/20 text-sky-300 border border-sky-500/30 px-1.5 py-0.2 rounded">
                            Через библиотеку
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400">{u.email}</span>
                    </div>
                  </div>

                  <div>
                    {isAdmin ? (
                      <Shield className="w-5 h-5 text-cinema-gold" />
                    ) : (
                      <div
                        className={`w-6 h-6 rounded-lg border flex items-center justify-center transition-colors ${
                          isAllowed
                            ? 'bg-cinema-gold border-cinema-gold text-black'
                            : 'border-white/20 bg-black/40 text-transparent'
                        }`}
                      >
                        <Check className="w-4 h-4 stroke-[3]" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

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
