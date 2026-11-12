import type { NoteMeta } from '@/types';

export type NoteNode = NoteMeta & { children: NoteNode[] };

export function buildNoteTree(notes: NoteMeta[]): { tree: NoteNode[]; childrenOf: (parentId: string | null) => NoteMeta[] } {
  const byParent = new Map<string | null, NoteMeta[]>();
  for (const n of notes) {
    const key = n.parentId ?? null;
    const arr = byParent.get(key);
    if (arr) arr.push(n);
    else byParent.set(key, [n]);
  }
  for (const arr of byParent.values()) arr.sort((a, z) => (a.sortOrder ?? 0) - (z.sortOrder ?? 0) || a.title.localeCompare(z.title));
  const make = (parentId: string | null): NoteNode[] => (byParent.get(parentId) ?? []).map((n) => ({ ...n, children: make(n.id) }));
  return { tree: make(null), childrenOf: (parentId) => byParent.get(parentId) ?? [] };
}


/** Toggle the GFM task checkbox on a 1-based source line. */
export function toggleTaskLine(md: string, line: number): string {
  const lines = md.split('\n');
  const i = line - 1;
  if (i < 0 || i >= lines.length) return md;
  lines[i] = lines[i].replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/, (_m, lead: string, mark: string) => `${lead}[${mark === ' ' ? 'x' : ' '}]`);
  return lines.join('\n');
}

/** The agent memory folder a note sits in (itself when it is one), or ''. */
export function memoryRootOf(id: string, notes: { id: string; parentId: string | null; memory?: boolean }[]): string {
  const byId = new Map(notes.map((n) => [n.id, n]));
  let cur: string | null = id;
  for (let i = 0; i < 32 && cur; i++) {
    const n = byId.get(cur);
    if (!n) return '';
    if (n.memory) return n.id;
    cur = n.parentId;
  }
  return '';
}
