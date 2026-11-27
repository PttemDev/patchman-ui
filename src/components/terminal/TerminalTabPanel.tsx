import { useEffect, useState } from 'react';
import { terminalAPI } from '@/services/api';
import { useTerminalPrefsStore } from '@/stores/terminalPrefsStore';
import type { Tab } from '@/types';
import { isStandalone } from '@/lib/detach/DetachController';
import { DetachedTerminalView } from './DetachedTerminalView';
import { sessionShell, useTerminalSessions } from './terminalSessions';
import { TerminalSessionView } from './TerminalSessionView';
import { useTerminalShortcuts } from './useTerminalShortcuts';
import { TerminalToolbar } from './TerminalToolbar';
import { TerminalSidePanel } from './TerminalSidePanel';

// A sidebar terminal session shown as a main-area tab (Terminal prefs openIn
// 'tab'). The tab is only a view: closing it leaves the shell running. In a
// detached window the shell stays in the main window (DetachedTerminalView).
export function TerminalTabPanel({ tab }: { tab: Tab }) {
  return isStandalone() ? <DetachedTerminalView tabId={tab.id} /> : <LocalTerminalTab tab={tab} />;
}

function LocalTerminalTab({ tab }: { tab: Tab }) {
  const id = tab.terminalSessionId ?? '';
  // The visible tab's session is the active one (only the active tab's body is
  // mounted), so ⌘⇧W / next / prev act on what the user is looking at.
  useEffect(() => {
    if (id) useTerminalSessions.getState().setActive(id);
  }, [id]);
  useTerminalShortcuts(sessionShell(id) ?? 'shell', true);
  const panelOpen = useTerminalPrefsStore((s) => s.sidePanelOpen);
  const setPanelOpen = useTerminalPrefsStore((s) => s.setSidePanelOpen);
  const [home, setHome] = useState('');
  useEffect(() => {
    terminalAPI.status().then((r) => setHome(r.data?.home ?? '')).catch(() => { /* cwd shown in full */ });
  }, []);
  return (
    <div data-terminal-panel className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <TerminalToolbar sessionId={id} home={home} panelOpen={panelOpen} onTogglePanel={() => setPanelOpen(!panelOpen)} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col">
          <TerminalSessionView key={id} id={id} />
        </div>
        {panelOpen && <TerminalSidePanel sessionId={id} onClose={() => setPanelOpen(false)} />}
      </div>
    </div>
  );
}
