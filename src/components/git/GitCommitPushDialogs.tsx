import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, ArrowRight, Check, ChevronDown, ExternalLink, GitBranch, GitCommitHorizontal, History, Loader2, Minus, UploadCloud,
} from 'lucide-react';
import { gitAPI } from '@/services/api';
import { gitOpsToken, useGitConnectionStore } from '@/stores/gitConnectionStore';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import { confirmDialog } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import type { GitCommit, GitRefs, GitRemote, GitStatus } from '@/types';
import { GitDiffViewer } from './GitDiffViewer';
import { decodeGitContent, extractErr, timeAgo } from './util';
import { GIT_KEYMAP, shortcutHint } from '@/lib/keymap';

// JetBrains-style Commit and Push dialogs (GIT_IDE_PLAN §A, §D).

type Kind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
/** all = commit the whole file; staged = only what is already staged (partial); none = leave it out. */
type Pick = 'all' | 'staged' | 'none';

interface ChangeRow {
  path: string;
  oldPath?: string;
  kind: Kind;
  inIndex: boolean;
  inWorktree: boolean;
}

const KIND_TONE: Record<Kind, string> = {
  modified: 'text-sky-600 dark:text-sky-400',
  added: 'text-emerald-600 dark:text-emerald-400',
  untracked: 'text-red-500/90 dark:text-red-400/90',
  deleted: 'text-muted-foreground line-through',
  renamed: 'text-sky-600 dark:text-sky-400',
};
const KIND_LETTER: Record<Kind, string> = { modified: 'M', added: 'A', untracked: 'U', deleted: 'D', renamed: 'R' };

function rowsFromStatus(st: GitStatus): ChangeRow[] {
  const by = new Map<string, ChangeRow>();
  const put = (path: string, patch: Partial<ChangeRow>, kind: Kind) => {
    const cur = by.get(path) ?? { path, kind, inIndex: false, inWorktree: false };
    by.set(path, { ...cur, ...patch, kind: cur.kind === 'modified' && kind !== 'modified' ? kind : cur.kind });
  };
  for (const e of st.staged) put(e.path, { inIndex: true, oldPath: e.oldPath }, e.status === 'untracked' ? 'added' : e.status);
  for (const e of st.unstaged) put(e.path, { inWorktree: true }, e.status === 'untracked' ? 'untracked' : e.status);
  for (const p of st.untracked) put(p, { inWorktree: true }, 'untracked');
  return [...by.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function initialPick(r: ChangeRow): Pick {
  if (r.kind === 'untracked') return 'none';
  if (r.inIndex && r.inWorktree) return 'staged';
  return 'all';
}

function splitPath(p: string) {
  const i = p.lastIndexOf('/');
  return i < 0 ? { name: p, dir: '' } : { name: p.slice(i + 1), dir: p.slice(0, i) };
}

async function readAt(repoId: string, path: string, ref?: string): Promise<string> {
  try {
    const res = await gitAPI.localFile(repoId, ref ? { path, ref } : { path });
    const d = (res.data ?? {}) as { content?: string; encoding?: string };
    return decodeGitContent(d.content, d.encoding);
  } catch {
    return '';
  }
}

function TriCheck({ value, onClick, label }: { value: Pick; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={value === 'all' ? true : value === 'none' ? false : 'mixed'}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border',
        value === 'none' ? 'border-muted-foreground/50' : 'border-primary bg-primary text-primary-foreground',
      )}
    >
      {value === 'all' && <Check className="h-2.5 w-2.5" />}
      {value === 'staged' && <Minus className="h-2.5 w-2.5" />}
    </button>
  );
}

// ── Commit ───────────────────────────────────────────────────────────────────

export function GitCommitDialog({ open, onOpenChange, repoId, branch, onCommitted }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  repoId: string;
  branch: string;
  /** push=true: "Commit and Push…" was used. */
  onCommitted: (push: boolean) => void;
}) {
  const { t } = useTranslation('git');
  const { toast } = useToast();
  const [rows, setRows] = useState<ChangeRow[] | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [sel, setSel] = useState<ChangeRow | null>(null);
  const [diff, setDiff] = useState<{ original: string; modified: string } | null>(null);
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [recent, setRecent] = useState<GitCommit[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setRows(null); setSel(null); setDiff(null); setErr(''); setAmend(false); setBusy(false);
    gitAPI.status(repoId).then((res) => {
      const r = rowsFromStatus(res.data as GitStatus);
      setRows(r);
      setPicks(Object.fromEntries(r.map((x) => [x.path, initialPick(x)])));
      setSel(r.find((x) => x.kind !== 'untracked') ?? r[0] ?? null);
    }).catch((e) => setErr(extractErr(e, t('errors.requestFailed'))));
    gitAPI.log(repoId, { limit: 20 }).then((res) => setRecent((res.data as GitCommit[]) ?? [])).catch(() => setRecent([]));
  }, [open, repoId, t]);

  useEffect(() => {
    if (!sel) { setDiff(null); return; }
    let cancelled = false;
    setDiff(null);
    const head = sel.kind === 'added' || sel.kind === 'untracked' ? Promise.resolve('') : readAt(repoId, sel.oldPath ?? sel.path, 'HEAD');
    const work = sel.kind === 'deleted' ? Promise.resolve('') : readAt(repoId, sel.path);
    Promise.all([head, work]).then(([original, modified]) => { if (!cancelled) setDiff({ original, modified }); });
    return () => { cancelled = true; };
  }, [sel, repoId]);

  const toggle = (r: ChangeRow) => setPicks((p) => {
    const cur = p[r.path] ?? 'none';
    const next: Pick = cur === 'none' ? 'all' : 'none';
    return { ...p, [r.path]: next };
  });
  const tracked = (rows ?? []).filter((r) => r.kind !== 'untracked');
  const unversioned = (rows ?? []).filter((r) => r.kind === 'untracked');
  const groupPick = (list: ChangeRow[]): Pick => {
    const v = list.map((r) => picks[r.path] ?? 'none');
    if (v.length && v.every((x) => x === 'all')) return 'all';
    if (v.every((x) => x === 'none')) return 'none';
    return 'staged';
  };
  const setGroup = (list: ChangeRow[], to: Pick) => setPicks((p) => ({ ...p, ...Object.fromEntries(list.map((r) => [r.path, to])) }));
  const chosen = (rows ?? []).filter((r) => (picks[r.path] ?? 'none') !== 'none');

  const onAmend = async (v: boolean) => {
    setAmend(v);
    if (v && !message.trim() && recent[0]) setMessage(recent[0].message || recent[0].title);
  };

  const commit = useCallback(async (push: boolean) => {
    if (!rows) return;
    if (!message.trim() && !amend) { setErr(t('commit.enterMessage')); return; }
    setBusy(true);
    setErr('');
    try {
      // Make the index match the picks, then commit it.
      for (const r of rows) {
        const p = picks[r.path] ?? 'none';
        if (p === 'all' && r.inWorktree) await gitAPI.stage(repoId, { path: r.path });
        if (p === 'none' && r.inIndex) {
          await gitAPI.unstage(repoId, { path: r.path });
          if (r.oldPath) await gitAPI.unstage(repoId, { path: r.oldPath }).catch(() => undefined);
        }
      }
      await gitAPI.localCommit(repoId, { message: message.trim(), amend });
      toast({ title: t('vcs.commitDialog.committed', { count: chosen.length }) });
      setMessage('');
      onOpenChange(false);
      onCommitted(push);
    } catch (e) {
      setErr(extractErr(e, t('errors.commit')));
    } finally {
      setBusy(false);
    }
  }, [rows, picks, message, amend, repoId, chosen.length, onOpenChange, onCommitted, toast, t]);

  const canCommit = !busy && (chosen.length > 0 || amend) && (!!message.trim() || amend);

  const fileRow = (r: ChangeRow) => {
    const { name, dir } = splitPath(r.path);
    return (
      <div
        key={r.path}
        role="option"
        aria-selected={sel?.path === r.path}
        onClick={() => setSel(r)}
        className={cn('flex cursor-default items-center gap-2 px-3 py-1 text-xs', sel?.path === r.path ? 'bg-accent' : 'hover:bg-accent/40')}
      >
        <TriCheck value={picks[r.path] ?? 'none'} onClick={() => toggle(r)} label={r.path} />
        <span className={cn('w-3 shrink-0 text-center font-mono text-[10px] font-semibold', KIND_TONE[r.kind])}>{KIND_LETTER[r.kind]}</span>
        <span className={cn('truncate', KIND_TONE[r.kind])}>{name}</span>
        {dir && <span className="truncate text-[10px] text-muted-foreground">{dir}</span>}
        {picks[r.path] === 'staged' && <span className="ml-auto shrink-0 text-[9px] text-muted-foreground">{t('vcs.commitDialog.partial')}</span>}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="flex h-[82vh] max-h-[760px] w-[92vw] max-w-[1180px] flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <GitCommitHorizontal className="h-4 w-4" />
            {t('vcs.commitDialog.title')}
            <span className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
              <GitBranch className="h-3 w-3" />{branch}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[340px] shrink-0 flex-col border-r">
            <div className="flex-1 overflow-auto py-1" role="listbox">
              {!rows ? (
                <div className="flex justify-center py-10"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
              ) : rows.length === 0 ? (
                <p className="px-3 py-10 text-center text-xs text-muted-foreground">{t('vcs.commitDialog.noChanges')}</p>
              ) : (
                <>
                  {tracked.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <TriCheck value={groupPick(tracked)} onClick={() => setGroup(tracked, groupPick(tracked) === 'all' ? 'none' : 'all')} label={t('vcs.commitDialog.changes')} />
                        {t('vcs.commitDialog.changes')} <span className="font-normal normal-case">{tracked.length}</span>
                      </div>
                      {tracked.map(fileRow)}
                    </>
                  )}
                  {unversioned.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 px-3 pb-0.5 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <TriCheck value={groupPick(unversioned)} onClick={() => setGroup(unversioned, groupPick(unversioned) === 'all' ? 'none' : 'all')} label={t('vcs.commitDialog.unversioned')} />
                        {t('vcs.commitDialog.unversioned')} <span className="font-normal normal-case">{unversioned.length}</span>
                      </div>
                      {unversioned.map(fileRow)}
                    </>
                  )}
                </>
              )}
            </div>
            <div className="shrink-0 space-y-2 border-t p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium">{t('vcs.commitDialog.message')}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px]" disabled={recent.length === 0} title={t('vcs.commitDialog.recent')}>
                      <History className="h-3 w-3" /><ChevronDown className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-w-[420px]">
                    {recent.slice(0, 12).map((c) => (
                      <DropdownMenuItem key={c.sha} className="text-xs" onClick={() => setMessage(c.message || c.title)}>
                        <span className="truncate">{c.title}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Textarea
                autoFocus
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canCommit) { e.preventDefault(); void commit(false); } }}
                placeholder={t('commit.messagePlaceholder')}
                className="min-h-[96px] resize-none font-mono text-xs"
                spellCheck={false}
              />
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Switch checked={amend} onCheckedChange={(v) => void onAmend(v)} className="scale-90" />
                {t('commit.amend')}
              </label>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            {sel && diff ? (
              <GitDiffViewer original={diff.original} modified={diff.modified} path={sel.path} />
            ) : sel ? (
              <div className="flex flex-1 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">{t('changes.selectFile')}</div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t px-4 py-2.5">
          {err ? (
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-destructive"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /><span className="truncate" title={err}>{err}</span></span>
          ) : (
            <span className="text-[11px] text-muted-foreground">{t('vcs.commitDialog.selected', { count: chosen.length })}</span>
          )}
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>{t('vcs.cancel')}</Button>
          <Button size="sm" variant="outline" disabled={!canCommit} onClick={() => void commit(true)}>
            {t('commit.commitAndPush')}
          </Button>
          <Button size="sm" disabled={!canCommit} onClick={() => void commit(false)} title={`⌘↵`}>
            {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {amend ? t('vcs.commitDialog.amendCommit') : t('commit.commit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Push ─────────────────────────────────────────────────────────────────────

interface CommitFile { path: string; oldPath?: string; status: string; additions: number; deletions: number; binary?: boolean }

export function GitPushDialog({ open, onOpenChange, repoId, connectionId, branch, defaultBranch, onPushed, onUpdate }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  repoId: string;
  connectionId?: string;
  branch: string;
  defaultBranch?: string;
  onPushed: () => void;
  /** Push was rejected: offer Update Project. */
  onUpdate: () => void;
}) {
  const { t } = useTranslation('git');
  const { toast } = useToast();
  // GitHub: opening a pull request on push comes with the PR phase.
  const pushToGitHub = useGitConnectionStore((st) => st.connections.find((c) => c.id === connectionId)?.provider === 'github');
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [refs, setRefs] = useState<GitRefs | null>(null);
  const [remote, setRemote] = useState('origin');
  const [target, setTarget] = useState(branch);
  const [commits, setCommits] = useState<GitCommit[] | null>(null);
  const [remoteExists, setRemoteExists] = useState(true);
  const [upstream, setUpstream] = useState('');
  const [selCommit, setSelCommit] = useState<GitCommit | null>(null);
  const [files, setFiles] = useState<CommitFile[] | null>(null);
  const [selFile, setSelFile] = useState<CommitFile | null>(null);
  const [diff, setDiff] = useState<{ original: string; modified: string } | null>(null);
  const [tags, setTags] = useState(false);
  const [force, setForce] = useState(false);
  const [setUp, setSetUp] = useState(false);
  const [openMr, setOpenMr] = useState(false);
  const [mrTitle, setMrTitle] = useState('');
  const [mrTarget, setMrTarget] = useState(defaultBranch ?? 'main');
  const [mrDesc, setMrDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; rejected?: boolean } | null>(null);
  const [mrUrl, setMrUrl] = useState('');

  useEffect(() => {
    if (!open) return;
    setRemote('origin'); setTarget(branch); setTags(false); setForce(false); setOpenMr(false); setErr(null); setMrUrl(''); setBusy(false);
    setMrTarget(defaultBranch ?? 'main'); setMrDesc('');
    gitAPI.remotes(repoId).then((r) => setRemotes((r.data as GitRemote[]) ?? [])).catch(() => setRemotes([]));
    gitAPI.refs(repoId).then((r) => setRefs(r.data as GitRefs)).catch(() => setRefs(null));
  }, [open, repoId, branch, defaultBranch]);

  const loadOutgoing = useCallback(async () => {
    if (!open || !target.trim()) return;
    setCommits(null); setSelCommit(null);
    try {
      const res = await gitAPI.outgoing(repoId, { remote, branch: target.trim() });
      const d = res.data as { commits: GitCommit[]; remoteExists: boolean; upstream: string };
      setCommits(d.commits);
      setRemoteExists(d.remoteExists);
      setUpstream(d.upstream);
      setSetUp(!d.upstream);
      setSelCommit(d.commits[0] ?? null);
      // GitLab's default: the commit title for one commit, else the branch.
      setMrTitle(d.commits.length === 1 ? d.commits[0].title : target.trim().replace(/^.*\//, '').replace(/[-_]+/g, ' '));
    } catch (e) {
      setCommits([]);
      setErr({ text: extractErr(e, t('errors.requestFailed')) });
    }
  }, [open, repoId, remote, target, t]);
  useEffect(() => {
    const h = setTimeout(() => void loadOutgoing(), 250);
    return () => clearTimeout(h);
  }, [loadOutgoing]);

  useEffect(() => {
    if (!selCommit) { setFiles(null); setSelFile(null); return; }
    let cancelled = false;
    setFiles(null); setSelFile(null);
    gitAPI.commitFiles(repoId, selCommit.sha).then((res) => {
      if (cancelled) return;
      const f = (res.data as CommitFile[]) ?? [];
      setFiles(f);
      setSelFile(f[0] ?? null);
    }).catch(() => { if (!cancelled) setFiles([]); });
    return () => { cancelled = true; };
  }, [selCommit, repoId]);

  useEffect(() => {
    if (!selCommit || !selFile) { setDiff(null); return; }
    let cancelled = false;
    setDiff(null);
    const parent = selCommit.parents?.[0];
    const before = selFile.status === 'added' || !parent ? Promise.resolve('') : readAt(repoId, selFile.oldPath ?? selFile.path, parent);
    const after = selFile.status === 'deleted' ? Promise.resolve('') : readAt(repoId, selFile.path, selCommit.sha);
    Promise.all([before, after]).then(([original, modified]) => { if (!cancelled) setDiff({ original, modified }); });
    return () => { cancelled = true; };
  }, [selCommit, selFile, repoId]);

  const remoteBranches = useMemo(
    () => (refs?.remote ?? []).filter((b) => b.remote === remote).map((b) => b.name.slice(remote.length + 1)),
    [refs, remote],
  );

  const push = async () => {
    if (force) {
      const ok = await confirmDialog({
        title: t('vcs.pushDialog.forceTitle', { branch: `${remote}/${target}` }),
        description: t('vcs.pushDialog.forceBody'),
        destructive: true,
        confirmLabel: t('vcs.pushDialog.forcePush'),
      });
      if (!ok) return;
    }
    setBusy(true);
    setErr(null);
    try {
      let accessToken = '';
      try { accessToken = await gitOpsToken(connectionId); } catch { /* origin may be public */ }
      const res = await gitAPI.pushTo(repoId, {
        accessToken, remote, targetBranch: target.trim(), setUpstream: setUp, tags,
        openMr: openMr && !!connectionId, mrTarget, mrTitle, mrDescription: mrDesc,
      }, force);
      const d = res.data as { mrUrl?: string; mrError?: string };
      toast({ title: t('vcs.pushDialog.pushed', { count: commits?.length ?? 0, target: `${remote}/${target}` }), description: d.mrError });
      onPushed();
      if (d.mrUrl) setMrUrl(d.mrUrl);
      else onOpenChange(false);
    } catch (e) {
      const body = (e as { response?: { data?: { rejected?: boolean } } })?.response?.data;
      setErr({ text: extractErr(e, t('errors.push')), rejected: !!body?.rejected });
    } finally {
      setBusy(false);
    }
  };

  const STATUS_TONE: Record<string, string> = { added: 'text-emerald-600 dark:text-emerald-400', deleted: 'text-muted-foreground line-through', renamed: 'text-sky-600 dark:text-sky-400', modified: 'text-sky-600 dark:text-sky-400' };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="flex h-[82vh] max-h-[760px] w-[92vw] max-w-[1180px] flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <UploadCloud className="h-4 w-4" /> {t('vcs.pushDialog.title')}
            <span className="text-[11px] font-normal text-muted-foreground">{shortcutHint(GIT_KEYMAP, 'git.push')}</span>
          </DialogTitle>
        </DialogHeader>
        {mrUrl ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm">
            <Check className="h-8 w-8 text-emerald-500" />
            <p>{t('vcs.pushDialog.mrOpened')}</p>
            <a href={mrUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-primary underline">
              {mrUrl} <ExternalLink className="h-3 w-3" />
            </a>
            <Button size="sm" onClick={() => onOpenChange(false)}>{t('vcs.close')}</Button>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
              <span className="flex items-center gap-1 rounded border bg-muted/40 px-2 py-1 font-mono"><GitBranch className="h-3 w-3" />{branch}</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <Select value={remote} onValueChange={setRemote}>
                <SelectTrigger className="h-7 w-[130px] font-mono text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(remotes.length ? remotes.map((r) => r.name) : ['origin']).map((n) => <SelectItem key={n} value={n} className="font-mono text-xs">{n}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">:</span>
              <datalist id="pm-push-targets">{remoteBranches.map((b) => <option key={b} value={b} />)}</datalist>
              <Input list="pm-push-targets" value={target} onChange={(e) => setTarget(e.target.value)} className="h-7 w-[240px] font-mono text-xs" />
              {!remoteExists && <span className="rounded-full border border-emerald-500/40 px-1.5 py-px text-[10px] text-emerald-600 dark:text-emerald-400">{t('vcs.pushDialog.newBranch')}</span>}
              {upstream && <span className="text-[11px] text-muted-foreground">{t('vcs.pushDialog.tracking', { upstream })}</span>}
            </div>
            <div className="flex min-h-0 flex-1">
              <div className="flex w-[320px] shrink-0 flex-col border-r">
                <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('vcs.pushDialog.commits', { count: commits?.length ?? 0 })}
                </div>
                <div className="flex-1 overflow-auto">
                  {!commits ? (
                    <div className="flex justify-center py-10"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                  ) : commits.length === 0 ? (
                    <p className="px-3 py-10 text-center text-xs text-muted-foreground">{t('vcs.pushDialog.nothing')}</p>
                  ) : commits.map((c) => (
                    <button key={c.sha} type="button" onClick={() => setSelCommit(c)}
                      className={cn('flex w-full flex-col gap-0.5 px-3 py-1.5 text-left', selCommit?.sha === c.sha ? 'bg-accent' : 'hover:bg-accent/40')}>
                      <span className="truncate text-xs">{c.title}</span>
                      <span className="flex gap-2 text-[10px] text-muted-foreground">
                        <span className="font-mono">{c.shortSha}</span><span className="truncate">{c.authorName}</span><span className="ml-auto shrink-0">{timeAgo(c.authoredAt)}</span>
                      </span>
                    </button>
                  ))}
                </div>
                {files && files.length > 0 && (
                  <div className="max-h-[38%] shrink-0 overflow-auto border-t py-1">
                    {files.map((f) => {
                      const { name, dir } = splitPath(f.path);
                      return (
                        <button key={f.path} type="button" onClick={() => setSelFile(f)}
                          className={cn('flex w-full items-center gap-2 px-3 py-0.5 text-left text-xs', selFile?.path === f.path ? 'bg-accent' : 'hover:bg-accent/40')}>
                          <span className={cn('truncate', STATUS_TONE[f.status])}>{name}</span>
                          {dir && <span className="truncate text-[10px] text-muted-foreground">{dir}</span>}
                          <span className="ml-auto shrink-0 font-mono text-[10px]">
                            {f.binary ? 'bin' : <><span className="text-emerald-600 dark:text-emerald-400">+{f.additions}</span> <span className="text-red-500">−{f.deletions}</span></>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                {selFile && diff ? (
                  <GitDiffViewer original={diff.original} modified={diff.modified} path={selFile.path} />
                ) : selFile ? (
                  <div className="flex flex-1 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                ) : selCommit ? (
                  <pre className="flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-xs text-muted-foreground">{selCommit.message}</pre>
                ) : null}
              </div>
            </div>
            <div className="shrink-0 space-y-2 border-t px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                <label className="flex items-center gap-2"><Switch checked={setUp} onCheckedChange={setSetUp} className="scale-90" />{t('vcs.pushDialog.setUpstream')}</label>
                <label className="flex items-center gap-2"><Switch checked={tags} onCheckedChange={setTags} className="scale-90" />{t('vcs.pushDialog.tags')}</label>
                <label className={cn('flex items-center gap-2', force && 'text-amber-600 dark:text-amber-400')}>
                  <Switch checked={force} onCheckedChange={setForce} className="scale-90" />{t('vcs.pushDialog.force')}
                </label>
                {/* A folder opened from disk with no git connection has no
                    GitLab project to open a merge request on. */}
                {connectionId && (
                  <label className={cn('flex items-center gap-2', remote !== 'origin' && 'opacity-50')}>
                    <Switch checked={openMr && remote === 'origin'} disabled={remote !== 'origin'} onCheckedChange={setOpenMr} className="scale-90" />{t('vcs.pushDialog.openMr', { context: pushToGitHub ? 'pr' : undefined })}
                  </label>
                )}
              </div>
              {openMr && remote === 'origin' && !!connectionId && (
                <div className="grid grid-cols-[1fr_200px] gap-2">
                  <Input value={mrTitle} onChange={(e) => setMrTitle(e.target.value)} placeholder={t('vcs.pushDialog.mrTitle')} className="h-8 text-xs" />
                  <Input value={mrTarget} onChange={(e) => setMrTarget(e.target.value)} placeholder={t('vcs.pushDialog.mrTarget')} className="h-8 font-mono text-xs" />
                  <Textarea value={mrDesc} onChange={(e) => setMrDesc(e.target.value)} placeholder={t('vcs.pushDialog.mrDescription')} className="col-span-2 min-h-[52px] text-xs" />
                </div>
              )}
              <div className="flex items-center gap-2">
                {err && (
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" /><span className="truncate" title={err.text}>{err.rejected ? t('vcs.pushDialog.rejected') : err.text}</span>
                    {err.rejected && <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => { onOpenChange(false); onUpdate(); }}>{t('vcs.update.title')}</Button>}
                  </span>
                )}
                <div className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>{t('vcs.cancel')}</Button>
                <Button size="sm" variant={force ? 'destructive' : 'default'} disabled={busy || !target.trim() || !commits || (commits.length === 0 && !force && !tags)} onClick={() => void push()}>
                  {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  {force ? t('vcs.pushDialog.forcePush') : t('vcs.pushDialog.push')}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
