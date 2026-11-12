import type { TestCase, TestCaseFolder } from '@/types';

// Test-case folder tree helpers. The order here is the Cases list's
// top-to-bottom order AND the order a folder "Run all" executes in — it must
// match the BE's collectFolderCases (be/internal/handlers/testcase_folder.go):
// subfolders first (name A→Z, case-insensitive, depth-first), then the
// folder's own cases in list order (newest first).

export interface FolderIndex {
  byId: Map<string, TestCaseFolder>;
  /** Child folders per parent id; '' = top level (incl. folders whose parent is unknown). */
  children: Map<string, TestCaseFolder[]>;
  /** Cases per folder id; '' = root (incl. cases whose folder is unknown). */
  cases: Map<string, TestCase[]>;
}

const ROOT = '';

function compareFolders(a: TestCaseFolder, b: TestCaseFolder): number {
  const an = a.name.toLowerCase();
  const bn = b.name.toLowerCase();
  if (an !== bn) return an < bn ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

export function buildFolderIndex(folders: TestCaseFolder[], cases: TestCase[]): FolderIndex {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const children = new Map<string, TestCaseFolder[]>();
  for (const f of folders) {
    const key = f.parentId && byId.has(f.parentId) ? f.parentId : ROOT;
    const list = children.get(key) ?? [];
    list.push(f);
    children.set(key, list);
  }
  for (const list of children.values()) list.sort(compareFolders);
  const byFolder = new Map<string, TestCase[]>();
  for (const tc of cases) {
    const key = tc.folderId && byId.has(tc.folderId) ? tc.folderId : ROOT;
    const list = byFolder.get(key) ?? [];
    list.push(tc);
    byFolder.set(key, list);
  }
  return { byId, children, cases: byFolder };
}

export function childFolders(idx: FolderIndex, parentId: string | null): TestCaseFolder[] {
  return idx.children.get(parentId ?? ROOT) ?? [];
}

export function casesIn(idx: FolderIndex, folderId: string | null): TestCase[] {
  return idx.cases.get(folderId ?? ROOT) ?? [];
}

/** The folder a case is shown under (null = root; unknown folders count as root). */
export function effectiveFolderId(idx: FolderIndex, tc: TestCase): string | null {
  return tc.folderId && idx.byId.has(tc.folderId) ? tc.folderId : null;
}

/** Cases of a folder (and, when recursive, its subfolders) in display/run order. */
export function folderCasesInOrder(idx: FolderIndex, folderId: string, recursive: boolean): TestCase[] {
  const out: TestCase[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    if (recursive) for (const kid of childFolders(idx, id)) walk(kid.id);
    out.push(...casesIn(idx, id));
  };
  walk(folderId);
  return out;
}

/** Total cases in a folder's subtree (for the folder row badge). */
export function subtreeCaseCount(idx: FolderIndex, folderId: string): number {
  return folderCasesInOrder(idx, folderId, true).length;
}

/** "Parent / Child" path of a folder (for search results and menus). */
export function folderPath(idx: FolderIndex, folderId: string | null): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let cur = folderId ? idx.byId.get(folderId) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(cur.name);
    cur = cur.parentId ? idx.byId.get(cur.parentId) : undefined;
  }
  return parts.join(' / ');
}

/** Every folder depth-first with its depth (for the "Move to…" menu). */
export function flattenFolders(idx: FolderIndex): Array<{ folder: TestCaseFolder; depth: number }> {
  const out: Array<{ folder: TestCaseFolder; depth: number }> = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const f of childFolders(idx, parent)) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
