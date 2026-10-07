import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { openInVlc } from '../../utils/vlc';

interface VlcOpenButtonProps {
  mediaId: string;
  title: string;
  /** compact — только «VLC», иначе «Открыть в VLC» */
  compact?: boolean;
  className?: string;
}

/**
 * Кнопка «Открыть в VLC».
 * Открывает ОРИГИНАЛЬНЫЙ прямой поток (/api/stream/:id/direct с токеном).
 */
export const VlcOpenButton: React.FC<VlcOpenButtonProps> = ({ mediaId, title, compact, className }) => {
  const [hint, setHint] = useState<string | null>(null);

  const flash = (msg: string) => {
    setHint(msg);
    window.setTimeout(() => setHint((cur) => (cur === msg ? null : cur)), 3000);
  };

  const handleOpen = () => {
    const how = openInVlc(mediaId, title);
    if (how === 'vlc-scheme') {
      flash('Открываем VLC… если не открылся — установите VLC из App Store');
    } else if (how === 'intent') {
      flash('Открываем VLC… если его нет — откроется Play Store');
    } else {
      flash('Плейлист .m3u скачан — откройте его в VLC');
    }
  };

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className || ''}`}>
      <button
        onClick={handleOpen}
        title="Открыть оригинальный поток во внешнем VLC (iPhone / Android / ПК)"
        className="px-4 py-3 rounded-2xl bg-[#ff8800]/15 hover:bg-[#ff8800]/30 text-[#ff8800] font-bold text-xs md:text-sm flex items-center gap-2 border border-[#ff8800]/30 transition-all active:scale-95 cursor-pointer"
      >
        <ExternalLink className="w-4 h-4" />
        <span>{compact ? 'VLC' : 'Открыть в VLC'}</span>
      </button>
      {hint && <span className="text-[11px] text-slate-300 w-full sm:w-auto">{hint}</span>}
    </div>
  );
};
