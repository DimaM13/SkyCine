// Диагностика скролла: редкие события (навигация/restore/save) уходят в серверный
// лог с тегом SCROLL через существующий /api/debug/webos-log (лимит 300/мин).
// Живые scroll-события НЕ логируем — только точки, участвующие в восстановлении позиции.
export function scrollDebug(event: string, data: Record<string, any> = {}) {
  try {
    const doc = document.scrollingElement as HTMLElement | null;
    const main = document.querySelector('main') as HTMLElement | null;
    const payload = {
      event,
      y: Math.round(window.scrollY || 0),
      docTop: Math.round(doc?.scrollTop ?? -1),
      mainTop: Math.round(main?.scrollTop ?? -1),
      mainOvY: main ? getComputedStyle(main).overflowY : 'none',
      docH: document.documentElement.scrollHeight,
      vh: window.innerHeight,
      ...data,
    };
    fetch('/api/debug/webos-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'info', tag: 'SCROLL', message: event, data: payload }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}
