import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Shield, Activity, FolderPlus, Settings, Users, Terminal } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { SystemMonitor } from '../components/admin/SystemMonitor';
import { LibraryManager } from '../components/admin/LibraryManager';
import { ServerSettingsForm } from '../components/admin/ServerSettingsForm';
import { UsersManager } from '../components/admin/UsersManager';
import { ServerLogsViewer } from '../components/admin/ServerLogsViewer';

export const AdminPage: React.FC = () => {
  const { user, isAdmin, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<'monitor' | 'libraries' | 'settings' | 'users' | 'logs'>('monitor');

  if (isLoading) return null;
  if (!user || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  const tabs = [
    { id: 'monitor', label: 'Мониторинг сервера', icon: Activity },
    { id: 'libraries', label: 'Управление библиотеками', icon: FolderPlus },
    { id: 'settings', label: 'Настройки сервера & TMDB', icon: Settings },
    { id: 'users', label: 'Пользователи', icon: Users },
    { id: 'logs', label: 'Журнал логов', icon: Terminal },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
          <Shield className="w-7 h-7 text-cinema-gold" />
          Панель управления сервером
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Конфигурация медиатеки, транскодера FFmpeg, аппаратного ускорения GPU, пользователей и логи
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 p-1.5 rounded-2xl bg-cinema-900 border border-white/10 w-fit">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
                active
                  ? 'bg-cinema-gold text-black shadow-glow-gold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Panels */}
      {activeTab === 'monitor' && <SystemMonitor />}
      {activeTab === 'libraries' && <LibraryManager />}
      {activeTab === 'settings' && <ServerSettingsForm />}
      {activeTab === 'users' && <UsersManager />}
      {activeTab === 'logs' && <ServerLogsViewer />}
    </div>
  );
};
