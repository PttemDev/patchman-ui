import { useCallback } from 'react';
import { useRequestStore } from '@/stores/requestStore';

// Anchors to scroll to once a note tab has loaded (note:<id>#heading links).
const pendingAnchors = new Map<string, string>();

export function takePendingAnchor(noteId: string): string | undefined {
  const a = pendingAnchors.get(noteId);
  pendingAnchors.delete(noteId);
  return a;
}

/** Open a note in a main-pane tab, reusing the tab if it's already open. */
export function openNoteTab(noteId: string, title: string, anchor?: string) {
  const rs = useRequestStore.getState();
  if (anchor) pendingAnchors.set(noteId, anchor);
  const existing = rs.tabs.find((t) => t.type === 'note' && t.noteId === noteId);
  if (existing) {
    rs.setActiveTab(existing.id);
    if (anchor) window.dispatchEvent(new CustomEvent('patchman:note-anchor', { detail: { noteId } }));
    return;
  }
  rs.addTab({ type: 'note', noteId, name: title || 'Untitled', method: 'GET', url: '' }, true);
}

export function useOpenNote() {
  return useCallback((noteId: string, title: string, anchor?: string) => openNoteTab(noteId, title, anchor), []);
}
