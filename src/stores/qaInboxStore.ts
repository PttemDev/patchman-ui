import { create } from 'zustand';
import type { QAInboxResult } from '@/types';
import { qaAPI } from '@/services/api';

// CR + QA Hub Inbox (CR_QA_P0_PLAN P0.c): the latest Inbox of the current
// QA space, shared by the poller, the rail badge and the Hub. `available`
// turns false when the backend has no radar (404) so polling stops.
interface QAInboxState {
  inbox: QAInboxResult | null;
  loading: boolean;
  error: string;
  available: boolean;
  fetch: (refresh?: boolean) => Promise<QAInboxResult | null>;
}

export const useQAInboxStore = create<QAInboxState>((set) => ({
  inbox: null,
  loading: false,
  error: '',
  available: true,
  fetch: async (refresh = false) => {
    set({ loading: true });
    try {
      const res = await qaAPI.inbox(refresh);
      const inbox = res.data ? { ...res.data, items: res.data.items ?? [], links: res.data.links ?? [], testStatuses: res.data.testStatuses ?? [] } : null;
      set({ inbox, loading: false, error: '', available: true });
      return inbox;
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '';
      // A missing route (no radar on this backend) answers 404 without a
      // JSON error; "Workspace not found" is a 404 with one and must not
      // stop polling for good.
      set({ loading: false, error: msg || 'error', available: !(status === 404 && !msg) });
      return null;
    }
  },
}));

const SEEN_KEY = 'patchman.qa.inbox.seen.v1';

/** Item keys already notified (ref@headSha), kept per browser. */
export function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function saveSeen(seen: Set<string>) {
  try {
    // Bounded: the newest 500 keys.
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-500)));
  } catch {
    /* storage unavailable: notifications may repeat after a reload */
  }
}
