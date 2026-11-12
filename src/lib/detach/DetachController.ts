// Detach-tab controller (DETACH_TAB_RFC §2 + §3).
//
// Two roles, one module, both `isDesktop()`-switched so the identical
// ownership-transfer protocol runs on web and desktop:
//
//   • Main window — `DetachHost`: opens the detached window, runs the pull
//     handshake (ready → handoff → commit-removal), and watches for the tab
//     coming home (graceful return) or the window vanishing (crash → reclaim
//     from snapshot). Restores placeholders + reconciles via rollcall after a
//     main-window reload.
//   • Detached window — `startStandaloneRuntime`: announces `ready`, pulls its
//     handoff, answers rollcall, and flushes a `return` on close/reload.
//
// All Tauri APIs are dynamically imported inside desktop-only branches so the
// web bundle never touches them at module top-level.

import { isDesktop, getLocalApiUrl } from '@/lib/platform';
import { useRequestStore } from '@/stores/requestStore';
import { toast } from '@/components/ui/use-toast';
import type { Tab } from '@/types';
import {
  createDetachChannel,
  detachedLabel,
  MAIN_WINDOW_LABEL,
  type CrossWindowChannel,
  type DetachMsg,
} from './channel';

/** A web child fires `pagehide` on RELOAD as well as close. When a return
 *  arrives, wait this long for a re-`ready` (= the child only reloaded)
 *  before actually re-docking the tab. Also the RFC's re-dock grace. */
const RE_DOCK_GRACE_MS = 250;
/** After a return/crash the child window is torn down; give a graceful return
 *  this long to beat the crash path so we prefer the child's edited payload. */
const CRASH_GRACE_MS = 400;
/** How long to wait for `detach:here` answers after a main-window reload. */
const ROLLCALL_GRACE_MS = 1500;

export function standaloneTabId(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('detached');
}

export function isStandalone(): boolean {
  return !!standaloneTabId();
}

// ── Main-window host ────────────────────────────────────────────────

class DetachHost {
  private channel: CrossWindowChannel | null = null;
  private started = false;
  /** Web only: live popup handles for crash polling + focus. */
  private webHandles = new Map<string, Window>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Tabs already reclaimed this session — guards against duplicate returns. */
  private reclaimed = new Set<string>();
  /** In-flight return grace timers (keyed by tabId). */
  private pendingReturns = new Map<string, ReturnType<typeof setTimeout>>();
  /** Children that answered the most recent rollcall. */
  private aliveDuringRollcall = new Set<string>();

  /** Idempotent; call once in the main window. */
  init(): void {
    if (this.started || isStandalone()) return;
    this.started = true;
    this.channel = createDetachChannel();
    this.channel.on((msg) => this.onMessage(msg));

    // The loan ledger lives in the persisted store, which rehydrates from
    // IndexedDB asynchronously — reconcile only once it's available so we
    // don't rollcall against an empty ledger.
    const persist = useRequestStore.persist;
    if (persist.hasHydrated()) {
      this.reconcileOnBoot();
    } else {
      persist.onFinishHydration(() => this.reconcileOnBoot());
    }

    if (!isDesktop()) {
      this.pollTimer = setInterval(() => this.pollWebHandles(), 1000);
    }
  }

  /** Right-click Detach / Cmd+D entry point. */
  async detach(tabId: string): Promise<void> {
    if (!this.channel) this.init();
    const store = useRequestStore.getState();
    const snapshot = store.beginDetach(tabId);
    if (!snapshot) return; // missing, or already on loan

    // Fresh loan → clear any stale per-tab dedup state.
    this.reclaimed.delete(tabId);
    this.aliveDuringRollcall.delete(tabId);
    const pending = this.pendingReturns.get(tabId);
    if (pending) {
      clearTimeout(pending);
      this.pendingReturns.delete(tabId);
    }

    const title = snapshot.name || snapshot.url || 'Detached tab';

    if (isDesktop()) {
      await this.desktopOpen(tabId, title);
    } else {
      const handle = window.open(
        `/?detached=${encodeURIComponent(tabId)}`,
        detachedLabel(tabId),
        'popup,width=1000,height=760',
      );
      if (!handle) {
        // Popup blocked — revert the loan.
        store.cancelDetach(tabId);
        toast({
          title: 'Detach blocked',
          description:
            'Allow popups for PatchMan to open a detached tab in its own window.',
          variant: 'destructive',
        });
        return;
      }
      this.webHandles.set(tabId, handle);
    }
  }

  /** Focus an already-detached window (placeholder-chip click). */
  async focus(tabId: string): Promise<void> {
    if (isDesktop()) {
      try {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const w = await WebviewWindow.getByLabel(detachedLabel(tabId));
        await w?.setFocus();
      } catch (err) {
        console.warn('[detach] focus failed', err);
      }
      return;
    }
    const handle = this.webHandles.get(tabId);
    if (handle && !handle.closed) {
      handle.focus();
      return;
    }
    // Handle lost (e.g. main reloaded) — re-focus the popup by name WITHOUT
    // navigating it (empty URL leaves the existing document untouched).
    try {
      const w = window.open('', detachedLabel(tabId));
      w?.focus();
    } catch {
      /* ignore */
    }
  }

  private async desktopOpen(tabId: string, title: string): Promise<void> {
    const fail = (detail: unknown) => {
      const text =
        typeof detail === 'string'
          ? detail
          : detail instanceof Error
            ? detail.message
            : (() => { try { return JSON.stringify(detail); } catch { return String(detail); } })();
      console.warn('[detach] desktop create failed:', text);
      useRequestStore.getState().cancelDetach(tabId);
      // Surface the real Tauri error so it's diagnosable without devtools
      // (release builds have none).
      toast({
        title: 'Could not detach tab',
        description: String(text).slice(0, 300),
        variant: 'destructive',
      });
    };
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const label = detachedLabel(tabId);
      // A leftover window under this label (e.g. a prior failed attempt) makes
      // creation fail with "a webview with label ... already exists" — evict it.
      try {
        const existing = await WebviewWindow.getByLabel(label);
        if (existing) await existing.close();
      } catch { /* none / not permitted — proceed */ }
      const localApi = getLocalApiUrl();
      // Pass the sidecar URL to the child via the `?api=` query param. Tauri's
      // create_webview_window command has NO initializationScript option (it
      // errors "unknown field initializationScript"), and the Rust bootstrap
      // only pins __PATCHMAN_LOCAL_API__ for the 'main' window — so the child
      // learns the embedded BE URL from the query (getLocalApiUrl reads it).
      const url =
        `/?detached=${encodeURIComponent(tabId)}` +
        (localApi ? `&api=${encodeURIComponent(localApi)}` : '');
      const w = new WebviewWindow(label, {
        // Root document + query — same as the web path (window.open('/?detached='));
        // Tauri's asset protocol resolves "/" to index.html.
        url,
        title,
        width: 1000,
        height: 760,
        // Match the main window: Tauri's OS drag-drop handler otherwise eats
        // in-app HTML5 drag-and-drop.
        dragDropEnabled: false,
      });
      w.once('tauri://error', (e) => fail(e?.payload ?? e));
      w.once('tauri://destroyed', () => this.onChildGone(tabId));
    } catch (err) {
      fail(err);
    }
  }

  private onMessage(msg: DetachMsg): void {
    const store = useRequestStore.getState();
    const loan = store.detached.find((l) => l.tabId === msg.tabId);

    switch (msg.type) {
      case 'detach:ready': {
        // A pending return + a fresh ready = the child only reloaded; cancel
        // the re-dock and let the child self-rehydrate from its own key.
        const pending = this.pendingReturns.get(msg.tabId);
        if (pending) {
          clearTimeout(pending);
          this.pendingReturns.delete(msg.tabId);
        }
        if (loan && loan.status === 'DETACHING' && this.channel) {
          // Pull handshake: send the cargo, THEN remove the live tab.
          this.channel.post(detachedLabel(msg.tabId), {
            type: 'detach:handoff',
            tabId: msg.tabId,
            epoch: loan.epoch,
            tab: loan.snapshot,
          });
          store.commitDetach(msg.tabId);
        }
        // DETACHED loan + ready = child reloaded and rehydrated on its own.
        break;
      }
      case 'detach:return': {
        if (!loan || this.reclaimed.has(msg.tabId) || this.pendingReturns.has(msg.tabId)) break;
        const payload = msg.tab ?? loan.snapshot;
        // Grace before re-dock so a reload's pagehide-return can be undone by
        // a follow-up `ready`.
        const timer = setTimeout(() => {
          this.pendingReturns.delete(msg.tabId);
          this.reclaim(msg.tabId, payload);
        }, RE_DOCK_GRACE_MS);
        this.pendingReturns.set(msg.tabId, timer);
        break;
      }
      case 'detach:here':
        this.aliveDuringRollcall.add(msg.tabId);
        break;
      // 'detach:handoff' / 'detach:rollcall' are outbound-from-main only.
      default:
        break;
    }
  }

  /** Re-dock a tab and clear its loan, once. */
  private reclaim(tabId: string, tab: Tab): void {
    const store = useRequestStore.getState();
    if (!store.detached.some((l) => l.tabId === tabId)) return;
    if (this.reclaimed.has(tabId)) return;
    this.reclaimed.add(tabId);
    store.reclaimTab(tab);
    this.webHandles.delete(tabId);
    void this.focusMain();
  }

  /** Window vanished (crash or post-return teardown). Prefer a graceful
   *  return if one is mid-grace; otherwise reclaim from the snapshot. */
  private onChildGone(tabId: string): void {
    setTimeout(() => {
      this.webHandles.delete(tabId);
      if (this.pendingReturns.has(tabId) || this.reclaimed.has(tabId)) return;
      const loan = useRequestStore.getState().detached.find((l) => l.tabId === tabId);
      if (loan) this.reclaim(tabId, loan.snapshot);
    }, CRASH_GRACE_MS);
  }

  private pollWebHandles(): void {
    for (const [tabId, handle] of this.webHandles) {
      if (handle.closed) {
        this.webHandles.delete(tabId);
        this.onChildGone(tabId);
      }
    }
  }

  /** Main-window boot: drop stale DETACHING loans (reload caught mid-handoff,
   *  before the child pulled its cargo — un-grey the tab back to live), then
   *  rollcall the DETACHED ones. Under approach (b) the tab always survives in
   *  `tabs` at its slot, so reclaiming/dropping a loan just un-greys the tab
   *  in place — the placeholder position is preserved for free. */
  private reconcileOnBoot(): void {
    const store = useRequestStore.getState();
    for (const loan of [...store.detached]) {
      if (loan.status === 'DETACHING') {
        store.cancelDetach(loan.tabId); // handoff never completed → drop loan
      }
    }

    const survivors = useRequestStore.getState().detached.filter((l) => l.status === 'DETACHED');
    if (survivors.length === 0 || !this.channel) return;

    this.aliveDuringRollcall.clear();
    for (const loan of survivors) {
      this.channel.post(detachedLabel(loan.tabId), {
        type: 'detach:rollcall',
        tabId: loan.tabId,
        epoch: 0,
      });
    }
    setTimeout(() => {
      const now = useRequestStore.getState();
      for (const loan of now.detached.filter((l) => l.status === 'DETACHED')) {
        if (!this.aliveDuringRollcall.has(loan.tabId) && !this.reclaimed.has(loan.tabId)) {
          // No answer → the child is gone → reclaim from snapshot.
          this.reclaim(loan.tabId, loan.snapshot);
        }
      }
    }, ROLLCALL_GRACE_MS);
  }

  private async focusMain(): Promise<void> {
    if (isDesktop()) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().setFocus();
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      window.focus();
    } catch {
      /* ignore */
    }
  }
}

let host: DetachHost | null = null;
function getHost(): DetachHost {
  if (!host) host = new DetachHost();
  return host;
}

/** Main window: wire up the detach host (idempotent). */
export function initDetachHost(): void {
  getHost().init();
}

/** Detach the given tab into its own window. */
export function detachTab(tabId: string): void {
  void getHost().detach(tabId);
}

/** Bring an already-detached window to the front. */
export function focusDetachedWindow(tabId: string): void {
  void getHost().focus(tabId);
}

// ── Detached-window (child) runtime ─────────────────────────────────

/**
 * Boot the child-side protocol for a standalone tab window. Announces
 * readiness (pull handshake), installs the owned tab when the handoff lands,
 * answers rollcall, and flushes a return on close/reload. Returns a disposer.
 */
export function startStandaloneRuntime(opts: {
  tabId: string;
  onHandoff: (tab: Tab) => void;
  getCurrentTab: () => Tab | null;
}): () => void {
  const { tabId, onHandoff, getCurrentTab } = opts;
  const channel = createDetachChannel();
  let flushed = false;
  let epoch = 1;

  const flush = () => {
    if (flushed) return;
    flushed = true;
    const tab = getCurrentTab();
    channel.post(MAIN_WINDOW_LABEL, {
      type: 'detach:return',
      tabId,
      epoch: epoch++,
      tab: tab ?? undefined,
    });
  };

  const unsub = channel.on((msg) => {
    if (msg.tabId !== tabId) return;
    if (msg.type === 'detach:handoff' && msg.tab) {
      onHandoff(msg.tab);
    } else if (msg.type === 'detach:rollcall') {
      channel.post(MAIN_WINDOW_LABEL, { type: 'detach:here', tabId, epoch: 0 });
    }
  });

  // Pull handshake — retry a couple of times in case main's listener wasn't
  // attached yet when we mounted.
  const ready = () =>
    channel.post(MAIN_WINDOW_LABEL, { type: 'detach:ready', tabId, epoch: 0 });
  ready();
  const t1 = setTimeout(ready, 150);
  const t2 = setTimeout(ready, 500);

  const disposeClose = installChildCloseHook(flush);

  return () => {
    clearTimeout(t1);
    clearTimeout(t2);
    unsub();
    disposeClose();
    channel.dispose();
  };
}

/** Flush the owned tab home when the child window closes. On desktop this
 *  intercepts the close, emits the return, then destroys the window; on web
 *  it rides `pagehide`/`beforeunload`. */
function installChildCloseHook(flush: () => void): () => void {
  if (isDesktop()) {
    let unlisten: (() => void) | null = null;
    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const w = getCurrentWindow();
      unlisten = await w.onCloseRequested(async (event) => {
        event.preventDefault();
        flush();
        // Give the emit a beat to reach the main window before teardown.
        await new Promise((r) => setTimeout(r, 60));
        await w.destroy();
      });
    })().catch((err) => console.warn('[detach] close hook failed', err));
    return () => {
      if (unlisten) unlisten();
    };
  }

  const onHide = () => flush();
  window.addEventListener('pagehide', onHide);
  window.addEventListener('beforeunload', onHide);
  return () => {
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('beforeunload', onHide);
  };
}
