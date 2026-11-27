import { useEffect } from 'react';
import { useRequestStore } from '@/stores/requestStore';
import { detachTab } from '@/lib/detach/DetachController';
import { usePasteHistoryUiStore } from '@/stores/pasteHistoryUiStore';
import { getInsertTarget } from '@/lib/paste/insertIntoTarget';
import { isTabSwitchKey, matchesAction, terminalOwnsKey } from '@/lib/keymap';
import { isDesktop } from '@/lib/platform';
import { toggleTerminal } from '@/components/terminal/toggleTerminal';

/**
 * Global keyboard shortcuts for PatchMan. The bindings are the `global.*`
 * actions in lib/keymap.ts (defaults there, user overrides from Settings →
 * Keymap, read on every keydown so a change applies at once). Alt+1–9
 * (switch tab) is fixed. The command palette listens in CommandPalette.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {

      // Skip if user is typing in an input/textarea (except for our explicit shortcuts)
      const target = e.target as HTMLElement;
      if (terminalOwnsKey(e)) return;
      const isEditing =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // Alt + 1-9: Switch to tab by index (works even when editing). Read from
      // e.code: on macOS ⌥1 types a character (e.key '¡'), not '1'.
      if (isTabSwitchKey(e)) {
        const num = Number(e.code.slice('Digit'.length));
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

      // Paste History (default ⌘⌥V / Ctrl+Alt+V; e.code-based, so ⌥
      // composition doesn't matter). Only acts when a text-insertable element
      // is focused; captures it (and its caret) as the insert target.
      if (matchesAction(e, 'global.pasteHistory')) {
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

      // Rebindable shortcuts (Settings → Keymap), read live from the keymap.
      const on = (id: string) => matchesAction(e, id);

      if (on('global.newTab')) {
        e.preventDefault();
        useRequestStore.getState().addTab();
        return;
      }

      // Send the active request. Works even while editing (body/headers/
      // params), matching Postman. UrlBar handles the event for the active
      // API tab; other tab types have no listener, so it's a no-op there.
      if (on('global.sendRequest')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('patchman:send-request'));
        return;
      }

      if (on('global.closeTab')) {
        e.preventDefault();
        const store = useRequestStore.getState();
        if (store.activeTabId) {
          store.removeTab(store.activeTabId);
        }
        return;
      }

      if (on('global.saveToCollection') || on('global.saveAsNew')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('patchman:save-to-collection'));
        return;
      }

      // Detach the active tab into its own window. Only when not typing
      // (Monaco routes keystrokes through a hidden <textarea>, so the
      // isEditing guard covers it). No-op with no active tab or when the
      // active tab is already detached (in the loan ledger).
      if (on('global.detachTab')) {
        e.preventDefault();
        const store = useRequestStore.getState();
        const id = store.activeTabId;
        // A terminal tab's focus sits in xterm's helper <textarea>; ⌘D still detaches it.
        const terminalTab = store.tabs.find((t) => t.id === id)?.type === 'terminal' && !!target.closest('.xterm');
        if (isEditing && !terminalTab) return;
        if (!id) return;
        if (store.detached.some((l) => l.tabId === id)) return;
        detachTab(id);
        return;
      }

      if (on('global.envManager')) {
        if (isEditing) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('patchman:open-env-manager'));
        return;
      }

      if (on('global.focusUrl')) {
        e.preventDefault();
        const urlInput = document.querySelector<HTMLInputElement>('[data-url-bar]');
        if (urlInput) {
          urlInput.focus();
          urlInput.select();
        }
        return;
      }

      // Global Search (Spotlight). Works while typing, like the command
      // palette; preventDefault swallows the browser Print dialog.
      if (on('global.globalSearch')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('patchman:open-search'));
        return;
      }

      // Show / hide the sidebar terminal (desktop only). Works while typing,
      // and from inside the terminal (keymap.terminalOwnsKey lets it through).
      if (isDesktop() && on('global.toggleTerminal')) {
        e.preventDefault();
        toggleTerminal();
        return;
      }

      if (on('global.toggleSidebar')) {
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
