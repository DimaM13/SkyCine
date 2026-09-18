import React from 'react';
import { Play, Pause, FastForward, LogIn, LogOut, RefreshCw, Loader2, CheckCircle2 } from 'lucide-react';
import { RoomActionFeedEntry } from '../../types';

interface RoomActionToastsProps {
  feed: RoomActionFeedEntry[];
}

function iconFor(action: string) {
  switch (action) {
    case 'PLAY': return <Play className="w-3 h-3 text-emerald-400 shrink-0" />;
    case 'PAUSE': return <Pause className="w-3 h-3 text-amber-400 shrink-0" />;
    case 'SEEK': return <FastForward className="w-3 h-3 text-sky-400 shrink-0" />;
    case 'JOIN': return <LogIn className="w-3 h-3 text-emerald-400 shrink-0" />;
    case 'LEAVE': return <LogOut className="w-3 h-3 text-slate-400 shrink-0" />;
    case 'SYNC': return <RefreshCw className="w-3 h-3 text-cinema-gold shrink-0" />;
    case 'BUFFERING': return <Loader2 className="w-3 h-3 text-sky-400 animate-spin shrink-0" />;
    case 'RECOVERED': return <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />;
    default: return null;
  }
}

export const RoomActionToasts: React.FC<RoomActionToastsProps> = ({ feed }) => {
  if (!feed || feed.length === 0) return null;
  // показываем последние 3
  const visible = feed.slice(-3);
  return (
    <div className="absolute bottom-24 left-3 z-40 flex flex-col gap-1.5 max-w-[70%] pointer-events-none">
      {visible.map((e) => (
        <div
          key={e.id}
          className="flex items-center gap-2 bg-black/75 backdrop-blur-md border border-white/10 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200 shadow-xl animate-fade-in"
        >
          {e.avatarUrl ? (
            <img src={e.avatarUrl} alt={e.username} className="w-4 h-4 rounded-full object-cover shrink-0" />
          ) : null}
          {iconFor(e.action)}
          <span className="truncate">
            <span className="font-bold text-white">{e.username}</span>
            <span className="opacity-80"> — {e.text.replace(new RegExp(`^${e.username}\\s*`), '') || e.text}</span>
          </span>
        </div>
      ))}
    </div>
  );
};
