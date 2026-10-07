/**
 * Открытие оригинального прямого потока во внешнем VLC.
 *
 * - iPhone/iPad: схема `vlc://` (регистрирует сам VLC из App Store):
 *   `vlc://https://host/api/stream/:id/direct?token=...`
 * - Android: explicit intent в пакет `org.videolan.vlc`
 *   (если VLC нет — откроется его страница в Play Store);
 *   рядом всегда есть fallback: скачивание `.m3u` и копирование ссылки.
 * - ПК/другое: скачивание `.m3u`-плейлиста (открывается в VLC двойным кликом)
 *   + копирование ссылки для «Медиа → Открыть сетевой поток» (Ctrl+N).
 */

/** Origin API-сервера: в web-dev клиент на :3000, API на :5000, в проде тот же origin. */
export function getServerOrigin(): string {
  if (typeof window === 'undefined') return '';
  if (window.location.port === '3000') {
    return `${window.location.protocol}//${window.location.hostname}:5000`;
  }
  return window.location.origin;
}

/** Абсолютная ссылка на оригинальный прямой поток (нужна внешнему плееру). */
export function buildDirectStreamUrl(mediaId: string): string {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('myplex_token') : null;
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${getServerOrigin()}/api/stream/${mediaId}/direct${q}`;
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS прикидывается Macintosh — отличаем по тачу
  return /Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1;
}

export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/.test(navigator.userAgent);
}

function triggerHref(href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export type VlcOpenHow = 'vlc-scheme' | 'intent' | 'm3u';

/**
 * Умное открытие VLC под текущую платформу.
 * Возвращает, каким способом открыли (для подсказки пользователю).
 */
export function openInVlc(mediaId: string, title: string): VlcOpenHow {
  const url = buildDirectStreamUrl(mediaId);
  if (isIOS()) {
    // VLC для iOS слушает схему vlc://<stream-url>
    triggerHref(`vlc://${url}`);
    return 'vlc-scheme';
  }
  if (isAndroid()) {
    try {
      const u = new URL(url);
      const scheme = u.protocol.replace(':', '') || 'http';
      const path = `${u.host}${u.pathname}${u.search}`;
      // Явный intent в VLC; если его нет — стор откроет страницу пакета
      triggerHref(
        `intent://${path}#Intent;scheme=${scheme};package=org.videolan.vlc;S.title=${encodeURIComponent(title || mediaId)};end`
      );
      return 'intent';
    } catch {
      /* ниже fallback */
    }
  }
  downloadM3u(mediaId, title);
  return 'm3u';
}

/** Скачать .m3u-плейлист с прямой ссылкой (открывается в VLC двойным кликом). */
export function downloadM3u(mediaId: string, title: string) {
  const url = buildDirectStreamUrl(mediaId);
  const safe = (title || 'video').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  const content = `#EXTM3U\n#EXTINF:-1,${title || mediaId}\n${url}\n`;
  const blob = new Blob([content], { type: 'audio/x-mpegurl' });
  const obj = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = obj;
  a.download = `${safe || 'video'}.m3u`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(obj), 5000);
}

/** Скопировать прямую ссылку (для Ctrl+N в VLC). */
export async function copyDirectLink(mediaId: string): Promise<boolean> {
  const url = buildDirectStreamUrl(mediaId);
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}
