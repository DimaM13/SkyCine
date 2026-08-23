import React, { useState, useEffect } from 'react';
import { Cpu, HardDrive, Zap, Activity, Film, Server, RefreshCw, RotateCcw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { apiClient } from '../../api/client';
import { SystemStats } from '../../types';

export const SystemMonitor: React.FC = () => {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRestartModal, setShowRestartModal] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [restartMessage, setRestartMessage] = useState('');

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

  const handleRestart = async () => {
    setShowRestartModal(false);
    setIsRestarting(true);
    setRestartMessage('Отправка команды перезагрузки...');

    try {
      await apiClient.post('/admin/restart');
    } catch (e) {
      // Expected to fail or timeout since server terminates
    }

    setRestartMessage('Сервер перезагружается... Ожидание запуска (3-5 сек)...');

    // Wait a couple seconds before polling
    await new Promise((r) => setTimeout(r, 2500));

    // Poll until server is back online
    const startTime = Date.now();
    const maxWaitMs = 30000;

    const interval = setInterval(async () => {
      if (Date.now() - startTime > maxWaitMs) {
        clearInterval(interval);
        setRestartMessage('Время ожидания истекло. Пожалуйста, обновите страницу вручную.');
        setTimeout(() => setIsRestarting(false), 3000);
        return;
      }

      try {
        const res = await apiClient.get('/admin/status');
        if (res.status === 200) {
          clearInterval(interval);
          setRestartMessage('Сервер успешно перезапущен и готов к работе!');
          setTimeout(() => {
            setIsRestarting(false);
            window.location.reload();
          }, 1000);
        }
      } catch (e) {
        // Still rebooting
      }
    }, 1000);
  };

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
    <div className="flex flex-col gap-6 relative">
      {/* Restart Overlay Modal */}
      {isRestarting && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xl flex items-center justify-center p-4">
          <div className="bg-cinema-900 border border-cinema-gold/30 rounded-3xl p-8 max-w-md w-full shadow-2xl flex flex-col items-center text-center gap-4 animate-in fade-in zoom-in-95">
            <div className="w-16 h-16 rounded-full bg-cinema-gold/10 border border-cinema-gold/30 flex items-center justify-center">
              <RotateCcw className="w-8 h-8 text-cinema-gold animate-spin" />
            </div>
            <h3 className="text-lg font-bold text-white tracking-wide">Перезагрузка сервера</h3>
            <p className="text-xs text-slate-300 leading-relaxed font-mono">{restartMessage}</p>
            <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden mt-2">
              <div className="h-full bg-cinema-gold animate-pulse rounded-full w-2/3"></div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showRestartModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-cinema-900 border border-red-500/30 rounded-3xl p-6 max-w-md w-full shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="p-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Перезагрузить сервер?</h3>
                <p className="text-xs text-slate-400">Сброс зависших сессий и кэшей</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Все активные процессы транскодирования FFmpeg и временные потоки будут завершены, а сервер выполнит полный чистый перезапуск. Это занимает всего 2-4 секунды.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowRestartModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleRestart}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-black flex items-center gap-1.5 transition-all shadow-lg shadow-amber-500/20"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Да, перезагрузить</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Header & Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-cinema-900/60 border border-white/10">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.6)]"></span>
          <span className="text-xs font-bold text-white tracking-wide">Сервер активен (Онлайн)</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchStats}
            className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors border border-white/5"
            title="Обновить метрики"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Обновить</span>
          </button>

          <button
            type="button"
            onClick={() => setShowRestartModal(true)}
            className="px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:text-amber-200 text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 shadow-sm"
            title="Перезагрузить сервер для сброса ошибок и зависших сессий"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Перезагрузить сервер</span>
          </button>
        </div>
      </div>

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
