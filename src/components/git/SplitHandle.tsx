import { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

// A vertical drag handle between two side-by-side panes. It reports the
// pointer's horizontal travel since the drag started; the owner turns that
// into a width (px or %), clamps it and stores it. Arrow keys nudge it.
export function SplitHandle({ onDragStart, onDrag, onDragEnd, onStep, label, className }: {
  onDragStart: () => void;
  onDrag: (deltaPx: number) => void;
  onDragEnd?: () => void;
  /** Keyboard nudge: -1 (left) or +1 (right). */
  onStep: (dir: -1 | 1) => void;
  label: string;
  className?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    startX.current = e.clientX;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    setDragging(true);
    onDragStart();
    const move = (ev: PointerEvent) => onDrag(ev.clientX - startX.current);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDragging(false);
      onDragEnd?.();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }, [onDragStart, onDrag, onDragEnd]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); onStep(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); onStep(1); }
      }}
      className={cn(
        'group relative z-10 -mx-[3px] w-[7px] shrink-0 cursor-col-resize touch-none select-none focus:outline-none',
        className,
      )}
    >
      <div className={cn(
        'pointer-events-none absolute inset-y-0 left-[3px] w-px bg-border transition-colors',
        'group-hover:bg-primary/60 group-focus-visible:bg-primary',
        dragging && 'bg-primary',
      )} />
    </div>
  );
}
