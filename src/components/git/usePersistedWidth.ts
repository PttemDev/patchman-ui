import { useCallback, useState } from 'react';

// usePersistedWidth keeps a pane width in localStorage (clamped on read).
export function usePersistedWidth(key: string, def: number, min: number, max: number) {
  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);
  const [width, setWidthState] = useState(() => {
    try {
      const v = Number(localStorage.getItem(key));
      return Number.isFinite(v) && v > 0 ? clamp(v) : def;
    } catch { return def; }
  });
  const setWidth = useCallback((v: number, persist = true) => {
    const c = clamp(v);
    setWidthState(c);
    if (persist) {
      try { localStorage.setItem(key, String(Math.round(c * 10) / 10)); } catch { /* private mode */ }
    }
  }, [key, clamp]);
  return [width, setWidth] as const;
}
