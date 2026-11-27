import { useTranslation } from 'react-i18next';
import { Eraser, PanelRightClose, PanelRightOpen, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { clearSession, restartSession, sessionLabel, useTerminalSessions } from './terminalSessions';
import { ProgramIcon } from './ProgramIcon';

function displayCwd(cwd: string, home: string): string {
  if (home && (cwd === home || cwd.startsWith(`${home}/`))) return `~${cwd.slice(home.length)}`;
  return cwd;
}

// The bar above a terminal tab: what runs where, plus clear / restart and the
// History & Commands panel toggle.
export function TerminalToolbar({ sessionId, home, panelOpen, onTogglePanel }: {
  sessionId: string;
  home: string;
  panelOpen: boolean;
  onTogglePanel: () => void;
}) {
  const { t } = useTranslation('terminal');
  const session = useTerminalSessions((s) => s.sessions.find((x) => x.id === sessionId));
  if (!session) return null;
  const btn = 'inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground';
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
      <ProgramIcon program={session.program} className={cn('h-3.5 w-3.5 shrink-0', session.busy ? 'text-amber-500' : 'text-emerald-500')} />
      <span className="truncate text-xs font-medium">{sessionLabel(session)}</span>
      {session.cwd && (
        <span className="truncate font-mono text-[11px] text-muted-foreground" title={session.cwd}>{displayCwd(session.cwd, home)}</span>
      )}
      <div className="flex-1" />
      <button type="button" className={btn} onClick={() => clearSession(sessionId)} title={t('toolbar.clear')} aria-label={t('toolbar.clear')}>
        <Eraser className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btn} onClick={() => restartSession(sessionId)} title={t('toolbar.restart')} aria-label={t('toolbar.restart')}>
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={cn(btn, panelOpen && 'bg-accent text-foreground')} onClick={onTogglePanel}
        title={t('toolbar.panel')} aria-label={t('toolbar.panel')} aria-pressed={panelOpen}>
        {panelOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
        <span>{t('toolbar.historyCommands')}</span>
      </button>
    </div>
  );
}
