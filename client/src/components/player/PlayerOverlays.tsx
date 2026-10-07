import React from 'react';
import { Play, Pause, RotateCcw, RotateCw, Keyboard } from 'lucide-react';

export interface SeekFlashData {
  side: 'left' | 'right';
  seconds: number;
  key: number;
}

/** YouTube-style double-tap feedback: translucent circle with arrow + seconds. */
export const SeekFlash: React.FC<{ flash: SeekFlashData | null }> = ({ flash }) => {
  if (!flash) return null;
  const isLeft = flash.side === 'left';
  return (
    <div
      key={flash.key}
      className={`absolute inset-y-0 ${isLeft ? 'left-0' : 'right-0'} w-[38%] flex items-center ${
        isLeft ? 'justify-start pl-8 sm:pl-14' : 'justify-end pr-8 sm:pr-14'
      } pointer-events-none z-30`}
    >
      <div className="flex flex-col items-center gap-1 rounded-full bg-black/55 px-7 py-6 backdrop-blur-[2px] animate-seek-flash">
        {isLeft ? (
          <RotateCcw className="w-8 h-8 text-white" />
        ) : (
          <RotateCw className="w-8 h-8 text-white" />
        )}
        <span className="text-white text-sm font-bold font-mono tabular-nums">
          {isLeft ? '−' : '+'}
          {flash.seconds}с
        </span>
      </div>
    </div>
  );
};

export interface CenterFlashData {
  kind: 'play' | 'pause';
  key: number;
}

/** Brief big play/pause pop when toggling via tap. */
export const CenterFlash: React.FC<{ flash: CenterFlashData | null }> = ({ flash }) => {
  if (!flash) return null;
  return (
    <div key={flash.key} className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
      <div className="rounded-full bg-black/60 p-5 backdrop-blur-[2px] animate-center-pop">
        {flash.kind === 'play' ? (
          <Play className="w-10 h-10 text-white fill-current ml-1" />
        ) : (
          <Pause className="w-10 h-10 text-white fill-current" />
        )}
      </div>
    </div>
  );
};

const SHORTCUTS: Array<[string, string]> = [
  ['Space / K', 'Пауза / Играть'],
  ['← / →  или  J / L', '∓ 10 сек (со Shift ∓ 30 сек)'],
  ['Двойной тап по бокам', '∓ 10 сек (тапы подряд суммируются)'],
  ['↑ / ↓', 'Громче / Тише'],
  ['F', 'Во весь экран'],
  ['M', 'Мут'],
  ['P', 'Картинка-в-картинке'],
  ['0 – 9', 'Перейти на 0–90% видео'],
  ['+ / −', 'Скорость быстрее / медленнее'],
  ['?', 'Этот список'],
];

export const ShortcutsButton: React.FC<{ onOpen: () => void }> = ({ onOpen }) => (
  <button
    onClick={onOpen}
    aria-label="Горячие клавиши (?)"
    title="Горячие клавиши (?)"
    className="p-2 min-w-[40px] min-h-[40px] hidden sm:flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-cinema-gold"
  >
    <Keyboard className="w-5 h-5" />
  </button>
);

export const ShortcutsModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  if (!open) return null;
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-label="Горячие клавиши"
    >
      <div
        className="w-full max-w-sm bg-cinema-900/95 border border-white/15 backdrop-blur-xl rounded-2xl p-4 shadow-2xl animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-3">
          <span className="font-bold text-white flex items-center gap-1.5 text-sm">
            <Keyboard className="w-4 h-4 text-cinema-gold" /> Горячие клавиши
          </span>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="text-slate-400 hover:text-white p-1 min-w-[32px] min-h-[32px] rounded-lg hover:bg-white/10"
          >
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-1.5 text-xs">
          {SHORTCUTS.map(([keys, desc]) => (
            <div key={keys} className="flex items-center justify-between gap-3 px-1">
              <span className="text-slate-400">{desc}</span>
              <kbd className="shrink-0 px-1.5 py-0.5 rounded-md bg-white/10 border border-white/15 font-mono text-[10px] text-cinema-gold whitespace-nowrap">
                {keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
