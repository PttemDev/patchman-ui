import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Ban, CalendarClock, ChevronLeft, ChevronRight, CheckCircle2, CircleDashed, Clock, Copy, ExternalLink, Eye, EyeOff, Hand, KeyRound, Loader2,
  Play, RefreshCw, RotateCcw, SkipForward, Square, Workflow, XCircle,
} from 'lucide-react';
import { gitAPI } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { confirmDialog } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { cronText } from '@/lib/cronText';
import { extractErr, timeAgo } from './util';

// GitCIPanel is the Git tab's CI/CD mode for one GitLab project: pipelines
// (with their jobs and logs, live while running), pipeline schedules (cron in
// words) and CI/CD variables (values hidden until asked for, one at a time).
// Running / retrying / cancelling needs a write grant on the connection and a
// token with the api scope — the backend explains when either is missing.

type View = 'pipelines' | 'schedules' | 'variables';

// 'github' → workflow runs / workflows / Actions variables wording.
const CIProvider = createContext<string | undefined>(undefined);
const useGH = () => useContext(CIProvider) === 'github';

interface Pipeline {
  id: number; iid?: number; status: string; source?: string; ref: string; sha: string; webUrl?: string;
  createdAt?: string; startedAt?: string; finishedAt?: string; duration?: number; user?: string; yamlErrors?: string;
  /** GitHub: the workflow's name. */ name?: string;
}
// A downstream pipeline started by a trigger job: a child pipeline in this
// project (opens here) or another project's pipeline (opens in GitLab).
interface Downstream { id: number; status: string; ref?: string; webUrl?: string; sameProject: boolean }
interface Job {
  id: number; name: string; stage: string; status: string; allowFailure?: boolean; failureReason?: string;
  duration?: number; startedAt?: string; webUrl?: string; runner?: string;
  // 'bridge' = a trigger job (`trigger:` in .gitlab-ci.yml) — no log of its own.
  kind?: 'job' | 'bridge'; downstream?: Downstream;
}
interface PipelineData { pipeline: Pipeline; stages: string[]; jobs: Job[]; bridgesError?: string }
interface Schedule {
  id: number; description: string; ref: string; cron: string; timezone: string; nextRunAt?: string; active: boolean; owner?: string;
  /** GitHub: false when the workflow has no workflow_dispatch (can't be run by hand). */ dispatchable?: boolean;
}
interface Variable {
  key: string; type: string; protected: boolean; masked: boolean; hidden: boolean; environmentScope: string; description?: string;
}
interface GHWorkflow { id: number; name: string; path: string; dispatchable: boolean; inputs?: string[] }
interface VarLevel { level: 'group' | 'project' | 'organization' | 'repository' | 'environment'; path: string; variables?: Variable[]; error?: string }

const LIVE = new Set(['running', 'pending', 'created', 'preparing', 'waiting_for_resource', 'waiting_for_callback']);

export function StatusIcon({ status, className }: { status: string; className?: string }) {
  const cls = cn('h-3.5 w-3.5 shrink-0', className);
  switch (status) {
    case 'success': return <CheckCircle2 className={cn(cls, 'text-emerald-500')} />;
    case 'failed': return <XCircle className={cn(cls, 'text-red-500')} />;
    case 'running': return <Loader2 className={cn(cls, 'text-sky-500 animate-spin')} />;
    case 'canceled': case 'canceling': return <Ban className={cn(cls, 'text-muted-foreground')} />;
    case 'skipped': return <SkipForward className={cn(cls, 'text-muted-foreground')} />;
    case 'manual': return <Hand className={cn(cls, 'text-violet-500')} />;
    case 'scheduled': return <CalendarClock className={cn(cls, 'text-amber-500')} />;
    case 'created': return <CircleDashed className={cn(cls, 'text-muted-foreground')} />;
    default: return <Clock className={cn(cls, 'text-amber-500')} />;
  }
}

function fmtDuration(sec?: number): string {
  if (sec == null || !Number.isFinite(sec)) return '';
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function GitCIPanel({ connId, project, gitRef, canWrite, provider }: { connId: string; project: string; gitRef: string; canWrite: boolean; provider?: string }) {
  const { t } = useTranslation('git');
  const [view, setView] = useState<View>('pipelines');
  const ctx = provider === 'github' ? 'gh' : undefined;
  const tabs: { id: View; label: string; icon: typeof Workflow }[] = [
    { id: 'pipelines', label: t('ci.pipelines', { context: ctx }), icon: Workflow },
    { id: 'schedules', label: t('ci.schedules', { context: ctx }), icon: CalendarClock },
    { id: 'variables', label: t('ci.variables'), icon: KeyRound },
  ];
  return (
    <CIProvider.Provider value={provider}>
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            onClick={() => setView(tb.id)}
            className={cn('flex items-center gap-1.5 h-7 px-2.5 rounded text-xs', view === tb.id ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/40')}
          >
            <tb.icon className="h-3.5 w-3.5" /> {tb.label}
          </button>
        ))}
      </div>
      {view === 'pipelines' && <PipelinesView connId={connId} project={project} gitRef={gitRef} canWrite={canWrite} />}
      {view === 'schedules' && <SchedulesView connId={connId} project={project} canWrite={canWrite} />}
      {view === 'variables' && <VariablesView connId={connId} project={project} canWrite={canWrite} />}
    </div>
    </CIProvider.Provider>
  );
}

// ── Pipelines ────────────────────────────────────────────────────────────

function PipelinesView({ connId, project, gitRef, canWrite }: { connId: string; project: string; gitRef: string; canWrite: boolean }) {
  const { t } = useTranslation('git');
  const { toast } = useToast();
  const [onlyRef, setOnlyRef] = useState(false);
  const [status, setStatus] = useState('all');
  const [rows, setRows] = useState<Pipeline[]>([]);
  const [nextPage, setNextPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  // Pipelines opened by drilling into a child (trigger job) — the Back button
  // pops this; picking a pipeline from the list starts a fresh trail.
  const [trail, setTrail] = useState<number[]>([]);
  const openFromList = (id: number) => { setTrail([]); setSelected(id); };
  const openChild = (id: number) => {
    if (selected != null && selected !== id) setTrail((cur) => [...cur, selected]);
    setSelected(id);
  };
  const goBack = () => {
    const prev = trail[trail.length - 1];
    if (prev == null) return;
    setTrail((cur) => cur.slice(0, -1));
    setSelected(prev);
  };

  const params = useMemo(() => ({
    project, ...(onlyRef && gitRef ? { ref: gitRef } : {}), ...(status !== 'all' ? { status } : {}),
  }), [project, onlyRef, gitRef, status]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await gitAPI.pipelines(connId, params);
      const d = res.data as { pipelines: Pipeline[]; nextPage: number };
      setRows(d.pipelines ?? []);
      setNextPage(d.nextPage ?? 0);
      setError('');
    } catch (e) {
      if (!quiet) setError(extractErr(e, t('ci.loadFailed')));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [connId, params, t]);
  useEffect(() => { void load(); }, [load]);

  // Keep running pipelines live.
  const anyLive = rows.some((p) => LIVE.has(p.status));
  useEffect(() => {
    if (!anyLive) return;
    const id = window.setInterval(() => { void load(true); }, 10000);
    return () => window.clearInterval(id);
  }, [anyLive, load]);

  const loadMore = async () => {
    try {
      const res = await gitAPI.pipelines(connId, { ...params, page: nextPage });
      const d = res.data as { pipelines: Pipeline[]; nextPage: number };
      setRows((cur) => [...cur, ...(d.pipelines ?? [])]);
      setNextPage(d.nextPage ?? 0);
    } catch (e) {
      toast({ title: t('ci.loadFailed'), description: extractErr(e, ''), variant: 'destructive' });
    }
  };

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      <div className="w-[320px] shrink-0 border-r flex flex-col overflow-hidden">
        <div className="shrink-0 flex items-center gap-1.5 p-2 border-b">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-7 text-xs w-[118px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['all', 'running', 'pending', 'success', 'failed', 'canceled', 'manual', 'scheduled'].map((s) => (
                <SelectItem key={s} value={s} className="text-xs">{t(`ci.status.${s}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {gitRef && (
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer truncate" title={gitRef}>
              <input type="checkbox" checked={onlyRef} onChange={(e) => setOnlyRef(e.target.checked)} />
              <span className="truncate">{t('ci.onlyRef', { ref: gitRef })}</span>
            </label>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void load()} title={t('ci.refresh')}>
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </Button>
            {canWrite && <RunPipeline connId={connId} project={project} defaultRef={gitRef} onStarted={(id) => { void load(true); openFromList(id); }} />}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {error ? (
            <p className="p-3 text-xs text-destructive">{error}</p>
          ) : loading && rows.length === 0 ? (
            <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : rows.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">{t('ci.noPipelines')}</p>
          ) : (
            <>
              {rows.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => openFromList(p.id)}
                  className={cn('w-full text-left px-3 py-2 border-b hover:bg-accent/40', selected === p.id && 'bg-accent/60')}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <StatusIcon status={p.status} />
                    <span className="font-mono">#{p.name ? (p.iid ?? p.id) : p.id}</span>
                    {p.name && <span className="truncate font-medium">{p.name}</span>}
                    <span className={cn('truncate', p.name ? 'text-muted-foreground' : 'font-medium')}>{p.ref}</span>
                    {p.source === 'schedule' && <CalendarClock className="h-3 w-3 text-amber-500 shrink-0" aria-label={t('ci.fromSchedule')} />}
                    <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{timeAgo(p.createdAt)}</span>
                  </div>
                  <div className="pl-5 mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="font-mono">{p.sha.slice(0, 8)}</span>
                    <span>{t(`ci.source.${p.source ?? 'other'}`, { defaultValue: p.source ?? '' })}</span>
                  </div>
                </button>
              ))}
              {nextPage > 0 && (
                <div className="p-2 flex justify-center">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void loadMore()}>{t('ci.loadMore')}</Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {selected ? (
          <PipelineDetail key={selected} connId={connId} project={project} pipelineId={selected} canWrite={canWrite}
            onChanged={() => void load(true)} onOpenPipeline={openChild}
            backTo={trail[trail.length - 1]} onBack={goBack} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">{t('ci.selectPipeline')}</div>
        )}
      </div>
    </div>
  );
}

function RunPipeline({ connId, project, defaultRef, onStarted }: { connId: string; project: string; defaultRef: string; onStarted: (id: number) => void }) {
  const { t } = useTranslation('git');
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState(defaultRef);
  const [vars, setVars] = useState('');
  const [busy, setBusy] = useState(false);
  const gh = useGH();
  const ctx = gh ? 'gh' : undefined;
  const [workflows, setWorkflows] = useState<GHWorkflow[] | null>(null);
  const [workflow, setWorkflow] = useState('');
  useEffect(() => { if (open) setRef(defaultRef); }, [open, defaultRef]);
  useEffect(() => {
    if (!open || !gh || workflows) return;
    gitAPI.workflows(connId, { project }).then((r) => {
      const l = ((r.data as GHWorkflow[] | null) ?? []).filter((w) => w.dispatchable);
      setWorkflows(l);
      setWorkflow((cur) => cur || (l[0] ? String(l[0].id) : ''));
    }).catch(() => setWorkflows([]));
  }, [open, gh, workflows, connId, project]);
  const wf = workflows?.find((w) => String(w.id) === workflow);

  const run = async () => {
    const variables = vars.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const i = l.indexOf('=');
      return i > 0 ? { key: l.slice(0, i).trim(), value: l.slice(i + 1) } : { key: l, value: '' };
    });
    setBusy(true);
    try {
      const res = await gitAPI.runPipeline(connId, project, ref.trim(), variables, gh ? workflow : undefined);
      const d = res.data as { id: number };
      toast({ title: d.id ? t('ci.started', { id: d.id }) : t('ci.dispatched') });
      setOpen(false);
      setVars('');
      if (d.id) onStarted(d.id);
    } catch (e) {
      toast({ title: t('ci.runFailed'), description: extractErr(e, ''), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" className="h-7 text-xs gap-1"><Play className="h-3.5 w-3.5" />{t('ci.run')}</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2">
        <div className="text-xs font-medium">{t('ci.runTitle', { context: ctx })}</div>
        {gh && (workflows === null ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : workflows.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">{t('ci.noDispatchable')}</p>
        ) : (
          <Select value={workflow} onValueChange={setWorkflow}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {workflows.map((w) => <SelectItem key={w.id} value={String(w.id)} className="text-xs">{w.name} <span className="text-muted-foreground">· {w.path.replace('.github/workflows/', '')}</span></SelectItem>)}
            </SelectContent>
          </Select>
        ))}
        <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t('ci.refPlaceholder')} className="h-8 text-xs font-mono" />
        <Textarea value={vars} onChange={(e) => setVars(e.target.value)} placeholder={gh && wf?.inputs?.length ? t('ci.varsPlaceholder_gh', { inputs: wf.inputs.join(', ') }) : t('ci.varsPlaceholder', { context: ctx })} className="min-h-[72px] text-xs font-mono" />
        <div className="flex justify-end">
          <Button size="sm" className="h-7 text-xs gap-1" disabled={busy || !ref.trim() || (gh && !workflow)} onClick={() => void run()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{t('ci.run')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PipelineDetail({ connId, project, pipelineId, canWrite, onChanged, onOpenPipeline, backTo, onBack }: {
  connId: string; project: string; pipelineId: number; canWrite: boolean; onChanged: () => void;
  onOpenPipeline: (id: number) => void; backTo?: number; onBack: () => void;
}) {
  const { t } = useTranslation('git');
  const { toast } = useToast();
  const [data, setData] = useState<PipelineData | null>(null);
  const [error, setError] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState('');
  // Child pipelines expanded inline next to the Downstream column (GitLab-style).
  const [expanded, setExpanded] = useState<number[]>([]);
  const toggleExpanded = (id: number) =>
    setExpanded((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const load = useCallback(async () => {
    try {
      const res = await gitAPI.pipeline(connId, { project, pipeline: pipelineId });
      setData(res.data as PipelineData);
      setError('');
    } catch (e) {
      setError(extractErr(e, t('ci.loadFailed')));
    }
  }, [connId, project, pipelineId, t]);
  useEffect(() => { void load(); }, [load]);
  const live = !!data && (LIVE.has(data.pipeline.status) || data.jobs.some((j) => LIVE.has(j.status)));
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => { void load(); }, 5000);
    return () => window.clearInterval(id);
  }, [live, load]);

  const act = async (key: string, fn: () => Promise<unknown>, okMsg: string, confirm?: string) => {
    if (confirm && !(await confirmDialog({ title: confirm }))) return;
    setBusy(key);
    try {
      await fn();
      toast({ title: okMsg });
      await load();
      onChanged();
    } catch (e) {
      toast({ title: t('ci.actionFailed'), description: extractErr(e, ''), variant: 'destructive' });
    } finally {
      setBusy('');
    }
  };

  if (error) return <p className="p-4 text-xs text-destructive">{error}</p>;
  if (!data) return <div className="flex-1 flex items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  const p = data.pipeline;
  const canCancel = LIVE.has(p.status);
  const canRetry = p.status === 'failed' || p.status === 'canceled';
  const downstream = data.jobs.filter((j) => j.downstream);
  // A job shows its log; a trigger job opens the pipeline it started (a child
  // one here — another project's has the GitLab link on its row).
  const pick = (j: Job) => {
    if (j.kind !== 'bridge') { setJob(j); return; }
    if (j.downstream?.sameProject) onOpenPipeline(j.downstream.id);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="shrink-0 px-4 py-3 border-b flex items-center gap-2 flex-wrap text-xs">
        {backTo != null && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1 -ml-2" onClick={onBack} title={t('ci.backTo', { id: backTo })}>
            <ArrowLeft className="h-3.5 w-3.5" />#{backTo}
          </Button>
        )}
        <StatusIcon status={p.status} className="h-4 w-4" />
        <span className="font-medium">{t(`ci.status.${p.status}`, { defaultValue: p.status })}</span>
        <span className="font-mono">#{p.name ? (p.iid ?? p.id) : p.id}</span>
        {p.name && <span className="font-medium">{p.name}</span>}
        <span className="truncate">{p.ref}</span>
        <span className="font-mono text-muted-foreground">{p.sha.slice(0, 8)}</span>
        {p.user && <span className="text-muted-foreground">· {p.user}</span>}
        {p.duration != null && <span className="text-muted-foreground">· {fmtDuration(p.duration)}</span>}
        <div className="ml-auto flex items-center gap-1">
          {canWrite && canRetry && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={!!busy}
              onClick={() => void act('retry', () => gitAPI.retryPipeline(connId, project, p.id), t('ci.retried'))}>
              <RotateCcw className="h-3.5 w-3.5" />{t('ci.retry')}
            </Button>
          )}
          {canWrite && canCancel && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={!!busy}
              onClick={() => void act('cancel', () => gitAPI.cancelPipeline(connId, project, p.id), t('ci.canceled'), t('ci.cancelConfirm', { id: p.id }))}>
              <Square className="h-3.5 w-3.5" />{t('ci.cancel')}
            </Button>
          )}
          {p.webUrl && (
            <a href={p.webUrl} target="_blank" rel="noreferrer" className="h-7 px-2 inline-flex items-center gap-1 rounded border text-xs hover:bg-accent/50">
              <ExternalLink className="h-3.5 w-3.5" />{p.name ? 'GitHub' : 'GitLab'}
            </a>
          )}
        </div>
        {p.yamlErrors && <p className="w-full text-destructive">{p.yamlErrors}</p>}
      </div>
      <div className="shrink-0 max-h-[45%] overflow-y-auto border-b">
        <div className="flex flex-wrap gap-3 p-3">
          {data.stages.map((st) => (
            <div key={st} className="w-56 shrink-0">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{st}</div>
              <div className="space-y-1">
                {data.jobs.filter((j) => j.stage === st).map((j) => (
                  <div key={j.id}
                    className={cn('group flex items-center gap-1.5 rounded border px-2 py-1.5 text-xs hover:bg-accent/40',
                      (j.kind !== 'bridge' || j.downstream?.sameProject) && 'cursor-pointer',
                      job?.id === j.id && 'ring-1 ring-primary/50')}
                    onClick={() => pick(j)}
                    title={j.kind === 'bridge' && j.downstream?.sameProject ? t('ci.openChild', { id: j.downstream.id }) : undefined}
                  >
                    <StatusIcon status={j.status} />
                    <span className="truncate flex-1" title={j.failureReason ? `${j.name} — ${j.failureReason}` : j.name}>{j.name}</span>
                    {j.kind === 'bridge' && (
                      <span className="shrink-0 rounded bg-sky-500/15 px-1 text-[9px] text-sky-600 dark:text-sky-400">{t('ci.trigger')}</span>
                    )}
                    {j.allowFailure && j.status === 'failed' && <span className="text-[9px] text-amber-600">{t('ci.allowedToFail')}</span>}
                    <span className="text-[10px] text-muted-foreground">{fmtDuration(j.duration)}</span>
                    {j.kind === 'bridge' && j.downstream && !j.downstream.sameProject && j.downstream.webUrl && (
                      <a href={j.downstream.webUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground hover:text-foreground" title={t('ci.openInGitLab')}>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <JobActionButtons job={j} canWrite={canWrite} busy={busy}
                      onPlay={() => void act(`play-${j.id}`, () => gitAPI.playJob(connId, project, j.id), t('ci.jobStarted', { name: j.name }))}
                      onRerun={() => void act(`retry-${j.id}`, () => rerunJob(connId, project, j), t('ci.jobRetried', { name: j.name }))} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          {downstream.length > 0 && (
            <div className="w-56 shrink-0">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{t('ci.downstream')}</div>
              <div className="space-y-1">
                {downstream.map((j) => {
                  const d = j.downstream!;
                  const body = (
                    <>
                      <StatusIcon status={d.status} />
                      <span className="truncate flex-1">{j.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">#{d.id}</span>
                      {!d.sameProject && <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />}
                    </>
                  );
                  const cls = 'flex w-full items-center gap-1.5 rounded border border-sky-500/30 px-2 py-1.5 text-xs text-left hover:bg-accent/40';
                  const isOpen = expanded.includes(d.id);
                  return d.sameProject ? (
                    <div key={j.id} className="flex items-stretch gap-1">
                      <button type="button" className={cls} onClick={() => onOpenPipeline(d.id)} title={t('ci.openChild', { id: d.id })}>{body}</button>
                      <button type="button" onClick={() => toggleExpanded(d.id)}
                        className={cn('shrink-0 rounded border border-sky-500/30 px-1 text-muted-foreground hover:text-foreground hover:bg-accent/40', isOpen && 'bg-sky-500/10 text-foreground')}
                        title={isOpen ? t('ci.collapseChild') : t('ci.expandChild')} aria-expanded={isOpen}>
                        {isOpen ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  ) : (
                    <a key={j.id} href={d.webUrl} target="_blank" rel="noreferrer" className={cls} title={t('ci.openInGitLab')}>{body}</a>
                  );
                })}
              </div>
            </div>
          )}
          {downstream.filter((j) => j.downstream!.sameProject && expanded.includes(j.downstream!.id)).map((j) => (
            <ChildPipelineInline key={j.downstream!.id} connId={connId} project={project} name={j.name} canWrite={canWrite}
              pipelineId={j.downstream!.id} selectedJobId={job?.id} onPickJob={setJob} onOpenPipeline={onOpenPipeline} />
          ))}
          {data.jobs.length === 0 && <p className="text-xs text-muted-foreground">{t('ci.noJobs')}</p>}
        </div>
        {data.bridgesError && (
          <p className="px-3 pb-2 text-[11px] text-amber-600">{t('ci.bridgesFailed', { error: data.bridgesError })}</p>
        )}
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {job ? <JobLog key={job.id} connId={connId} project={project} job={job} canWrite={canWrite}
          onRerun={async (newId) => { await load(); onChanged(); if (newId) setJob((cur) => (cur ? { ...cur, id: newId, status: 'pending', duration: undefined } : cur)); }} /> : (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">{t('ci.selectJob')}</div>
        )}
      </div>
    </div>
  );
}

// A child pipeline's stages rendered inline beside its trigger job, like
// Finished jobs can run again; a manual job waits to be played. Bridges
// (trigger jobs) have neither through the API.
const FINISHED = new Set(['success', 'failed', 'canceled']);
const canRerun = (j: Job) => j.kind !== 'bridge' && FINISHED.has(j.status);
const canPlay = (j: Job) => j.kind !== 'bridge' && j.status === 'manual';

/** Run a job again (GitLab "retry"). Retrying a manual job can leave the new
 *  job waiting as `manual` (doğrulanmadı per GitLab version) — play it then,
 *  so "run again" always runs. Resolves the new job's id. */
async function rerunJob(connId: string, project: string, j: Job): Promise<number | undefined> {
  const res = await gitAPI.retryJob(connId, project, j.id);
  const nj = res.data as { id?: number; status?: string } | undefined;
  if (nj?.id && nj.status === 'manual') await gitAPI.playJob(connId, project, nj.id);
  return nj?.id;
}

/** Play / Run-again buttons for a job row. Always visible (not hover-only):
 *  a finished job's "run again" is a primary action, e.g. re-running a
 *  deploy job. */
function JobActionButtons({ job: j, canWrite, busy, onPlay, onRerun }: {
  job: Job; canWrite: boolean; busy?: string;
  onPlay: () => void; onRerun: () => void;
}) {
  const { t } = useTranslation('git');
  if (!canWrite) return null;
  const spinning = busy === `play-${j.id}` || busy === `retry-${j.id}`;
  if (spinning) return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />;
  return (
    <>
      {canPlay(j) && (
        <button type="button" className="shrink-0 text-violet-600 hover:text-violet-500" title={t('ci.playJob')} aria-label={t('ci.playJob')}
          onClick={(e) => { e.stopPropagation(); onPlay(); }}>
          <Play className="h-3.5 w-3.5" />
        </button>
      )}
      {canRerun(j) && (
        <button type="button" className="shrink-0 text-muted-foreground/70 hover:text-foreground" title={t('ci.retryJob')} aria-label={t('ci.retryJob')}
          onClick={(e) => { e.stopPropagation(); onRerun(); }}>
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </>
  );
}

// GitLab's expanded downstream view. Jobs open their log in the parent's log
// pane; nested trigger jobs drill into their own pipeline (with Back).
function ChildPipelineInline({ connId, project, name, pipelineId, selectedJobId, onPickJob, onOpenPipeline, canWrite }: {
  connId: string; project: string; name: string; pipelineId: number; selectedJobId?: number;
  onPickJob: (j: Job) => void; onOpenPipeline: (id: number) => void; canWrite: boolean;
}) {
  const { t } = useTranslation('git');
  const { toast } = useToast();
  const [busy, setBusy] = useState('');
  const [data, setData] = useState<PipelineData | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const res = await gitAPI.pipeline(connId, { project, pipeline: pipelineId });
      setData(res.data as PipelineData);
      setError('');
    } catch (e) {
      setError(extractErr(e, t('ci.loadFailed')));
    }
  }, [connId, project, pipelineId, t]);
  useEffect(() => { void load(); }, [load]);
  const act = async (key: string, fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(key);
    try {
      await fn();
      toast({ title: okMsg });
      await load();
    } catch (e) {
      toast({ title: t('ci.actionFailed'), description: extractErr(e, ''), variant: 'destructive' });
    } finally {
      setBusy('');
    }
  };
  const live = !!data && (LIVE.has(data.pipeline.status) || data.jobs.some((j) => LIVE.has(j.status)));
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => { void load(); }, 5000);
    return () => window.clearInterval(id);
  }, [live, load]);

  return (
    <div className="shrink-0 rounded-md border border-sky-500/30 bg-sky-500/5 p-2">
      <button type="button" onClick={() => onOpenPipeline(pipelineId)} title={t('ci.openChild', { id: pipelineId })}
        className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium hover:underline">
        {data && <StatusIcon status={data.pipeline.status} />}
        <span>{name}</span>
        <span className="font-mono text-[10px] text-muted-foreground">#{pipelineId}</span>
      </button>
      {error ? (
        <p className="w-56 text-[11px] text-destructive">{error}</p>
      ) : !data ? (
        <div className="w-56 flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : data.jobs.length === 0 ? (
        <p className="w-56 text-[11px] text-muted-foreground">{t('ci.noJobs')}</p>
      ) : (
        <div className="flex gap-3">
          {data.stages.map((st) => (
            <div key={st} className="w-52 shrink-0">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{st}</div>
              <div className="space-y-1">
                {data.jobs.filter((j) => j.stage === st).map((j) => {
                  const drill = j.kind === 'bridge' && j.downstream?.sameProject;
                  const clickable = j.kind !== 'bridge' || drill;
                  return (
                    <div key={j.id}
                      className={cn('flex items-center gap-1.5 rounded border bg-background px-2 py-1.5 text-xs hover:bg-accent/40',
                        clickable && 'cursor-pointer', selectedJobId === j.id && 'ring-1 ring-primary/50')}
                      onClick={() => { if (j.kind !== 'bridge') onPickJob(j); else if (drill) onOpenPipeline(j.downstream!.id); }}
                      title={drill ? t('ci.openChild', { id: j.downstream!.id }) : (j.failureReason ? `${j.name} — ${j.failureReason}` : j.name)}
                    >
                      <StatusIcon status={j.status} />
                      <span className="truncate flex-1">{j.name}</span>
                      {j.kind === 'bridge' && (
                        <span className="shrink-0 rounded bg-sky-500/15 px-1 text-[9px] text-sky-600 dark:text-sky-400">{t('ci.trigger')}</span>
                      )}
                      <span className="text-[10px] text-muted-foreground">{fmtDuration(j.duration)}</span>
                      <JobActionButtons job={j} canWrite={canWrite} busy={busy}
                        onPlay={() => void act(`play-${j.id}`, () => gitAPI.playJob(connId, project, j.id), t('ci.jobStarted', { name: j.name }))}
                        onRerun={() => void act(`retry-${j.id}`, () => rerunJob(connId, project, j), t('ci.jobRetried', { name: j.name }))} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JobLog({ connId, project, job, canWrite, onRerun }: {
  connId: string; project: string; job: Job; canWrite?: boolean;
  /** After Run again / Play: the new job's id (retry creates a new job). */
  onRerun?: (newJobId?: number) => void | Promise<void>;
}) {
  const { t } = useTranslation('git');
  const { toast } = useToast();
  const [acting, setActing] = useState(false);
  const [lines, setLines] = useState(300);
  const [log, setLog] = useState<{ text: string; truncated: boolean; totalLines: number; job: { status: string } } | null>(null);
  const [error, setError] = useState('');
  const pre = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await gitAPI.jobLog(connId, { project, job: job.id, lines });
      setLog(res.data as { text: string; truncated: boolean; totalLines: number; job: { status: string } });
      setError('');
    } catch (e) {
      setError(extractErr(e, t('ci.loadFailed')));
    }
  }, [connId, project, job.id, lines, t]);
  useEffect(() => { void load(); }, [load]);
  const live = LIVE.has(log?.job.status ?? job.status);
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => { void load(); }, 4000);
    return () => window.clearInterval(id);
  }, [live, load]);
  useEffect(() => { if (pre.current) pre.current.scrollTop = pre.current.scrollHeight; }, [log?.text]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b text-xs">
        <StatusIcon status={log?.job.status ?? job.status} />
        <span className="font-medium">{job.name}</span>
        {job.failureReason && <span className="text-destructive">{job.failureReason}</span>}
        {job.runner && <span className="text-muted-foreground">· {job.runner}</span>}
        {live && <span className="text-sky-600">{t('ci.live')}</span>}
        <div className="ml-auto flex items-center gap-1">
          {canWrite && (() => {
            const cur = { ...job, status: log?.job.status ?? job.status };
            if (!canPlay(cur) && !canRerun(cur)) return null;
            const play = canPlay(cur);
            return (
              <Button size="sm" variant="outline" className="h-6 gap-1 text-[11px]" disabled={acting}
                onClick={async () => {
                  setActing(true);
                  try {
                    const newId = play ? (await gitAPI.playJob(connId, project, job.id), undefined) : await rerunJob(connId, project, cur);
                    toast({ title: play ? t('ci.jobStarted', { name: job.name }) : t('ci.jobRetried', { name: job.name }) });
                    if (play) void load();
                    await onRerun?.(newId);
                  } catch (e) {
                    toast({ title: t('ci.actionFailed'), description: extractErr(e, ''), variant: 'destructive' });
                  } finally {
                    setActing(false);
                  }
                }}>
                {acting ? <Loader2 className="h-3 w-3 animate-spin" /> : play ? <Play className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}
                {play ? t('ci.play') : t('ci.runAgain')}
              </Button>
            );
          })()}
          {log?.truncated && lines < 3000 && (
            <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setLines(3000)}>{t('ci.moreLog')}</Button>
          )}
          <Button size="icon" variant="ghost" className="h-6 w-6" title={t('ci.copyLog')}
            onClick={() => void navigator.clipboard.writeText(log?.text ?? '').then(() => toast({ title: t('ci.copied') }))}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          {job.webUrl && (
            <a href={job.webUrl} target="_blank" rel="noreferrer" className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-accent/50" title="GitLab">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>
      {error ? <p className="p-3 text-xs text-destructive">{error}</p> : (
        <pre ref={pre} className="flex-1 min-h-0 overflow-auto m-0 p-3 text-[11px] leading-[1.45] font-mono bg-zinc-950 text-zinc-100 whitespace-pre-wrap break-all">
          {log ? (log.truncated ? `… ${t('ci.earlierLines', { count: log.totalLines - log.text.split('\n').length })}\n` : '') + (log.text || t('ci.emptyLog')) : ''}
        </pre>
      )}
    </div>
  );
}

// ── Schedules ────────────────────────────────────────────────────────────

function SchedulesView({ connId, project, canWrite }: { connId: string; project: string; canWrite: boolean }) {
  const { t, i18n } = useTranslation('git');
  const gh = useGH();
  const { toast } = useToast();
  const [rows, setRows] = useState<Schedule[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await gitAPI.pipelineSchedules(connId, { project });
      setRows((res.data as Schedule[]) ?? []);
      setError('');
    } catch (e) {
      setError(extractErr(e, t('ci.loadFailed')));
    }
  }, [connId, project, t]);
  useEffect(() => { void load(); }, [load]);

  const play = async (s: Schedule) => {
    if (!(await confirmDialog({ title: t('ci.playScheduleConfirm', { name: s.description || `#${s.id}` }) }))) return;
    setBusy(s.id);
    try {
      await gitAPI.playSchedule(connId, project, s.id);
      toast({ title: t('ci.scheduleStarted') });
    } catch (e) {
      toast({ title: t('ci.actionFailed'), description: extractErr(e, ''), variant: 'destructive' });
    } finally {
      setBusy(0);
    }
  };

  const when = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(d) : '';
  };

  if (error) return <p className="p-4 text-xs text-destructive">{error}</p>;
  if (!rows) return <div className="flex-1 flex items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  if (rows.length === 0) return <p className="p-4 text-xs text-muted-foreground">{t('ci.noSchedules', { context: gh ? 'gh' : undefined })}</p>;
  return (
    <div className="flex-1 min-h-0 overflow-auto">
      {gh && <p className="px-3 pt-2 text-[11px] text-muted-foreground">{t('ci.schedulesHint_gh')}</p>}
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-background border-b text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            {['schedule', 'cron', 'branch', 'nextRun', 'owner', ''].map((h) => <th key={h} className="text-left font-normal px-3 py-2">{h && t(`ci.col.${h}`)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const words = cronText(s.cron, t, i18n.language);
            return (
              <tr key={s.id} className={cn('border-b', !s.active && 'opacity-55')}>
                <td className="px-3 py-2">
                  <div className="font-medium">{s.description || `#${s.id}`}</div>
                  {!s.active && <div className="text-[10px] text-muted-foreground">{t('ci.inactive')}</div>}
                </td>
                <td className="px-3 py-2">
                  <code className="font-mono">{s.cron}</code>
                  <div className="text-[10px] text-muted-foreground">{[words, s.timezone].filter(Boolean).join(' · ')}</div>
                </td>
                <td className="px-3 py-2 font-mono">{s.ref}</td>
                <td className="px-3 py-2">{s.active ? when(s.nextRunAt) : '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">{s.owner}</td>
                <td className="px-3 py-2 text-right">
                  {canWrite && s.dispatchable !== false && (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={busy === s.id} onClick={() => void play(s)}>
                      {busy === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{t('ci.runNow')}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Variables ────────────────────────────────────────────────────────────

function VariablesView({ connId, project, canWrite }: { connId: string; project: string; canWrite: boolean }) {
  const { t } = useTranslation('git');
  const gh = useGH();
  const { toast } = useToast();
  const [levels, setLevels] = useState<VarLevel[] | null>(null);
  const [error, setError] = useState('');
  const [shown, setShown] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!canWrite) return;
    gitAPI.ciVariables(connId, { project })
      .then((r) => { setLevels((r.data as { levels: VarLevel[] }).levels ?? []); setError(''); })
      .catch((e) => setError(extractErr(e, t('ci.loadFailed'))));
  }, [connId, project, canWrite, t]);

  if (!canWrite) return <p className="p-4 text-xs text-muted-foreground max-w-lg">{t('ci.varsNeedWrite')}</p>;
  if (error) return <p className="p-4 text-xs text-destructive">{error}</p>;
  if (!levels) return <div className="flex-1 flex items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;

  const idOf = (l: VarLevel, v: Variable) => `${l.level}:${l.path}:${v.key}:${v.environmentScope}`;
  const reveal = async (l: VarLevel, v: Variable) => {
    const id = idOf(l, v);
    if (id in shown) {
      setShown((cur) => {
        const next = { ...cur };
        delete next[id];
        return next;
      });
      return;
    }
    setBusy(id);
    try {
      const res = await gitAPI.ciVariable(connId, { project, key: v.key, scope: v.environmentScope, ...(l.level === 'group' || l.level === 'organization' ? { group: l.path } : {}) });
      setShown((s) => ({ ...s, [id]: (res.data as { value: string }).value ?? '' }));
    } catch (e) {
      toast({ title: t('ci.revealFailed'), description: extractErr(e, ''), variant: 'destructive' });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto p-3 space-y-4">
      <p className="text-[11px] text-muted-foreground">{t('ci.varsHint', { context: gh ? 'gh' : undefined })}</p>
      {levels.map((l) => (
        <section key={`${l.level}:${l.path}`}>
          <div className="flex items-center gap-2 mb-1.5 text-xs">
            <span className="rounded bg-muted px-1.5 py-px text-[10px] uppercase tracking-wide">{t(`ci.level.${l.level}`)}</span>
            <span className="font-mono">{l.path}</span>
          </div>
          {l.error ? (
            <p className="text-xs text-muted-foreground border rounded-md px-3 py-2">{l.error}</p>
          ) : (l.variables ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground px-1">{t('ci.noVariables')}</p>
          ) : (
            <table className="w-full text-xs border rounded-md">
              <tbody>
                {(l.variables ?? []).map((v) => {
                  const id = idOf(l, v);
                  return (
                    <tr key={id} className="border-b last:border-b-0">
                      <td className="px-3 py-1.5 font-mono font-medium w-[30%] break-all" title={v.description}>{v.key}</td>
                      <td className="px-3 py-1.5 w-[12%] text-muted-foreground font-mono">{v.environmentScope}</td>
                      <td className="px-3 py-1.5 w-[22%]">
                        <span className="flex flex-wrap gap-1">
                          {v.protected && <Flag text={t('ci.flag.protected')} />}
                          {v.masked && <Flag text={t('ci.flag.masked')} />}
                          {v.hidden && <Flag text={t('ci.flag.hidden')} />}
                          {v.type === 'file' && <Flag text={t('ci.flag.file')} />}
                          {v.type === 'secret' && <Flag text={t('ci.flag.secret')} />}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        {v.hidden ? (
                          <span className="text-muted-foreground">{t('ci.hiddenValue', { context: gh ? 'gh' : undefined })}</span>
                        ) : (
                          <span className="flex items-center gap-1.5 min-w-0">
                            <code className="font-mono truncate max-w-[340px]">{id in shown ? (shown[id] || '""') : '••••••••'}</code>
                            <button type="button" className="text-muted-foreground hover:text-foreground shrink-0" onClick={() => void reveal(l, v)}
                              title={id in shown ? t('ci.hide') : t('ci.show')}>
                              {busy === id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : id in shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                            {id in shown && (
                              <button type="button" className="text-muted-foreground hover:text-foreground shrink-0" title={t('ci.copyValue')}
                                onClick={() => void navigator.clipboard.writeText(shown[id]).then(() => toast({ title: t('ci.copied') }))}>
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}

function Flag({ text }: { text: string }) {
  return <span className="rounded-full border px-1.5 py-px text-[10px] text-muted-foreground">{text}</span>;
}
