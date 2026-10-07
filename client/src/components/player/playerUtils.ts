export function qualityLabel(q: string): string {
  if (q === 'original') return 'Оригинал';
  if (q === 'transcode') return 'Оригинал (транскод)';
  return q;
}

export function formatTime(secs: number): string {
  if (isNaN(secs) || secs < 0) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) {
    return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
