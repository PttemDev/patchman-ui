import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, Check, ExternalLink, FileDiff, GitBranch, GitMerge, GitPullRequest, Loader2, MessageSquare,
  Plus, RefreshCw, Search, ThumbsUp, UserPlus, X, Download, PanelLeftOpen,
} from 'lucide-react';
import { gitAPI } from '@/services/api';
import { gitOpsToken } from '@/stores/gitConnectionStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownView } from '@/components/notes/MarkdownView';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { confirmDialog } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import type {
  GitFileDiff, GitMember, GitMergeRequest, GitMRApprovals, GitMRDetail, GitMRDiscussion, GitMRPipeline,
} from '@/types';
import { GitMRDiff, Thread, Composer, type LineRef } from './GitMRDiff';
import { extractErr, timeAgo } from './util';

type Filter = 'opened' | 'review' | 'created' | 'assigned' | 'merged' | 'all';

interface PendingComment { file: GitFileDiff; line: LineRef; body: string }

// Merge requests (GitLab) / pull requests (GitHub) for the selected project (GIT_IDE_PLAN §I): list
// with filters, then Overview (description, pipeline, approvals, threads)
// and Changes (diff with inline threads, "Start review" batching).
export function GitMRPanel({ connId, project, canWrite, localRepo, currentBranch, defaultBranch, onCheckedOut, provider }: {
  /** 'github' → pull-request wording (#12, "Open on GitHub"). */
  provider?: string;
  connId: string;
  project: string;
  canWrite: boolean;
  localRepo?: { id: string; connectionId: string } | null;
  currentBranch?: string;
  defaultBranch?: string;
  onCheckedOut?: (branch: string) => void;
}) {
  const { t } = useTranslation('git');
  const pr = provider === 'github' ? 'pr' : undefined;
  const sigil = pr ? '#' : '!';
  const [filter, setFilter] = useState<Filter>('opened');
  const [search, setSearch] = useState('');
  const [list, setList] = useState<GitMergeRequest[] | null>(null);
  const [listErr, setListErr] = useState('');
  const [sel, setSel] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  // The diff needs the width: the list folds away while Changes is open.
  const [listHidden, setListHidden] = useState(false);

  const loadList = useCallback(async () => {
    setListErr('');
    try {
      const params: Parameters<typeof gitAPI.mergeRequests>[1] = { project, search: search.trim() || undefined };
      if (filter === 'review' || filter === 'created' || filter === 'assigned') { params.mine = filter; params.state = 'opened'; }
      else params.state = filter;
      const res = await gitAPI.mergeRequests(connId, params);
      const l = (res.data as GitMergeRequest[]) ?? [];
      setList(l);
      setSel((s) => (s && l.some((m) => m.iid === s) ? s : l[0]?.iid ?? null));
    } catch (e) {
      setListErr(extractErr(e, t('mr.loadFailed')));
      setList([]);
    }
  }, [connId, project, filter, search, t]);
  useEffect(() => {
    const h = setTimeout(() => void loadList(), 250);
    return () => clearTimeout(h);
  }, [loadList]);

  const FILTERS: Filter[] = ['opened', 'review', 'created', 'assigned', 'merged', 'all'];
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {listHidden ? (
        <button type="button" onClick={() => setListHidden(false)} title={t('mr.showList')} aria-label={t('mr.showList')}
          className="flex w-7 shrink-0 flex-col items-center gap-2 border-r pt-3 text-muted-foreground hover:bg-accent/40 hover:text-foreground">
          <PanelLeftOpen className="h-3.5 w-3.5" />
          <span className="text-[10px] [writing-mode:vertical-rl]">{t('mode.mrs', { context: pr })}</span>
        </button>
      ) : (
      <div className="flex w-80 shrink-0 flex-col border-r">
        <div className="space-y-2 border-b p-2">
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('mr.search', { context: pr })} className="h-8 pl-7 text-xs" />
            </div>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => void loadList()} aria-label={t('mr.refresh')} title={t('mr.refresh')}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            {canWrite && (
              <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> {t('mr.new')}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)}
                className={cn('rounded-full border px-2 py-0.5 text-[11px]', filter === f ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {t(`mr.filter.${f}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {listErr && <p className="m-2 rounded bg-destructive/10 p-2 text-xs text-destructive">{listErr}</p>}
          {!list ? (
            <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : list.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">{t('mr.none', { context: pr })}</p>
          ) : list.map((m) => (
            <button key={m.iid} type="button" onClick={() => setSel(m.iid)}
              className={cn('flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left', sel === m.iid ? 'bg-accent' : 'hover:bg-accent/40')}>
              <span className="flex items-start gap-1.5 text-xs">
                <GitPullRequest className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', m.state === 'merged' ? 'text-violet-500' : m.state === 'closed' ? 'text-red-500' : 'text-emerald-500')} />
                <span className="line-clamp-2">{m.title.replace(/^Draft:\s*/i, '')}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5 pl-5 text-[10px] text-muted-foreground">
                <span className="font-mono">{sigil}{m.iid}</span>
                {m.draft && <Badge variant="outline" className="px-1 py-0 text-[9px]">{t('mr.draft')}</Badge>}
                {m.hasConflicts && <Badge variant="outline" className="border-red-500/40 px-1 py-0 text-[9px] text-red-500">{t('mr.conflicts')}</Badge>}
                <span className="truncate">{m.sourceBranch} → {m.targetBranch}</span>
              </span>
              <span className="flex items-center gap-2 pl-5 text-[10px] text-muted-foreground">
                <span>{m.author}</span><span>{timeAgo(m.updatedAt || m.createdAt)}</span>
                {!!m.notes && <span className="flex items-center gap-0.5"><MessageSquare className="h-2.5 w-2.5" />{m.notes}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {sel ? (
          <MRDetail key={sel} provider={provider} onTabChange={(tb) => setListHidden(tb === 'changes')} connId={connId} project={project} iid={sel} canWrite={canWrite} localRepo={localRepo}
            onChanged={() => void loadList()} onCheckedOut={onCheckedOut} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">{t('mr.pick', { context: pr })}</div>
        )}
      </div>
      <CreateMRDialog provider={provider} open={createOpen} onOpenChange={setCreateOpen} connId={connId} project={project}
        source={currentBranch} target={defaultBranch} onCreated={(iid) => { void loadList().then(() => setSel(iid)); }} />
    </div>
  );
}

function MRDetail({ connId, project, iid, canWrite, localRepo, onChanged, onCheckedOut, onTabChange, provider }: {
  provider?: string;
  onTabChange?: (tab: 'overview' | 'changes') => void;
  connId: string;
  project: string;
  iid: number;
  canWrite: boolean;
  localRepo?: { id: string; connectionId: string } | null;
  onChanged: () => void;
  onCheckedOut?: (branch: string) => void;
}) {
  const { t } = useTranslation('git');
  const { toast } = useToast();
  const pr = provider === 'github' ? 'pr' : undefined;
  const [mr, setMr] = useState<GitMRDetail | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'overview' | 'changes'>('overview');
  const [diffs, setDiffs] = useState<GitFileDiff[] | null>(null);
  const [threads, setThreads] = useState<GitMRDiscussion[]>([]);
  const [approvals, setApprovals] = useState<GitMRApprovals | null>(null);
  const [pipes, setPipes] = useState<GitMRPipeline[]>([]);
  const [file, setFile] = useState<string>('');
  const [pending, setPending] = useState<PendingComment[]>([]);
  const [reviewMode, setReviewMode] = useState(true);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const [m, d, a, p] = await Promise.allSettled([
        gitAPI.mergeRequest(connId, { project, iid }),
        gitAPI.mrDiscussions(connId, { project, iid }),
        gitAPI.mrApprovals(connId, { project, iid }),
        gitAPI.mrPipelines(connId, { project, iid }),
      ]);
      if (m.status === 'fulfilled') setMr(m.value.data as GitMRDetail); else setErr(extractErr(m.reason, t('mr.loadFailed')));
      if (d.status === 'fulfilled') setThreads((d.value.data as GitMRDiscussion[]) ?? []);
      setApprovals(a.status === 'fulfilled' ? (a.value.data as GitMRApprovals) : null);
      setPipes(p.status === 'fulfilled' ? ((p.value.data as GitMRPipeline[]) ?? []) : []);
    } catch (e) {
      setErr(extractErr(e, t('mr.loadFailed')));
    }
  }, [connId, project, iid, t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (tab !== 'changes' || diffs) return;
    gitAPI.mergeRequestChanges(connId, { project, iid }).then((r) => {
      const d = ((r.data as { diffs: GitFileDiff[] }).diffs) ?? [];
      setDiffs(d);
      setFile((f) => f || d[0]?.newPath || '');
    }).catch((e) => setErr(extractErr(e, t('mr.loadFailed'))));
  }, [tab, diffs, connId, project, iid, t]);

  const act = async (key: string, fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(key);
    try {
      await fn();
      if (okMsg) toast({ title: okMsg });
      await load();
      onChanged();
    } catch (e) {
      toast({ title: t('mr.actionFailed'), description: extractErr(e, t('mr.actionFailed')), variant: 'destructive' });
    } finally {
      setBusy('');
    }
  };

  const position = (f: GitFileDiff, line: LineRef) => mr && ({
    ...mr.diffRefs, newPath: f.newPath, oldPath: f.oldPath, newLine: line.newLine, oldLine: line.oldLine,
  });
  const comment = async (f: GitFileDiff, line: LineRef, body: string) => {
    if (reviewMode) { setPending((p) => [...p, { file: f, line, body }]); return; }
    await act('comment', () => gitAPI.createMRDiscussion(connId, project, iid, { body, position: position(f, line) }));
  };
  const submitReview = async () => {
    await act('review', async () => {
      for (const c of pending) await gitAPI.createMRDiscussion(connId, project, iid, { body: c.body, position: position(c.file, c.line) });
      setPending([]);
    }, t('mr.reviewSubmitted', { count: pending.length }));
  };
  const checkoutLocal = async () => {
    if (!localRepo || !mr) return;
    await act('checkout', async () => {
      let accessToken = '';
      try { accessToken = await gitOpsToken(localRepo.connectionId); } catch { /* public */ }
      await gitAPI.fetch(localRepo.id, { accessToken, remote: 'origin' });
      await gitAPI.checkout(localRepo.id, { accessToken, ref: `origin/${mr.sourceBranch}` });
      onCheckedOut?.(mr.sourceBranch);
    }, t('mr.checkedOut', { branch: mr.sourceBranch }));
  };

  if (err && !mr) return <p className="m-3 rounded bg-destructive/10 p-2 text-xs text-destructive">{err}</p>;
  if (!mr) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;

  const opened = mr.state === 'opened';
  const pipe = pipes[0];
  const general = threads.filter((d) => !d.position);
  const inline = threads.filter((d) => d.position);
  const unresolved = threads.filter((d) => d.resolvable && !d.resolved).length;
  const fileObj = diffs?.find((d) => d.newPath === file);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 border-b px-4 py-3">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-sm font-semibold">
            {mr.draft && <Badge variant="outline" className="mr-1.5 align-middle text-[10px]">{t('mr.draft')}</Badge>}
            {mr.title.replace(/^Draft:\s*/i, '')} <span className="font-mono font-normal text-muted-foreground">{pr ? '#' : '!'}{mr.iid}</span>
          </h2>
          <a href={mr.webUrl} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            {pr ? 'GitHub' : 'GitLab'} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="secondary" className={cn('text-[10px]', mr.state === 'merged' && 'bg-violet-500/15 text-violet-600', mr.state === 'opened' && 'bg-emerald-500/15 text-emerald-600')}>{t(`mr.state.${mr.state}`, mr.state)}</Badge>
          <span className="flex items-center gap-1 font-mono"><GitBranch className="h-3 w-3" />{mr.sourceBranch} → {mr.targetBranch}</span>
          <span>{mr.author} · {timeAgo(mr.createdAt)}</span>
          {pipe && <a href={pipe.webUrl} target="_blank" rel="noreferrer" className={cn('rounded-full border px-1.5 py-px', pipe.status === 'success' ? 'border-emerald-500/40 text-emerald-600' : pipe.status === 'failed' ? 'border-red-500/40 text-red-500' : 'border-amber-500/40 text-amber-600')}>{t('mr.pipeline', { status: pipe.status })}</a>}
          {approvals && <span className="flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{approvals.approvedBy.length ? approvals.approvedBy.join(', ') : t('mr.noApprovals')}{approvals.left > 0 && ` · ${t('mr.approvalsLeft', { count: approvals.left })}`}</span>}
          {!!approvals?.changesRequestedBy?.length && <span className="text-amber-600">{t('mr.changesRequested', { names: approvals.changesRequestedBy.join(', ') })}</span>}
          {unresolved > 0 && <span className="text-amber-600">{t('mr.unresolvedThreads', { count: unresolved })}</span>}
          {mr.hasConflicts && <span className="flex items-center gap-1 text-red-500"><AlertTriangle className="h-3 w-3" />{t('mr.hasConflicts')}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {localRepo && <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={!!busy} onClick={() => void checkoutLocal()}><Download className="h-3.5 w-3.5" />{t('mr.checkoutLocal')}</Button>}
          {canWrite && opened && (
            <>
              {approvals?.userHasApproved
                ? <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={!!busy} onClick={() => void act('unapprove', () => gitAPI.unapproveMR(connId, project, iid))}>{t('mr.unapprove')}</Button>
                : <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={!!busy} onClick={() => void act('approve', () => gitAPI.approveMR(connId, project, iid), t('mr.approved'))}><ThumbsUp className="h-3.5 w-3.5" />{t('mr.approve')}</Button>}
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!busy} onClick={() => void act('draft', () => gitAPI.updateMR(connId, project, iid, { draft: !mr.draft }))}>{mr.draft ? t('mr.markReady') : t('mr.markDraft')}</Button>
              {(mr.mergeStatus === 'need_rebase' || mr.hasConflicts) && <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!busy} onClick={() => void act('rebase', () => gitAPI.rebaseMR(connId, project, iid), t('mr.rebaseStarted'))}>{t('mr.rebase')}</Button>}
              <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" disabled={!!busy} onClick={async () => { if (await confirmDialog({ title: t('mr.closeTitle'), destructive: true })) void act('close', () => gitAPI.updateMR(connId, project, iid, { stateEvent: 'close' })); }}>{t('mr.close')}</Button>
              <div className="flex-1" />
              <Button size="sm" className="h-7 gap-1 text-xs" disabled={!!busy || mr.draft || mr.hasConflicts} onClick={() => setMergeOpen(true)}><GitMerge className="h-3.5 w-3.5" />{t('mr.merge')}</Button>
            </>
          )}
          {canWrite && mr.state === 'closed' && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void act('reopen', () => gitAPI.updateMR(connId, project, iid, { stateEvent: 'reopen' }))}>{t('mr.reopen')}</Button>}
        </div>
        <div className="flex gap-3 text-xs">
          {(['overview', 'changes'] as const).map((x) => (
            <button key={x} type="button" onClick={() => { setTab(x); onTabChange?.(x); }} className={cn('border-b-2 pb-1', tab === x ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {x === 'overview' ? t('mr.tabOverview', { count: general.length }) : t('mr.tabChanges', { count: inline.length })}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' ? (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {/* Readable line length on wide screens (description, threads, composer). */}
          <div className="mx-auto max-w-4xl space-y-3">
          <div className="break-words rounded-md border bg-card p-3 text-xs">
            {mr.description ? <MarkdownView markdown={mr.description} className="md-compact" /> : <span className="text-muted-foreground">{t('mr.noDescription')}</span>}
          </div>
          {general.map((d) => (
            <Thread key={d.id} d={d} canReply={canWrite}
              onReply={(id, b) => act('reply', () => gitAPI.replyMRDiscussion(connId, project, iid, id, b))}
              onResolve={(id, r) => act('resolve', () => gitAPI.resolveMRDiscussion(connId, project, iid, id, r))} />
          ))}
          {canWrite && <Composer immediate={false} onSubmit={(b) => act('note', () => gitAPI.createMRDiscussion(connId, project, iid, { body: b }))} />}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex max-h-24 shrink-0 flex-wrap gap-1 overflow-auto border-b px-3 py-1.5">
            {!diffs ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : diffs.map((d) => {
              const n = inline.filter((x) => x.position?.newPath === d.newPath).length + pending.filter((p) => p.file.newPath === d.newPath).length;
              return (
                <button key={d.newPath} type="button" onClick={() => setFile(d.newPath)} title={d.newPath}
                  className={cn('flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs', file === d.newPath ? 'border-primary bg-primary/10' : 'hover:bg-accent/40')}>
                  <FileDiff className={cn('h-3.5 w-3.5 shrink-0', d.status === 'added' ? 'text-emerald-500' : d.status === 'deleted' ? 'text-red-500' : 'text-sky-500')} />
                  <span className="max-w-[220px] truncate">{d.newPath}</span>
                  {!!n && <span className="flex items-center gap-0.5 text-[10px] text-amber-600"><MessageSquare className="h-2.5 w-2.5" />{n}</span>}
                  {d.additions != null && <span className="font-mono text-[10px] text-emerald-600">+{d.additions}</span>}
                  {d.deletions != null && <span className="font-mono text-[10px] text-red-500">−{d.deletions}</span>}
                </button>
              );
            })}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            {canWrite && (
              <div className="flex shrink-0 items-center gap-3 border-b px-3 py-1.5 text-[11px]">
                <label className="flex items-center gap-1.5" title={t('mr.reviewModeHint')}><Switch checked={reviewMode} onCheckedChange={setReviewMode} className="scale-75" />{t('mr.reviewMode')}</label>
                {pending.length > 0 && (
                  <>
                    <span className="text-amber-600">{t('mr.pending', { count: pending.length })}</span>
                    <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setPending([])}>{t('mr.discard')}</Button>
                    <Button size="sm" className="h-6 text-[11px]" disabled={busy === 'review'} onClick={() => void submitReview()}>
                      {busy === 'review' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}{t('mr.submitReview', { count: pending.length })}
                    </Button>
                  </>
                )}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto">
              {fileObj && (
                <>
                  <div className="sticky top-0 z-10 border-b bg-muted/60 px-3 py-1 font-mono text-[11px] backdrop-blur">{fileObj.newPath}</div>
                  <GitMRDiff
                    file={fileObj}
                    threads={[...inline, ...pending.filter((p) => p.file.newPath === fileObj.newPath).map((p, i): GitMRDiscussion => ({
                      id: `pending-${i}`, resolvable: false, resolved: false,
                      notes: [{ id: -1 - i, body: p.body, author: t('mr.pendingAuthor'), username: 'you', createdAt: new Date().toISOString() }],
                      position: { newPath: p.file.newPath, oldPath: p.file.oldPath, newLine: p.line.newLine ?? null, oldLine: p.line.oldLine ?? null },
                    }))]}
                    canComment={canWrite && opened}
                    onComment={(line, body) => comment(fileObj, line, body)}
                    onReply={(id, b) => act('reply', () => gitAPI.replyMRDiscussion(connId, project, iid, id, b))}
                    onResolve={(id, r) => act('resolve', () => gitAPI.resolveMRDiscussion(connId, project, iid, id, r))}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      )}
      <MergeDialog pr={pr} open={mergeOpen} onOpenChange={setMergeOpen} mr={mr} pipelineStatus={pipe?.status} unresolved={unresolved}
        onMerge={(opts) => act('merge', () => gitAPI.mergeMR(connId, project, iid, { ...opts, sha: mr.sha }), t('mr.mergedToast'))} />
    </div>
  );
}

/** The provider's default merge commit message, to start editing from:
 *  GitLab's "Merge branch 'a' into 'b'" template, or GitHub's. */
function defaultMergeMessage(mr: GitMRDetail, pr?: string): string {
  const title = mr.title.replace(/^Draft:\s*/i, '');
  if (pr) return `Merge pull request #${mr.iid} from ${mr.sourceBranch}\n\n${title}`;
  const path = (() => {
    try { return new URL(mr.webUrl).pathname.split('/-/')[0].replace(/^\/+/, ''); } catch { return ''; }
  })();
  return `Merge branch '${mr.sourceBranch}' into '${mr.targetBranch}'\n\n${title}` + (path ? `\n\nSee merge request ${path}!${mr.iid}` : '');
}

function MergeDialog({ open, onOpenChange, mr, pipelineStatus, unresolved, onMerge, pr }: {
  pr?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mr: GitMRDetail;
  pipelineStatus?: string;
  unresolved: number;
  onMerge: (o: { squash: boolean; removeSourceBranch: boolean; mergeWhenPipelineSucceeds: boolean; squashCommitMessage?: string; mergeCommitMessage?: string }) => Promise<void>;
}) {
  const { t } = useTranslation('git');
  const [squash, setSquash] = useState(false);
  const [remove, setRemove] = useState(true);
  const running = pipelineStatus === 'running' || pipelineStatus === 'pending' || pipelineStatus === 'created';
  const [auto, setAuto] = useState(running);
  const [edit, setEdit] = useState(false);
  // Separate drafts, like GitLab: switching squash on/off keeps each one.
  const [squashMsg, setSquashMsg] = useState(mr.title.replace(/^Draft:\s*/i, ''));
  const [mergeMsg, setMergeMsg] = useState(() => defaultMergeMessage(mr, pr));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setAuto(running);
    setEdit(false);
    setSquashMsg(mr.title.replace(/^Draft:\s*/i, ''));
    setMergeMsg(defaultMergeMessage(mr, pr));
  }, [open, running, mr, pr]);
  const msg = squash ? squashMsg : mergeMsg;
  const setMsg = squash ? setSquashMsg : setMergeMsg;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(edit ? 'sm:max-w-xl' : 'sm:max-w-md')}>
        <DialogHeader>
          <DialogTitle>{t('mr.mergeTitle', { iid: mr.iid, context: pr })}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{mr.sourceBranch} → {mr.targetBranch}</DialogDescription>
        </DialogHeader>
        {(unresolved > 0 || pipelineStatus === 'failed') && (
          <div className="flex items-start gap-2 rounded bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{[unresolved > 0 && t('mr.unresolvedThreads', { count: unresolved }), pipelineStatus === 'failed' && t('mr.pipeline', { status: 'failed' })].filter(Boolean).join(' · ')}</span>
          </div>
        )}
        <div className="min-w-0 space-y-2 text-xs">
          <label className="flex items-center gap-2"><Switch checked={remove} onCheckedChange={setRemove} />{t('mr.removeSource')}</label>
          <label className="flex items-center gap-2"><Switch checked={squash} onCheckedChange={setSquash} />{t('mr.squash')}</label>
          <label className="flex items-center gap-2"><Switch checked={edit} onCheckedChange={setEdit} />{t('mr.editCommitMessage')}</label>
          {edit && (
            <div className="space-y-1">
              <div className="font-medium">{squash ? t('mr.squashCommitMessage') : t('mr.mergeCommitMessage')}</div>
              <Textarea value={msg} onChange={(e) => setMsg(e.target.value)} spellCheck={false}
                className="min-h-[140px] w-full resize-y font-mono text-xs" />
            </div>
          )}
          <label className={cn('flex items-center gap-2', !running && 'opacity-50')}><Switch checked={auto && running} disabled={!running} onCheckedChange={setAuto} />{t('mr.autoMerge')}</label>
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>{t('vcs.cancel')}</Button>
          <Button size="sm" disabled={busy || (edit && !msg.trim())} onClick={async () => {
            setBusy(true);
            await onMerge({
              squash, removeSourceBranch: remove, mergeWhenPipelineSucceeds: auto && running,
              // Without "edit", GitLab / GitHub use their own default message.
              squashCommitMessage: edit && squash ? squashMsg : undefined,
              mergeCommitMessage: edit && !squash ? mergeMsg : undefined,
            });
            setBusy(false);
            onOpenChange(false);
          }}>
            {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}<GitMerge className="mr-1 h-3.5 w-3.5" />{auto && running ? t('mr.mergeWhenGreen') : t('mr.merge')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateMRDialog({ open, onOpenChange, connId, project, source, target, onCreated, provider }: {
  provider?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  connId: string;
  project: string;
  source?: string;
  target?: string;
  onCreated: (iid: number) => void;
}) {
  const { t } = useTranslation('git');
  const [branches, setBranches] = useState<string[]>([]);
  const [src, setSrc] = useState('');
  const [dst, setDst] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [draft, setDraft] = useState(false);
  const [squash, setSquash] = useState(false);
  const [remove, setRemove] = useState(true);
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<GitMember[]>([]);
  const [reviewers, setReviewers] = useState<GitMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setSrc(source ?? ''); setDst(target ?? 'main'); setTitle(''); setDesc(''); setDraft(false); setSquash(false); setRemove(true);
    setReviewers([]); setErr(''); setQuery('');
    gitAPI.branches(connId, { project }).then((r) => setBranches(((r.data as { name: string }[]) ?? []).map((b) => b.name))).catch(() => setBranches([]));
  }, [open, connId, project, source, target]);
  useEffect(() => {
    if (!open || !src || title) return;
    gitAPI.commits(connId, { project, ref: src, page: 1 }).then((r) => {
      const c = (r.data as { commits?: { title: string }[] }).commits?.[0];
      if (c) setTitle((v) => v || c.title);
    }).catch(() => undefined);
  }, [open, src, connId, project, title]);
  useEffect(() => {
    if (!open || query.trim().length < 2) { setMembers([]); return; }
    const h = setTimeout(() => {
      gitAPI.projectMembers(connId, { project, query: query.trim() }).then((r) => setMembers((r.data as GitMember[]) ?? [])).catch(() => setMembers([]));
    }, 250);
    return () => clearTimeout(h);
  }, [open, query, connId, project]);

  const create = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await gitAPI.createMR(connId, project, {
        sourceBranch: src, targetBranch: dst, title, description: desc, draft, squash, removeSourceBranch: remove,
        reviewerIds: reviewers.map((r) => r.id),
      });
      onOpenChange(false);
      onCreated(Number((res.data as { iid: number }).iid));
    } catch (e) {
      setErr(extractErr(e, t('mr.actionFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>{t('mr.createTitle', { context: provider === 'github' ? 'pr' : undefined })}</DialogTitle></DialogHeader>
        <div className="space-y-2 text-xs">
          <datalist id="pm-mr-branches">{branches.map((b) => <option key={b} value={b} />)}</datalist>
          <div className="flex items-center gap-2">
            <Input list="pm-mr-branches" value={src} onChange={(e) => setSrc(e.target.value)} placeholder={t('mr.source')} className="h-8 flex-1 font-mono text-xs" />
            <span className="text-muted-foreground">→</span>
            <Input list="pm-mr-branches" value={dst} onChange={(e) => setDst(e.target.value)} placeholder={t('mr.target')} className="h-8 flex-1 font-mono text-xs" />
          </div>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('mr.titlePlaceholder')} className="h-8 text-xs" />
          <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t('mr.descriptionPlaceholder')} className="min-h-[90px] text-xs" />
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-1">
              <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
              {reviewers.map((r) => (
                <span key={r.id} className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]">{r.name}
                  <button type="button" aria-label={t('mr.removeReviewer')} onClick={() => setReviewers((x) => x.filter((y) => y.id !== r.id))}><X className="h-3 w-3" /></button>
                </span>
              ))}
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('mr.addReviewer')} className="h-7 w-44 text-xs" />
            </div>
            {members.length > 0 && (
              <div className="max-h-32 overflow-auto rounded border">
                {members.filter((m) => !reviewers.some((r) => r.id === m.id)).map((m) => (
                  <button key={m.id} type="button" className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-accent/50"
                    onClick={() => { setReviewers((x) => [...x, m]); setQuery(''); }}>
                    <span>{m.name}</span><span className="text-muted-foreground">@{m.username}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2"><Switch checked={draft} onCheckedChange={setDraft} className="scale-90" />{t('mr.draft')}</label>
            <label className="flex items-center gap-2"><Switch checked={squash} onCheckedChange={setSquash} className="scale-90" />{t('mr.squash')}</label>
            <label className="flex items-center gap-2"><Switch checked={remove} onCheckedChange={setRemove} className="scale-90" />{t('mr.removeSource')}</label>
          </div>
          {err && <p className="text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>{t('vcs.cancel')}</Button>
          <Button size="sm" disabled={busy || !src.trim() || !dst.trim() || !title.trim() || src === dst} onClick={() => void create()}>
            {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}<Check className="mr-1 h-3.5 w-3.5" />{t('mr.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

