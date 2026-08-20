import React from 'react';
import { Loader2, CheckCircle2, Play, Zap, Check } from 'lucide-react';
import { RoomMember } from '../../types';

interface BufferBarrierBannerProps {
  isVisible: boolean;
  members: RoomMember[];
  isHost: boolean;
  onForcePlay: () => void;
}

export const BufferBarrierBanner: React.FC<BufferBarrierBannerProps> = ({
  isVisible,
  members,
  isHost,
  onForcePlay,
}) => {
  if (!isVisible || members.length <= 1) return null;

  const readyCount = members.filter((m) => m.isReady).length;
  const totalCount = members.length;
  const allReady = readyCount === totalCount;

  return (
    <div className="absolute top-16 md:top-20 left-1/2 -translate-x-1/2 z-40 max-w-lg w-[92%] sm:w-auto animate-fade-in pointer-events-auto">
      <div
        className={`backdrop-blur-xl border rounded-2xl p-3 sm:px-4 sm:py-3 shadow-[0_8px_32px_rgba(0,0,0,0.8)] flex flex-col gap-2.5 transition-all ${
          allReady
            ? 'bg-cinema-900/95 border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.25)]'
            : 'bg-cinema-900/90 border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
        }`}
      >
        {/* Header with Title & Host Override */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {allReady ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
            )}
            <span className="text-xs font-bold text-white">
              {allReady
                ? 'Все участники готовы к просмотру! Нажмите Play'
                : `Ожидание прогрузки (${readyCount} из ${totalCount} готовы)`}
            </span>
          </div>

          {!allReady && isHost && (
            <button
              onClick={onForcePlay}
              className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-[11px] font-extrabold flex items-center gap-1 shadow-md transition-all active:scale-95 cursor-pointer"
              title="Начать воспроизведение не дожидаясь остальных"
            >
              <Zap className="w-3 h-3 fill-current" />
              <span>Запустить ⚡</span>
            </button>
          )}
        </div>

        {/* Members Status Chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {members.map((m) => {
            const isReady = m.isReady;
            const percent = m.bufferPercent !== undefined ? m.bufferPercent : (isReady ? 100 : 0);

            return (
              <div
                key={m.socketId || m.userId}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-xl text-[11px] font-medium border transition-all ${
                  isReady
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                    : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                }`}
              >
                <img
                  src={m.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${m.username}`}
                  alt={m.username}
                  className="w-3.5 h-3.5 rounded-full object-cover shrink-0"
                />
                <span className="font-semibold max-w-[100px] truncate">{m.username}:</span>
                {isReady ? (
                  <span className="flex items-center gap-0.5 text-emerald-400 font-bold">
                    Готов <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-amber-400">
                    <span>{percent}%</span>
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
