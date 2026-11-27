import { createDetachChannel, detachedLabel, type CrossWindowChannel, type DetachMsg } from '@/lib/detach/channel';
import { useRequestStore } from '@/stores/requestStore';
import {
  resizeSession,
  restartSession,
  sessionTail,
  setOutputListener,
  useTerminalSessions,
  writeSession,
} from './terminalSessions';

// Main-window side of a detached terminal tab. The shell (its WebSocket and a
// hidden xterm) stays here; the detached window is only a screen + keyboard:
// it asks for a replay of the output tail, then gets live output while its tab
// is on loan, and sends keystrokes / size / restart back.

let channel: CrossWindowChannel | null = null;
const forwarding = new Map<string, string>(); // sessionId → tabId

// Output is batched per window (~one frame): every Tauri event reaches every
// webview, so one event per stdout chunk would flood all windows on heavy output.
const pending = new Map<string, string>(); // tabId → output not yet sent
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function queueOut(tabId: string, data: string): void {
  pending.set(tabId, (pending.get(tabId) ?? '') + data);
  flushTimer ??= setTimeout(() => {
    flushTimer = null;
    for (const [tid, out] of pending) post(tid, { type: 'term:out', data: out });
    pending.clear();
  }, 16);
}

const onLoan = (tabId: string) => useRequestStore.getState().detached.some((l) => l.tabId === tabId);
const post = (tabId: string, msg: Omit<DetachMsg, 'tabId' | 'epoch'>) =>
  channel?.post(detachedLabel(tabId), { ...msg, tabId, epoch: 0 });

function sessionOf(tabId: string): string | undefined {
  for (const [sid, tid] of forwarding) if (tid === tabId) return sid;
  return undefined;
}

function onMessage(msg: DetachMsg): void {
  switch (msg.type) {
    case 'term:attach': {
      const tab = useRequestStore.getState().tabs.find((t) => t.id === msg.tabId && t.type === 'terminal');
      const session = useTerminalSessions.getState().sessions.find((s) => s.id === tab?.terminalSessionId);
      if (!tab || !session || !onLoan(tab.id)) { post(msg.tabId, { type: 'term:state', state: 'gone' }); return; }
      forwarding.set(session.id, tab.id);
      pending.delete(tab.id); // already inside the replay
      post(tab.id, { type: 'term:out', replay: true, data: sessionTail(session.id) });
      post(tab.id, { type: 'term:state', state: session.state });
      return;
    }
    case 'term:in': {
      const sid = sessionOf(msg.tabId);
      if (sid && msg.data) writeSession(sid, msg.data);
      return;
    }
    case 'term:resize': {
      const sid = sessionOf(msg.tabId);
      if (sid && msg.cols && msg.rows) resizeSession(sid, msg.cols, msg.rows);
      return;
    }
    case 'term:restart': {
      const sid = sessionOf(msg.tabId);
      if (sid) {
        restartSession(sid);
        pending.delete(msg.tabId);
        post(msg.tabId, { type: 'term:out', replay: true, data: '' }); // clear the old screen there too
      }
      return;
    }
    default: // detach:* belong to DetachHost; term:out/state are ours outbound
  }
}

/** The user ended the session: its detached window closes. */
export function notifyEnded(tabId: string): void {
  post(tabId, { type: 'term:state', state: 'ended' });
  for (const [sid, tid] of forwarding) if (tid === tabId) forwarding.delete(sid);
}

/** Main window, desktop only; idempotent. */
export function initTerminalBridge(): void {
  if (channel) return;
  channel = createDetachChannel();
  channel.on(onMessage);

  setOutputListener((sid, data) => {
    const tabId = forwarding.get(sid);
    if (!tabId) return;
    if (onLoan(tabId)) queueOut(tabId, data);
    else forwarding.delete(sid); // came home: stop forwarding
  });

  useTerminalSessions.subscribe((s, prev) => {
    for (const [sid, tabId] of forwarding) {
      const now = s.sessions.find((x) => x.id === sid);
      const before = prev.sessions.find((x) => x.id === sid);
      if (now && now.state !== before?.state) post(tabId, { type: 'term:state', state: now.state });
    }
  });

  // Shells die with a main-window reload: tell surviving terminal windows and drop their loans.
  const cleanup = () => {
    const store = useRequestStore.getState();
    for (const loan of store.detached.filter((l) => l.snapshot.type === 'terminal')) {
      post(loan.tabId, { type: 'term:state', state: 'gone' });
      store.cancelDetach(loan.tabId);
    }
  };
  if (useRequestStore.persist.hasHydrated()) cleanup();
  else useRequestStore.persist.onFinishHydration(cleanup);
}
