import { useEffect, useRef } from 'react';

/**
 * Общее поведение модалок: закрытие по Escape + лок скролла фона.
 * onClose берём через ref, чтобы не переподписываться каждый рендер.
 */
export function useModalBehavior(enabled: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [enabled]);
}
