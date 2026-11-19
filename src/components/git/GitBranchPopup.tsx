import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronRight, CloudDownload, Eye, FileDiff, FolderPlus, GitBranch, GitCommitHorizontal,
  GitCompare, GitMerge, GitPullRequestArrow, Link2, Loader2, Pencil, Plus, Search, Server, Star, Tag, Trash2, UploadCloud, RefreshCw,
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useRequestStore } from '@/stores/requestStore';
import { GitCompareDialog, GitDiffWorkTreeDialog, GitPushBranchDialog, GitTrackDialog, GitWorktreeDialog, type WorktreeRequest } from './GitBranchDialogs';
import { openGitFolder } from './GitFolderMenu';
import { extractErr } from './util';
import { gitAPI } from '@/services/api';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { confirmDialog } from '@/components/ui/confirm';
import { GIT_KEYMAP, shortcutHint } from '@/lib/keymap';
import { cn } from '@/lib/utils';
import type { GitHistoryOpResult, GitOpState, GitRefBranch, GitRefs } from '@/types';
import type { NamePromptState } from './GitVcsDialogs';
import type { OpOutcome, GitLocalRepoRef } from './useGitRepoOps';

type Run = <T = GitHistoryOpResult>(
  key: string,
  fn: (accessToken: string) => Promise<{ data: unknown }>,
  opts?: { needsToken?: boolean; success?: string; quietError?: boolean },
) => Promise<OpOutcome<T>>;

interface Props {
  repo: GitLocalRepoRef;
  refs: GitRefs | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  run: Run;
  busy: string;
  onShowRef: (ref: string) => void;
  onCheckedOut: (branch: string) => void;
  onUpdate: () => void;
  onCommit: () => void;
  onPush: () => void;
  onRemotes: () => void;
  onPrompt: (p: NamePromptState) => void;
}

// JetBrains-style branch popup: actions on top, then Recent / Local / Remote
// (grouped by remote) / Tags. A branch row expands into its own action list.
export function GitBranchPopup(p: Props) {
  const { t } = useTranslation('git');
  const { repo, refs, run } = p;
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string>(''); // "local:x" | "remote:origin/x" | "tag:v1"
  const [showTags, setShowTags] = useState(false);
  const { toast } = useToast();
  // Dialogs opened from a branch row (they outlive the popup).
  const [compareRef, setCompareRef] = useState<string | null>(null);
  const [diffRef, setDiffRef] = useState<string | null>(null);
  const [trackBranch, setTrackBranch] = useState<string | null>(null);
  const [pushBranch, setPushBranch] = useState<string | null>(null);
  const [worktree, setWorktree] = useState<WorktreeRequest | null>(null);
  const current = refs?.current ?? '';
  const st = refs?.state;
  const label = current || (st?.detached ? t('vcs.detached', { head: st.head }) : t('branchPicker.placeholder'));

  const q = query.trim().toLowerCase();
  const filt = (l: GitRefBranch[]) => (q ? l.filter((b) => b.name.toLowerCase().includes(q)) : l);
  const local = useMemo(() => filt(refs?.local ?? []), [refs, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const remoteGroups = useMemo(() => {
    const g: Record<string, GitRefBranch[]> = {};
    for (const b of filt(refs?.remote ?? [])) (g[b.remote ?? ''] ??= []).push(b);
    return g;
  }, [refs, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const tags = useMemo(() => filt(refs?.tags ?? []), [refs, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const recent = useMemo(
    () => (q ? [] : (refs?.recent ?? []).map((n) => refs?.local.find((b) => b.name === n)).filter(Boolean) as GitRefBranch[]),
    [refs, q],
  );

  const close = () => { p.onOpenChange(false); setExpanded(''); setQuery(''); };

  // ── actions ──
  const checkout = async (ref: string) => {
    close();
    const r = await run('checkout', (accessToken) => gitAPI.checkout(repo.id, { accessToken, ref }), { quietError: true });
    if (r.ok) { p.onCheckedOut(((r.data as GitHistoryOpResult).state as GitOpState | undefined)?.branch || ref); return; }
    if (r.body.localChanges) {
      const ok = await confirmDialog({ title: t('vcs.smartTitle'), description: t('vcs.smartBody'), confirmLabel: t('vcs.smartCheckout') });
      if (!ok) return;
      const r2 = await run('checkout', (accessToken) => gitAPI.checkout(repo.id, { accessToken, ref, smart: true }));
      if (r2.ok) p.onCheckedOut(((r2.data as GitHistoryOpResult).state as GitOpState | undefined)?.branch || ref);
      return;
    }
    await confirmDialog({ title: t('vcs.failed'), description: r.error, confirmLabel: t('vcs.close') });
  };

  const newBranch = (from: string) => {
    close();
    p.onPrompt({
      title: t('vcs.newBranchTitle', { from }),
      label: t('vcs.branchName'),
      placeholder: 'feature/…',
      checkoutToggle: true,
      submitLabel: t('vcs.create'),
      onSubmit: async (name, co) => {
        const r = co
          ? await run('checkout', (accessToken) => gitAPI.checkout(repo.id, { accessToken, ref: from, newBranch: name }))
          : await run('branch', () => gitAPI.createBranch(repo.id, { name, startPoint: from }), { needsToken: false, success: t('vcs.created', { name }) });
        if (r.ok && co) p.onCheckedOut(name);
        return r.ok;
      },
    });
  };

  const checkoutRevision = () => {
    close();
    p.onPrompt({
      title: t('vcs.checkoutRevisionTitle'),
      label: t('vcs.checkoutRevisionLabel'),
      placeholder: 'v1.2.0 / a1b2c3d',
      submitLabel: t('vcs.checkout'),
      onSubmit: async (ref) => { await checkout(ref); return true; },
    });
  };

  const rename = (name: string) => {
    close();
    p.onPrompt({
      title: t('vcs.renameTitle', { name }),
      label: t('vcs.branchName'),
      initial: name,
      submitLabel: t('vcs.rename'),
      onSubmit: async (newName) => {
        const r = await run('branch', () => gitAPI.renameBranch(repo.id, { name, newName }), { needsToken: false });
        if (r.ok && name === current) p.onCheckedOut(newName);
        return r.ok;
      },
    });
  };

  const remove = async (name: string) => {
    close();
    const ok = await confirmDialog({ title: t('vcs.deleteTitle', { name }), description: t('vcs.deleteBody'), destructive: true });
    if (!ok) return;
    const r = await run('branch', () => gitAPI.deleteBranch(repo.id, { name }), { needsToken: false, quietError: true, success: t('vcs.deleted', { name }) });
    if (r.ok) return;
    if (r.body.notMerged) {
      const force = await confirmDialog({ title: t('vcs.forceDeleteTitle', { name }), description: t('vcs.forceDeleteBody'), destructive: true, confirmLabel: t('vcs.forceDelete') });
      if (force) await run('branch', () => gitAPI.deleteBranch(repo.id, { name }, true), { needsToken: false, success: t('vcs.deleted', { name }) });
      return;
    }
    await confirmDialog({ title: t('vcs.failed'), description: r.error, confirmLabel: t('vcs.close') });
  };

  const merge = async (ref: string) => {
    close();
    await run('merge', (accessToken) => gitAPI.merge(repo.id, { accessToken, ref }), { success: t('vcs.merged', { ref, into: current }) });
  };
  const rebase = async (onto: string) => {
    close();
    await run('rebase', (accessToken) => gitAPI.rebase(repo.id, { accessToken, onto }), { success: t('vcs.rebased', { branch: current, onto }) });
  };
  // Checkout <branch>, then rebase it onto the current branch. A remote branch
  // gets its local tracking branch first (as JetBrains does).
  const checkoutAndRebase = async (b: GitRefBranch, kind: 'local' | 'remote') => {
    close();
    const onto = current;
    let name = b.name;
    if (kind === 'remote') {
      name = b.name.slice((b.remote?.length ?? 0) + 1);
      if (!refs?.local.some((l) => l.name === name)) {
        const c = await run('branch', () => gitAPI.createBranch(repo.id, { name, startPoint: b.name }), { needsToken: false });
        if (!c.ok) return;
      }
    }
    const r = await run('rebase', (accessToken) => gitAPI.rebase(repo.id, { accessToken, onto, branch: name }), {
      success: t('vcs.rebased', { branch: name, onto }),
    });
    if (r.ok) p.onCheckedOut(name);
  };
  // Checkout, then Update Project on it.
  const checkoutAndUpdate = async (name: string) => {
    await checkout(name);
    p.onUpdate();
  };
  // Fast-forward a branch that is not checked out from its upstream.
  const updateBranch = async (name: string) => {
    close();
    const r = await run<{ updated: boolean }>('fetch', (accessToken) => gitAPI.updateBranch(repo.id, { accessToken, name }), { quietError: true });
    if (r.ok) { toast({ title: r.data.updated ? t('vcs.branchUpdated', { name }) : t('vcs.branchUpToDate', { name }) }); return; }
    const desc = r.body.diverged ? t('vcs.branchDiverged', { name }) : r.body.noUpstream ? t('vcs.branchNoUpstream', { name }) : r.error;
    await confirmDialog({ title: t('vcs.failed'), description: desc, confirmLabel: t('vcs.close') });
  };
  const deleteRemote = async (b: GitRefBranch) => {
    close();
    const remote = b.remote ?? 'origin';
    const branch = b.name.slice(remote.length + 1);
    const ok = await confirmDialog({ title: t('vcs.deleteRemoteTitle', { name: b.name }), description: t('vcs.deleteRemoteBody'), destructive: true, confirmLabel: t('vcs.delete') });
    if (!ok) return;
    await run('branch', (accessToken) => gitAPI.deleteRemoteBranch(repo.id, { accessToken, remote, branch }), { success: t('vcs.deleted', { name: b.name }) });
  };
  const deleteTag = async (name: string) => {
    close();
    const ok = await confirmDialog({ title: t('vcs.deleteTagTitle', { name }), description: t('vcs.deleteTagBody'), destructive: true, confirmLabel: t('vcs.delete') });
    if (!ok) return;
    await run('branch', () => gitAPI.deleteTag(repo.id, name), { needsToken: false, success: t('vcs.deleted', { name }) });
  };
  const openWorktreeTab = async (path: string) => {
    try {
      const { repo: r, tab } = await openGitFolder(path);
      useRequestStore.getState().addTab({ type: 'git', name: r.projectName || r.localPath, method: 'GET', url: '', ...tab }, true);
    } catch (e) {
      toast({ title: t('folder.openFailed'), description: extractErr(e, ''), variant: 'destructive' });
    }
  };
  const fetchAll = async () => {
    close();
    await run('fetch', (accessToken) => gitAPI.fetch(repo.id, { accessToken }), { success: t('vcs.fetched') });
  };

  const busy = !!p.busy;
  const inOp = !!st?.operation;

  const branchRow = (b: GitRefBranch, kind: 'local' | 'remote' | 'tag', key: string) => {
    const id = `${kind}:${b.name}`;
    const open = expanded === id;
    const isCurrent = kind === 'local' && b.name === current;
    const display = kind === 'remote' ? b.name.slice((b.remote?.length ?? 0) + 1) : b.name;
    return (
      <div key={key}>
        <button
          type="button"
          onClick={() => setExpanded(open ? '' : id)}
          className={cn('w-full flex items-center gap-1.5 px-3 py-1 text-left text-xs hover:bg-accent/50', open && 'bg-accent/40')}
          title={b.subject}
        >
          {kind === 'tag' ? <Tag className="h-3 w-3 shrink-0 text-muted-foreground" />
            : isCurrent ? <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-500" />
              : <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />}
          <span className={cn('truncate', isCurrent && 'font-medium')}>{display}</span>
          {b.gone && <span className="text-[9px] text-destructive">{t('vcs.gone')}</span>}
          <span className="ml-auto flex items-center gap-1 shrink-0 text-[10px] text-muted-foreground">
            {!!b.ahead && <span className="flex items-center text-emerald-600"><ArrowUp className="h-2.5 w-2.5" />{b.ahead}</span>}
            {!!b.behind && <span className="flex items-center text-sky-600"><ArrowDown className="h-2.5 w-2.5" />{b.behind}</span>}
            {b.upstream && kind === 'local' && <span className="max-w-[110px] truncate">{b.upstream}</span>}
            <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
          </span>
        </button>
        {open && (
          <div className="ml-6 mr-2 mb-1 border-l pl-1">
            {!isCurrent && <Act icon={GitBranch} label={t('vcs.checkout')} onClick={() => checkout(b.name)} disabled={busy || inOp} />}
            <Act icon={Plus} label={t('vcs.newBranchFrom', { name: display })} onClick={() => newBranch(b.name)} disabled={busy || inOp} />
            {!isCurrent && current && kind !== 'tag' && (
              <Act icon={GitPullRequestArrow} label={t('vcs.checkoutAndRebase', { onto: current })}
                onClick={() => void checkoutAndRebase(b, kind)} disabled={busy || inOp} />
            )}
            {kind === 'local' && !isCurrent && b.upstream && <Act icon={RefreshCw} label={t('vcs.checkoutAndUpdate')} onClick={() => void checkoutAndUpdate(b.name)} disabled={busy || inOp} />}
            <div className="my-0.5 border-t" />
            {!isCurrent && current && <Act icon={GitCompare} label={t('vcs.compareWith', { name: current })} onClick={() => { close(); setCompareRef(b.name); }} />}
            {!isCurrent && <Act icon={FileDiff} label={t('vcs.diffWorkTree')} onClick={() => { close(); setDiffRef(b.name); }} />}
            <Act icon={Eye} label={t('vcs.show')} onClick={() => { close(); p.onShowRef(b.name); }} />
            {!isCurrent && current && (
              <>
                <div className="my-0.5 border-t" />
                {kind !== 'tag' && <Act icon={GitPullRequestArrow} label={t('vcs.rebaseOnto', { branch: current, onto: display })} onClick={() => rebase(b.name)} disabled={busy || inOp} />}
                <Act icon={GitMerge} label={t('vcs.mergeInto', { name: display, into: current })} onClick={() => merge(b.name)} disabled={busy || inOp} />
              </>
            )}
            <div className="my-0.5 border-t" />
            <Act icon={FolderPlus} label={t('vcs.newWorktreeFrom', { name: display })}
              onClick={() => { close(); setWorktree({ ref: b.name, existingBranch: kind === 'local' && !isCurrent ? b.name : undefined, suggestedName: kind === 'remote' ? display : `${display}-wt` }); }} disabled={busy} />
            {kind === 'local' && (
              <>
                <div className="my-0.5 border-t" />
                {isCurrent
                  ? <Act icon={RefreshCw} label={t('vcs.updateBranch')} onClick={() => { close(); p.onUpdate(); }} disabled={busy || inOp} />
                  : <Act icon={RefreshCw} label={t('vcs.updateBranch')} onClick={() => void updateBranch(b.name)} disabled={busy || !b.upstream} />}
                {isCurrent
                  ? <Act icon={UploadCloud} label={t('vcs.pushAction')} onClick={() => { close(); p.onPush(); }} disabled={inOp} />
                  : <Act icon={UploadCloud} label={t('vcs.pushAction')} onClick={() => { close(); setPushBranch(b.name); }} disabled={busy} />}
                <Act icon={Link2} label={b.upstream ? t('vcs.trackedBranch', { upstream: b.upstream }) : t('vcs.trackBranch')} onClick={() => { close(); setTrackBranch(b.name); }} disabled={busy} />
                <div className="my-0.5 border-t" />
                <Act icon={Pencil} label={t('vcs.rename')} onClick={() => rename(b.name)} disabled={busy} />
                {!isCurrent && <Act icon={Trash2} label={t('vcs.delete')} onClick={() => remove(b.name)} disabled={busy} destructive />}
              </>
            )}
            {kind === 'remote' && <Act icon={Trash2} label={t('vcs.deleteRemote')} onClick={() => void deleteRemote(b)} disabled={busy} destructive />}
            {kind === 'tag' && <Act icon={Trash2} label={t('vcs.deleteTag')} onClick={() => void deleteTag(b.name)} disabled={busy} destructive />}
          </div>
        )}
      </div>
    );
  };

  const section = (title: string, children: React.ReactNode, extra?: React.ReactNode, key?: string) => (
    <div className="py-0.5" key={key ?? title}>
      <div className="flex items-center px-3 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}{extra}
      </div>
      {children}
    </div>
  );

  return (
    <>
    <GitCompareDialog repoId={repo.id} base={current || 'HEAD'} refName={compareRef} onClose={() => setCompareRef(null)} />
    <GitDiffWorkTreeDialog repoId={repo.id} refName={diffRef} onClose={() => setDiffRef(null)} />
    <GitTrackDialog repoId={repo.id} branch={trackBranch} refs={refs} run={run} onClose={() => setTrackBranch(null)} />
    <GitPushBranchDialog repoId={repo.id} branch={pushBranch} refs={refs} run={run} onClose={() => setPushBranch(null)} />
    <GitWorktreeDialog repoId={repo.id} req={worktree} run={run} onCreated={(path) => void openWorktreeTab(path)} onClose={() => setWorktree(null)} />
    <Popover open={p.open} onOpenChange={(o) => { p.onOpenChange(o); if (!o) { setExpanded(''); setQuery(''); } }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs min-w-[160px] max-w-[300px] justify-between font-normal"
          title={`${t('vcs.branchesTitle')} (${shortcutHint(GIT_KEYMAP, 'git.branches')})`}>
          <span className="flex items-center gap-1.5 min-w-0">
            {p.busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <GitBranch className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{label}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[400px] p-0">
        <div className="relative border-b">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('vcs.searchBranches')}
            className="h-9 border-0 pl-8 text-xs focus-visible:ring-0" autoFocus />
        </div>
        <div className="max-h-[460px] overflow-auto py-1">
          {!q && (
            <div className="pb-1 border-b">
              {inOp && (
                <div className="mx-2 my-1 flex items-center gap-1.5 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" /> {t(`vcs.op.${st!.operation}`)}
                </div>
              )}
              <Act icon={RefreshCw} label={t('vcs.update.title')} hint={shortcutHint(GIT_KEYMAP, 'git.update')} onClick={() => { close(); p.onUpdate(); }} disabled={busy || inOp} />
              <Act icon={GitCommitHorizontal} label={t('vcs.commitAction')} hint={shortcutHint(GIT_KEYMAP, 'git.commit')} onClick={() => { close(); p.onCommit(); }} />
              <Act icon={UploadCloud} label={t('vcs.pushAction')} hint={shortcutHint(GIT_KEYMAP, 'git.push')} onClick={() => { close(); p.onPush(); }} disabled={inOp} />
              <Act icon={CloudDownload} label={t('vcs.fetch')} onClick={fetchAll} disabled={busy} />
              <Act icon={Plus} label={t('vcs.newBranch')} onClick={() => newBranch(current || 'HEAD')} disabled={busy || inOp} />
              <Act icon={FolderPlus} label={t('vcs.newWorktree')} onClick={() => { close(); setWorktree({ ref: current || 'HEAD', suggestedName: `${current || 'work'}-wt` }); }} disabled={busy} />
              <Act icon={Tag} label={t('vcs.checkoutRevision')} onClick={checkoutRevision} disabled={busy || inOp} />
              <Act icon={Server} label={t('vcs.remotes.title')} onClick={() => { close(); p.onRemotes(); }} />
            </div>
          )}
          {!refs ? (
            <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              {recent.length > 0 && section(t('vcs.recent'), recent.map((b) => branchRow(b, 'local', `r-${b.name}`)))}
              {local.length > 0 && section(t('vcs.local'), local.map((b) => branchRow(b, 'local', `l-${b.name}`)))}
              {Object.entries(remoteGroups).map(([remote, list]) =>
                section(`${t('vcs.remote')} · ${remote}`, list.map((b) => branchRow(b, 'remote', `rm-${b.name}`))))}
              {tags.length > 0 && section(
                t('vcs.tags'),
                (showTags || q) ? tags.slice(0, 200).map((b) => branchRow(b, 'tag', `t-${b.name}`)) : null,
                !q && (
                  <button type="button" className="ml-auto normal-case font-normal tracking-normal hover:underline" onClick={() => setShowTags((v) => !v)}>
                    {showTags ? t('vcs.hide') : t('vcs.showCount', { count: tags.length })}
                  </button>
                ),
              )}
              {q && local.length + tags.length + Object.keys(remoteGroups).length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">{t('repoPicker.noResults')}</div>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
    </>
  );
}

function Act({ icon: Icon, label, hint, onClick, disabled, destructive }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn('w-full flex items-center gap-2 px-3 py-1 text-left text-xs hover:bg-accent/50 disabled:opacity-40 disabled:pointer-events-none',
        destructive && 'text-destructive')}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
      {hint && <kbd className="ml-auto text-[10px] text-muted-foreground">{hint}</kbd>}
    </button>
  );
}

// ── In-progress operation strip ──────────────────────────────────────────────

export function GitOperationBanner({ state, run, repoId, onResolve }: {
  state: GitOpState;
  run: Run;
  repoId: string;
  onResolve: () => void;
}) {
  const { t } = useTranslation('git');
  const n = state.conflicted.length;
  const act = async (action: 'abort' | 'continue' | 'skip') => {
    if (action === 'abort') {
      const ok = await confirmDialog({ title: t('vcs.abortTitle', { op: state.operation }), description: t('vcs.abortBody'), destructive: true });
      if (!ok) return;
    }
    await run('operation', (accessToken) => gitAPI.operation(repoId, { accessToken, action }));
  };
  return (
    <div className="shrink-0 flex flex-wrap items-center gap-2 border-b bg-amber-500/10 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-300">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="font-medium">{t(`vcs.op.${state.operation}`)}</span>
      <span>{n > 0 ? t('vcs.opConflicts', { count: n }) : t('vcs.opResolved')}</span>
      <span className="flex-1" />
      {n > 0 && <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={onResolve}>{t('vcs.resolve')}</Button>}
      <Button size="sm" className="h-6 text-[11px]" disabled={n > 0} onClick={() => act('continue')}>{t('vcs.continue')}</Button>
      {state.operation !== 'merge' && <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => act('skip')}>{t('vcs.skip')}</Button>}
      <Button size="sm" variant="ghost" className="h-6 text-[11px] text-destructive" onClick={() => act('abort')}>{t('vcs.abort')}</Button>
    </div>
  );
}
