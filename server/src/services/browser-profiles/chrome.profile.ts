/**
 * SOURCE OF TRUTH — Google Chrome (desktop, proprietary build): что играется
 * нативно direct progressive / MSE, а что только через HLS сервера (hls.js).
 *
 * Составлено по первоисточникам (проверено 2026-09-21):
 *  - Chromium Audio/Video (контейнеры/кодеки):
 *    https://www.chromium.org/audio-video/
 *  - Chromium source, media/base/supported_types.cc (какие кодеки вообще декодируются,
 *    AC3/EAC3/ALAC/DTS — только за флагами/платформой, DTS/AC4 по умолчанию выкл):
 *    https://chromium.googlesource.com/chromium/src/+/HEAD/media/base/supported_types.cc
 *  - Chromium source, media/base/mime_util.cc (карта контейнер→кодек, HLS-маппинг
 *    только для OS_ANDROID; canPlayType('mpegurl') на десктопе врёт "maybe"):
 *    https://chromium.googlesource.com/chromium/src/+/97785eaf0f3b8f017a38fs/mediabase/mime_util.cc
 *  - HEVC в Chrome (D3D11VA без расширений, только HW-декод, лимиты до Chrome 130):
 *    https://github.com/StaZhu/enable-chromium-hevc-hardware-decoding
 *    https://github.com/lid-labs/hevc.js (таблица совместимости браузеров)
 *  - Замеры покрытия кодеков 2026 (AV1 ~91.5% decode, HEVC-зависимость от GPU):
 *    https://webcodecsfundamentals.org/datasets/codec-analysis-2026/
 *
 * Коротко:
 *  - Видео нативно: H.264/AVC, H.265/HEVC (Chrome 107+ Win через D3D11VA БЕЗ
 *    расширений Microsoft, но ТОЛЬКО при HEVC-способном GPU — Skylake/GTX960/R9Fury
 *    и новее, software-фолбэка нет; macOS — VideoToolbox incl. SW-фолбэк;
 *    Chrome 130+ без флагов и лимитов, до 8K), VP8, VP9 (всегда, в т.ч. software),
 *    AV1 (декод везде, ~100%). НЕТ: MPEG-4 ASP (Xvid/DivX), MPEG-1/2, VC-1, Theora.
 *  - Аудио нативно: AAC (Main/LC/HE; xHE-AAC — только при поддержке ОС:
 *    Android P+, macOS, Win11 22H2+), MP3, Opus, Vorbis, FLAC, PCM/WAV.
 *    НЕТ: AC3/EAC3 (IsCodecSupportedOnPlatform всегда false — demux-флаг не спасает),
 *    ALAC (false), DTS/DTS:X (флаг ENABLE_PLATFORM_DTS_AUDIO по умолчанию выкл),
 *    TrueHD, WMA, MPEG-H (негарантировано).
 *  - Контейнеры progressive: MP4 (incl. MOV/CMAF), WebM, Matroska (MKV — да),
 *    Ogg, WAV. НЕТ: AVI, ASF/WMV, MPEG-TS (.ts — только MSE-парсер за флагом),
 *    FLV, VOB, MPG. HLS-натив на десктопе ненадёжен — только hls.js + MSE.
 *  - MSE: video/mp4 (avc1, hev1 — при HW, vp9 — с полной строкой vp09.xx, av01),
 *    video/webm (vp8/vp9 + opus/vorbis). isTypeSupported на HEVC может врать
 *    (баг Chrome <=108 на Windows) — надёжно только пробным SourceBuffer.
 *
 * ПОЛИТИКА веб-клиента: Chrome = hls.js + MSE, fMP4 (isApple=0, quality=original).
 * Direct — только нативные контейнер+кодеки из белых списков ниже.
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

/** Какие параметры просить у /master.m3u8: fMP4 + hls.js (isApple=0). */
export const CHROME_MASTER_PARAMS = {
  isApple: 0,
  quality: 'original',
} as const;

/** Видеокодеки, которые Chrome декодирует нативно (MSE/direct). */
export const CHROME_NATIVE_VIDEO = [
  'h264',
  'hevc', // условно: только при HEVC-способном GPU (Win) / VideoToolbox (Mac)
  'h265',
  'vp8',
  'vp9',
  'av1',
] as const;

/** Аудиокодеки, которые Chrome декодирует нативно. */
export const CHROME_NATIVE_AUDIO = [
  'aac', // Main/LC/HE; xHE-AAC — только при поддержке ОС
  'mp3',
  'opus',
  'vorbis',
  'flac',
  'pcm', // WAV / LPCM
] as const;

/** Расширения контейнеров, которые Chrome открывает нативно (progressive). */
export const CHROME_NATIVE_CONTAINERS = [
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogg', 'ogv', 'wav',
] as const;

export function chromeExtOf(filePath?: string): string {
  if (!filePath) return '';
  const m = filePath.toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/);
  return m ? m[1] : '';
}

export function normalizeChromeVideoCodec(raw?: string): string {
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
  if (['theora'].includes(c)) return 'theora';
  return c;
}

export function normalizeChromeAudioCodec(raw?: string): string {
  const c = (raw || '').toLowerCase().trim();
  if (!c) return '';
  if (['mp4a', 'mp4a.40.2', 'mp4a.40.5', 'aac', 'aac-lc', 'he-aac', 'heaac', 'xhe-aac'].includes(c)) return 'aac';
  if (['ac-3', 'ac3', 'dolby_digital'].includes(c)) return 'ac3';
  if (['ec-3', 'ec3', 'eac3', 'dd+', 'dolby_digital_plus', 'atmos_eac3', 'atmos'].includes(c)) return 'eac3';
  if (['mp3', 'mpga', 'mp1', 'mp2'].includes(c)) return 'mp3';
  if (c.includes('dts')) return 'dts';
  if (['truehd', 'mlp', 'atmos_truehd'].includes(c)) return 'truehd';
  if (['vorbis', 'ogg'].includes(c)) return 'vorbis';
  if (['flac'].includes(c)) return 'flac';
  if (['opus'].includes(c)) return 'opus';
  if (['pcm', 'lpcm', 's16le', 's24le', 'wav'].includes(c)) return 'pcm';
  if (['wma', 'wmav2'].includes(c)) return 'wma';
  if (['alac'].includes(c)) return 'alac';
  if (['ac-4', 'ac4'].includes(c)) return 'ac4';
  return c;
}

/**
 * Решение direct vs HLS для Chrome.
 * Консервативно: неизвестный кодек/контейнер => HLS (сервер либо скопирует поток
 * в fMP4, либо перекодирует в H.264+AAC — Chrome съест оба варианта через MSE).
 */
export function decideChromePlayback(probe: BrowserMediaProbe): PlaybackDecision {
  const reasons: string[] = [];
  const v = normalizeChromeVideoCodec(probe.videoCodec);
  const a = normalizeChromeAudioCodec(probe.audioCodec);
  const ext = chromeExtOf(probe.filePath);

  if (!v || !(CHROME_NATIVE_VIDEO as readonly string[]).includes(v)) {
    reasons.push(
      v === 'mpeg4' || v === 'mpeg2' || v === 'mpeg1'
        ? `видео ${v.toUpperCase()} Chrome не декодирует (только H.264 из MPEG-семьи) — через HLS-транскод в H.264`
        : v === 'vc1'
          ? 'видео VC-1/WMV Chrome не декодирует — через HLS-транскод в H.264'
          : `видео ${v || 'unknown'} не в direct-белом списке Chrome — через HLS`,
    );
  } else if (v === 'hevc') {
    reasons.push('note: HEVC в Chrome — только при HEVC-способном GPU (Win D3D11VA / Mac VideoToolbox), без software-фолбэка на Windows');
  }
  if (!a || !(CHROME_NATIVE_AUDIO as readonly string[]).includes(a)) {
    reasons.push(
      a === 'ac3' || a === 'eac3'
        ? 'аудио DD/DD+ Chrome НЕ декодирует (platform-check всегда false) — через HLS с перекодом в AAC'
        : a === 'dts' || a === 'truehd'
          ? `аудио ${a.toUpperCase()} Chrome не декодирует — через HLS с перекодом в AAC`
          : a === 'alac'
            ? 'аудио ALAC Chrome не декодирует — через HLS с перекодом в AAC'
            : `аудио ${a || 'unknown'} не в direct-белом списке Chrome (WMA/AC-4/MPEG-H) — через HLS`,
    );
  }
  if (ext && !(CHROME_NATIVE_CONTAINERS as readonly string[]).includes(ext)) {
    reasons.push(`контейнер .${ext} Chrome нативно не открывает (AVI/TS/WMV/FLV/VOB/MPG) — через HLS (fMP4)`);
  }
  const hls = reasons.some((r) => !r.startsWith('note:'));
  return hls
    ? { mode: 'hls', reasons }
    : { mode: 'direct', reasons: ['видео+аудио+контейнер нативны для Chrome', ...reasons] };
}
