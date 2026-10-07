import React, { useState } from 'react';
import { ExternalLink, Copy, Check, Download } from 'lucide-react';
import { openInVlc, downloadM3u, copyDirectLink } from '../../utils/vlc';

interface VlcOpenButtonProps {
  mediaId: string;
  title: string;
  /** compact — только «VLC», иначе «Открыть в VLC» */
  compact?: boolean;
  className?: string;
}

/**
 * Кнопка «Открыть в VLC» + копирование прямой ссылки + скачивание .m3u.
 * Открывает ОРИГИНАЛЬНЫЙ прямой поток (/api/stream/:id/direct с токеном).
 */
export const VlcOpenButton: React.FC<VlcOpenButtonProps> = ({ mediaId, title, compact, className }) => {
  const [copied, setCopied] = useState(false);
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

  const handleCopy = async () => {
    const ok = await copyDirectLink(mediaId);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      flash('Не удалось скопировать ссылку');
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
      <button
        onClick={handleCopy}
        title="Скопировать прямую ссылку на оригинал (в VLC: Медиа → Открыть сетевой поток, Ctrl+N)"
        aria-label="Скопировать прямую ссылку"
        className="p-3 rounded-2xl bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white border border-white/10 transition-all active:scale-95 cursor-pointer"
      >
        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
      </button>
      <button
        onClick={() => {
          downloadM3u(mediaId, title);
          flash('Плейлист .m3u скачан — откройте его в VLC');
        }}
        title="Скачать .m3u-плейлист (двойной клик откроет его в VLC)"
        aria-label="Скачать .m3u плейлист"
        className="p-3 rounded-2xl bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white border border-white/10 transition-all active:scale-95 cursor-pointer"
      >
        <Download className="w-4 h-4" />
      </button>
      {hint && <span className="text-[11px] text-slate-300 w-full sm:w-auto">{hint}</span>}
    </div>
  );
};
