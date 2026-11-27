import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, CornerDownLeft, History, Loader2, Pencil, Play, RefreshCw, Search, SquareTerminal, X } from 'lucide-react';
import { terminalAPI } from '@/services/api';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { useTerminalPrefsStore } from '@/stores/terminalPrefsStore';
import { onPrompt, sendCommand, useTerminalSessions } from './terminalSessions';
import { TERMINAL_COMMAND_GROUPS, needsInput } from './terminalCommands';

// Right-hand panel of a terminal tab: the shell's history (default) and a
// library of everyday commands. A row can run on the session, be put on its
// prompt to finish there, be edited first, or be copied.

type PanelTab = 'history' | 'commands';
interface HistoryRow { command: string; time: number | null }

function relTime(sec: number | null, locale: string): string {
  if (!sec) return '';
  const diff = Math.round(sec - Date.now() / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(diff, 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(sec * 1000).toLocaleDateString(locale);
}

export function TerminalSidePanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { t, i18n } = useTranslation('terminal');
  const [tab, setTab] = useState<PanelTab>('history'); // history is what is needed most
  const [query, setQuery] = useState('');
  const width = useTerminalPrefsStore((s) => s.sidePanelWidth);
  const setWidth = useTerminalPrefsStore((s) => s.setSidePanelWidth);
  const session = useTerminalSessions((s) => s.sessions.find((x) => x.id === sessionId));
  const canSend = session?.state === 'open' && !session.busy;
  const searchRef = useRef<HTMLInputElement>(null);

  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [historyFile, setHistoryFile] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [loading, setLoading] = useState(false);
  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await terminalAPI.history(2000);
      setHistory(data?.entries ?? []);
      setHistoryFile(data?.file ?? '');
      setHistoryError('');
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void loadHistory(); }, [loadHistory]);
  // A command that just finished is in the history file now (the terminal's zsh
  // writes each command as it runs): refresh, debounced.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onPrompt(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void loadHistory(), 400);
    });
    return () => { off(); if (timer) clearTimeout(timer); };
  }, [loadHistory]);

  useEffect(() => { searchRef.current?.focus(); }, [tab]);

  const q = query.trim().toLowerCase();
  const historyRows = useMemo(
    () => (history ?? []).filter((h) => !q || h.command.toLowerCase().includes(q)).slice(0, 500),
    [history, q],
  );
  const groups = useMemo(() => TERMINAL_COMMAND_GROUPS.map((g) => ({
    ...g,
    commands: g.commands.filter((c) => !q
      || c.command.toLowerCase().includes(q)
      || t(`commands.items.${c.id}`).toLowerCase().includes(q)
      || t(`commands.groups.${g.id}`).toLowerCase().includes(q)),
  })).filter((g) => g.commands.length > 0), [q, t]);

  const send = (command: string, run: boolean) => {
    if (!sendCommand(sessionId, command, run)) toast({ title: t('panel.notReady'), duration: 2000 });
  };
  const copy = (command: string) => {
    navigator.clipboard.writeText(command).then(
      () => toast({ title: t('panel.copied'), duration: 1500 }),
      () => { /* clipboard blocked */ },
    );
  };

  // Drag the left edge to resize.
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev: MouseEvent) => setWidth(startW + (startX - ev.clientX));
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <aside className="relative flex min-h-0 shrink-0 flex-col border-l bg-background" style={{ width }}>
      <div className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-primary/30" onMouseDown={onResizeStart} />
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        {(['history', 'commands'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs',
              tab === id ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {id === 'history' ? <History className="h-3.5 w-3.5" /> : <SquareTerminal className="h-3.5 w-3.5" />}
            {t(`panel.${id}`)}
          </button>
        ))}
        <div className="flex-1" />
        {tab === 'history' && (
          <button type="button" onClick={() => void loadHistory()} title={t('panel.refresh')} aria-label={t('panel.refresh')}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        )}
        <button type="button" onClick={onClose} title={t('panel.close')} aria-label={t('panel.close')}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="shrink-0 border-b p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
            placeholder={tab === 'history' ? t('panel.searchHistory') : t('panel.searchCommands')}
            className="h-7 pl-7 text-xs"
          />
        </div>
        {!canSend && session && (
          <p className="mt-1.5 text-[10px] text-muted-foreground">{session.busy ? t('panel.busy') : t('panel.notReady')}</p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'history' ? (
          historyError ? (
            <p className="p-4 text-xs text-destructive">{historyError}</p>
          ) : history === null ? (
            <div className="flex justify-center p-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : historyRows.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">{q ? t('panel.noMatch') : t('panel.historyEmpty')}</p>
          ) : (
            <ul className="py-1">
              {historyRows.map((h) => (
                <CommandRow key={h.command} command={h.command} meta={relTime(h.time, i18n.language)}
                  canSend={canSend} onSend={send} onCopy={copy} />
              ))}
            </ul>
          )
        ) : groups.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">{t('panel.noMatch')}</p>
        ) : (
          groups.map((g) => (
            <section key={g.id} className="py-1">
              <h3 className="sticky top-0 z-[1] bg-background/95 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`commands.groups.${g.id}`)}
              </h3>
              <ul>
                {g.commands.map((c) => (
                  <CommandRow key={c.id} command={c.command} description={t(`commands.items.${c.id}`)}
                    badge={c.platform === 'mac' ? 'macOS' : c.platform === 'linux' ? 'Linux' : undefined}
                    canSend={canSend} onSend={send} onCopy={copy} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      {tab === 'history' && historyFile && (
        <div className="shrink-0 truncate border-t px-3 py-1 font-mono text-[10px] text-muted-foreground" title={historyFile}>
          {historyFile}
        </div>
      )}
    </aside>
  );
}

function CommandRow({ command, description, badge, meta, canSend, onSend, onCopy }: {
  command: string;
  description?: string;
  badge?: string;
  meta?: string;
  canSend: boolean;
  onSend: (command: string, run: boolean) => void;
  onCopy: (command: string) => void;
}) {
  const { t } = useTranslation('terminal');
  const [draft, setDraft] = useState<string | null>(null);
  const fill = needsInput(command);
  const editing = draft !== null;
  const value = draft ?? command;
  const runDisabled = !canSend || needsInput(value);

  const iconBtn = 'rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent';
  return (
    <li className="group border-b border-border/40 px-3 py-1.5 last:border-b-0 hover:bg-accent/40">
      {meta && <span className="float-right ml-2 text-[10px] text-muted-foreground">{meta}</span>}
      {description && (
        <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1">{description}</span>
          {badge && <span className="shrink-0 rounded border px-1 text-[9px] leading-4">{badge}</span>}
        </div>
      )}
      {editing ? (
        <textarea
          autoFocus
          value={value}
          rows={Math.min(6, value.split('\n').length + (value.length > 40 ? 1 : 0))}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => {
            // Select the first <placeholder> so typing replaces it.
            const m = /<[a-z][\w-]*>/i.exec(e.target.value);
            if (m) e.target.setSelectionRange(m.index, m.index + m[0].length);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !runDisabled) { e.preventDefault(); onSend(value, true); setDraft(null); }
          }}
          className="w-full resize-none rounded border bg-muted/40 px-1.5 py-1 font-mono text-[11px] outline-none focus:border-primary"
        />
      ) : (
        <button
          type="button"
          title={fill ? t('panel.fillFirst') : t('panel.clickToInsert')}
          onClick={() => (fill ? setDraft(command) : canSend && onSend(command, false))}
          className="block w-full whitespace-pre-wrap break-all text-left font-mono text-[11px] text-foreground"
        >
          {command}
        </button>
      )}
      <div className={cn('mt-1 flex items-center gap-0.5', !editing && 'opacity-0 group-hover:opacity-100 focus-within:opacity-100')}>
        <button type="button" className={iconBtn} disabled={runDisabled}
          title={needsInput(value) ? t('panel.fillFirst') : `${t('panel.run')} (⌘↵)`} aria-label={t('panel.run')}
          onClick={() => { onSend(value, true); setDraft(null); }}>
          <Play className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={iconBtn} disabled={!canSend} title={t('panel.insert')} aria-label={t('panel.insert')}
          onClick={() => { onSend(value, false); setDraft(null); }}>
          <CornerDownLeft className="h-3.5 w-3.5" />
        </button>
        {editing ? (
          <button type="button" className={iconBtn} title={t('panel.doneEditing')} aria-label={t('panel.doneEditing')} onClick={() => setDraft(null)}>
            <Check className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button type="button" className={iconBtn} title={t('panel.edit')} aria-label={t('panel.edit')} onClick={() => setDraft(command)}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        <button type="button" className={iconBtn} title={t('panel.copy')} aria-label={t('panel.copy')} onClick={() => onCopy(value)}>
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}
