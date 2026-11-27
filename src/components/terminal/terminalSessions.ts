import type { Terminal, IDisposable } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { create } from 'zustand';
import { createXterm, applyTerminalPrefs, sendPtyResize, attachPtySocket } from '@/lib/ptyTerminal';
import { terminalAPI } from '@/services/api';
import { useThemeStore } from '@/stores/themeStore';
import { useTerminalPrefsStore } from '@/stores/terminalPrefsStore';
import { appendTail } from './outputTail';

// Registry of live terminal sessions. xterm instances and sockets live outside
// React (module-level Map) so a session keeps running while its tab is not
// mounted; the zustand store only holds the display rows. The BE sends an exit
// frame when the shell ends, but a socket close (also on a dropped connection
// or a cancelled step-up) is what marks a session as ended here.

export type TerminalProgram = 'shell' | 'claude' | 'codex';
export type TerminalSessionState = 'connecting' | 'open' | 'closed' | 'cancelled';

export interface TerminalSession {
  id: string;
  /** user-given name; shown instead of the automatic title when set */
  name?: string;
  title: string;
  cwd: string;
  busy: boolean;
  program: TerminalProgram;
  state: TerminalSessionState;
}

interface TerminalSessionsState {
  sessions: TerminalSession[];
  activeId: string | null;
  setActive: (id: string) => void;
}

// Not persisted: sessions die with the page.
export const useTerminalSessions = create<TerminalSessionsState>((set) => ({
  sessions: [],
  activeId: null,
  setActive: (id) => set({ activeId: id }),
}));

interface Entry {
  term: Terminal;
  fit: FitAddon;
  container: HTMLDivElement;
  ws: WebSocket | null;
  dataSub: IDisposable | null;
  opened: boolean;
  shellName: string;
  refit: (() => void) | null; // set while attached to a host
  tail: string; // last raw output, replayed into a detached window (terminalBridge)
}

const TAIL_MAX = 256 * 1024;
let outputListener: ((id: string, data: string) => void) | null = null;
/** One listener (the main-window terminal bridge) sees every session's output. */
export function setOutputListener(fn: ((id: string, data: string) => void) | null): void {
  outputListener = fn;
}

const entries = new Map<string, Entry>();
let seq = 0;

function patch(id: string, p: Partial<TerminalSession>): void {
  useTerminalSessions.setState((s) => ({
    sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...p } : x)),
  }));
}

/** The name a session is shown under: the user's name, else the automatic title. */
export const sessionLabel = (s: TerminalSession): string => s.name ?? s.title;

/** Empty clears the name, so the label follows the running command again. */
export function renameSession(id: string, name: string): void {
  const n = name.trim();
  useTerminalSessions.setState((s) => ({
    sessions: s.sessions.map((x) => (x.id === id ? { ...x, name: n || undefined } : x)),
  }));
}

export const sessionShell = (id: string): string | undefined => entries.get(id)?.shellName;
export const sessionTail = (id: string): string => entries.get(id)?.tail ?? '';

/** Keystrokes from a detached window (terminalBridge). */
export function writeSession(id: string, data: string): void {
  const ws = entries.get(id)?.ws;
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stdin', data }));
}

/** Clears the visible screen and scrollback (the shell keeps running). */
export function clearSession(id: string): void {
  const e = entries.get(id);
  if (!e) return;
  e.term.clear();
  e.term.focus();
}

/**
 * Puts a command on the session's prompt (replacing what is typed there) and,
 * with run, presses Enter. Uses bracketed paste when the shell asked for it,
 * so a multi-line command arrives as one edit instead of running line by line.
 */
export function sendCommand(id: string, command: string, run: boolean): boolean {
  const e = entries.get(id);
  if (!e?.ws || e.ws.readyState !== WebSocket.OPEN) return false;
  const body = e.term.modes.bracketedPasteMode ? `\x1b[200~${command}\x1b[201~` : command;
  e.ws.send(JSON.stringify({ type: 'stdin', data: `\x15${body}${run ? '\r' : ''}` }));
  e.term.focus();
  return true;
}

/** Called after a command finished in any session (OSC 7 back at the prompt). */
const promptListeners = new Set<() => void>();
export function onPrompt(fn: () => void): () => void {
  promptListeners.add(fn);
  return () => { promptListeners.delete(fn); };
}

/** A detached window's size: the hidden main xterm follows it, so the parse stays in step. */
export function resizeSession(id: string, cols: number, rows: number): void {
  const e = entries.get(id);
  if (!e || cols < 1 || rows < 1) return;
  e.term.resize(cols, rows);
  sendPtyResize(e.ws, e.term);
}

export function programOf(command: string): TerminalProgram {
  const first = command.trim().split(/\s+/)[0] ?? '';
  const base = first.slice(first.lastIndexOf('/') + 1);
  return base === 'claude' || base === 'codex' ? base : 'shell';
}

export function cwdFromOsc7(data: string): string | null {
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(data);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

// Drops the socket's handlers before closing so a stale close can't patch a
// session that has since been restarted or removed.
function dropSocket(e: Entry): void {
  e.dataSub?.dispose();
  e.dataSub = null;
  if (e.ws) {
    e.ws.onopen = null;
    e.ws.onmessage = null;
    e.ws.onclose = null;
    e.ws.onerror = null;
    e.ws.close();
    e.ws = null;
  }
}

function connect(id: string, e: Entry): void {
  // Plain constructor: the patched window.WebSocket runs the step-up prompt for
  // sensitive URLs and closes with 4401 when the user cancels.
  const ws = new WebSocket(terminalAPI.shellUrl().url);
  e.ws = ws;
  ws.onopen = () => {
    patch(id, { state: 'open' });
    sendPtyResize(ws, e.term);
  };
  ws.onclose = (ev) => patch(id, { state: ev.code === 4401 ? 'cancelled' : 'closed', busy: false });
  e.dataSub = attachPtySocket(e.term, ws, () => {});
  ws.addEventListener('message', (ev) => {
    let frame: { type?: string; data?: string };
    try {
      frame = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
    } catch {
      return;
    }
    if (frame.type !== 'stdout' || !frame.data) return;
    e.tail = appendTail(e.tail, frame.data, TAIL_MAX);
    outputListener?.(id, frame.data);
  });
}

export function createSession(shellName: string): string {
  const id = `term-${++seq}`;
  const { term, fit } = createXterm(8000);
  const container = document.createElement('div');
  container.className = 'h-full w-full';
  const e: Entry = { term, fit, container, ws: null, dataSub: null, opened: false, shellName, refit: null, tail: '' };
  entries.set(id, e);

  // 6973 = command started (title/program), OSC 7 = back at the prompt (cwd).
  term.parser.registerOscHandler(6973, (cmd) => {
    patch(id, { title: cmd, busy: true, program: programOf(cmd) });
    return true;
  });
  term.parser.registerOscHandler(7, (d) => {
    const cwd = cwdFromOsc7(d);
    patch(id, { busy: false, title: shellName, program: 'shell', ...(cwd ? { cwd } : {}) });
    promptListeners.forEach((fn) => fn());
    return true;
  });

  useTerminalSessions.setState((s) => ({
    sessions: [...s.sessions, { id, title: shellName, cwd: '', busy: false, program: 'shell', state: 'connecting' }],
    activeId: id,
  }));
  connect(id, e);
  return id;
}

export function restartSession(id: string): void {
  const e = entries.get(id);
  if (!e) return;
  dropSocket(e);
  e.term.reset();
  e.tail = '';
  patch(id, { state: 'connecting', busy: false, title: e.shellName, program: 'shell' });
  connect(id, e);
}

export function closeSession(id: string): void {
  const e = entries.get(id);
  if (e) {
    dropSocket(e);
    e.term.dispose();
    e.container.remove();
    entries.delete(id);
  }
  useTerminalSessions.setState((s) => {
    const sessions = s.sessions.filter((x) => x.id !== id);
    return { sessions, activeId: s.activeId === id ? (sessions[0]?.id ?? null) : s.activeId };
  });
}

/** Focuses the active session's terminal, if it is open in the panel. */
export function focusActiveSession(): void {
  const id = useTerminalSessions.getState().activeId;
  const e = id ? entries.get(id) : undefined;
  if (e?.opened && e.container.isConnected) e.term.focus();
}

export function attachSession(id: string, host: HTMLElement): () => void {
  const e = entries.get(id);
  if (!e) return () => {};
  host.appendChild(e.container);
  if (!e.opened) {
    e.term.open(e.container);
    e.opened = true;
  }
  const refit = () => {
    if (!host.clientWidth || !host.clientHeight) return; // hidden (rail collapse) — keep the last size
    try { e.fit.fit(); } catch { /* disposed / not laid out */ }
    sendPtyResize(e.ws, e.term);
  };
  e.refit = refit;
  const raf = requestAnimationFrame(() => {
    refit();
    e.term.focus();
  });
  const ro = new ResizeObserver(refit);
  ro.observe(host);
  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    if (e.refit === refit) e.refit = null;
    if (e.container.parentElement === host) host.removeChild(e.container);
  };
}

// Theme/preset/prefs changes are pushed live; a font-size change also refits attached sessions.
const applyAll = (refit: boolean) => {
  for (const e of entries.values()) {
    applyTerminalPrefs(e.term);
    if (refit) e.refit?.();
  }
};
useThemeStore.subscribe((s, p) => {
  if (s.theme !== p.theme || s.preset !== p.preset) applyAll(false);
});
useTerminalPrefsStore.subscribe((s, p) => applyAll(s.fontSize !== p.fontSize));
