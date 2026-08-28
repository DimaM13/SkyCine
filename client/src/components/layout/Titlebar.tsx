import React, { useState, useEffect } from 'react';
import { Film, Minus, Square, Copy, X } from 'lucide-react';

export const Titlebar: React.FC<{ isPlayer?: boolean }> = ({ isPlayer = false }) => {
  const isDesktop = typeof window !== 'undefined' && Boolean((window as any).desktopPlayer?.isDesktop);
  const [isMax, setIsMax] = useState(false);

  useEffect(() => {
    if (!isDesktop) return;
    const dp = (window as any).desktopPlayer;
    dp?.isMaximized?.().then(setIsMax).catch(() => {});
    const unsub = dp?.onMaximizedChange?.((max: boolean) => setIsMax(max));
    return () => unsub?.();
  }, [isDesktop]);

  if (!isDesktop) return null;

  const dp = (window as any).desktopPlayer;

  return (
    <header
      className={`h-8 w-full flex items-center justify-between select-none z-50 transition-colors duration-200 ${
        isPlayer ? 'bg-transparent text-white' : 'bg-cinema-950/90 backdrop-blur-md border-b border-white/5 text-slate-300'
      }`}
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      {/* App Branding */}
      <div className="flex items-center gap-2 px-3">
        <Film className="w-3.5 h-3.5 text-cinema-gold" />
        <span className="text-xs font-semibold tracking-wide text-white/90">
          SkyCine Cinema
        </span>
      </div>

      {/* Drag center space */}
      <div className="flex-1 h-full" />

      {/* Window Control Action Buttons */}
      <div className="flex items-center h-full" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <button
          onClick={() => dp?.minimizeWindow?.()}
          className="h-full px-3 flex items-center justify-center hover:bg-white/10 text-white/70 hover:text-white transition-colors"
          title="Свернуть"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => dp?.maximizeWindow?.()}
          className="h-full px-3 flex items-center justify-center hover:bg-white/10 text-white/70 hover:text-white transition-colors"
          title={isMax ? "Восстановить" : "Развернуть"}
        >
          {isMax ? <Copy className="w-3 h-3 rotate-180" /> : <Square className="w-3 h-3" />}
        </button>

        <button
          onClick={() => dp?.closeWindow?.()}
          className="h-full px-3.5 flex items-center justify-center hover:bg-red-600 text-white/70 hover:text-white transition-colors"
          title="Закрыть"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
