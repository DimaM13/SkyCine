import { useEffect, useRef, useState, useCallback } from 'react';
import { scrollDebug } from '../utils/scrollDebug';

// Документ «схлопнут»: контент страницы уже удалён из DOM (маунт плеера/спиннер),
// браузер заclamp-ил скролл в максимум почти пустого документа (~начало).
// Сохранять такую позицию нельзя — она перезаписала бы реальную.
function isDocCollapsed(): boolean {
  try {
    return document.documentElement.scrollHeight - window.innerHeight < 64;
  } catch {
    return false;
  }
}

function readScroll(key: string): number {
  try {
    return Math.max(0, parseInt(localStorage.getItem(key) || '0', 10) || 0);
  } catch {
    return 0;
  }
}

function saveScroll(key: string): boolean {
  try {
    if (isDocCollapsed()) return false;
    localStorage.setItem(key, String(Math.max(0, Math.round(window.scrollY || 0))));
    return true;
  } catch {
    return false;
  }
}

/**
 * Сохраняет позицию скролла под ключом и возвращает её при монтировании,
 * когда контент готов (ready). App сбрасывает скролл в 0 при каждой навигации,
 * поэтому восстановление идёт отложенно — после отрисовки данных.
 */
export function useScrollRestore(storageKey: string, ready: boolean) {
  const restoredRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || restoredRef.current === storageKey) return;
    restoredRef.current = storageKey;
    const y = readScroll(storageKey);
    if (y <= 0) {
      scrollDebug('restore-skip', { key: storageKey, y });
      return;
    }
    // Проход 0 — безусловно (nav-reset как раз поставил 0, порог тут вреден).
    // Повторные — только если позицию СНУЛО к началу (cur < y - 240):
    // поздний restore браузера/сдвиг layout; с прокруткой юзера не драться.
    const delays = [0, 300, 800, 1500];
    scrollDebug('restore', { key: storageKey, y });
    let cancelled = false;
    let applied = false;
    const timers: any[] = delays.map((delay, i) =>
      setTimeout(() => {
        if (cancelled) return;
        const cur = window.scrollY || 0;
        if (i === 0 || cur < y - 240) {
          applied = true;
          window.scrollTo(0, y);
          scrollDebug('restore-apply', { attempt: i, y, cur, after: window.scrollY || 0 });
        } else if (i === delays.length - 1) {
          scrollDebug('restore-settled', { y, cur });
        }
      }, delay)
    );
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      // Cleanup до первого применения (StrictMode double-mount / мгновенный анмаунт):
      // снимаем отметку, иначе повторный маунт никогда не восстановит позицию
      if (!applied) restoredRef.current = null;
    };
  }, [ready, storageKey]);

  // Непрерывное сохранение + финальное при уходе (в одном эффекте).
  // pendingY обновляется только пока документ цел; cleanup выполняется ПОСЛЕ
  // размонтирования контента — если страница схлопнулась (уход в плеер),
  // пишем последнюю валидную позицию, а не заclamp-енный ноль.
  useEffect(() => {
    let last = 0;
    let timer: any = null;
    let pendingY = Math.max(0, Math.round(window.scrollY || 0));

    const flush = () => {
      try {
        localStorage.setItem(storageKey, String(Math.max(0, Math.round(pendingY))));
      } catch {}
    };

    const onScroll = () => {
      if (isDocCollapsed()) return;
      pendingY = window.scrollY || 0;
      const now = Date.now();
      if (now - last >= 500) {
        last = now;
        flush();
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = Date.now();
          flush();
        }, 550);
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (timer) clearTimeout(timer);
      const collapsed = isDocCollapsed();
      flush();
      scrollDebug('save-unmount', { key: storageKey, y: pendingY, collapsed });
    };
  }, [storageKey]);
}

/** visibleCount, переживающий размонтирование (иначе скролл некуда возвращать). */
export function usePersistentVisibleCount(
  storageKey: string,
  defaultCount: number = 36
): [number, React.Dispatch<React.SetStateAction<number>>, () => void] {
  const readCount = (key: string): number => {
    try {
      const v = parseInt(localStorage.getItem(key) || '', 10);
      if (Number.isFinite(v) && v > 0) return Math.min(v, 500);
      return defaultCount;
    } catch {
      return defaultCount;
    }
  };

  const [count, setCount] = useState<number>(() => readCount(storageKey));

  // Смена ключа (другая библиотека) — подхватить сохранённое для неё
  useEffect(() => {
    setCount(readCount(storageKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(count));
    } catch {}
  }, [count, storageKey]);

  const reset = useCallback(() => {
    setCount(defaultCount);
    try {
      localStorage.setItem(storageKey, String(defaultCount));
    } catch {}
  }, [defaultCount, storageKey]);

  return [count, setCount, reset];
}

export { saveScroll };
