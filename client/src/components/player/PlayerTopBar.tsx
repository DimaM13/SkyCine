import React from 'react';
import { ArrowLeft, Share2, MessageSquare, Activity, Minus, Square, X, Users } from 'lucide-react';

export interface PlayerStreamBadges {
  modeText: string;
  modeType: 'direct' | 'stream' | 'transcode';
}

interface PlayerTopBarProps {
  visible: boolean;
  title: string;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  mediaType?: string;
  badges: PlayerStreamBadges;
  isWatchTogether: boolean;
  membersCount: number;
  isDesktop: boolean;
  isSidebarOpen: boolean;
  onBack?: () => void;
  onInvite?: () => void;
  onToggleSidebar?: () => void;
  onToggleStats: () => void;
}

export const PlayerTopBar: React.FC<PlayerTopBarProps> = ({
  visible,
  title,
  seasonNumber,
  episodeNumber,
  mediaType,
  badges,
  isWatchTogether,
  membersCount,
  isDesktop,
  isSidebarOpen,
  onBack,
  onInvite,
  onToggleSidebar,
  onToggleStats,
}) => {
  return (
    <div
      className={`absolute top-0 left-0 right-0 p-4 sm:p-6 bg-gradient-to-b from-black/90 via-black/50 to-transparent transition-opacity duration-300 z-30 flex items-center justify-between select-none ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      <div className="flex items-center gap-3 min-w-0" style={{ WebkitAppRegion: 'no-drag' } as any}>
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Назад"
            className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer shrink-0 focus-visible:ring-2 focus-visible:ring-cinema-gold"
            title="Назад"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-sm sm:text-base font-bold text-white truncate min-w-0 flex-1">
              {title}
            </h1>
            {mediaType === 'EPISODE' && seasonNumber && episodeNumber && (
              <span className="shrink-0 text-[11px] text-cinema-gold font-bold px-1.5 py-0.5 rounded bg-cinema-gold/10 border border-cinema-gold/20 whitespace-nowrap">
                <span className="hidden sm:inline">Сезон {seasonNumber} • Серия {episodeNumber}</span>
                <span className="sm:hidden">С{seasonNumber} • Е{episodeNumber}</span>
              </span>
            )}
            <span
              title={badges.modeText}
              className={`shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wider uppercase border flex items-center gap-1.5 backdrop-blur-md whitespace-nowrap ${
                badges.modeType === 'transcode'
                  ? 'bg-sky-500/20 text-sky-300 border-sky-500/30'
                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${badges.modeType === 'transcode' ? 'bg-sky-400' : 'bg-emerald-400 animate-pulse'}`} />
              {badges.modeType === 'direct' ? 'Direct' : badges.modeType === 'stream' ? 'Stream' : 'Транскод'}
            </span>
          </div>

          {isWatchTogether && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold tracking-wider uppercase bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1 shadow-sm backdrop-blur-md">
                <Users className="w-3 h-3 text-purple-400" />
                Комната ({membersCount})
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0" style={{ WebkitAppRegion: 'no-drag' } as any}>
        {isWatchTogether && onInvite && (
          <button
            onClick={onInvite}
            aria-label="Пригласить друзей"
            className="px-3 py-1.5 min-h-[40px] rounded-xl bg-cinema-gold/15 hover:bg-cinema-gold/30 text-cinema-gold border border-cinema-gold/30 text-xs font-semibold flex items-center gap-1.5 cursor-pointer focus-visible:ring-2 focus-visible:ring-cinema-gold"
            title="Пригласить друзей"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Позвать</span>
          </button>
        )}

        {isWatchTogether && onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            aria-label="Чат комнаты"
            className={`px-3 py-1.5 min-h-[40px] rounded-xl border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all focus-visible:ring-2 focus-visible:ring-cinema-gold ${
              isSidebarOpen ? 'bg-cinema-gold text-black border-cinema-gold' : 'bg-white/10 text-slate-200 border-white/15 hover:bg-white/20'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Чат</span>
          </button>
        )}

        <button
          onClick={onToggleStats}
          aria-label="Инфо о потоке"
          className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 text-xs cursor-pointer focus-visible:ring-2 focus-visible:ring-cinema-gold"
          title="Инфо о потоке"
        >
          <Activity className="w-4 h-4" />
        </button>

        {isDesktop && (
          <div className="flex items-center gap-1 ml-2 pl-2 border-l border-white/15">
            <button
              onClick={() => (window as any).desktopPlayer?.minimizeWindow?.()}
              aria-label="Свернуть окно"
              className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 transition-colors cursor-pointer"
              title="Свернуть"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => (window as any).desktopPlayer?.maximizeWindow?.()}
              aria-label="Развернуть окно"
              className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 transition-colors cursor-pointer"
              title="Развернуть"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => (window as any).desktopPlayer?.closeWindow?.()}
              aria-label="Закрыть окно"
              className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl bg-red-500/20 hover:bg-red-600 text-red-300 hover:text-white transition-colors cursor-pointer"
              title="Закрыть"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
