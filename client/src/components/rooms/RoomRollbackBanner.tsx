import React from 'react';
import { History, Loader2 } from 'lucide-react';
import { RoomRollbackNotice } from '../../types';

interface RoomRollbackBannerProps {
  notice: RoomRollbackNotice | null;
}

export const RoomRollbackBanner: React.FC<RoomRollbackBannerProps> = ({ notice }) => {
  if (!notice) return null;
  return (
    <div className="absolute top-[68px] sm:top-[74px] left-1/2 -translate-x-1/2 z-40 w-[94%] sm:w-auto sm:max-w-xl pointer-events-auto animate-fade-in">
      <div className="flex items-center gap-2 bg-red-950/85 backdrop-blur-xl border border-red-500/40 rounded-2xl px-3 py-2 shadow-[0_0_20px_rgba(239,68,68,0.25)]">
        <History className="w-4 h-4 text-red-300 shrink-0" />
        <div className="text-[11px] leading-tight">
          <span className="font-bold text-red-200">{notice.culpritName} отмотал назад на {notice.backwardSec.toFixed(1)}с</span>
          <span className="text-red-200/80"> — выравниваем под комнату…</span>
        </div>
        <Loader2 className="w-3.5 h-3.5 text-red-300 animate-spin shrink-0 ml-auto" />
      </div>
    </div>
  );
};
