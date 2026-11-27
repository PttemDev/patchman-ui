import { create } from 'zustand';
import { useRequestStore } from '@/stores/requestStore';
import { focusDetachedWindow, isStandalone } from '@/lib/detach/DetachController';
import { useTerminalPrefsStore, type TerminalOpenIn } from '@/stores/terminalPrefsStore';
import { closeSession, createSession, sessionLabel, useTerminalSessions } from './terminalSessions';
import { notifyEnded } from './terminalBridge';

// Where a terminal session is shown: under the sidebar list, or (openIn 'tab')
// in a main-area tab of type 'terminal'. A tab is only a view: closing it keeps
// the shell running; ending a session (endSession) also closes its tab.

const terminalTabs = () => useRequestStore.getState().tabs.filter((t) => t.type === 'terminal');
const onLoan = (tabId: string) => useRequestStore.getState().detached.some((l) => l.tabId === tabId);

/** The tab id of the session's tab while it is detached into its own window. */
export function detachedTabOf(sessionId: string): string | undefined {
  return terminalTabs().find((t) => t.terminalSessionId === sessionId && onLoan(t.id))?.id;
}

/** Makes the session active; in tab mode also opens (or focuses) its tab. */
export function showSession(id: string): void {
  useTerminalSessions.getState().setActive(id);
  const away = detachedTabOf(id);
  if (away) { focusDetachedWindow(away); return; }
  if (useTerminalPrefsStore.getState().openIn !== 'tab') return;
  const session = useTerminalSessions.getState().sessions.find((s) => s.id === id);
  if (!session) return;
  const store = useRequestStore.getState();
  const existing = terminalTabs().find((t) => t.terminalSessionId === id);
  if (existing) store.setActiveTab(existing.id);
  else store.addTab({ type: 'terminal', name: sessionLabel(session), method: 'GET', url: '', terminalSessionId: id }, true);
}

export function startSession(shell: string): string {
  const id = createSession(shell);
  showSession(id);
  return id;
}

export function endSession(id: string): void {
  closeSession(id);
  const store = useRequestStore.getState();
  for (const t of terminalTabs()) {
    if (t.terminalSessionId !== id) continue;
    if (onLoan(t.id)) {
      notifyEnded(t.id); // its window closes; the loan goes, so the later return is ignored
      store.cancelDetach(t.id);
    }
    store.removeTab(t.id);
  }
}

// A busy session asks first (TerminalCloseConfirm, mounted once in AppLayout).
export const useTerminalCloseConfirm = create<{ pendingId: string | null; cancel: () => void }>((set) => ({
  pendingId: null,
  cancel: () => set({ pendingId: null }),
}));

export function requestEndSession(id: string): void {
  const s = useTerminalSessions.getState().sessions.find((x) => x.id === id);
  if (s?.busy) useTerminalCloseConfirm.setState({ pendingId: id });
  else endSession(id);
}

/** Switching to the sidebar closes the terminal tabs (the sessions keep running);
 *  detached windows stay, and their tab doesn't come back when they close. */
function dropDockedTerminalTabs(): void {
  const store = useRequestStore.getState();
  for (const t of terminalTabs()) if (!onLoan(t.id)) store.removeTab(t.id);
}

export function setOpenIn(mode: TerminalOpenIn): void {
  useTerminalPrefsStore.getState().setOpenIn(mode);
  if (mode === 'sidebar') {
    dropDockedTerminalTabs();
    return;
  }
  const { activeId } = useTerminalSessions.getState();
  if (activeId) showSession(activeId);
}

// A detached terminal that comes home while in sidebar mode doesn't keep a tab.
useRequestStore.subscribe((s, prev) => {
  if (isStandalone()) return; // a detached window owns its one tab
  if (s.detached !== prev.detached && useTerminalPrefsStore.getState().openIn === 'sidebar') dropDockedTerminalTabs();
});

// Terminal tab titles follow the session's label (rename, or the running command).
useTerminalSessions.subscribe((s) => {
  const store = useRequestStore.getState();
  for (const t of terminalTabs()) {
    const session = s.sessions.find((x) => x.id === t.terminalSessionId);
    if (session && t.name !== sessionLabel(session)) store.updateTab(t.id, { name: sessionLabel(session) });
  }
});
