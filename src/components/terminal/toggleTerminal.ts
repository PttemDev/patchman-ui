import { useSidebarStore } from '@/stores/sidebarStore';
import { useTerminalPrefsStore } from '@/stores/terminalPrefsStore';
import { focusActiveSession, useTerminalSessions } from './terminalSessions';
import { showSession } from './terminalView';

// Show / hide terminal (Settings → Keymap), like VS Code's: hidden → show and
// focus it; shown but unfocused → focus it; focused → collapse the sidebar to
// its rail (sessions keep running). In tab mode: open / focus the active
// session's tab (nothing to hide).
export function toggleTerminal(): void {
  const { activeId } = useTerminalSessions.getState();
  if (useTerminalPrefsStore.getState().openIn === 'tab' && activeId) {
    if (document.activeElement?.closest('[data-terminal-panel]')) return;
    showSession(activeId);
    requestAnimationFrame(focusActiveSession);
    return;
  }
  const panel = document.querySelector<HTMLElement>('[data-terminal-panel]');
  const visible = !!panel && panel.clientWidth > 0;
  const focused = !!document.activeElement?.closest('[data-terminal-panel]');
  if (visible && focused) {
    useSidebarStore.getState().setCollapsed(true);
    (document.activeElement as HTMLElement | null)?.blur(); // keys must not reach a hidden shell
  } else if (visible) {
    focusActiveSession();
  } else {
    window.dispatchEvent(new CustomEvent('patchman:show-sidebar'));
    useSidebarStore.getState().setActiveTab('terminal');
    requestAnimationFrame(focusActiveSession);
  }
}
