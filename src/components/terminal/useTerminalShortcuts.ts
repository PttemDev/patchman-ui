import { TERMINAL_KEYMAP, useScopedKeymap } from '@/lib/keymap';
import { useTerminalSessions } from './terminalSessions';
import { requestEndSession, showSession, startSession } from './terminalView';

/**
 * Settings → Keymap terminal shortcuts for a terminal surface (the sidebar
 * panel or a terminal tab). Live while focus is inside a [data-terminal-panel]
 * (checked per key: closing the focused xterm removes it without a blur event).
 */
export function useTerminalShortcuts(shell: string, enabled: boolean) {
  const cycle = (step: number) => {
    const { sessions, activeId } = useTerminalSessions.getState();
    if (sessions.length < 2) return;
    const i = sessions.findIndex((s) => s.id === activeId);
    showSession(sessions[(i + step + sessions.length) % sessions.length].id);
  };
  useScopedKeymap(TERMINAL_KEYMAP, enabled, {
    'terminal.newSession': () => startSession(shell),
    'terminal.closeSession': () => {
      const { activeId } = useTerminalSessions.getState();
      if (activeId) requestEndSession(activeId);
    },
    'terminal.nextSession': () => cycle(1),
    'terminal.prevSession': () => cycle(-1),
  }, () => !!document.activeElement?.closest('[data-terminal-panel]'));
}
