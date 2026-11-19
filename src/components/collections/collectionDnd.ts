import { createContext, useContext } from 'react';
import type { Collection } from '@/types';

// Collections sidebar drag-and-drop: where a drop would land and what is
// allowed. The row under the pointer is split into zones — a folder row's
// top / bottom quarter means "before / after it", the middle "inside it"; a
// request row's halves mean before / after. The tree shows that zone as a
// line or a highlight while dragging, so the gesture is visible.

export const COL_PREFIX = 'col:';
export const REQ_PREFIX = 'req:';
export const ROOT_DROP_ID = 'root-drop';

export type DropZone = 'above' | 'below' | 'inside';
export interface DropTarget { id: string; zone: DropZone }

export const DropTargetContext = createContext<DropTarget | null>(null);

/** The zone this row shows, or null when the drop isn't over it. */
export function useDropZone(sortableId: string): DropZone | null {
  const t = useContext(DropTargetContext);
  return t && t.id === sortableId ? t.zone : null;
}

/** Zone for a pointer at clientY over a row rect. */
export function zoneFor(kind: 'collection' | 'request', top: number, height: number, clientY: number): DropZone {
  const y = (clientY - top) / Math.max(height, 1);
  if (kind === 'request') return y < 0.5 ? 'above' : 'below';
  if (y < 0.25) return 'above';
  if (y > 0.75) return 'below';
  return 'inside';
}

/** Whether the caller may change this collection's tree (its root's role:
 *  viewers and team members can't; own / local collections carry no role). */
export function canEditCollection(c: Collection | undefined): boolean {
  return !!c && c.myRole !== 'viewer';
}

export function findCollection(cols: Collection[], id: string): Collection | undefined {
  for (const c of cols) {
    if (c.id === id) return c;
    if (c.children) {
      const f = findCollection(c.children, id);
      if (f) return f;
    }
  }
  return undefined;
}

/** The top-level collection that holds `id` (itself when it is top level). */
export function rootOf(cols: Collection[], id: string): Collection | undefined {
  for (const c of cols) {
    if (c.id === id || (c.children && findCollection(c.children, id))) return c;
  }
  return undefined;
}

/** True when `id` is `ancestorId` or lies inside it. */
export function isWithin(cols: Collection[], ancestorId: string, id: string): boolean {
  if (ancestorId === id) return true;
  const a = findCollection(cols, ancestorId);
  return !!a?.children && !!findCollection(a.children, id);
}
