import { useCallback, useEffect, useRef, useState } from 'react';

const STAMP_MS = 900;

/**
 * The one orchestrated moment (design.md Motion): after a successful human action,
 * call `stamp(key)` and give the affected row `className={isStamped(key) ? 'stamp' : ''}`.
 * No-op under prefers-reduced-motion.
 */
export function useStamp() {
  const [key, setKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const stamp = useCallback((k: string) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    clearTimeout(timer.current);
    setKey(k);
    timer.current = setTimeout(() => setKey(null), STAMP_MS);
  }, []);

  const isStamped = useCallback((k: string) => key === k, [key]);

  return { stamp, isStamped };
}
