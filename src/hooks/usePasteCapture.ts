import { useEffect } from 'react';
import { usePasteHistoryStore } from '@/stores/pasteHistoryStore';

/**
 * Mounts global listeners that feed the Paste History with what the user
 * pastes AND what they copy — so you can copy a few things (here or in another
 * app), then open the overlay and paste any of them. Call once, at the App root.
 *
 * Three capture paths:
 *  - `paste` (capture phase): what lands in a field, regardless of where.
 *  - `copy` / `cut` (capture phase): an in-app text selection being copied.
 *  - window `focus`: read the clipboard once when we regain focus, so text
 *    copied in ANOTHER page/app (whose copy event we can't see) is recorded.
 *
 * Never calls preventDefault (copy/paste happen normally). Skips password
 * fields and the overlay's own search box. The insert path fires `input`, not
 * `paste`, so re-inserting an entry doesn't re-capture it. The store dedupes
 * against the newest entry and drops oversized text, so a repeated focus with
 * the same clipboard content is a no-op.
 */
export function usePasteCapture(): void {
  useEffect(() => {
    const add = (text: string | null | undefined) => {
      if (text) usePasteHistoryStore.getState().add(text);
    };

    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        if (target instanceof HTMLInputElement && target.type === 'password') return;
        if (target.closest?.('[data-paste-history]')) return;
      }
      add(e.clipboardData?.getData('text') ?? '');
    };

    // Copy/cut of a DOM text selection. `clipboardData.getData` is empty during
    // a user-initiated copy, so read the live selection instead. (Copies made
    // via a Copy button / Monaco don't fire a DOM selection copy — those are
    // caught on the next window focus below.)
    const onCopy = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement && target.type === 'password') return;
      add(document.getSelection?.()?.toString());
    };

    // Text copied in another page/app: we can't observe that copy event, but we
    // can read the clipboard when our window comes back into focus. Requires
    // clipboard-read permission; silently skipped when denied/unavailable.
    const onFocus = () => {
      navigator.clipboard?.readText?.().then(add).catch(() => { /* denied / unfocused / unsupported */ });
    };

    document.addEventListener('paste', onPaste, true);
    document.addEventListener('copy', onCopy, true);
    document.addEventListener('cut', onCopy, true);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('paste', onPaste, true);
      document.removeEventListener('copy', onCopy, true);
      document.removeEventListener('cut', onCopy, true);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
}
