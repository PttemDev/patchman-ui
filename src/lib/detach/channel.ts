// Cross-window message bus for the detach-tab feature.
//
// The ownership-transfer protocol (DETACH_TAB_RFC §2) is carried EXPLICITLY
// over this channel — never via shared storage, which is a hazard we fence
// (RFC §0), not a message bus. One interface, two impls picked by platform:
//
//   • Web     — BroadcastChannel('patchman-detach'), same-origin broadcast.
//   • Desktop — Tauri events (emitTo / listen). BroadcastChannel is
//               unreliable across WKWebView windows, so it is NOT used on
//               desktop.
//
// `target` is a window label: the main window is 'main', a detached window is
// 'detached-<tabId>'. On web the transport is a broadcast, so the target is
// advisory and receivers filter by `tabId`; on desktop it routes the event to
// exactly that window.

import { isDesktop } from '@/lib/platform';
import type { Tab } from '@/types';

export const MAIN_WINDOW_LABEL = 'main';
export const detachedLabel = (tabId: string) => `detached-${tabId}`;

const TAURI_EVENT = 'detach://msg';
const WEB_CHANNEL = 'patchman-detach';

export type DetachMsgType =
  | 'detach:ready' // child → main: mounted, pulling its cargo
  | 'detach:handoff' // main → child: here is your serialized Tab
  | 'detach:return' // child → main: final flush before teardown
  | 'detach:rollcall' // main → all: main reloaded, who's still alive?
  | 'detach:here'; // child → main: rollcall answer

export interface DetachMsg {
  type: DetachMsgType;
  tabId: string;
  /** Monotonic per-tab counter for idempotency / dedup. */
  epoch: number;
  /** Full serialized Tab — present on handoff and return. */
  tab?: Tab;
}

export interface CrossWindowChannel {
  post(target: string, msg: DetachMsg): void;
  on(handler: (msg: DetachMsg) => void): () => void;
  dispose(): void;
}

class WebChannel implements CrossWindowChannel {
  private bc: BroadcastChannel;
  private handlers = new Set<(m: DetachMsg) => void>();

  constructor() {
    this.bc = new BroadcastChannel(WEB_CHANNEL);
    this.bc.onmessage = (e: MessageEvent) => {
      const m = e.data as DetachMsg;
      this.handlers.forEach((h) => h(m));
    };
  }

  post(_target: string, msg: DetachMsg): void {
    // Broadcast; receivers filter by tabId. A BroadcastChannel never echoes
    // to the sender, so main↔child delivery is clean.
    try {
      this.bc.postMessage(msg);
    } catch {
      /* channel already closed */
    }
  }

  on(handler: (m: DetachMsg) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  dispose(): void {
    this.handlers.clear();
    try {
      this.bc.close();
    } catch {
      /* ignore */
    }
  }
}

class DesktopChannel implements CrossWindowChannel {
  private handlers = new Set<(m: DetachMsg) => void>();
  private unlisten: Promise<() => void> | null = null;

  constructor() {
    // Dynamic import so the web bundle never pulls the Tauri API at module
    // top-level. `listen` is async; buffer the unlisten for dispose().
    this.unlisten = (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      return listen<DetachMsg>(TAURI_EVENT, (e) => {
        this.handlers.forEach((h) => h(e.payload));
      });
    })().catch((err) => {
      console.warn('[detach] listen failed', err);
      return () => {};
    });
  }

  post(target: string, msg: DetachMsg): void {
    void (async () => {
      try {
        const { emitTo } = await import('@tauri-apps/api/event');
        await emitTo(target, TAURI_EVENT, msg);
      } catch (err) {
        console.warn('[detach] emitTo failed', err);
      }
    })();
  }

  on(handler: (m: DetachMsg) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  dispose(): void {
    this.handlers.clear();
    void this.unlisten?.then((u) => u()).catch(() => {});
  }
}

export function createDetachChannel(): CrossWindowChannel {
  return isDesktop() ? new DesktopChannel() : new WebChannel();
}
