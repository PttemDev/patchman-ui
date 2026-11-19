// A detached window shows exactly one tab, so a tab opened from it (service
// map, related pod, logs in a new tab…) would land in its invisible
// single-tab store and the click would seem to do nothing. Such opens are
// forwarded to the main window instead. Kept free of the stores so
// requestStore can import it without a cycle.

import type { Tab } from '@/types';
import { MAIN_WINDOW_LABEL, createDetachChannel, type CrossWindowChannel } from './channel';

export function standaloneTabId(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('detached');
}

let channel: CrossWindowChannel | null = null;

export function forwardOpenTabToMain(open: Partial<Tab> | undefined, forceNew?: boolean): void {
  const tabId = standaloneTabId();
  if (!tabId) return;
  channel ??= createDetachChannel();
  // Functions / transient fields don't survive structured clone; a new tab's
  // overrides are plain data.
  channel.post(MAIN_WINDOW_LABEL, { type: 'detach:open-tab', tabId, epoch: 0, open: open ?? {}, forceNew });
}
