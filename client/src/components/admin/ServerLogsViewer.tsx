import React, { useState, useEffect, useRef } from 'react';
import { Terminal, RefreshCw, Trash2, Download, AlertCircle, FileText } from 'lucide-react';
import { apiClient } from '../../api/client';

export const ServerLogsViewer: React.FC = () => {
  const [serverLogs, setServerLogs] = useState<string[]>([]);
  const [errorLogs, setErrorLogs] = useState<string[]>([]);
  const [activeLogTab, setActiveLogTab] = useState<'all' | 'errors'>('all');
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const fetchLogs = () => {
    setLoading(true);
    apiClient.get('/admin/logs')
      .then((res) => {
        setServerLogs(res.data.serverLogs || []);
        setErrorLogs(res.data.errorLogs || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [serverLogs, errorLogs, activeLogTab]);

  const handleClearLogs = async () => {
    if (!confirm('Вы уверены, что хотите очистить журналы логов на сервере?')) return;
    try {
      await apiClient.delete('/admin/logs');
      setServerLogs([]);
      setErrorLogs([]);
    } catch (e) {
      alert('Ошибка при очистке логов');
    }
  };

  const handleDownloadLogs = () => {
    const logs = activeLogTab === 'errors' ? errorLogs : serverLogs;
    const blob = new Blob([logs.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `skycine_${activeLogTab}_${Date.now()}.log`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const displayedLogs = activeLogTab === 'errors' ? errorLogs : serverLogs;

  const formatLine = (line: string) => {
    if (line.includes('[ERROR]') || line.includes('SERVER_ERR')) {
      return 'text-red-400 font-semibold';
    }
    if (line.includes('[WARN]')) {
      return 'text-amber-400';
    }
    if (line.includes('[ROOM_ACTION]')) {
      return 'text-cinema-gold font-medium';
    }
    if (line.includes('[HTTP]')) {
      return 'text-sky-300';
    }
    if (line.includes('[FFmpeg]') || line.includes('[SOCKET]')) {
      return 'text-emerald-300';
    }
    return 'text-slate-300';
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header / Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-3xl bg-cinema-900 border border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-cinema-gold/10 border border-cinema-gold/20 flex items-center justify-center text-cinema-gold">
            <Terminal className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>Системный журнал событий сервера</span>
              <span className="text-[10px] font-mono bg-white/10 px-2 py-0.5 rounded-full text-slate-400">
                data/logs/server.log
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Логирование HTTP запросов, синхронизации комнат, кодирования видео и ошибок
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Sub-tabs */}
          <div className="flex items-center p-1 rounded-xl bg-black/40 border border-white/10">
            <button
              onClick={() => setActiveLogTab('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeLogTab === 'all'
                  ? 'bg-cinema-gold text-black shadow-glow-gold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Все логи ({serverLogs.length})</span>
            </button>

            <button
              onClick={() => setActiveLogTab('errors')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeLogTab === 'errors'
                  ? 'bg-red-500 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Ошибки ({errorLogs.length})</span>
            </button>
          </div>

          {/* Auto Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              autoRefresh
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-white/5 border-white/10 text-slate-400'
            }`}
          >
            {autoRefresh ? '● Автообновление (3с)' : '○ Ручное'}
          </button>

          {/* Refresh Button */}
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition-colors"
            title="Обновить журнал"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* Download Logs */}
          <button
            onClick={handleDownloadLogs}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition-colors"
            title="Скачать файл логов"
          >
            <Download className="w-4 h-4" />
          </button>

          {/* Clear Logs */}
          <button
            onClick={handleClearLogs}
            className="p-2 rounded-xl bg-white/5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 border border-white/10 transition-colors"
            title="Очистить журнал логов"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Terminal Display */}
      <div
        ref={logContainerRef}
        className="p-4 md:p-6 rounded-3xl bg-cinema-950 border border-white/10 font-mono text-[11px] leading-relaxed overflow-y-auto max-h-[600px] min-h-[380px] shadow-2xl flex flex-col gap-1 select-text"
      >
        {displayedLogs.length === 0 ? (
          <div className="m-auto text-center text-slate-500 py-12">
            <Terminal className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>Журнал логов пуст</p>
          </div>
        ) : (
          displayedLogs.map((log, index) => (
            <div key={index} className={`break-words whitespace-pre-wrap ${formatLine(log)}`}>
              {log}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
