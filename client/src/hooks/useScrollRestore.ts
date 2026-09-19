import { useEffect, useRef, useState, useCallback } from 'react';

function readScroll(key: string): number {
  try {
    return Math.max(0, parseInt(localStorage.getItem(key) || '0', 10) || 0);
  } catch {
    return 0;
  }
}

function saveScroll(key: string) {
  try {
    localStorage.setItem(key, String(Math.max(0, Math.round(window.scrollY || 0))));
  } catch {}
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
    if (y <= 0) return;
    // Два прохода: сразу после paint + контрольный (картинки могут сдвинуть layout)
    let innerTimer: any = null;
    const raf = requestAnimationFrame(() => {
      window.scrollTo(0, y);
      innerTimer = setTimeout(() => {
        try {
          if (Math.abs((window.scrollY || 0) - y) > 240) window.scrollTo(0, y);
        } catch {}
      }, 400);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (innerTimer) clearTimeout(innerTimer);
    };
  }, [ready, storageKey]);

  // Сохранение при размонтировании (уход в плеер/другой раздел)
  useEffect(() => {
    return () => {
      saveScroll(storageKey);
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
