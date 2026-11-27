import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, AppWindow, Loader2, MonitorSmartphone, PanelLeft, Plus, X } from 'lucide-react';
import { terminalAPI } from '@/services/api';
import { useTerminalPrefsStore } from '@/stores/terminalPrefsStore';
import { useRequestStore } from '@/stores/requestStore';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { sessionLabel, useTerminalSessions, renameSession } from './terminalSessions';
import { ProgramIcon } from './ProgramIcon';
import { detachedTabOf, requestEndSession, setOpenIn, showSession, startSession } from './terminalView';
import { TerminalSessionView } from './TerminalSessionView';
import { useTerminalShortcuts } from './useTerminalShortcuts';

// Multi-session terminal for the sidebar: session list on top and, in sidebar
// mode, the active session's xterm below; in tab mode (Terminal prefs openIn)
// the list fills the panel and sessions open as main-area tabs. Sessions live
// in the terminalSessions registry (not in React), so this panel can
// mount/unmount freely without killing a shell.

type Probe = 'checking' | 'ready' | 'no-desktop' | 'error';

// Per app run, so a remount neither re-probes nor re-opens a shell the user
// closed (an error isn't cached: Retry probes again).
let probeCache: { probe: 'ready' | 'no-desktop'; shell: string; home: string } | null = null;
let autoStarted = false;

function displayCwd(cwd: string, home: string): string {
  if (home && (cwd === home || cwd.startsWith(`${home}/`))) return `~${cwd.slice(home.length)}`;
  return cwd;
}

export function TerminalPanel() {
  const { t } = useTranslation(['terminal', 'common']);
  const sessions = useTerminalSessions((s) => s.sessions);
  const activeId = useTerminalSessions((s) => s.activeId);
  const openIn = useTerminalPrefsStore((s) => s.openIn);
  useRequestStore((s) => s.detached); // re-render rows when a session's tab is detached / comes home

  const [probe, setProbe] = useState<Probe>(probeCache?.probe ?? 'checking');
  const [shell, setShell] = useState(probeCache?.shell ?? 'shell');
  const [home, setHome] = useState(probeCache?.home ?? '');
  const [nonce, setNonce] = useState(0);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);

  // Pre-flight: desktop only. Skipped once a probe has succeeded; Retry (shown
  // on error) re-runs it.
  useEffect(() => {
    if (probeCache) {
      setShell(probeCache.shell);
      setHome(probeCache.home);
      setProbe(probeCache.probe);
      return;
    }
    let cancelled = false;
    setProbe('checking');
    (async () => {
      try {
        const res = await terminalAPI.status();
        const d = res.data;
        probeCache = d?.desktop
          ? { probe: 'ready', shell: d.shell || 'shell', home: d.home ?? '' }
          : { probe: 'no-desktop', shell: 'shell', home: '' };
        if (cancelled) return;
        setShell(probeCache.shell);
        setHome(probeCache.home);
        setProbe(probeCache.probe);
      } catch {
        if (!cancelled) setProbe('error');
      }
    })();
    return () => { cancelled = true; };
  }, [nonce]);

  // First open of the app run: start one session. The module flag keeps
  // StrictMode's double effect from creating two, and a panel whose sessions
  // were all closed shows the empty state on return (spec §8.4).
  useEffect(() => {
    if (probe !== 'ready' || autoStarted) return;
    autoStarted = true;
    if (useTerminalSessions.getState().sessions.length === 0) startSession(shell);
  }, [probe, shell]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => sessionLabel(s).toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q));
  }, [sessions, query]);

  useTerminalShortcuts(shell, probe === 'ready');

  const commitRename = () => {
    if (editing) renameSession(editing.id, editing.draft);
    setEditing(null);
  };

  // ── Non-ready states ────────────────────────────────────────────────────
  if (probe !== 'ready') {
    let icon = <Loader2 className="h-6 w-6 animate-spin" />;
    let msg = t('terminal:checking');
    if (probe === 'no-desktop') {
      icon = <MonitorSmartphone className="h-7 w-7" />;
      msg = t('terminal:desktopOnly');
    } else if (probe === 'error') {
      icon = <AlertTriangle className="h-7 w-7 text-destructive" />;
      msg = t('terminal:probeError');
    }
    return (
      <div data-terminal-panel className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
        {icon}
        <p className="max-w-sm text-sm">{msg}</p>
        {probe === 'error' && (
          <Button variant="outline" size="sm" onClick={() => setNonce((n) => n + 1)}>
            {t('common:retry')}
          </Button>
        )}
      </div>
    );
  }

  const inTab = openIn === 'tab';
  const modeLabel = inTab ? t('terminal:showInSidebar') : t('terminal:showInTab');
  const ModeIcon = inTab ? PanelLeft : AppWindow;

  return (
    <div data-terminal-panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-[2.5rem] shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">{t('terminal:title')}</h2>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={modeLabel}
            aria-label={modeLabel}
            onClick={() => setOpenIn(inTab ? 'sidebar' : 'tab')}
          >
            <ModeIcon className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={t('terminal:newSession')}
            aria-label={t('terminal:newSession')}
            onClick={() => startSession(shell)}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
          <p className="text-sm">{t('terminal:empty')}</p>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => startSession(shell)}>
            <Plus className="h-3.5 w-3.5" /> {t('terminal:newSession')}
          </Button>
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b p-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('terminal:searchPlaceholder')}
              className="h-7 text-xs"
            />
          </div>

          <div className={cn('overflow-y-auto', inTab ? 'min-h-0 flex-1' : 'max-h-[104px] shrink-0 border-b')}>
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">{t('common:noResults')}</p>
            ) : (
              filtered.map((s) => {
                const dot = s.state === 'open' && !s.busy ? 'bg-emerald-500' : s.busy ? 'bg-amber-500' : 'bg-muted-foreground/40';
                const sub =
                  detachedTabOf(s.id) ? t('terminal:inWindow')
                  : s.state === 'closed' ? t('terminal:sessionClosed')
                  : s.state === 'cancelled' ? t('terminal:stepUpCancelled')
                  : displayCwd(s.cwd, home);
                return (
                  <div
                    key={s.id}
                    onClick={() => showSession(s.id)}
                    className={cn(
                      'group flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-accent/50',
                      s.id === activeId && 'bg-accent',
                    )}
                  >
                    <ProgramIcon program={s.program} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      {editing?.id === s.id ? (
                        <Input
                          autoFocus
                          value={editing.draft}
                          placeholder={s.title}
                          onChange={(e) => setEditing({ id: s.id, draft: e.target.value })}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename();
                            else if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); }
                          }}
                          className="h-5 px-1 text-xs"
                        />
                      ) : (
                        <div
                          className="truncate text-xs font-medium"
                          title={t('terminal:renameHint')}
                          onDoubleClick={(e) => { e.stopPropagation(); setEditing({ id: s.id, draft: s.name ?? '' }); }}
                        >
                          {sessionLabel(s)}
                        </div>
                      )}
                      {sub && <div className="truncate text-[10px] text-muted-foreground">{sub}</div>}
                    </div>
                    <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', dot)} />
                    <button
                      type="button"
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                      title={t('common:close')}
                      aria-label={t('common:close')}
                      onClick={(e) => {
                        e.stopPropagation();
                        requestEndSession(s.id);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* A detached session's shell is sized by its window: don't attach (and resize) it here too. */}
          {!inTab && activeId && (detachedTabOf(activeId) ? (
            <button
              type="button"
              className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => showSession(activeId)}
            >
              {t('terminal:inWindow')}
            </button>
          ) : (
            <TerminalSessionView id={activeId} />
          ))}
        </>
      )}
    </div>
  );
}
