import { useCallback, useLayoutEffect, useRef } from 'react';

// Auto-grow a textarea to fit its content, capped at a fraction of the
// viewport (it scrolls past that). Used by the "expand" editors that show a
// long single-line value wrapped (URL bar, environment values).
//
// Returns a callback ref, not a ref object: Radix mounts popover content a
// render AFTER it opens and only gives it its final width after the first
// positioning pass — an effect keyed on "open" finds no element yet. The
// ResizeObserver attached the moment the element exists refits once that
// width settles (and on window resizes); the layout effect refits as the
// text changes. `elRef` exposes the element for focus handling.
export function useAutoGrow(value: string, maxViewportFraction = 0.4) {
  const elRef = useRef<HTMLTextAreaElement | null>(null);
  const ro = useRef<ResizeObserver | null>(null);

  const fit = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // border-box: the height includes the borders scrollHeight leaves out.
    const borders = el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.min(el.scrollHeight + borders, Math.round(window.innerHeight * maxViewportFraction))}px`;
  }, [maxViewportFraction]);

  useLayoutEffect(() => { fit(); }, [value, fit]);
  useLayoutEffect(() => () => ro.current?.disconnect(), []);

  const ref = useCallback((el: HTMLTextAreaElement | null) => {
    ro.current?.disconnect();
    ro.current = null;
    elRef.current = el;
    if (el) {
      // Only a width change re-wraps the text; the height is ours. Fit on the
      // next frame — resizing inside the callback trips the browser's
      // "ResizeObserver loop" error.
      let lastWidth = -1;
      ro.current = new ResizeObserver(([entry]) => {
        const w = entry.contentRect.width;
        if (w === lastWidth) return;
        lastWidth = w;
        requestAnimationFrame(fit);
      });
      ro.current.observe(el);
    }
  }, [fit]);

  return { ref, elRef };
}
