import React, { useState } from 'react';
import { Radio, Disc3, Subtitles, Gauge } from 'lucide-react';
import { MediaTrack } from '../../types';
import { qualityLabel, PLAYBACK_RATES } from './playerUtils';

type MenuTab = 'root' | 'quality' | 'audio' | 'subtitles' | 'speed';

interface PlayerSettingsMenuProps {
  open: boolean;
  selectedQuality: string;
  onSelectQuality: (q: string) => void;
  audioTracks: MediaTrack[];
  selectedAudioTrack: number;
  onSelectAudioTrack: (idx: number) => void;
  subtitleTracks: MediaTrack[];
  selectedSubtitleTrack: number;
  onSelectSubtitleTrack: (idx: number) => void;
  playbackRate: number;
  onSelectRate: (r: number) => void;
  onClose: () => void;
}

const QUALITIES = ['original', 'transcode', '1080p', '720p', '480p'];

export const PlayerSettingsMenu: React.FC<PlayerSettingsMenuProps> = ({
  open,
  selectedQuality,
  onSelectQuality,
  audioTracks,
  selectedAudioTrack,
  onSelectAudioTrack,
  subtitleTracks,
  selectedSubtitleTrack,
  onSelectSubtitleTrack,
  playbackRate,
  onSelectRate,
  onClose,
}) => {
  const [tab, setTab] = useState<MenuTab>('root');
  if (!open) return null;

  const pick = (fn: () => void) => () => {
    fn();
    setTab('root');
    onClose();
  };

  return (
    <div
      role="menu"
      aria-label="Настройки потока"
      className="absolute bottom-12 right-0 w-64 max-w-[calc(100vw-2rem)] bg-cinema-900/95 border border-white/15 backdrop-blur-xl rounded-2xl p-3 shadow-2xl z-50 text-xs text-slate-200 animate-fade-in"
    >
      {tab === 'root' && (
        <div className="flex flex-col gap-1">
          <div className="text-[11px] font-semibold text-slate-400 px-2 py-1 uppercase">Настройки потока</div>
          <button onClick={() => setTab('quality')} className="flex items-center justify-between p-2 min-h-[40px] rounded-lg hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-cinema-gold">
            <span className="flex items-center gap-2"><Radio className="w-4 h-4 text-cinema-gold" /> Качество</span>
            <span className="text-slate-400 capitalize">{qualityLabel(selectedQuality)}</span>
          </button>
          <button onClick={() => setTab('audio')} className="flex items-center justify-between p-2 min-h-[40px] rounded-lg hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-cinema-gold">
            <span className="flex items-center gap-2"><Disc3 className="w-4 h-4 text-cinema-gold" /> Аудиодорожка</span>
            <span className="text-slate-400 truncate max-w-[80px]">#{selectedAudioTrack}</span>
          </button>
          <button onClick={() => setTab('subtitles')} className="flex items-center justify-between p-2 min-h-[40px] rounded-lg hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-cinema-gold">
            <span className="flex items-center gap-2"><Subtitles className="w-4 h-4 text-cinema-gold" /> Субтитры</span>
            <span className="text-slate-400">{selectedSubtitleTrack === -1 ? 'Выкл' : 'Вкл'}</span>
          </button>
          <button onClick={() => setTab('speed')} className="flex items-center justify-between p-2 min-h-[40px] rounded-lg hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-cinema-gold">
            <span className="flex items-center gap-2"><Gauge className="w-4 h-4 text-cinema-gold" /> Скорость</span>
            <span className="text-slate-400">{playbackRate}x</span>
          </button>
        </div>
      )}

      {tab === 'quality' && (
        <div className="flex flex-col gap-1">
          <button onClick={() => setTab('root')} className="text-left text-[11px] text-cinema-gold font-semibold mb-1 p-1">← Назад</button>
          {QUALITIES.map((q) => (
            <button
              key={q}
              onClick={pick(() => onSelectQuality(q))}
              className={`p-2 min-h-[40px] rounded-lg text-left capitalize flex justify-between ${selectedQuality === q ? 'bg-cinema-gold/20 text-cinema-gold font-bold' : 'hover:bg-white/10'}`}
            >
              <span>{qualityLabel(q)}</span>
              {selectedQuality === q && <span>✓</span>}
            </button>
          ))}
        </div>
      )}

      {tab === 'audio' && (
        <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
          <button onClick={() => setTab('root')} className="text-left text-[11px] text-cinema-gold font-semibold mb-1 p-1">← Назад</button>
          {audioTracks.map((t: MediaTrack) => (
            <button
              key={t.streamIndex}
              onClick={pick(() => onSelectAudioTrack(t.streamIndex))}
              className={`p-2 min-h-[40px] rounded-lg text-left flex justify-between ${selectedAudioTrack === t.streamIndex ? 'bg-cinema-gold/20 text-cinema-gold font-bold' : 'hover:bg-white/10'}`}
            >
              <div className="truncate pr-2">
                <p className="font-semibold text-xs">{t.title || `Дорожка #${t.streamIndex}`}</p>
                <p className="text-[10px] text-slate-400 uppercase">{t.language || 'und'} • {t.codec}</p>
              </div>
              {selectedAudioTrack === t.streamIndex && <span>✓</span>}
            </button>
          ))}
        </div>
      )}

      {tab === 'subtitles' && (
        <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
          <button onClick={() => setTab('root')} className="text-left text-[11px] text-cinema-gold font-semibold mb-1 p-1">← Назад</button>
          <button
            onClick={pick(() => onSelectSubtitleTrack(-1))}
            className={`p-2 min-h-[40px] rounded-lg text-left flex justify-between ${selectedSubtitleTrack === -1 ? 'bg-cinema-gold/20 text-cinema-gold font-bold' : 'hover:bg-white/10'}`}
          >
            <span>Отключить субтитры</span>
            {selectedSubtitleTrack === -1 && <span>✓</span>}
          </button>
          {subtitleTracks.map((s: MediaTrack) => (
            <button
              key={s.streamIndex}
              onClick={pick(() => onSelectSubtitleTrack(s.streamIndex))}
              className={`p-2 min-h-[40px] rounded-lg text-left flex justify-between ${selectedSubtitleTrack === s.streamIndex ? 'bg-cinema-gold/20 text-cinema-gold font-bold' : 'hover:bg-white/10'}`}
            >
              <span>{s.title || `Субтитры #${s.streamIndex}`}</span>
              {selectedSubtitleTrack === s.streamIndex && <span>✓</span>}
            </button>
          ))}
        </div>
      )}

      {tab === 'speed' && (
        <div className="flex flex-col gap-1">
          <button onClick={() => setTab('root')} className="text-left text-[11px] text-cinema-gold font-semibold mb-1 p-1">← Назад</button>
          {PLAYBACK_RATES.map((r) => (
            <button
              key={r}
              onClick={pick(() => onSelectRate(r))}
              className={`p-2 min-h-[40px] rounded-lg text-left flex justify-between ${playbackRate === r ? 'bg-cinema-gold/20 text-cinema-gold font-bold' : 'hover:bg-white/10'}`}
            >
              <span>{r}x{ r === 1 ? ' (обычная)' : ''}</span>
              {playbackRate === r && <span>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
