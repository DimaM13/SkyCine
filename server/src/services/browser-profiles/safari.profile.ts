/**
 * SOURCE OF TRUTH — Apple Safari (macOS + iPadOS/iOS, ветка Safari 17/18, 2024-2026):
 * что играется нативно (direct progressive / AVPlayer HLS), а что только через HLS.
 *
 * Составлено по первоисточникам (проверено 2026-09-21):
 *  - Safari Release Notes: Opus в WebM (Safari 15, только macOS/iPadOS),
 *    stereo-Opus в MP4+WebM на Sonoma (Safari 17), VP8/VP9+WebM на iOS/iPadOS (17.4),
 *    Ogg Opus/Vorbis + WebM в MediaRecorder (18.4):
 *    https://github.com/Fyrd/caniuse/issues/6805 (сводка с цитатами релиз-ноутов)
 *  - AV1 у Apple: только HW-декод — iPhone 15 Pro+ (A17 Pro), Mac M3+, iPad M4+,
 *    software-фолбэка нет (2026), HLS+FairPlay+DolbyVision поддерживаются:
 *    https://bitmovin.com/blog/apple-av1-support/ (2026-04-18)
 *  - Замеры покрытия 2026 (Safari AV1 decode: ~24% macOS / ~33% iOS — hardware gap):
 *    https://webcodecsfundamentals.org/datasets/codec-analysis-2026/
 *  - MDN Containers / Audio-in-WebM+Ogg (таблицы Chrome/Edge/Firefox/Safari,
 *    Ogg Opus/Vorbis в Safari только с 18.4):
 *    https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Containers
 *  - WebKit: FLAC-в-MP4 по строке "fLaC" (17+), Opus-in-MP4, ALAC/PCM в MediaRecorder:
 *    https://github.com/WebKit/WebKit/pull/16956
 *    https://github.com/WebKit/WebKit/pull/35852
 *    https://github.com/WebKit/WebKit/pull/39977
 *  - HEVC везде нативно через VideoToolbox (13+, incl. SW-фолбэк на macOS):
 *    https://github.com/lid-labs/hevc.js (таблица совместимости)
 *
 * Коротко:
 *  - Видео нативно: H.264/AVC, H.265/HEVC (Main/Main10, VideoToolbox; на macOS
 *    есть software-фолбэк), VP8/VP9 — в WebM (macOS/iPadOS 15+, iOS/iPadOS 17.4+;
 *    VP9-в-MP4 негарантирован). AV1 — ТОЛЬКО HW (M3+/A17 Pro+/M4+, без SW) =>
 *    по умолчанию считаем НЕнативным. НЕТ: MPEG-4 ASP, MPEG-1/2, VC-1.
 *  - Аудио нативно: AAC (все профили), MP3, ALAC, FLAC (в MP4 — строка "fLaC"),
 *    AC3/EAC3 passthrough (MP4/HLS), PCM/WAV; Opus — условно (stereo в MP4/WebM
 *    с Safari 17 на Sonoma / 17.4 на iOS; Ogg Opus/Vorbis — только с 18.4).
 *    НЕТ (стабильно): Vorbis-в-MP4/WebM старых версий, DTS/TrueHD, WMA.
 *  - Контейнеры progressive: MP4/MOV/M4V. НЕТ: MKV (никогда), WebM — условно
 *    (см. выше), Ogg — только 18.4+, TS/AVI/WMV/FLV/VOB/MPG — нет.
 *  - HLS: нативный AVPlayer — primary (canPlayType реален, FairPlay только тут);
 *    ManagedMediaSource (macOS 14+ / iOS 17.1+) — путь hls.js; классического MSE
 *    на iPhone до 17.1 не было вовсе.
 *
 * ПОЛИТИКА веб-клиента: Apple-девайс без MMS => нативный AVPlayer (isApple=1,
 * сервер отдаёт всегда fMP4: VERSION 7 + MAP; MPEG-TS удалён); мобильный Apple
 * с MMS => hls.js через ManagedMediaSource.
 *
 * Файл standalone: без импортов, чистая data + pure functions.
 */

export interface BrowserMediaProbe {
  videoCodec?: string;
  audioCodec?: string;
  filePath?: string;
  width?: number;
  height?: number;
}

export interface PlaybackDecision {
  mode: 'direct' | 'hls';
  reasons: string[];
}

/** Какие параметры просить у /master.m3u8: нативный AVPlayer-путь (isApple=1). */
export const SAFARI_MASTER_PARAMS = {
  isApple: 1,
  quality: 'original',
} as const;

/** Видеокодеки, безусловно нативные в Safari (прогрессив/HLS). */
export const SAFARI_NATIVE_VIDEO = [
  'h264',
  'hevc', // Main/Main10, VideoToolbox (+SW-фолбэк на macOS)
  'h265',
] as const;

/** VP8/VP9 — нативны, но ТОЛЬКО в WebM и с версионным полом (см. decide). */
export const SAFARI_WEBM_VIDEO = ['vp8', 'vp9'] as const;

/** Аудиокодеки, безусловно нативные в Safari. */
export const SAFARI_NATIVE_AUDIO = [
  'aac', // все профили incl. HE-AAC
  'mp3',
  'alac',
  'flac', // в MP4 — по строке "fLaC" (Safari 17+)
  'ac3', // passthrough в MP4/HLS
  'eac3', // passthrough в MP4/HLS
  'pcm',
  'opus', // условно: stereo в MP4/WebM с Safari 17 (Sonoma) / 17.4 (iOS) — см. decide
] as const;

/** Контейнеры progressive, безусловно нативные в Safari. */
export const SAFARI_NATIVE_CONTAINERS = ['mp4', 'm4v', 'mov'] as const;

export function safariExtOf(filePath?: string): string {
  if (!filePath) return '';
  const m = filePath.toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/);
  return m ? m[1] : '';
}

export function normalizeSafariVideoCodec(raw?: string): string {
  const c = (raw || '').toLowerCase().trim();
  if (!c) return '';
  if (['avc1', 'avc', 'h264', 'x264'].includes(c)) return 'h264';
  if (['hev1', 'hev', 'hevc', 'h265', 'hvc1', 'x265'].includes(c)) return 'hevc';
  if (['av01', 'av1'].includes(c)) return 'av1';
  if (['vp09', 'vp9'].includes(c)) return 'vp9';
  if (['vp80', 'vp8'].includes(c)) return 'vp8';
  if (['mp4v', 'mpeg4', 'xvid', 'divx', 'dx50'].includes(c)) return 'mpeg4';
  if (['mpeg2video', 'mpeg2'].includes(c)) return 'mpeg2';
  if (['mpeg1video', 'mpeg1'].includes(c)) return 'mpeg1';
  if (['mjpeg', 'mjpg', 'jpeg'].includes(c)) return 'mjpeg';
  if (['wmv3', 'wmva', 'vc1', 'vc-1'].includes(c)) return 'vc1';
  return c;
}

export function normalizeSafariAudioCodec(raw?: string): string {
  const c = (raw || '').toLowerCase().trim();
  if (!c) return '';
  if (['mp4a', 'mp4a.40.2', 'mp4a.40.5', 'aac', 'aac-lc', 'he-aac', 'heaac'].includes(c)) return 'aac';
  if (['ac-3', 'ac3', 'dolby_digital'].includes(c)) return 'ac3';
  if (['ec-3', 'ec3', 'eac3', 'dd+', 'dolby_digital_plus', 'atmos_eac3', 'atmos'].includes(c)) return 'eac3';
  if (['mp3', 'mpga', 'mp1', 'mp2'].includes(c)) return 'mp3';
  if (c.includes('dts')) return 'dts';
  if (['truehd', 'mlp', 'atmos_truehd'].includes(c)) return 'truehd';
  if (['vorbis', 'ogg'].includes(c)) return 'vorbis';
  if (c === 'flac') return 'flac';
  if (['opus'].includes(c)) return 'opus';
  if (['pcm', 'lpcm', 's16le', 's24le', 'wav'].includes(c)) return 'pcm';
  if (['wma', 'wmav2'].includes(c)) return 'wma';
  if (['alac'].includes(c)) return 'alac';
  return c;
}

/**
 * Решение direct vs HLS для Safari.
 * Консервативно: AV1 и неизвестное — всегда HLS (транскод в H.264 съест любой
 * девайс, а AV1-copy уронил бы все Intel-Mac и старые iPhone без SW-фолбэка).
 */
export function decideSafariPlayback(probe: BrowserMediaProbe): PlaybackDecision {
  const reasons: string[] = [];
  const v = normalizeSafariVideoCodec(probe.videoCodec);
  const a = normalizeSafariAudioCodec(probe.audioCodec);
  const ext = safariExtOf(probe.filePath);

  if (!v) {
    reasons.push('видео unknown — через HLS-транскод в H.264');
  } else if (v === 'av1') {
    reasons.push('видео AV1 в Safari — только HW-декод (M3+/A17 Pro+/M4+, без software-фолбэка) — через HLS-транскод в H.264');
  } else if ((SAFARI_WEBM_VIDEO as readonly string[]).includes(v)) {
    // VP8/VP9: только WebM (macOS/iPadOS 15+, iOS 17.4+); VP9-в-MP4 негарантирован.
    if (ext === 'webm') {
      reasons.push('note: VP8/VP9 в WebM — нужен Safari 15+ (macOS/iPadOS) / 17.4+ (iOS)');
    } else {
      reasons.push(`видео ${v.toUpperCase()} вне WebM Safari негарантирован (VP9-в-MP4) — через HLS`);
    }
  } else if (!(SAFARI_NATIVE_VIDEO as readonly string[]).includes(v)) {
    reasons.push(
      v === 'mpeg4' || v === 'mpeg2' || v === 'mpeg1'
        ? `видео ${v.toUpperCase()} Safari не декодирует — через HLS-транскод в H.264`
        : v === 'vc1'
          ? 'видео VC-1/WMV Safari не декодирует — через HLS-транскод в H.264'
          : `видео ${v} не в direct-белом списке Safari — через HLS`,
    );
  }
  if (!a || !(SAFARI_NATIVE_AUDIO as readonly string[]).includes(a)) {
    reasons.push(
      a === 'dts' || a === 'truehd'
        ? `аудио ${a.toUpperCase()} Safari не декодирует — через HLS с перекодом в AAC/AC3`
        : a === 'vorbis'
          ? 'аудио Vorbis в Safari — только Ogg с версии 18.4 — через HLS с перекодом'
          : `аудио ${a || 'unknown'} не в direct-белом списке Safari (WMA) — через HLS`,
    );
  } else if (a === 'opus') {
    reasons.push('note: Opus — только stereo в MP4/WebM с Safari 17 (Sonoma) / 17.4 (iOS); многоканал — через HLS');
  }
  if (ext && !(SAFARI_NATIVE_CONTAINERS as readonly string[]).includes(ext)) {
    if (ext === 'webm') {
      reasons.push('note: контейнер WebM — нужен Safari 15+ (macOS/iPadOS) / 17.4+ (iOS)');
    } else {
      reasons.push(`контейнер .${ext} Safari нативно не открывает (MKV — никогда; TS/AVI/WMV/FLV/VOB/MPG) — через HLS`);
    }
  }
  const hls = reasons.some((r) => !r.startsWith('note:'));
  return hls
    ? { mode: 'hls', reasons }
    : { mode: 'direct', reasons: ['видео+аудио+контейнер нативны для Safari', ...reasons] };
}
