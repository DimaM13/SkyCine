import React from 'react';
import { Activity } from 'lucide-react';

export interface PlayerTechStats {
  droppedFrames: number;
  totalFrames: number;
  hlsBitrate: number;
  fallbackStage: number;
  bufferedAhead: number;
}

interface PlayerStatsModalProps {
  open: boolean;
  onClose: () => void;
  /** Полный режим строкой: Direct Play / Direct Stream / Транскодирование… */
  modeText: string;
  /** Одна строка про видео: "H264 • 1080p • Direct Copy" / "… • Транскод 720p • 2.4 Мбит/с" */
  videoLine: string;
  /** Одна строка про звук: "RUS • AAC 2.0" / "… (транскод)" */
  audioLine: string;
  playbackRate: number;
  tech: PlayerTechStats;
}

export const PlayerStatsModal: React.FC<PlayerStatsModalProps> = ({
  open,
  onClose,
  modeText,
  videoLine,
  audioLine,
  playbackRate,
  tech,
}) => {
  if (!open) return null;
  const dropPct = tech.totalFrames > 0 ? (tech.droppedFrames / tech.totalFrames) * 100 : 0;
  const bufferLow = tech.bufferedAhead < 5;
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Состояние потока"
      className="absolute top-16 right-4 w-72 max-w-[calc(100%-2rem)] bg-cinema-900/95 border border-cinema-gold/30 backdrop-blur-2xl rounded-2xl p-4 shadow-2xl z-50 text-xs text-slate-200 animate-fade-in"
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2">
        <span className="font-bold text-white flex items-center gap-1.5">
          <Activity className="w-4 h-4 text-cinema-gold" /> Поток
        </span>
        <button
          onClick={onClose}
          aria-label="Закрыть"
          className="text-slate-400 hover:text-white p-1 min-w-[32px] min-h-[32px] rounded-lg hover:bg-white/10"
        >
          ✕
        </button>
      </div>
      <div className="space-y-2 text-[11px]">
        <div className="flex justify-between items-center gap-2 bg-white/5 px-2 py-1.5 rounded-lg">
          <span className="text-slate-400 shrink-0">Режим</span>
          <span className="font-semibold text-cinema-gold text-right leading-snug">{modeText}</span>
        </div>
        <div className="flex justify-between items-center gap-2 px-1">
          <span className="text-slate-400 shrink-0">Видео</span>
          <span className="text-white font-mono text-right leading-snug">{videoLine}</span>
        </div>
        <div className="flex justify-between items-center gap-2 px-1">
          <span className="text-slate-400 shrink-0">Звук</span>
          <span className="text-white font-mono text-right leading-snug">{audioLine}</span>
        </div>
        <div className="flex justify-between items-center gap-2 px-1">
          <span className="text-slate-400 shrink-0">Скорость</span>
          <span className="text-white font-mono">{playbackRate}x</span>
        </div>
        <div className="flex justify-between items-center gap-2 px-1 border-t border-white/10 pt-2">
          <span className="text-slate-400 shrink-0">Буфер</span>
          <span className={`font-mono ${bufferLow ? 'text-amber-300' : 'text-emerald-300'}`}>
            {Math.round(tech.bufferedAhead)}с{tech.totalFrames > 0 && dropPct > 0.5 ? ` • дропы ${dropPct.toFixed(1)}%` : ''}
          </span>
        </div>
        {tech.fallbackStage > 0 && (
          <div className="flex justify-between items-center gap-2 px-1">
            <span className="text-slate-400 shrink-0">Авто-качество</span>
            <span className="text-amber-300 font-mono">ступень {tech.fallbackStage}</span>
          </div>
        )}
      </div>
    </div>
  );
};
