import React, { useState, useEffect } from 'react';
import { Cpu, HardDrive, Zap, Activity, Film, Server, RefreshCw } from 'lucide-react';
import { apiClient } from '../../api/client';
import { SystemStats } from '../../types';

export const SystemMonitor: React.FC = () => {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = () => {
    apiClient.get('/admin/status')
      .then((res) => setStats(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 3000); // refresh every 3 seconds
    return () => clearInterval(interval);
  }, []);

  if (loading && !stats) {
    return (
      <div className="p-8 flex justify-center items-center text-slate-400">
        <div className="w-8 h-8 border-2 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
      </div>
    );
  }

  const formatBytes = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(1)} GB`;
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Top Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* CPU */}
        <div className="p-5 rounded-3xl bg-cinema-900 border border-white/10 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-blue-500/20 text-blue-400">
                <Cpu className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs text-slate-400 font-medium">Процессор (CPU)</span>
                <h4 className="text-xl font-bold text-white">{stats?.cpu.currentLoad}%</h4>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  (stats?.cpu.currentLoad || 0) > 80 ? 'bg-red-500' : 'bg-blue-500'
                }`}
                style={{ width: `${stats?.cpu.currentLoad || 0}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-500 mt-1 block truncate">
              {stats?.cpu.model} ({stats?.cpu.cores} ядер)
            </span>
          </div>
        </div>

        {/* RAM */}
        <div className="p-5 rounded-3xl bg-cinema-900 border border-white/10 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-emerald-500/20 text-emerald-400">
                <Server className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs text-slate-400 font-medium">Память (RAM)</span>
                <h4 className="text-xl font-bold text-white">{stats?.memory.usedPercent}%</h4>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${stats?.memory.usedPercent || 0}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-500 mt-1 block">
              Использовано {formatBytes(stats?.memory.used || 0)} из {formatBytes(stats?.memory.total || 0)}
            </span>
          </div>
        </div>

        {/* Active Streams */}
        <div className="p-5 rounded-3xl bg-cinema-900 border border-white/10 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-cinema-gold/20 text-cinema-gold">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs text-slate-400 font-medium">Активные потоки</span>
                <h4 className="text-xl font-bold text-white">{stats?.activeStreamsCount || 0}</h4>
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-slate-300">Транскодер FFmpeg активен</span>
          </div>
        </div>
      </div>

      {/* Disks Usage */}
      <div className="p-6 rounded-3xl bg-cinema-900 border border-white/10">
        <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-cinema-gold" />
          Дисковые накопители
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {stats?.disks.map((d, i) => (
            <div key={i} className="p-4 rounded-2xl bg-white/5 border border-white/5 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white font-mono">{d.mount || d.fs}</span>
                <span className="text-xs text-slate-400">{d.usePercent}% занято</span>
              </div>
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cinema-gold transition-all duration-500"
                  style={{ width: `${d.usePercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>Свободно: {formatBytes(d.available)}</span>
                <span>Всего: {formatBytes(d.size)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Active Streams Monitor */}
      <div className="p-6 rounded-3xl bg-cinema-900 border border-white/10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Zap className="w-4 h-4 text-cinema-gold" />
            Активные сессии транскодирования
          </h3>
          <button onClick={fetchStats} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {stats?.activeSessions && stats.activeSessions.length > 0 ? (
          <div className="flex flex-col gap-2">
            {stats.activeSessions.map((s) => (
              <div
                key={s.sessionId}
                className="p-3.5 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-cinema-gold/10 text-cinema-gold">
                    <Film className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-white block">Сессия {s.sessionId.slice(0, 8)}</span>
                    <span className="text-[10px] text-slate-400">
                      Режим: <b className="text-cinema-gold">{s.type}</b> • Качество: {s.quality}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  {s.speed && (
                    <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20">
                      Скорость: {s.speed}
                    </span>
                  )}
                  {s.fps && (
                    <span className="text-[11px] font-mono text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-lg border border-blue-500/20">
                      {Math.round(s.fps)} FPS
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6 rounded-2xl bg-white/5 border border-white/5 text-center text-xs text-slate-500">
            В данный момент нет активных потоков транскодирования.
          </div>
        )}
      </div>
    </div>
  );
};
