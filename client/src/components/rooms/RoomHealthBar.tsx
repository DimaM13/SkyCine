import React from 'react';
import { Wifi, WifiOff, AlertTriangle, Loader2, CheckCircle2, Monitor, Globe, Smartphone } from 'lucide-react';
import { RoomHealthEntry } from '../../types';

interface RoomHealthBarProps {
  health: RoomHealthEntry[];
  waitingText: string | null;
  currentUserId?: string;
  compact?: boolean;
  // Видимость интерфейса плеера: полоска прячется вместе с контролами,
  // но серьёзное (буферизация/лаги) пробивается всегда.
  controlsVisible?: boolean;
}

const STATUS_STYLE: Record<string, { dot: string; ring: string; chip: string; Icon: any }> = {
  ok: { dot: 'bg-emerald-400', ring: 'border-emerald-500/40', chip: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25', Icon: CheckCircle2 },
  warning: { dot: 'bg-amber-400', ring: 'border-amber-500/50', chip: 'bg-amber-500/10 text-amber-300 border-amber-500/25', Icon: AlertTriangle },
  lagging: { dot: 'bg-red-400', ring: 'border-red-500/60', chip: 'bg-red-500/10 text-red-300 border-red-500/30', Icon: WifiOff },
  buffering: { dot: 'bg-sky-400 animate-pulse', ring: 'border-sky-500/60', chip: 'bg-sky-500/10 text-sky-300 border-sky-500/30', Icon: Loader2 },
  offline: { dot: 'bg-slate-500', ring: 'border-white/10', chip: 'bg-white/5 text-slate-400 border-white/10', Icon: Wifi },
};

function platformIcon(platform?: string) {
  if (platform === 'desktop') return <Monitor className="w-3 h-3 opacity-70" />;
  if (platform === 'mobile') return <Smartphone className="w-3 h-3 opacity-70" />;
  return <Globe className="w-3 h-3 opacity-70" />;
}

export const RoomHealthBar: React.FC<RoomHealthBarProps> = ({ health, waitingText, currentUserId, controlsVisible = true }) => {
  if (!health || health.length <= 1) return null;
  const hasSerious = health.some((h) => h.status === 'buffering' || h.status === 'lagging');
  // Интерфейс скрыт и все здоровы — не мешаем кино. Серьёзное показываем всегда.
  if (!controlsVisible && !hasSerious) return null;
  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 w-[96%] sm:w-auto sm:max-w-3xl pointer-events-auto">
      <div className="backdrop-blur-xl bg-black/70 border border-white/10 rounded-2xl px-2.5 py-1.5 shadow-2xl">
        {waitingText && (
          <div className="flex items-center gap-1.5 px-1 pb-1 text-[11px] font-semibold text-amber-300">
            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
            <span className="truncate">{waitingText}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {health.map((h) => {
            const st = STATUS_STYLE[h.status] || STATUS_STYLE.ok;
            const isMe = currentUserId && h.userId === currentUserId;
            const Icon = st.Icon;
            const title = `${h.username}\n${h.detail}\nПинг: ${h.rttMs}мс • Буфер: ${h.bufferedAheadSec}с • Сталы: ${h.stallCount} • Дропы: ${h.droppedFrames}${h.driftSec ? `\nДрейф: ${h.driftSec}с` : ''}${h.platform ? `\nПлатформа: ${h.platform}` : ''}${h.streamMode ? ` • ${h.streamMode}` : ''}`;
            return (
              <div
                key={h.userId}
                title={title}
                className={`flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-xl border text-[11px] font-medium whitespace-nowrap ${st.chip} ${isMe ? 'ring-1 ring-cinema-gold/50' : ''}`}
              >
                <span className="relative flex w-5 h-5 shrink-0">
                  <img
                    src={h.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${h.username}`}
                    alt={h.username}
                    className={`w-5 h-5 rounded-full object-cover border ${st.ring}`}
                  />
                  <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-black ${st.dot}`} />
                </span>
                <span className="font-bold max-w-[90px] truncate">{h.username}{isMe ? ' (вы)' : ''}</span>
                <span className="flex items-center gap-1 opacity-90">
                  {h.status === 'buffering' ? <Icon className="w-3 h-3 animate-spin" /> : <Icon className="w-3 h-3" />}
                  <span className="font-mono">{h.rttMs}мс</span>
                  <span className="opacity-60">•</span>
                  <span className="font-mono">{h.bufferedAheadSec}с</span>
                  {platformIcon(h.platform)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
