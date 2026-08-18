import React, { useState, useEffect } from 'react';
import { Users, Shield, ShieldAlert, Trash2, Check, AlertCircle } from 'lucide-react';
import { apiClient } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

import { UserAccessModal } from './UserAccessModal';
import { Lock } from 'lucide-react';

export const UsersManager: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState('');
  const [selectedUserForAccess, setSelectedUserForAccess] = useState<{ id: string; username: string } | null>(null);

  const fetchUsers = () => {
    apiClient.get('/admin/users')
      .then((res) => setUsers(res.data.users || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await apiClient.put(`/admin/users/${userId}/role`, { role: newRole });
      setStatusMsg('Роль пользователя изменена');
      setTimeout(() => setStatusMsg(''), 3000);
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка изменения роли');
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Вы действительно хотите удалить этот аккаунт?')) return;
    try {
      await apiClient.delete(`/admin/users/${userId}`);
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка удаления пользователя');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {statusMsg && (
        <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <Check className="w-4 h-4" />
          <span>{statusMsg}</span>
        </div>
      )}

      <div className="p-6 rounded-3xl bg-cinema-900 border border-white/10 flex flex-col gap-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Users className="w-4 h-4 text-cinema-gold" />
          Зарегистрированные пользователи сервера ({users.length})
        </h3>

        <div className="flex flex-col gap-2">
          {users.map((u) => {
            const isSelf = u.id === currentUser?.id;
            const isAdmin = u.role === 'ADMIN';

            return (
              <div
                key={u.id}
                className="p-4 rounded-2xl bg-white/5 border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <img
                    src={u.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${u.username}`}
                    alt={u.username}
                    className="w-10 h-10 rounded-full bg-cinema-800 object-cover shrink-0"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">{u.username}</span>
                      {isSelf && (
                        <span className="text-[10px] bg-white/10 text-slate-300 px-1.5 py-0.5 rounded">Это вы</span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400 block">{u.email}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  {/* Access Button (for regular users) */}
                  {!isAdmin && (
                    <button
                      onClick={() => setSelectedUserForAccess({ id: u.id, username: u.username })}
                      className="px-3 py-1.5 rounded-xl bg-cinema-gold/15 hover:bg-cinema-gold text-cinema-gold hover:text-black border border-cinema-gold/30 text-xs font-bold transition-all flex items-center gap-1.5 active:scale-95"
                      title="Настроить доступ к библиотекам и фильмам"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Доступ</span>
                    </button>
                  )}

                  {/* Role Selector */}
                  <select
                    value={u.role}
                    disabled={isSelf}
                    onChange={(e) => handleRoleChange(u.id, e.target.value)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold focus:outline-none ${
                      u.role === 'ADMIN'
                        ? 'bg-cinema-gold/20 text-cinema-gold border border-cinema-gold/30'
                        : 'bg-white/10 text-slate-300 border border-white/10'
                    }`}
                  >
                    <option value="USER">Пользователь (USER)</option>
                    <option value="ADMIN">Администратор (ADMIN)</option>
                  </select>

                  {!isSelf && (
                    <button
                      onClick={() => handleDeleteUser(u.id)}
                      className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
                      title="Удалить пользователя"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* User Access Modal */}
      <UserAccessModal
        userId={selectedUserForAccess?.id || null}
        username={selectedUserForAccess?.username || ''}
        isOpen={!!selectedUserForAccess}
        onClose={() => setSelectedUserForAccess(null)}
      />
    </div>
  );
};
