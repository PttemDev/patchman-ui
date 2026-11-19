// Branch-popup dialogs (JetBrains parity): Compare with, Show Diff with
// Working Tree, Tracked Branch, Push a branch that is not checked out, and
// New Worktree.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderPlus, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { gitAPI } from '@/services/api';
import { cn } from '@/lib/utils';
import type { GitHistoryOpResult, GitRefs } from '@/types';
import { GitDiffViewer } from './GitDiffViewer';
import { decodeGitContent, extractErr, timeAgo } from './util';
import type { OpOutcome } from './useGitRepoOps';

type Run = <T = GitHistoryOpResult>(
  key: string,
  fn: (accessToken: string) => Promise<{ data: unknown }>,
  opts?: { needsToken?: boolean; success?: string; quietError?: boolean },
) => Promise<OpOutcome<T>>;

interface Commit { sha: string; shortSha: string; title: string; authorName: string; authoredAt: string }

function CommitList({ commits, empty }: { commits: Commit[]; empty: string }) {
  if (!commits.length) return <p className="px-2 py-3 text-xs text-muted-foreground">{empty}</p>;
  return (
    <div className="divide-y">
      {commits.map((c) => (
        <div key={c.sha} className="flex items-center gap-2 px-2 py-1.5 text-xs" title={c.sha}>
          <span className="font-mono text-[10px] text-muted-foreground">{c.shortSha}</span>
          <span className="min-w-0 flex-1 truncate">{c.title}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{c.authorName} · {timeAgo(c.authoredAt)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Compare with ─────────────────────────────────────────────────────────────

export function GitCompareDialog({ repoId, base, refName, onClose }: {
  repoId: string; base: string; refName: string | null; onClose: () => void;
}) {
  const { t } = useTranslation('git');
  const [data, setData] = useState<{ refOnly: Commit[]; baseOnly: Commit[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!refName) return;
    setData(null); setError('');
    gitAPI.compareRefs(repoId, { base, ref: refName })
      .then((r) => setData(r.data as { refOnly: Commit[]; baseOnly: Commit[] }))
      .catch((e) => setError(extractErr(e, t('vcs.failed'))));
  }, [repoId, base, refName, t]);
  return (
    <Dialog open={!!refName} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle className="text-sm">{t('vcs.compareTitle', { ref: refName, base })}</DialogTitle></DialogHeader>
        {error ? <p className="text-xs text-destructive">{error}</p> : !data ? (
          <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-auto md:grid-cols-2">
            <div className="rounded border">
              <div className="border-b bg-muted/30 px-2 py-1 text-[11px] font-medium">{t('vcs.compareOnly', { a: refName, b: base, count: data.refOnly.length })}</div>
              <CommitList commits={data.refOnly} empty={t('vcs.compareNone')} />
            </div>
            <div className="rounded border">
              <div className="border-b bg-muted/30 px-2 py-1 text-[11px] font-medium">{t('vcs.compareOnly', { a: base, b: refName, count: data.baseOnly.length })}</div>
              <CommitList commits={data.baseOnly} empty={t('vcs.compareNone')} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Show Diff with Working Tree ──────────────────────────────────────────────

interface NameStatus { path: string; oldPath?: string; status: string }

export function GitDiffWorkTreeDialog({ repoId, refName, onClose }: { repoId: string; refName: string | null; onClose: () => void }) {
  const { t } = useTranslation('git');
  const [files, setFiles] = useState<NameStatus[] | null>(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<NameStatus | null>(null);
  const [content, setContent] = useState<{ original: string; modified: string } | null>(null);
  useEffect(() => {
    if (!refName) return;
    setFiles(null); setSel(null); setContent(null); setError('');
    gitAPI.diffWorkTree(repoId, refName)
      .then((r) => { const f = ((r.data as { files: NameStatus[] }).files) ?? []; setFiles(f); if (f[0]) setSel(f[0]); })
      .catch((e) => setError(extractErr(e, t('vcs.failed'))));
  }, [repoId, refName, t]);
  useEffect(() => {
    if (!sel || !refName) return;
    setContent(null);
    const read = async (path: string, ref?: string) => {
      const r = await gitAPI.localFile(repoId, ref ? { path, ref } : { path });
      const d = (r.data ?? {}) as { content?: string; encoding?: string };
      return decodeGitContent(d.content, d.encoding);
    };
    Promise.all([
      sel.status === 'A' ? Promise.resolve('') : read(sel.oldPath || sel.path, refName).catch(() => ''),
      sel.status === 'D' ? Promise.resolve('') : read(sel.path).catch(() => ''),
    ]).then(([original, modified]) => setContent({ original, modified }));
  }, [sel, refName, repoId]);
  const color = (s: string) => (s === 'A' ? 'text-emerald-600' : s === 'D' ? 'text-destructive' : s === 'R' ? 'text-violet-600' : 'text-sky-600');
  return (
    <Dialog open={!!refName} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex h-[80vh] max-w-6xl flex-col gap-2 p-3">
        <DialogHeader><DialogTitle className="text-sm">{t('vcs.diffWorkTreeTitle', { ref: refName })}</DialogTitle></DialogHeader>
        {error ? <p className="text-xs text-destructive">{error}</p> : !files ? (
          <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : files.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">{t('vcs.diffWorkTreeSame')}</p>
        ) : (
          <div className="flex min-h-0 flex-1 gap-2">
            <div className="w-64 shrink-0 overflow-auto rounded border">
              {files.map((f) => (
                <button key={f.path} type="button" onClick={() => setSel(f)} title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
                  className={cn('flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs hover:bg-accent/50', sel?.path === f.path && 'bg-accent/60')}>
                  <span className={cn('w-3 shrink-0 font-mono text-[10px] font-semibold', color(f.status))}>{f.status}</span>
                  <span className="truncate">{f.path}</span>
                </button>
              ))}
            </div>
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded border">
              {!content ? <div className="flex flex-1 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                : sel && <GitDiffViewer original={content.original} modified={content.modified} path={sel.path} />}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Tracked branch ───────────────────────────────────────────────────────────

const NONE = '__none__';

export function GitTrackDialog({ repoId, branch, refs, run, onClose }: {
  repoId: string; branch: string | null; refs: GitRefs | null; run: Run; onClose: () => void;
}) {
  const { t } = useTranslation('git');
  const cur = refs?.local.find((b) => b.name === branch)?.upstream ?? '';
  const [value, setValue] = useState(cur || NONE);
  useEffect(() => { setValue(cur || NONE); }, [cur, branch]);
  const remotes = refs?.remote ?? [];
  return (
    <Dialog open={!!branch} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-sm">{t('vcs.trackTitle', { name: branch })}</DialogTitle></DialogHeader>
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={NONE} className="text-xs">{t('vcs.trackNone')}</SelectItem>
            {remotes.map((r) => <SelectItem key={r.name} value={r.name} className="text-xs">{r.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={onClose}>{t('vcs.close')}</Button>
          <Button size="sm" onClick={async () => {
            const up = value === NONE ? '' : value;
            const r = await run('branch', () => gitAPI.setUpstream(repoId, { name: branch!, upstream: up }), {
              needsToken: false, success: up ? t('vcs.trackSet', { name: branch, upstream: up }) : t('vcs.trackUnset', { name: branch }),
            });
            if (r.ok) onClose();
          }}>{t('vcs.trackApply')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Push a branch that is not checked out ────────────────────────────────────

export function GitPushBranchDialog({ repoId, branch, refs, run, onClose }: {
  repoId: string; branch: string | null; refs: GitRefs | null; run: Run; onClose: () => void;
}) {
  const { t } = useTranslation('git');
  const b = refs?.local.find((x) => x.name === branch);
  const remoteNames = useMemo(() => Array.from(new Set((refs?.remote ?? []).map((r) => r.remote ?? '').filter(Boolean))), [refs]);
  const [upRemote, upBranch] = useMemo(() => {
    const u = b?.upstream ?? '';
    const i = u.indexOf('/');
    return i > 0 ? [u.slice(0, i), u.slice(i + 1)] : ['', ''];
  }, [b]);
  const [remote, setRemote] = useState('origin');
  const [target, setTarget] = useState('');
  const [commits, setCommits] = useState<Commit[] | null>(null);
  useEffect(() => {
    if (!branch) return;
    setRemote(upRemote || remoteNames[0] || 'origin');
    setTarget(upBranch || branch);
  }, [branch, upRemote, upBranch, remoteNames]);
  const exists = !!refs?.remote.some((r) => r.name === `${remote}/${target}`);
  useEffect(() => {
    if (!branch || !target) return;
    setCommits(null);
    if (!exists) { setCommits([]); return; }
    gitAPI.compareRefs(repoId, { base: `${remote}/${target}`, ref: branch })
      .then((r) => setCommits((r.data as { refOnly: Commit[] }).refOnly))
      .catch(() => setCommits([]));
  }, [repoId, branch, remote, target, exists]);
  return (
    <Dialog open={!!branch} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle className="text-sm">{t('vcs.pushBranchTitle', { name: branch })}</DialogTitle></DialogHeader>
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono">{branch}</span><span className="text-muted-foreground">→</span>
          <Select value={remote} onValueChange={setRemote}>
            <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{(remoteNames.length ? remoteNames : ['origin']).map((r) => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}</SelectContent>
          </Select>
          <span>:</span>
          <Input value={target} onChange={(e) => setTarget(e.target.value)} className="h-7 flex-1 font-mono text-xs" />
        </div>
        <div className="max-h-64 overflow-auto rounded border">
          {!exists ? <p className="px-2 py-3 text-xs text-muted-foreground">{t('vcs.pushBranchNew', { remote, target })}</p>
            : commits === null ? <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
              : <CommitList commits={commits} empty={t('vcs.pushBranchNothing')} />}
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={onClose}>{t('vcs.close')}</Button>
          <Button size="sm" disabled={!target.trim() || (exists && commits?.length === 0)} onClick={async () => {
            const r = await run('push', (accessToken) => gitAPI.pushTo(repoId, { accessToken, source: branch, remote, targetBranch: target.trim(), setUpstream: !b?.upstream }), {
              success: t('vcs.pushBranchDone', { name: branch, remote, target: target.trim() }),
            });
            if (r.ok) onClose();
          }}>{t('vcs.pushDialog.push')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── New Worktree ─────────────────────────────────────────────────────────────

export interface WorktreeRequest {
  /** Ref the worktree starts from. */
  ref: string;
  /** Local branch that can be checked out there as is (not checked out
   *  anywhere). Otherwise a new branch is created (name required). */
  existingBranch?: string;
  suggestedName: string;
}

export function GitWorktreeDialog({ repoId, req, run, onCreated, onClose }: {
  repoId: string; req: WorktreeRequest | null; run: Run;
  onCreated: (path: string) => void; onClose: () => void;
}) {
  const { t } = useTranslation('git');
  const [path, setPath] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [useExisting, setUseExisting] = useState(true);
  useEffect(() => {
    if (!req) return;
    setUseExisting(!!req.existingBranch);
    setNewBranch(req.existingBranch ? '' : req.suggestedName);
    setPath('');
    gitAPI.localPath(repoId).then((r) => {
      const repoPath = (r.data as { path: string }).path.replace(/\/+$/, '');
      const slug = (req.existingBranch || req.suggestedName || 'worktree').replace(/[^A-Za-z0-9._-]+/g, '-');
      setPath(`${repoPath}-${slug}`);
    }).catch(() => {});
  }, [req, repoId]);
  const creatingBranch = !req?.existingBranch || !useExisting;
  return (
    <Dialog open={!!req} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle className="text-sm">{t('vcs.worktreeTitle', { ref: req?.ref })}</DialogTitle></DialogHeader>
        <label className="text-xs font-medium">{t('vcs.worktreePath')}</label>
        <Input value={path} onChange={(e) => setPath(e.target.value)} className="h-8 font-mono text-xs" />
        {req?.existingBranch && (
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={useExisting} onCheckedChange={(v) => { setUseExisting(v); if (!v && !newBranch) setNewBranch(`${req.existingBranch}-wt`); }} className="scale-90" />
            {t('vcs.worktreeUseExisting', { name: req.existingBranch })}
          </label>
        )}
        {creatingBranch && (
          <>
            <label className="text-xs font-medium">{t('vcs.worktreeNewBranch')}</label>
            <Input value={newBranch} onChange={(e) => setNewBranch(e.target.value)} className="h-8 font-mono text-xs" placeholder="feature/…" />
          </>
        )}
        <p className="text-[11px] text-muted-foreground">{t('vcs.worktreeHint')}</p>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={onClose}>{t('vcs.close')}</Button>
          <Button size="sm" disabled={!path.trim() || (creatingBranch && !newBranch.trim())} onClick={async () => {
            const body = creatingBranch
              ? { path: path.trim(), ref: req!.ref, newBranch: newBranch.trim() }
              : { path: path.trim(), ref: req!.existingBranch! };
            const r = await run<{ path: string }>('worktree', () => gitAPI.addWorktree(repoId, body), { needsToken: false, success: t('vcs.worktreeCreated') });
            if (r.ok) { onClose(); onCreated(r.data.path || body.path); }
          }}>
            <FolderPlus className="mr-1 h-3.5 w-3.5" />{t('vcs.worktreeCreate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
