import { useCallback, useMemo, useState } from 'react';
import type { GitFileDiff } from '@/types';

// Per-file "Viewed" marks on an MR's Changes tab (GitLab parity).

/** A cheap fingerprint of a file's diff: "Viewed" clears when the diff changes (GitLab does the same). */
function fingerprint(patch: string): string {
  let h = 0;
  for (let i = 0; i < patch.length; i++) h = (h * 31 + patch.charCodeAt(i)) | 0;
  return `${patch.length}:${h}`;
}

/** Per-viewer "Viewed" marks, kept in localStorage (a convenience; may be unavailable). */
export function useViewedFiles(key: string, diffs: GitFileDiff[] | null) {
  const storageKey = `pm.mrViewed.${key}`;
  const [marks, setMarks] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Record<string, string>; } catch { return {}; }
  });
  const isViewed = useCallback((d: GitFileDiff) => marks[d.newPath] === fingerprint(d.patch), [marks]);
  const toggle = useCallback((d: GitFileDiff) => {
    setMarks((m) => {
      const next = { ...m };
      if (next[d.newPath] === fingerprint(d.patch)) delete next[d.newPath]; else next[d.newPath] = fingerprint(d.patch);
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, [storageKey]);
  const viewedCount = useMemo(() => (diffs ?? []).filter((d) => marks[d.newPath] === fingerprint(d.patch)).length, [diffs, marks]);
  return { isViewed, toggle, viewedCount };
}
