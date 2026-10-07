import React from 'react';
import { Activity } from 'lucide-react';

export interface PlayerTechStats {
  droppedFrames: number;
  totalFrames: number;
  hlsLevel: number;
  hlsBitrate: number;
  fallbackStage: number;
  bufferedAhead: number;
}

interface PlayerStatsModalProps {
  open: boolean;
  onClose: () => void;
  modeText: string;
  videoLabel: string;
  qualityText: string;
  audioLabel: string;
  audioProcessing: string;
  containerLabel: string;
  engineLabel: string;
  bufferedTime: number;
  effectiveDuration: number;
  playbackRate: number;
  tech: PlayerTechStats;
}

export const PlayerStatsModal: React.FC<PlayerStatsModalProps> = ({
  open,
  onClose,
  modeText,
  videoLabel,
  qualityText,
  audioLabel,
  audioProcessing,
  containerLabel,
  engineLabel,
  bufferedTime,
  effectiveDuration,
  playbackRate,
  tech,
}) => {
  if (!open) return null;
  const dropPct = tech.totalFrames > 0 ? (tech.droppedFrames / tech.totalFrames) * 100 : 0;
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Параметры потока"
      className="absolute top-16 right-4 w-80 max-w-[calc(100%-2rem)] bg-cinema-900/95 border border-cinema-gold/30 backdrop-blur-2xl rounded-2xl p-4 shadow-2xl z-50 text-xs text-slate-200 animate-fade-in"
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-3">
        <span className="font-bold text-white flex items-center gap-1.5">
          <Activity className="w-4 h-4 text-cinema-gold" /> Параметры потока
        </span>
        <button
          onClick={onClose}
          aria-label="Закрыть статистику"
          className="text-slate-400 hover:text-white p-1 min-w-[32px] min-h-[32px] rounded-lg hover:bg-white/10"
        >
          ✕
        </button>
      </div>
      <div className="space-y-2 text-[11px]">
        <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg">
          <span className="text-slate-400">Режим:</span>
          <span className="font-semibold text-cinema-gold text-right">{modeText}</span>
        </div>
        <div className="flex justify-between items-center px-1">
          <span className="text-slate-400">Видеопоток:</span>
          <span className="text-white font-mono">{videoLabel || 'Оригинал'}</span>
        </div>
        <div className="flex justify-between items-center px-1">
          <span className="text-slate-400">Качество видео:</span>
          <span className="text-white font-mono text-right">{qualityText}</span>
        </div>
        <div className="flex justify-between items-center px-1">
          <span className="text-slate-400">Аудиодорожка:</span>
          <span className="text-white font-mono text-right">{audioLabel}</span>
        </div>
        <div className="flex justify-between items-center px-1">
          <span className="text-slate-400">Обработка звука:</span>
          <span className="text-white font-mono text-right">{audioProcessing}</span>
        </div>
        <div className="flex justify-between items-center px-1">
          <span className="text-slate-400">Контейнер / HLS:</span>
          <span className="text-white font-mono text-right">{containerLabel}</span>
        </div>
        <div className="flex justify-between items-center px-1">
          <span className="text-slate-400">Движок плеера:</span>
          <span className="text-cinema-gold font-mono text-right">{engineLabel}</span>
        </div>
        <div className="flex justify-between items-center px-1">
          <span className="text-slate-400">Скорость:</span>
          <span className="text-white font-mono">{playbackRate}x</span>
        </div>
        <div className="border-t border-white/10 pt-2 space-y-1">
          <div className="flex justify-between items-center px-1">
            <span className="text-slate-400">HLS уровень / битрейт:</span>
            <span className="text-white font-mono">
              {tech.hlsLevel >= 0 ? `lvl ${tech.hlsLevel}` : '—'}
              {tech.hlsBitrate > 0 ? ` • ${(tech.hlsBitrate / 1000).toFixed(0)} кбит/с` : ''}
            </span>
          </div>
          <div className="flex justify-between items-center px-1">
            <span className="text-slate-400">Дропы кадров:</span>
            <span className="text-white font-mono">
              {tech.droppedFrames}/{tech.totalFrames}{tech.totalFrames > 0 ? ` (${dropPct.toFixed(1)}%)` : ''}
            </span>
          </div>
          <div className="flex justify-between items-center px-1">
            <span className="text-slate-400">Буфер впереди:</span>
            <span className="text-white font-mono">{Math.round(tech.bufferedAhead)}с</span>
          </div>
          {tech.fallbackStage > 0 && (
            <div className="flex justify-between items-center px-1">
              <span className="text-slate-400">Авто-фолбэк:</span>
              <span className="text-amber-300 font-mono">ступень {tech.fallbackStage}</span>
            </div>
          )}
        </div>
        {effectiveDuration > 0 && (
          <div className="flex justify-between items-center px-1 border-t border-white/5 pt-2 text-[10px]">
            <span className="text-slate-500">Буфер / Длина:</span>
            <span className="text-slate-400 font-mono">{Math.round(bufferedTime)}с / {Math.round(effectiveDuration)}с</span>
          </div>
        )}
      </div>
    </div>
  );
};
