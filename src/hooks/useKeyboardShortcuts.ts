import { useEffect } from 'react';
import { useRequestStore } from '@/stores/requestStore';
import { detachTab } from '@/lib/detach/DetachController';
import { usePasteHistoryUiStore } from '@/stores/pasteHistoryUiStore';
import { getInsertTarget } from '@/lib/paste/insertIntoTarget';

/**
 * Global keyboard shortcuts for PatchMan.
 *
 * Registered shortcuts:
 * - Cmd/Ctrl + N: New tab
 * - Cmd/Ctrl + T: New tab (alias)
 * - Cmd/Ctrl + W: Close current tab
 * - Cmd/Ctrl + S: Save to collection
 * - Cmd/Ctrl + Shift + S: Save as new (future)
 * - Cmd/Ctrl + D: Detach the active tab into its own window
 * - Cmd/Ctrl + Enter: Send the active request (from anywhere in the app)
 * - Cmd/Ctrl + E: Open environment manager
 * - Cmd/Ctrl + L: Focus URL bar
 * - Cmd/Ctrl + B: Toggle sidebar
 * - Alt + 1-9: Switch to tab by index
 *
 * Note: Cmd/Ctrl + K (Command Palette) is handled by CommandPalette component.
 * Cmd/Ctrl + Enter dispatches `patchman:send-request`; UrlBar (mounted for the
 * active API tab) handles it, so it works even when focus is in the body/headers
 * editors — not just the URL field.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      // Skip if user is typing in an input/textarea (except for our explicit shortcuts)
      const target = e.target as HTMLElement;
      const isEditing =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // Alt + 1-9: Switch to tab by index (works even when editing)
      if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 9) {
          e.preventDefault();
          const store = useRequestStore.getState();
          const tab = store.tabs[num - 1];
          if (tab) {
            store.setActiveTab(tab.id);
          }
          return;
        }
      }

      // Cmd+Option+V (macOS) / Ctrl+Alt+V (Windows/Linux): open Paste History.
      // Match on e.code — on macOS, holding Option composes the key (Option+V
      // yields '√'), so e.key is unreliable; e.code is the physical key.
      // Only acts when a text-insertable element is focused; captures it (and
      // its caret) as the insert target, then opens the overlay. No valid
      // target => no-op (the preventDefault just swallows the chord).
      const macChord = e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey;
      const winChord = e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey;
      const isMacPlatform = /mac|iphone|ipad|ipod/i.test(
        navigator.platform || navigator.userAgent,
      );
      if (
        (isMacPlatform ? macChord : winChord) &&
        (e.code === 'KeyV' || e.key === 'v' || e.key === 'V')
      ) {
        e.preventDefault();
        // Ignore if the overlay is already open (its search box is an <input>
        // and would otherwise be captured as the target).
        if (usePasteHistoryUiStore.getState().open) return;
        const insertTarget = getInsertTarget(document.activeElement);
        if (!insertTarget) return;
        let selStart: number | null = null;
        let selEnd: number | null = null;
        if (
          insertTarget instanceof HTMLInputElement ||
          insertTarget instanceof HTMLTextAreaElement
        ) {
          try {
            selStart = insertTarget.selectionStart;
            selEnd = insertTarget.selectionEnd;
          } catch {
            selStart = null;
            selEnd = null;
          }
        }
        usePasteHistoryUiStore.getState().openWith(insertTarget, selStart, selEnd);
        return;
      }

      if (!isMod) return;

      // Cmd/Ctrl + N or Cmd/Ctrl + T: New tab
      if ((e.key === 'n' || e.key === 't') && !e.shiftKey) {
        e.preventDefault();
        useRequestStore.getState().addTab();
        return;
      }

      // Cmd/Ctrl + Enter: Send the active request. Works even while editing
      // (body/headers/params), matching Postman. UrlBar handles the event for
      // the active API tab; other tab types (DB/Kafka/S3/tool) have no
      // listener, so it's a no-op there.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('patchman:send-request'));
        return;
      }

      // Cmd/Ctrl + W: Close current tab
      if (e.key === 'w' && !e.shiftKey) {
        e.preventDefault();
        const store = useRequestStore.getState();
        if (store.activeTabId) {
          store.removeTab(store.activeTabId);
        }
        return;
      }

      // Cmd/Ctrl + S: Save to collection
      if (e.key === 's' && !e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('patchman:save-to-collection'));
        return;
      }

      // Cmd/Ctrl + Shift + S: Save as new
      if (e.key === 's' && e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('patchman:save-to-collection'));
        return;
      }

      // Cmd/Ctrl + D: Detach the active tab into its own window. Always
      // preventDefault so the browser's "bookmark" dialog never pops on web
      // (Cmd+D is free in the desktop app); only actually detach when not
      // typing (Monaco routes keystrokes through a hidden <textarea>, so the
      // isEditing guard covers it). No-op with no active tab or when the
      // active tab is already detached (in the loan ledger).
      if (e.key === 'd' && !e.shiftKey) {
        e.preventDefault();
        if (isEditing) return;
        const store = useRequestStore.getState();
        const id = store.activeTabId;
        if (!id) return;
        if (store.detached.some((l) => l.tabId === id)) return;
        detachTab(id);
        return;
      }

      // Cmd/Ctrl + E: Open environment manager
      if (e.key === 'e' && !e.shiftKey) {
        // Don't capture if user is editing text
        if (isEditing) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('patchman:open-env-manager'));
        return;
      }

      // Cmd/Ctrl + L: Focus URL bar
      if (e.key === 'l' && !e.shiftKey) {
        e.preventDefault();
        const urlInput = document.querySelector<HTMLInputElement>('[data-url-bar]');
        if (urlInput) {
          urlInput.focus();
          urlInput.select();
        }
        return;
      }

      // Cmd/Ctrl + P: Open Global Search (Spotlight). Works while typing, like
      // the command palette. preventDefault swallows the browser Print dialog.
      if (e.key === 'p' && !e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('patchman:open-search'));
        return;
      }

      // Cmd/Ctrl + B: Toggle sidebar
      if (e.key === 'b' && !e.shiftKey) {
        // Don't capture if user is editing text
        if (isEditing) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('patchman:toggle-sidebar'));
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, []);
}
