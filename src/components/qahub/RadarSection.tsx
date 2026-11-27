import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, Bot, CheckCircle2, CircleDashed, ExternalLink, GitPullRequest, Kanban, Loader2, RefreshCw, Rows3, Search, Settings2, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { qaAPI } from '@/services/api';
import { useGitConnectionStore } from '@/stores/gitConnectionStore';
import { MRDetail } from '@/components/git/GitMRPanel';
import type { QAMRRef, QARadarLink, QARadarMR, QARadarResult, QASignalKind } from '@/types';
import { ReviewPanel } from './ReviewPanel';
import { MRTestsPanel } from './MRTestsPanel';
import { SIGNAL_META, SIGNAL_KINDS, boardColumn, mrLabel, pipelineTone, useAge, type BoardColumn } from './qaRadarUtil';
import type { QASection } from './sections';

const ALL = '__all__';

export function SignalChip({ kind, reason }: { kind: QASignalKind; reason?: string }) {
  const { t } = useTranslation('qa');
  const meta = SIGNAL_META[kind];
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span title={reason ? `${t(`radar.signal.${kind}.hint`)} — ${reason}` : t(`radar.signal.${kind}.hint`)}
      className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] font-medium', meta.tone)}>
      <Icon className="h-3 w-3" />{t(`radar.signal.${kind}.label`)}
    </span>
  );
}

export function ReviewChip({ review }: { review: NonNullable<QARadarMR['review']> }) {
  const { t } = useTranslation('qa');
  const tone = review.status === 'posted' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
    : review.status === 'claimed' ? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400'
      : review.status === 'stale' ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
        : 'border-primary/40 bg-primary/10 text-primary';
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] font-medium', tone)}>
      <Bot className="h-3 w-3" />{t(`review.reviewStatus.${review.status}`)}{review.pending > 0 ? ` · ${review.pending}` : ''}
    </span>
  );
}

function JiraCell({ m }: { m: QARadarMR }) {
  const { t } = useTranslation('qa');
  if (!m.jiraKey) return <span className="text-xs text-muted-foreground">—</span>;
  if (!m.jira) return <span className="font-mono text-xs text-muted-foreground" title={t('radar.jiraNotRead')}>{m.jiraKey}</span>;
  if (m.jira.missing) return <span className="font-mono text-xs text-orange-600 line-through dark:text-orange-400" title={t('radar.jiraMissing')}>{m.jiraKey}</span>;
  const done = m.jira.statusCategory === 'done';
  return (
    <a href={m.jira.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="group inline-flex flex-col leading-tight" title={m.jira.summary}>
      <span className="font-mono text-xs font-medium group-hover:underline">{m.jiraKey}</span>
      <span className={cn('text-[10px]', done ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>{m.jira.status}</span>
    </a>
  );
}

function Reviewers({ m }: { m: QARadarMR }) {
  if (!m.reviewers.length) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {m.reviewers.map((r) => {
        const ok = m.approvedBy.some((a) => a.toLowerCase() === r.username.toLowerCase());
        return (
          <span key={r.username} className={cn('inline-flex items-center gap-0.5 rounded bg-muted px-1 text-[11px]', ok && 'text-emerald-700 dark:text-emerald-400')} title={r.name || r.username}>
            {ok && <CheckCircle2 className="h-3 w-3" />}{r.username}
          </span>
        );
      })}
    </div>
  );
}

function LinkStrip({ links, onSettings }: { links: QARadarLink[]; onSettings: () => void }) {
  const { t } = useTranslation('qa');
  const issues = links.filter((l) => l.status !== 'ok' || l.truncated || l.mergedTruncated || l.incomplete > 0 || (l.jiraStatus && l.jiraStatus !== 'ok'));
  if (!issues.length) return null;
  return (
    <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs">
      {issues.map((l) => (
        <div key={l.id} className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="font-medium">{l.gitProject}</span>
          <span className="text-muted-foreground">
            {l.status !== 'ok' && <>{t(`radar.linkStatus.${l.status}`)}{l.error ? ` — ${l.error}` : ''}. </>}
            {l.truncated && <>{t('radar.truncated', { shown: l.shown, total: l.total ?? '—' })} </>}
            {l.mergedTruncated && <>{t('radar.mergedTruncated')} </>}
            {l.incomplete > 0 && <>{t('radar.incomplete', { count: l.incomplete })} </>}
            {l.jiraStatus && l.jiraStatus !== 'ok' && <>{t(`radar.jiraStatus.${l.jiraStatus}`)}{l.jiraError ? ` — ${l.jiraError}` : ''}</>}
          </span>
        </div>
      ))}
      <button type="button" onClick={onSettings} className="ml-5 text-primary hover:underline">{t('radar.openSettings')}</button>
    </div>
  );
}

// MR Radar (CR_QA_P0_PLAN P0.c): open MRs of the linked projects with
// signals, as a table or a board; a row opens the MR in a side panel.
export function RadarSection({ onNavigate }: { onNavigate?: (s: QASection) => void }) {
  const { t } = useTranslation('qa');
  const age = useAge();
  const [data, setData] = useState<QARadarResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [view, setView] = useState<'table' | 'board'>(() => {
    try { return localStorage.getItem('patchman.qa.radar.view') === 'board' ? 'board' : 'table'; } catch { return 'table'; }
  });
  const [q, setQ] = useState('');
  const [project, setProject] = useState(ALL);
  const [signal, setSignal] = useState<string>(ALL);
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState<QARadarMR | null>(null);
  const gitConns = useGitConnectionStore((s) => s.connections);
  const fetchGit = useGitConnectionStore((s) => s.fetchConnections);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const res = await qaAPI.radar(refresh);
      const d = res.data;
      setData(d ? { ...d, links: d.links ?? [], mrs: d.mrs ?? [], merged: d.merged ?? [], me: d.me ?? {} } : null);
      setErr('');
    } catch (e) {
      setErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error || t('radar.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onEvent = () => void load();
    window.addEventListener('patchman:qa-radar', onEvent);
    return () => window.removeEventListener('patchman:qa-radar', onEvent);
  }, [load]);
  useEffect(() => { if (!gitConns.length) void fetchGit(); }, [gitConns.length, fetchGit]);
  useEffect(() => { try { localStorage.setItem('patchman.qa.radar.view', view); } catch { /* ignore */ } }, [view]);

  const projects = useMemo(() => [...new Set((data?.mrs ?? []).map((m) => m.project))].sort(), [data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.mrs ?? []).filter((m) => {
      if (project !== ALL && m.project !== project) return false;
      if (signal !== ALL && !m.signals.some((s) => s.kind === signal)) return false;
      if (mine) {
        const me = data?.me[m.gitConnectionId]?.toLowerCase();
        if (!me || !(m.author.username.toLowerCase() === me || m.reviewers.some((r) => r.username.toLowerCase() === me))) return false;
      }
      if (needle && !(`${m.title} ${mrLabel(m)} ${m.author.username} ${m.jiraKey ?? ''} ${m.sourceBranch}`.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [data, q, project, signal, mine]);
  const counts = useMemo(() => {
    const c: Partial<Record<QASignalKind, number>> = {};
    for (const m of data?.mrs ?? []) for (const s of m.signals) c[s.kind] = (c[s.kind] ?? 0) + 1;
    return c;
  }, [data]);

  const goSettings = () => onNavigate?.('settings');

  if (loading && !data) {
    return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('radar.loading')}</div>;
  }
  if (err && !data) return <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{err}</div>;
  if (data && data.links.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
        <GitPullRequest className="h-8 w-8 text-muted-foreground" />
        <p className="max-w-md text-sm text-muted-foreground">{t('radar.noLinks')}</p>
        <Button size="sm" className="gap-1.5" onClick={goSettings}><Settings2 className="h-3.5 w-3.5" />{t('radar.linkProjects')}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Signal summary: click to filter */}
      <div className="flex flex-wrap gap-1.5">
        {SIGNAL_KINDS.map((k) => {
          const n = counts[k] ?? 0;
          const Icon = SIGNAL_META[k].icon;
          const active = signal === k;
          return (
            <button key={k} type="button" onClick={() => setSignal(active ? ALL : k)} disabled={!n}
              className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-40',
                active ? SIGNAL_META[k].tone : 'hover:bg-accent')}>
              <Icon className="h-3.5 w-3.5" />{t(`radar.signal.${k}.label`)}<span className="font-semibold tabular-nums">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('radar.search')} className="h-8 pl-7 text-xs" />
        </div>
        <Select value={project} onValueChange={setProject}>
          <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('radar.allProjects')}</SelectItem>
            {projects.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title={data && data.links.some((l) => l.status === 'ok' && !l.personal) ? t('radar.notPersonal') : undefined}>
          <Switch checked={mine} onCheckedChange={setMine} aria-label={t('radar.mine')} />{t('radar.mine')}
        </label>
        <div className="flex rounded-md border p-0.5">
          <Button variant="ghost" size="sm" aria-pressed={view === 'table'} className={cn('h-7 gap-1 px-2 text-xs', view === 'table' && 'bg-primary/15 text-primary hover:bg-primary/20')} onClick={() => setView('table')}><Rows3 className="h-3.5 w-3.5" />{t('radar.table')}</Button>
          <Button variant="ghost" size="sm" aria-pressed={view === 'board'} className={cn('h-7 gap-1 px-2 text-xs', view === 'board' && 'bg-primary/15 text-primary hover:bg-primary/20')} onClick={() => setView('board')}><Kanban className="h-3.5 w-3.5" />{t('radar.board')}</Button>
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void load(true)} disabled={loading}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />{t('radar.refresh')}
        </Button>
        {data && <span className="text-[11px] text-muted-foreground">{t('radar.updated', { when: age(data.generatedAt) })}</span>}
      </div>

      {data && <LinkStrip links={data.links} onSettings={goSettings} />}

      {view === 'table' ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t('radar.col.mr')}</th>
                <th className="px-3 py-2 font-medium">{t('radar.col.author')}</th>
                <th className="px-3 py-2 font-medium">{t('radar.col.reviewers')}</th>
                <th className="px-3 py-2 font-medium">{t('radar.col.pipeline')}</th>
                <th className="px-3 py-2 font-medium">{t('radar.col.jira')}</th>
                <th className="px-3 py-2 font-medium">{t('radar.col.updated')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-muted-foreground">{t('radar.noneMatch')}</td></tr>
              )}
              {rows.map((m) => (
                <tr key={m.ref} onClick={() => setOpen(m)} className="cursor-pointer border-t align-top transition-colors hover:bg-accent/40">
                  <td className="max-w-[420px] px-3 py-2">
                    <div className="flex items-start gap-1.5">
                      <GitPullRequest className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', m.draft ? 'text-muted-foreground' : 'text-emerald-500')} />
                      <div className="min-w-0">
                        <div className="line-clamp-2 font-medium">{m.title}</div>
                        <div className="truncate font-mono text-[10px] text-muted-foreground">{mrLabel(m)} · {m.sourceBranch} → {m.targetBranch}</div>
                        {(m.signals.length > 0 || m.review) && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {m.review && <ReviewChip review={m.review} />}
                            {m.signals.map((s) => <SignalChip key={s.kind} kind={s.kind} reason={s.reason} />)}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">{m.author.name || m.author.username}</td>
                  <td className="px-3 py-2"><Reviewers m={m} /></td>
                  <td className={cn('px-3 py-2 text-xs', pipelineTone(m.pipeline))}>{m.pipeline ? t(`radar.pipeline.${m.pipeline}`, { defaultValue: m.pipeline }) : '—'}</td>
                  <td className="px-3 py-2"><JiraCell m={m} /></td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{age(m.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Board rows={rows} onOpen={setOpen} />
      )}

      {data && data.merged.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('radar.mergedTitle')}</h3>
          <div className="divide-y rounded-lg border">
            {data.merged.map((m) => (
              <div key={m.ref} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="font-mono text-[11px] text-muted-foreground">{mrLabel(m)}</span>
                <span className="min-w-0 flex-1 truncate">{m.title}</span>
                <JiraCell m={m} />
                {m.signals.map((s) => <SignalChip key={s.kind} kind={s.kind} reason={s.reason} />)}
                <a href={m.webUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label={t('radar.openRemote')}><ExternalLink className="h-3.5 w-3.5" /></a>
              </div>
            ))}
          </div>
        </section>
      )}

      {open && <MRDrawer mr={open} onClose={() => setOpen(null)} onChanged={() => void load(true)} />}
    </div>
  );
}

const COLUMNS: BoardColumn[] = ['review', 'stuck', 'ready', 'draft'];

export type DrawerTab = 'mr' | 'review' | 'tests';
const DRAWER_TABS: DrawerTab[] = ['mr', 'review', 'tests'];

function Board({ rows, onOpen }: { rows: QARadarMR[]; onOpen: (m: QARadarMR) => void }) {
  const { t } = useTranslation('qa');
  const age = useAge();
  return (
    <div className="grid gap-3 @3xl:grid-cols-2 @6xl:grid-cols-4">
      {COLUMNS.map((col) => {
        const items = rows.filter((m) => boardColumn(m) === col);
        return (
          <div key={col} className="flex min-h-[120px] flex-col rounded-xl border bg-muted/20">
            <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-semibold">
              {col === 'ready' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : col === 'stuck' ? <AlertTriangle className="h-3.5 w-3.5 text-red-500" /> : <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />}
              {t(`radar.column.${col}`)}
              <span className="ml-auto tabular-nums text-muted-foreground">{items.length}</span>
            </div>
            <div className="flex flex-col gap-2 p-2">
              {items.map((m) => (
                <button key={m.ref} type="button" onClick={() => onOpen(m)} className="rounded-lg border bg-background p-2.5 text-left shadow-sm transition hover:border-primary/50 hover:shadow">
                  <div className="line-clamp-2 text-xs font-medium">{m.title}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="truncate font-mono">{mrLabel(m)}</span>
                    <span className="ml-auto whitespace-nowrap">{age(m.updatedAt)}</span>
                  </div>
                  {(m.signals.length > 0 || m.jiraKey) && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {m.jiraKey && <span className="rounded bg-muted px-1 font-mono text-[10px]">{m.jiraKey}{m.jira?.status ? ` · ${m.jira.status}` : ''}</span>}
                      {m.signals.filter((s) => s.kind !== 'stuck').map((s) => <SignalChip key={s.kind} kind={s.kind} reason={s.reason} />)}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Side panel: the Git tool's MR detail, the AI review and (P2) tests. */
export function MRDrawer({ mr, onClose, onChanged, initialTab = 'mr' }: { mr: QAMRRef; onClose: () => void; onChanged: () => void; initialTab?: DrawerTab }) {
  const { t } = useTranslation('qa');
  const conn = useGitConnectionStore((s) => s.connections.find((c) => c.id === mr.gitConnectionId));
  const [tab, setTab] = useState<DrawerTab>(initialTab);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label={t('radar.close')} className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-[min(1100px,92vw)] flex-col border-l bg-background shadow-2xl">
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <GitPullRequest className="h-4 w-4 text-emerald-500" />
          <span className="font-mono text-xs text-muted-foreground">{mrLabel(mr)}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{mr.title}</span>
          <div className="flex rounded-md border p-0.5">
            {DRAWER_TABS.map((k) => (
              <Button key={k} variant="ghost" size="sm" aria-pressed={tab === k} onClick={() => setTab(k)}
                className={cn('h-7 px-2 text-xs', tab === k && 'bg-primary/15 text-primary hover:bg-primary/20')}>{t(`drawer.${k}`)}</Button>
            ))}
          </div>
          <a href={mr.webUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label={t('radar.openRemote')}><ExternalLink className="h-4 w-4" /></a>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label={t('radar.close')}><X className="h-4 w-4" /></Button>
        </div>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {tab === 'mr' && (
            <MRDetail
              connId={mr.gitConnectionId}
              project={mr.project}
              iid={mr.iid}
              provider={mr.provider}
              canWrite={!!conn && (!conn.shared || conn.grantRole === 'write')}
              onChanged={onChanged}
            />
          )}
          {tab === 'review' && <div className="min-h-0 flex-1 overflow-y-auto"><ReviewPanel mr={mr} /></div>}
          {tab === 'tests' && <div className="min-h-0 flex-1 overflow-y-auto"><MRTestsPanel mr={mr} /></div>}
        </div>
      </div>
    </div>
  );
}
