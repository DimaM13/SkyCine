/**
 * SOURCE OF TRUTH — LG webOS TV: что играется нативно direct progressive,
 * а что только через HLS сервера.
 *
 * Составлено по официальной документации LG (проверено 2026-09-20):
 *  - Audio and Video Format on webOS TV 25:
 *    https://webostv.developer.lge.com/develop/specifications/video-audio-250
 *    (актуально и для 26: https://webostv.developer.lge.com/develop/specifications/video-audio-260)
 *  - Streaming Protocol and DRM:
 *    https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm
 *  - Media Option Parameters (mediaTransportType URI vs HLS):
 *    https://webostv.developer.lge.com/develop/guides/mediaoption-parameter
 *  - HLS troubleshooting (CODECS / MEDIA-SEQUENCE требования):
 *    https://webostv.developer.lge.com/faq/streaming-http-live-streaming-hls-troubleshooting
 *
 * Коротко из спек:
 *  - .mp4/.m4v/.mov: H.264/MPEG-4/HEVC/AV1 + DD/DD+/AAC/MP3 (+AC-4/MPEG-H/DTS — со сноской
 *    "some models may not support" — DTS считаем НЕ direct).
 *  - .mkv: MPEG-2/MPEG-4/H.264/VP8/VP9/HEVC/AV1 + DD/DD+/AAC/PCM/Opus/MP3 (+DTS* — мимо).
 *  - .ts/.trp/.tp/.mts: H.264/MPEG-2/HEVC + MP1/2/MP3/DD/DD+/AAC/PCM (+DTS-HD/AC-4 — мимо/частично).
 *  - .avi: Xvid/H.264/MotionJPEG/MPEG-4. .3gp/.3g2: H.264/MPEG-4. .mpg/.vob: MPEG-1/2.
 *  - VC-1 (.asf/.wmv) — со сноской "some models may not support" => консервативно HLS.
 *  - 4K UHD: H.264 3840x2160@30 L5.1, HEVC 4K@60 L5.1, VP9 4K@60, AV1 4K@60
 *    (на части моделей H.264 4K@60). 8K: HEVC/AV1 8K@60 только на 8K-моделях.
 *  - Ограничения: GMC/Qpel — нет; WMA только v7+; AAC Main profile — нет.
 *  - HLS: поддерживается (v7/AES-128 на новых, v5 на старых). НЕ поддерживаются теги
 *    PROGRAM-DATE-TIME, ALLOW-CACHE, DATERANGE, I-FRAMES-ONLY, I-FRAME-STREAM-INF,
 *    SESSION-DATA, INDEPENDENT-SEGMENTS, DISCONTINUITY-SEQUENCE, VIDEO TYPE в EXT-X-MEDIA.
 *    DISCONTINUITY — только PTS (с webOS 4.0). MEDIA-SEQUENCE обязан совпадать
 *    по всем rendition. Audio-only + video в одном плейлисте — только с корректным
 *    единичным CODECS в STREAM-INF. Наш серверный плейлист (single rendition, VOD,
 *    EXT-X-MAP, без этих тегов кроме informational INDEPENDENT-SEGMENTS) — совместим.
 *  - MSE: полная рекомендация 2016 только с webOS 5.0; 3.x–4.x — draft; 1.x–2.x — нет.
 *    Поэтому HLS отдаём НАТИВНО (<video src=m3u8>), а не через hls.js.
 *
 * ПОЛИТИКА ПРИЛОЖЕНИЯ SkyCine-WebOSTV:
 *  - direct, если видео+аудио+контейнер в белых списках ниже;
 *  - иначе HLS сервера (включая ВСЕ DTS/DTS-HD/DTS:X/TrueHD — старый прогрессивный
 *    AC3-ремукс УДАЛЁН, он нестабилен: рвётся seek/duration, нет перемотки назад
 *    без reopen, вешает demuxer; в HLS тот же звук идёт транскодом в AAC внутри
 *    сегментов с нормальным seek по плейлисту).
 *
 * Файл standalone: без импортов, чистая data + pure functions.
 * Копия правил для ТВ-клиента: SkyCine-WebOSTV/src/webos/playbackProfile.ts
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

/** Какие параметры просить у /master.m3u8: fMP4-контейнер (isApple=0). */
export const WEBOS_MASTER_PARAMS = {
  isApple: 0,
  quality: 'original',
} as const;
// Сервер включает ТВ-движок по ?client=webos (маркер _tvwebos в sessionId):
// audio-copy AAC/AC3/EAC3/MP3 (DD/DD+ passthrough вместо AAC-транскода),
// video-copy только H.264/HEVC, контейнер всегда fMP4,
// плейлист без EXT-X-INDEPENDENT-SEGMENTS. Без маркера — PC-правила.

/** Видеокодеки, которые webOS берёт нативным direct-потоком (прогрессив). */
export const WEBOS_NATIVE_VIDEO = [
  'h264',
  'hevc',
  'h265',
  'av1',
  'vp9',
  'vp8', // только MKV
  'mpeg4', // включает Xvid/DivX
  'mpeg2',
  'mpeg1',
  'mjpeg',
] as const;

/** Аудиокодеки, которые webOS берёт нативным direct-потоком. */
export const WEBOS_NATIVE_AUDIO = [
  'ac3', // Dolby Digital
  'eac3', // Dolby Digital Plus / Atmos-DD+
  'aac', // LC; Main profile не поддерживается — детектить нечем, считаем direct
  'mp3',
  'pcm', // PCM / LPCM / DVD-LPCM
  'opus', // только MKV
  'ac4', // в спеке, но со сноской model-dependent — оставляем direct
  'mpegh',
] as const;

/** Расширения контейнеров, которые webOS открывает нативно (прогрессив). */
export const WEBOS_NATIVE_CONTAINERS = [
  'mp4', 'm4v', 'mov', 'mkv',
  'ts', 'trp', 'tp', 'mts',
  'avi', 'mpg', 'mpeg', 'dat', 'vob',
  '3gp', '3g2',
] as const;

export function webosExtOf(filePath?: string): string {
  if (!filePath) return '';
  const m = filePath.toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/);
  return m ? m[1] : '';
}

/** Нормализация имён видеокодеков (ffprobe/БД пишут по-разному). */
export function normalizeWebosVideoCodec(raw?: string): string {
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
export function normalizeWebosAudioCodec(raw?: string): string {
  const c = (raw || '').toLowerCase().trim();
  if (!c) return '';
  if (['mp4a', 'mp4a.40.2', 'mp4a.40.5', 'aac', 'aac-lc', 'he-aac', 'heaac'].includes(c)) return 'aac';
  if (['ac-3', 'ac3', 'dolby_digital'].includes(c)) return 'ac3';
  if (['ec-3', 'ec3', 'eac3', 'dd+', 'dolby_digital_plus', 'atmos_eac3', 'atmos'].includes(c)) return 'eac3';
  if (['mp3', 'mpga', 'mp1', 'mp2'].includes(c)) return 'mp3';
  if (c.includes('dts')) return 'dts'; // dts / dts-hd / dts:x / dca — всё в HLS
  if (['truehd', 'mlp', 'atmos_truehd'].includes(c)) return 'truehd';
  if (['vorbis', 'ogg'].includes(c)) return 'vorbis';
  if (['flac'].includes(c)) return 'flac';
  if (['opus'].includes(c)) return 'opus';
  if (['pcm', 'lpcm', 's16le', 's24le', 'wav', 'dvd-lpcm'].includes(c)) return 'pcm';
  if (['wma', 'wmav2'].includes(c)) return 'wma';
  if (['alac'].includes(c)) return 'alac';
  if (['ac-4', 'ac4'].includes(c)) return 'ac4';
  if (['mpeg-h', 'mpegh', '360ra'].includes(c)) return 'mpegh';
  if (['amr-nb', 'amr-wb', 'amr'].includes(c)) return 'amr';
  return c;
}

/**
 * Решение direct vs HLS для webOS.
 * Консервативно: неизвестный кодек/контейнер => HLS (сервер либо скопирует поток,
 * либо перекодирует в H.264+AAC — в обоих случаях телевизор это съест).
 */
export function decideWebosPlayback(probe: TvMediaProbe): PlaybackDecision {
  const reasons: string[] = [];
  const v = normalizeWebosVideoCodec(probe.videoCodec);
  const a = normalizeWebosAudioCodec(probe.audioCodec);
  const ext = webosExtOf(probe.filePath);

  if (!v || !(WEBOS_NATIVE_VIDEO as readonly string[]).includes(v)) {
    reasons.push(
      v === 'vc1'
        ? 'видео VC-1/WMV поддерживается лишь частью моделей webOS — через HLS-транскод в H.264'
        : `видео ${v || 'unknown'} не в direct-белом списке webOS — через HLS-транскод в H.264`,
    );
  }
  if (!a || !(WEBOS_NATIVE_AUDIO as readonly string[]).includes(a)) {
    reasons.push(
      a === 'dts' || a === 'truehd'
        ? `аудио ${a.toUpperCase()} не поддерживается webOS стабильно (DTS — со сноской model-dependent, TrueHD — вовсе нет) — через HLS с перекодом звука в AAC`
        : `аудио ${a || 'unknown'} не в direct-белом списке webOS (FLAC/Vorbis/WMA/ALAC) — через HLS с перекодом в AAC`,
    );
  }
  if (ext && !(WEBOS_NATIVE_CONTAINERS as readonly string[]).includes(ext)) {
    reasons.push(`контейнер .${ext} не открывается webOS нативно (ASF/WMV/WEBM) — через HLS`);
  }
  if ((probe.width || 0) > 4096 || (probe.height || 0) > 2304) {
    reasons.push('кадр больше 4K — direct не гарантирован даже на UHD-моделях, через HLS');
  }
  return reasons.length === 0
    ? { mode: 'direct', reasons: ['видео+аудио+контейнер нативны для webOS'] }
    : { mode: 'hls', reasons };
}
