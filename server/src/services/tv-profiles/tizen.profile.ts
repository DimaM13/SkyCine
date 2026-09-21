/**
 * SOURCE OF TRUTH — Samsung Tizen TV: что играется нативно (direct progressive),
 * а что только через HLS-транскод/ремукс сервера.
 *
 * Составлено по официальной документации Samsung (проверено 2026-09-20):
 *  - 2025 TV Video Specifications:
 *    https://developer.samsung.com/smarttv/develop/specifications/media-specifications/2025-tv-video-specifications.html
 *  - 2024 TV Video Specifications:
 *    https://developer.samsung.com/smarttv/develop/specifications/media-specifications/2024-tv-video-specifications.html
 *  - General Specifications (Streaming Engine / HLS Tag Support):
 *    https://developer.samsung.com/smarttv/develop/specifications/general-specifications.html
 *  - AVPlay API + "Playback Using AVPlay" guide:
 *    https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html
 *    https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-avplay.html
 *
 * Коротко из спек:
 *  - Direct-контейнеры: AVI / MKV / ASF / MP4 / 3GP / MOV / FLV / VRO / VOB / PS / TS
 *    (на моделях 24TV_BASIC4 и 2025+ WMV/VC-1/WMA больше НЕ поддерживаются).
 *  - Видео: H.264 BP/MP/HP (FHD L4.2, UHD L5.1, до 4096x2160@60),
 *    HEVC (FHD L4.1, UHD L5.2, 8K L6.1 — только MKV/MP4/TS),
 *    AV1 (до 3840x2160), VP9 (WebM), MPEG-4.
 *  - Аудио: AC3, LPCM, ADPCM, AAC, HE-AAC, DD+, MP3, MPEG-H, AC-4, OPUS, G.711.
 *  - DTS НЕ поддерживается на TV 2024+ (официально: держать выбираемую не-DTS дорожку).
 *  - MSE — только до FHD, UHD через MSE нет => 4K только через AVPlay, не через hls.js.
 *  - HLS в AVPlay: fMP4 с Tizen 3.0, MPEG-TS с Tizen 2.4. Trick-play ±16x только
 *    при EXT-X-I-FRAME-STREAM-INF (мы его не отдаём — обычный seek всё равно работает).
 *
 * ПОЛИТИКА ПРИЛОЖЕНИЯ SkyCine-TizenTV: ВСЁ через HLS (TIZEN_APP_POLICY = 'hls-always').
 * Таблица direct ниже — для документации и возможного будущего использования на сервере,
 * клиент её не спрашивает: единый путь = AVPlay.open(master.m3u8), fMP4.
 *
 * Файл standalone: без импортов, чистая data + pure functions.
 * Копия правил для ТВ-клиента: SkyCine-TizenTV/src/tizen/playbackProfile.ts
 */

export interface TvMediaProbe {
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

/** Политика приложения: Tizen всегда идёт через HLS, direct не используется. */
export const TIZEN_APP_POLICY = 'hls-always' as const;

/** Какие параметры просить у /master.m3u8: fMP4-контейнер (isApple=0). */
export const TIZEN_MASTER_PARAMS = {
  isApple: 0,
  quality: 'original',
} as const;
// Сервер включает ТВ-движок по ?client=tizen (маркер _tvtizen в sessionId):
// audio-copy AAC/AC3/EAC3/MP3 (DD/DD+ passthrough вместо AAC-транскода),
// video-copy только H.264/HEVC, контейнер всегда fMP4,
// плейлист без EXT-X-INDEPENDENT-SEGMENTS. Без маркера — PC-правила.

/** Видеокодеки, которые Tizen берёт нативным direct-потоком (прогрессив). */
export const TIZEN_NATIVE_VIDEO = [
  'h264',
  'hevc',
  'h265',
  'av1',
  'vp9',
  'mpeg4',
  'mjpeg',
] as const;

/** Аудиокодеки, которые Tizen берёт нативным direct-потоком. */
export const TIZEN_NATIVE_AUDIO = [
  'aac', // включает HE-AAC
  'ac3',
  'eac3', // Dolby Digital Plus
  'mp3',
  'opus',
  'pcm', // включает LPCM
  'adpcm',
  'ac4',
  'mpegh',
] as const;

/** Расширения контейнеров, которые Tizen открывает нативно (прогрессив). */
export const TIZEN_NATIVE_CONTAINERS = [
  'mp4', 'm4v', 'mov', 'mkv', 'avi',
  'ts', 'tp', 'trp', 'm2ts', 'mts',
  '3gp', '3g2', 'flv', 'vob', 'webm',
] as const;

export function tizenExtOf(filePath?: string): string {
  if (!filePath) return '';
  const m = filePath.toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/);
  return m ? m[1] : '';
}

/** Нормализация имён видеокодеков (ffprobe/БД пишут по-разному). */
export function normalizeTizenVideoCodec(raw?: string): string {
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

/** Нормализация имён аудиокодеков. */
export function normalizeTizenAudioCodec(raw?: string): string {
  const c = (raw || '').toLowerCase().trim();
  if (!c) return '';
  if (['mp4a', 'mp4a.40.2', 'mp4a.40.5', 'aac', 'aac-lc', 'he-aac', 'heaac'].includes(c)) return 'aac';
  if (['ac-3', 'ac3', 'dolby_digital'].includes(c)) return 'ac3';
  if (['ec-3', 'ec3', 'eac3', 'dd+', 'dolby_digital_plus', 'atmos_eac3'].includes(c)) return 'eac3';
  if (['mp3', 'mpga', 'mp1', 'mp2'].includes(c)) return 'mp3';
  if (c.includes('dts')) return 'dts'; // dts / dts-hd / dts:x / dca — всё мимо
  if (['truehd', 'mlp', 'atmos_truehd'].includes(c)) return 'truehd';
  if (['vorbis', 'ogg'].includes(c)) return 'vorbis';
  if (['flac'].includes(c)) return 'flac';
  if (['opus'].includes(c)) return 'opus';
  if (['pcm', 'lpcm', 's16le', 's24le', 'wav'].includes(c)) return 'pcm';
  if (['adpcm', 'ima_adpcm', 'ms_adpcm'].includes(c)) return 'adpcm';
  if (['wma', 'wmav2'].includes(c)) return 'wma';
  if (['alac'].includes(c)) return 'alac';
  if (['ac-4', 'ac4'].includes(c)) return 'ac4';
  if (['mpeg-h', 'mpegh', '360ra'].includes(c)) return 'mpegh';
  return c;
}

/**
 * Справочное решение "мог бы direct или нет" (клиент Tizen его НЕ использует —
 * политика hls-always; нужно серверу/диагностике).
 */
export function decideTizenDirect(probe: TvMediaProbe): PlaybackDecision {
  const reasons: string[] = [];
  const v = normalizeTizenVideoCodec(probe.videoCodec);
  const a = normalizeTizenAudioCodec(probe.audioCodec);
  const ext = tizenExtOf(probe.filePath);

  if (!v || !(TIZEN_NATIVE_VIDEO as readonly string[]).includes(v)) {
    reasons.push(`видео ${v || 'unknown'} не в direct-белом списке Tizen (нужен HLS-транскод в H.264)`);
  }
  if (!a || !(TIZEN_NATIVE_AUDIO as readonly string[]).includes(a)) {
    reasons.push(`аудио ${a || 'unknown'} не поддерживается Tizen нативно (DTS/TrueHD/FLAC/Vorbis/WMA/ALAC — только через HLS с перекодом в AAC)`);
  }
  if (ext && !(TIZEN_NATIVE_CONTAINERS as readonly string[]).includes(ext)) {
    reasons.push(`контейнер .${ext} не открывается Tizen нативно (ASF/WMV/MPG — только через HLS)`);
  }
  if ((probe.width || 0) > 4096 || (probe.height || 0) > 2304) {
    reasons.push('кадр больше 4K — direct не гарантирован, нужен HLS');
  }
  return reasons.length === 0
    ? { mode: 'direct', reasons: ['H.264/HEVC + нативное аудио + нативный контейнер'] }
    : { mode: 'hls', reasons };
}

/** Итоговое решение для приложения: всегда HLS (причина фиксируется в лог). */
export function resolveTizenPlayback(probe: TvMediaProbe): PlaybackDecision {
  const direct = decideTizenDirect(probe);
  return {
    mode: 'hls',
    reasons: [
      'политика Tizen-клиента: все через AVPlay HLS (fMP4)',
      ...direct.reasons,
    ],
  };
}
