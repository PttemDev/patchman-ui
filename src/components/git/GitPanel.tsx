import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  GitBranch as GitBranchIcon,
  GitCommitHorizontal,
  FolderTree,
  FolderGit2,
  FolderOpen,
  FileDiff,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Search,
  DownloadCloud,
  ExternalLink,
  ChevronDown,
  User,
  Workflow,
} from 'lucide-react';
import { gitAPI, type DBScope } from '@/services/api';
import { useGitConnectionStore, gitOpsToken } from '@/stores/gitConnectionStore';
import { useRequestStore } from '@/stores/requestStore';
import { ExecScopePicker } from '@/components/common/ExecScopePicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useToast } from '@/components/ui/use-toast';
import { confirmDialog } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { isDesktop } from '@/lib/platform';
import { GitCommitGraph, type GitRef } from './GitCommitGraph';
import { GitBrowseTreePane, GitBrowseContent } from './GitBrowseTree';
import { GitChangesPanel } from './GitChangesPanel';
import { GitCIPanel } from './GitCIPanel';
import { GitDiffViewer } from './GitDiffViewer';
import { decodeGitContent, extractErr, timeAgo } from './util';
import type { Tab, GitRepoSummary, GitBranch, GitCommit, GitFileDiff } from '@/types';

type Mode = 'history' | 'browse' | 'changes' | 'ci';

// A managed local clone row (models.GitRepo). No FE interface ships for it, so
// we type the fields the UI consumes off the local-ops responses here.
interface GitLocalRepo {
  id: string;
  connectionId: string;
  projectRef: string;
  projectName: string;
  remoteUrl: string;
  localPath: string;
  defaultBranch: string;
}

// GitPanel is the Git tab body — a three-pane git client rendered as a WIDE
// main tab (like K8sExplorerPanel / KafkaTopicPanel), driven entirely off the
// per-tab state so selections persist across tab switches. Header is two rows:
// row 1 is the connection picker (with a leading icon); row 2 leads with the
// repo picker (icon-aligned under row 1) and pushes the branch picker to the
// far right, followed by scope + "Open locally" on desktop. Left: the mode
// switch (History | Browse | Changes) — in Browse the file tree is hosted
// inline in this column so the center pane shows the selected file alone.
// Center: the commit DAG, the browsed file's content, or the local
// working-tree changes view. All read surfaces work on web; local-only
// affordances (Changes, Open locally) are hidden off desktop. Connection CRUD
// (add / edit / share / delete) lives in GitSidebar, not here.
export function GitPanel({ tab }: { tab: Tab }) {
  const { t } = useTranslation('git');
  const connections = useGitConnectionStore((s) => s.connections);
  const fetchConnections = useGitConnectionStore((s) => s.fetchConnections);
  const updateTab = useRequestStore((s) => s.updateTab);
  const { toast } = useToast();
  const desktop = isDesktop();

  // ── Per-tab selection (source of truth) ─────────────────────────────
  const connId = tab.gitConnectionId ?? '';
  const conn = useMemo(() => connections.find((c) => c.id === connId) ?? null, [connections, connId]);
  const scope: DBScope = tab.gitScope ?? conn?.scope ?? 'remote';
  const project = tab.gitRepoRef ?? ''; // canonical project id — String(repo.id)
  const gitRef = tab.gitRef ?? '';
  const mode: Mode = tab.gitView ?? 'history';

  // Repos (remote list) + derived selection. `selectedRepo` may be null on a
  // reopened tab until the list re-fetches — the UI falls back to
  // tab.gitRepoName for the label, and every pane reads the `project`
  // primitive, so the client renders without waiting on it.
  const [repoSearch, setRepoSearch] = useState('');
  const [repos, setRepos] = useState<GitRepoSummary[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState('');
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const selectedRepo = useMemo(
    () => repos.find((r) => String(r.id) === project) ?? null,
    [repos, project],
  );

  // Local clones (desktop only) — decide Changes visibility + local history.
  // `localReposReady` guards the mode-reset below: until the managed-clone
  // list has actually loaded we can't tell a genuinely-orphaned Changes view
  // from one whose clone simply hasn't been fetched yet on this mount.
  const [localRepos, setLocalRepos] = useState<GitLocalRepo[]>([]);
  const [localReposReady, setLocalReposReady] = useState(false);
  const localRepo = useMemo(
    () => localRepos.find((r) => r.projectRef === project) ?? null,
    [localRepos, project],
  );
  const useLocal = desktop && !!localRepo;

  // Branch list for the selected repo.
  const [branches, setBranches] = useState<GitBranch[]>([]);
  // Why the branch list failed to load (shown beside the picker), and a key
  // bumped by its Retry.
  const [branchesError, setBranchesError] = useState('');
  const [branchesReload, setBranchesReload] = useState(0);
  const [cloning, setCloning] = useState(false);
  const [pulling, setPulling] = useState(false);
  // Bumped after a successful pull to force HistoryView to reload the (now
  // advanced) local log.
  const [reloadKey, setReloadKey] = useState(0);

  // Browse-mode selection. Lifted here (rather than kept inside the tree) so the
  // tree can render in the left mode-nav column while the picked file's content
  // fills the center pane. Not persisted to the tab — it resets with repo/ref
  // (and thus connection, since handleConn clears the repo), matching the
  // tree's own reset.
  const [browsePath, setBrowsePath] = useState('');
  useEffect(() => { setBrowsePath(''); }, [project, gitRef]);

  // ── bootstrap ───────────────────────────────────────────────────────
  useEffect(() => {
    if (connections.length === 0) fetchConnections();
  }, [connections.length, fetchConnections]);

  const loadLocalRepos = useCallback(async () => {
    if (!desktop) { setLocalRepos([]); setLocalReposReady(true); return; }
    try {
      const res = await gitAPI.listRepos();
      setLocalRepos((res.data as GitLocalRepo[]) ?? []);
    } catch {
      setLocalRepos([]);
    } finally {
      setLocalReposReady(true);
    }
  }, [desktop]);

  useEffect(() => { loadLocalRepos(); }, [loadLocalRepos]);

  // ── repos ───────────────────────────────────────────────────────────
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const loadRepos = useCallback(async (id: string, search: string) => {
    if (!id) { setRepos([]); return; }
    setReposLoading(true);
    setReposError('');
    try {
      const res = await gitAPI.repos(id, { search: search || undefined });
      setRepos((res.data as GitRepoSummary[]) ?? []);
    } catch (err) {
      // The 412 "Link your GitLab account in Settings…" message is a designed
      // UX — surface it verbatim rather than a generic failure.
      setReposError(extractErr(err, t('errors.listRepos')));
      setRepos([]);
    } finally {
      setReposLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh the repo list when the connection changes (the tab's repo
  // selection is reset by handleConn, so we only refetch the list here).
  useEffect(() => {
    setRepos([]);
    setRepoSearch('');
    if (connId) loadRepos(connId, '');
  }, [connId, loadRepos]);

  const handleRepoSearch = (q: string) => {
    setRepoSearch(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadRepos(connId, q), 250);
  };

  // ── branches ────────────────────────────────────────────────────────
  // Fetch by `project` (not the full selectedRepo object) so a reopened tab
  // loads branches before the repos list resolves. When no ref is persisted
  // yet, seed it: the checked-out branch on a local clone, else the repo's
  // default branch (flagged in the list), then 'main', 'master', the repo
  // summary's defaultBranch. If none apply the picker shows "Select Branch".
  // A failure is shown beside the picker with a Retry — it used to leave an
  // empty, disabled picker with no reason.
  useEffect(() => {
    if (!project) { setBranches([]); setBranchesError(''); return; }
    let cancelled = false;
    const fetchBranches = useLocal && localRepo
      ? gitAPI.localBranches(localRepo.id)
      : gitAPI.branches(connId, { project });
    fetchBranches
      .then((res) => {
        if (cancelled) return;
        const bs = (res.data as GitBranch[]) ?? [];
        setBranches(bs);
        setBranchesError('');
        if (!tab.gitRef) {
          const names = bs.map((b) => b.name);
          // On a local clone, land on the checked-out branch so Browse opens on
          // the editable (working-tree) surface right away.
          const current = useLocal ? bs.find((b) => b.current)?.name : '';
          const def = current
            || bs.find((b) => b.isDefault)?.name
            || (names.includes('main')
              ? 'main'
              : names.includes('master')
                ? 'master'
                : (selectedRepo?.defaultBranch || ''));
          if (def) updateTab(tab.id, { gitRef: def });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setBranches([]);
        setBranchesError(extractErr(err, t('branchPicker.loadFailed')));
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, useLocal, localRepo?.id, connId, branchesReload]);

  // Keep the mode valid: Changes needs a desktop-local clone. Wait until the
  // clone list has loaded so a persisted Changes view isn't clobbered by the
  // empty initial `localRepos` on remount (web resolves `ready` immediately).
  useEffect(() => {
    if (!localReposReady) return;
    if (tab.gitView === 'changes' && !useLocal) updateTab(tab.id, { gitView: 'history' });
  }, [localReposReady, tab.gitView, useLocal, tab.id, updateTab]);

  // sha → branch/HEAD chips for the graph.
  const refsBySha = useMemo<Record<string, GitRef[]>>(() => {
    const out: Record<string, GitRef[]> = {};
    for (const b of branches) {
      if (!b.commitSha) continue;
      (out[b.commitSha] ??= []).push({ name: b.name, kind: b.isDefault || b.current ? 'head' : 'branch' });
    }
    return out;
  }, [branches]);

  // ── editable-file gate (Browse) ─────────────────────────────────────
  // A browsed file is editable only when it IS the working-tree file: desktop,
  // a local clone, and the panel's ref equals the clone's checked-out branch
  // (`current` is populated by localBranches). Any committed blob at another
  // ref is read-only. When a clone exists but the branch differs we surface a
  // one-line hint so the user knows how to unlock editing.
  const checkedOutBranch = useMemo(
    () => (useLocal ? branches.find((b) => b.current)?.name ?? '' : ''),
    [useLocal, branches],
  );
  const editable = desktop && !!localRepo && !!gitRef && gitRef === checkedOutBranch;
  const editHint = desktop && localRepo && checkedOutBranch && gitRef !== checkedOutBranch
    ? t('edit.switchToEdit', { branch: checkedOutBranch })
    : undefined;

  // Unsaved-edit guard. GitFileEditor (Browse) and GitConflictResolver
  // (Changes) each report their dirty flag up here; before any navigation that
  // would unmount them (file / branch / mode / repo / connection switch) we
  // confirm.
  const editorDirtyRef = useRef(false);
  const changesDirtyRef = useRef(false);
  const handleEditorDirty = useCallback((d: boolean) => { editorDirtyRef.current = d; }, []);
  const handleChangesDirty = useCallback((d: boolean) => { changesDirtyRef.current = d; }, []);
  const confirmDiscard = useCallback(async () => {
    if (!editorDirtyRef.current && !changesDirtyRef.current) return true;
    const ok = await confirmDialog({ title: t('confirm.unsavedChanges'), destructive: true });
    if (ok) { editorDirtyRef.current = false; changesDirtyRef.current = false; }
    return ok;
  }, [t]);

  // ── handlers (write through to the tab) ─────────────────────────────
  const handleConn = useCallback(async (v: string) => {
    if (!(await confirmDiscard())) return;
    const next = connections.find((c) => c.id === v) ?? null;
    // updateTab strips `undefined`, so reset fields with '' to actually clear.
    updateTab(tab.id, {
      gitConnectionId: v,
      gitScope: next?.scope ?? 'remote',
      gitRepoRef: '',
      gitRepoName: '',
      gitRepoId: '',
      gitRef: '',
      gitView: 'history',
    });
  }, [connections, tab.id, updateTab, confirmDiscard]);

  const handleSelectRepo = useCallback(async (r: GitRepoSummary) => {
    if (!(await confirmDiscard())) return;
    const localId = localRepos.find((lr) => lr.projectRef === String(r.id))?.id ?? '';
    updateTab(tab.id, {
      gitRepoRef: String(r.id),
      gitRepoName: r.fullPath || r.name,
      gitRepoId: localId,
      gitRef: '', // re-seeded from the new repo's branches
    });
    setRepoPickerOpen(false);
  }, [localRepos, tab.id, updateTab, confirmDiscard]);

  // ── clone ───────────────────────────────────────────────────────────
  const handleClone = useCallback(async () => {
    if (!conn || !selectedRepo) return;
    setCloning(true);
    try {
      const accessToken = await gitOpsToken(conn.id);
      const repoId = crypto.randomUUID();
      await gitAPI.clone(conn.id, {
        repoId,
        projectRef: String(selectedRepo.id),
        projectName: selectedRepo.fullPath || selectedRepo.name,
        remoteUrl: selectedRepo.httpUrl,
        defaultBranch: selectedRepo.defaultBranch,
        accessToken,
      });
      toast({ title: t('clone.successTitle'), description: t('clone.successDesc', { repo: selectedRepo.fullPath || selectedRepo.name }) });
      await loadLocalRepos();
      updateTab(tab.id, { gitRepoId: repoId, gitView: 'changes' });
    } catch (err) {
      toast({ title: t('clone.failedTitle'), description: extractErr(err, t('errors.clone')), variant: 'destructive' });
    }
    setCloning(false);
  }, [conn, selectedRepo, toast, loadLocalRepos, tab.id, updateTab, t]);

  // ── reveal in OS file manager (desktop + local clone) ──────────────
  const handleReveal = useCallback(async () => {
    if (!localRepo) return;
    try {
      const { data } = await gitAPI.localPath(localRepo.id);
      const path = (data as { path: string }).path;
      // revealItemInDir highlights the folder in Finder/Explorer — the
      // purpose-built API. (plugin-shell's `open` rejects a bare filesystem
      // path under the shell scope, which is why reveal was failing.)
      const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
      await revealItemInDir(path);
    } catch (err) {
      toast({ title: t('reveal.failedTitle'), description: extractErr(err, t('errors.reveal')), variant: 'destructive' });
    }
  }, [localRepo, toast, t]);

  // ── pull (fast-forward the local clone to latest) ──────────────────
  const handlePull = useCallback(async () => {
    if (!localRepo) return;
    setPulling(true);
    try {
      const accessToken = await gitOpsToken(localRepo.connectionId);
      await gitAPI.pull(localRepo.id, { accessToken });
      toast({ title: t('pull.successTitle'), description: t('pull.successDesc') });
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast({ title: t('pull.failedTitle'), description: extractErr(err, t('errors.pull')), variant: 'destructive' });
    }
    setPulling(false);
  }, [localRepo, toast, t]);

  const repoLabel = selectedRepo
    ? (selectedRepo.fullPath || selectedRepo.name)
    : (tab.gitRepoName || t('repoPicker.placeholder'));

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Header — two rows: connection alone, then repo + branch. */}
      <div className="shrink-0 border-b">
        {/* Row 1: connection picker (full width) */}
        <div className="px-3 pt-3 pb-1.5 flex items-center gap-2">
          <GitBranchIcon className="h-4 w-4 text-orange-500 shrink-0" />
          <Select value={connId} onValueChange={handleConn}>
            <SelectTrigger className="flex-1 max-w-md h-8 text-xs">
              <SelectValue placeholder={t('connectionPicker.placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {connections.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  {t('connectionPicker.empty')}
                </div>
              ) : (
                connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.shared && <span className="ml-2 text-[10px] text-muted-foreground">· {c.grantRole === 'write' ? t('role.write') : t('role.read')}</span>}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Row 2: repo picker (leading icon aligned under row 1), branch
            picker pushed to the far right, then scope / clone on desktop. */}
        <div className="px-3 pb-2 flex items-center gap-2 flex-wrap">
          <FolderGit2 className="h-4 w-4 text-muted-foreground shrink-0" />
          {/* Repo picker (searchable) */}
          <Popover open={repoPickerOpen} onOpenChange={(o) => { if (connId) setRepoPickerOpen(o); }}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs min-w-[220px] justify-between font-normal"
                disabled={!connId}
              >
                <span className="truncate">{repoLabel}</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[340px] p-0">
              <div className="relative border-b">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={repoSearch}
                  onChange={(e) => handleRepoSearch(e.target.value)}
                  placeholder={t('repoPicker.searchPlaceholder')}
                  className="h-9 border-0 pl-8 text-xs focus-visible:ring-0"
                  autoFocus
                />
                {reposLoading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
              <div className="max-h-[300px] overflow-auto py-1">
                {reposError ? (
                  <div className="flex items-start gap-2 m-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span className="min-w-0 break-words">{reposError}</span>
                  </div>
                ) : repos.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {reposLoading ? t('common:loading') : t('repoPicker.noResults')}
                  </div>
                ) : (
                  repos.map((r) => {
                    const cloned = localRepos.some((lr) => lr.projectRef === String(r.id));
                    return (
                      <button
                        key={String(r.id)}
                        type="button"
                        onClick={() => handleSelectRepo(r)}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/50',
                          project === String(r.id) && 'bg-accent/60',
                        )}
                      >
                        <GitBranchIcon className="h-3.5 w-3.5 shrink-0 text-orange-500" />
                        <span className="truncate flex-1 min-w-0">{r.fullPath || r.name}</span>
                        {cloned && <Badge variant="secondary" className="text-[8px] px-1 py-0 shrink-0">{t('badge.local')}</Badge>}
                      </button>
                    );
                  })
                )}
              </div>
            </PopoverContent>
          </Popover>

          <div className="flex-1" />

          {/* Branch picker (far right, with a small leading branch icon) */}
          <GitBranchIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Select
            value={gitRef}
            onValueChange={async (v) => { if (await confirmDiscard()) updateTab(tab.id, { gitRef: v }); }}
            disabled={!project || branches.length === 0}
          >
            {/* Render the trigger content ourselves in a <div> (not a bare
                <span>, which SelectTrigger's `[&>span]:line-clamp-1` collapses
                into a -webkit-box, shrinking the nested truncate to "ma…").
                A roomy min/max width shows a normal branch name in full and only
                truncates genuinely long ones; the "default" tag + chevron stay. */}
            <SelectTrigger className="min-w-[160px] max-w-[300px] h-8 text-xs">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className={cn('truncate', !gitRef && 'text-muted-foreground')}>
                  {gitRef || (branchesError ? t('branchPicker.loadFailed') : t('branchPicker.placeholder'))}
                </span>
                {branches.find((b) => b.name === gitRef)?.isDefault && (
                  <span className="text-[9px] text-muted-foreground shrink-0">{t('branchPicker.default')}</span>
                )}
              </div>
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.name} value={b.name}>
                  <span className="flex items-center gap-1.5 min-w-0">
                    <GitBranchIcon className="h-3 w-3 shrink-0" />
                    <span className="truncate">{b.name}</span>
                    {b.isDefault && <span className="text-[9px] text-muted-foreground shrink-0">{t('branchPicker.default')}</span>}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {branchesError && (
            <button
              type="button"
              onClick={() => setBranchesReload((k) => k + 1)}
              title={branchesError}
              className="flex items-center gap-1 h-8 px-1.5 rounded text-[11px] text-destructive hover:bg-destructive/10 shrink-0"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {t('branchPicker.retry')}
            </button>
          )}

          {conn && (
            <ExecScopePicker
              scope={scope}
              availableScopes={conn.availableScopes ?? (conn.scope ? [conn.scope] : undefined)}
              onChange={(s) => updateTab(tab.id, { gitScope: s })}
              noun="browse"
            />
          )}

          {/* Open locally (clone) — desktop only */}
          {desktop && selectedRepo && !localRepo && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={cloning} onClick={handleClone}>
              {cloning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
              {t('openLocally')}
            </Button>
          )}
          {desktop && localRepo && (
            <Badge variant="outline" className="h-8 gap-1 px-2 text-[10px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
              <DownloadCloud className="h-3 w-3" /> {t('badge.cloned')}
            </Badge>
          )}
          {desktop && localRepo && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={handleReveal}
              title={t('reveal.title')}
            >
              <FolderOpen className="h-3.5 w-3.5" /> {t('showInFinder')}
            </Button>
          )}
          {desktop && localRepo && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              disabled={pulling}
              onClick={handlePull}
              title={t('pull.title')}
            >
              {pulling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t('pull.button')}
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      {!connId ? (
        <EmptyState
          icon={<GitBranchIcon className="h-10 w-10 opacity-30" />}
          title={t('empty.noConnectionTitle')}
          hint={t('empty.noConnectionHint')}
        />
      ) : !project ? (
        <EmptyState
          icon={<GitBranchIcon className="h-10 w-10 opacity-30" />}
          title={t('empty.noRepoTitle')}
          hint={t('empty.noRepoHint')}
        />
      ) : (
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Left: mode switch — in Browse the file tree is hosted inline in
              this column (below the buttons) so the center pane shows just the
              selected file; the column widens to fit the tree. */}
          <div className={cn(
            'shrink-0 border-r flex flex-col overflow-hidden',
            mode === 'browse' && gitRef ? 'w-64' : 'w-44',
          )}>
            <nav className="p-1.5 space-y-0.5 shrink-0">
              <ModeButton icon={GitCommitHorizontal} label={t('mode.history')} active={mode === 'history'} onClick={async () => { if (await confirmDiscard()) updateTab(tab.id, { gitView: 'history' }); }} />
              <ModeButton icon={FolderTree} label={t('mode.browse')} active={mode === 'browse'} onClick={async () => { if (await confirmDiscard()) updateTab(tab.id, { gitView: 'browse' }); }} />
              {useLocal && (
                <ModeButton icon={FileDiff} label={t('mode.changes')} active={mode === 'changes'} onClick={async () => { if (await confirmDiscard()) updateTab(tab.id, { gitView: 'changes' }); }} />
              )}
              <ModeButton icon={Workflow} label={t('mode.ci')} active={mode === 'ci'} onClick={async () => { if (await confirmDiscard()) updateTab(tab.id, { gitView: 'ci' }); }} />
            </nav>
            {mode === 'browse' && gitRef && (
              <div className="flex-1 min-h-0 overflow-auto border-t">
                <GitBrowseTreePane
                  connId={connId}
                  project={project}
                  gitRef={gitRef}
                  selectedPath={browsePath}
                  onSelect={async (p) => { if (await confirmDiscard()) setBrowsePath(p); }}
                />
              </div>
            )}
            {!desktop && (
              <div className="mt-auto p-2 text-[10px] text-muted-foreground leading-tight border-t">
                {t('desktopOnlyNote')}
              </div>
            )}
          </div>

          {/* Center: active mode */}
          <div className="flex-1 min-h-0 flex overflow-hidden">
            {mode === 'history' && (
              <HistoryView
                key={`history-${reloadKey}`}
                connId={connId}
                project={project}
                gitRef={gitRef}
                useLocal={useLocal}
                localRepoId={localRepo?.id ?? ''}
                refsBySha={refsBySha}
              />
            )}
            {mode === 'browse' && (
              gitRef ? (
                <GitBrowseContent
                  connId={connId}
                  project={project}
                  gitRef={gitRef}
                  path={browsePath}
                  editable={editable}
                  localRepoId={localRepo?.id ?? ''}
                  editHint={editHint}
                  onDirtyChange={handleEditorDirty}
                  onSaved={loadLocalRepos}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
                  {t('browse.selectBranch')}
                </div>
              )
            )}
            {mode === 'ci' && (
              <GitCIPanel connId={connId} project={project} gitRef={gitRef} canWrite={!!conn && (!conn.shared || conn.grantRole === 'write')} />
            )}
            {mode === 'changes' && useLocal && localRepo && (
              <GitChangesPanel repoId={localRepo.id} connectionId={localRepo.connectionId} onChanged={loadLocalRepos} onDirtyChange={handleChangesDirty} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── History (commit DAG + commit detail) ─────────────────────────────────────
function HistoryView({
  connId, project, gitRef, useLocal, localRepoId, refsBySha,
}: {
  connId: string;
  project: string;
  gitRef: string;
  useLocal: boolean;
  localRepoId: string;
  refsBySha: Record<string, GitRef[]>;
}) {
  const { t } = useTranslation('git');
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<GitCommit | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setSelected(null);
    try {
      if (useLocal && localRepoId) {
        const res = await gitAPI.log(localRepoId, { ref: gitRef || undefined, limit: 200 });
        setCommits((res.data as GitCommit[]) ?? []);
        setNextPage(null);
      } else {
        const res = await gitAPI.commits(connId, { project, ref: gitRef || undefined, page: 1 });
        const d = (res.data ?? {}) as { commits?: GitCommit[]; nextPage?: number };
        setCommits(d.commits ?? []);
        setNextPage(d.nextPage && d.nextPage > 0 ? d.nextPage : null);
      }
    } catch (err) {
      setError(extractErr(err, t('errors.loadHistory')));
      setCommits([]);
      setNextPage(null);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, project, gitRef, useLocal, localRepoId]);

  useEffect(() => { load(); }, [load]);

  const loadMore = useCallback(async () => {
    if (!nextPage) return;
    setLoadingMore(true);
    try {
      const res = await gitAPI.commits(connId, { project, ref: gitRef || undefined, page: nextPage });
      const d = (res.data ?? {}) as { commits?: GitCommit[]; nextPage?: number };
      setCommits((prev) => [...prev, ...(d.commits ?? [])]);
      setNextPage(d.nextPage && d.nextPage > 0 ? d.nextPage : null);
    } catch (err) {
      setError(extractErr(err, t('errors.loadMoreCommits')));
    }
    setLoadingMore(false);
  }, [connId, project, gitRef, nextPage, t]);

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      <div className={cn('min-h-0 overflow-auto', selected ? 'w-[46%] border-r' : 'flex-1')}>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('history.loading')}
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 m-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        ) : (
          <GitCommitGraph
            commits={commits}
            refsBySha={refsBySha}
            selectedSha={selected?.sha ?? null}
            onSelect={setSelected}
            onLoadMore={loadMore}
            hasMore={!!nextPage}
            loadingMore={loadingMore}
          />
        )}
      </div>
      {selected && (
        <div className="flex-1 min-h-0">
          <CommitDetail
            connId={connId}
            project={project}
            commit={selected}
            useLocal={useLocal}
            localRepoId={localRepoId}
            onClose={() => setSelected(null)}
          />
        </div>
      )}
    </div>
  );
}

// CommitDetail lists the commit's changed files and shows the selected file's
// Monaco diff (base = parent content, modified = this commit's content).
function CommitDetail({
  connId, project, commit, useLocal, localRepoId, onClose,
}: {
  connId: string;
  project: string;
  commit: GitCommit;
  useLocal: boolean;
  localRepoId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('git');
  const [files, setFiles] = useState<GitFileDiff[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState<GitFileDiff | null>(null);
  const [content, setContent] = useState<{ original: string; modified: string } | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState('');

  useEffect(() => {
    setActive(null);
    setContent(null);
    setContentError('');
    setLoading(true);
    setError('');
    let cancelled = false;
    gitAPI.commit(connId, { project, sha: commit.sha })
      .then((res) => {
        if (cancelled) return;
        const d = (res.data ?? {}) as { diff?: GitFileDiff[] };
        setFiles(d.diff ?? []);
      })
      .catch((err) => { if (!cancelled) setError(extractErr(err, t('errors.loadCommit'))); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, project, commit.sha]);

  const parent = commit.parents?.[0];

  const openFile = useCallback(async (file: GitFileDiff) => {
    setActive(file);
    setContent(null);
    setContentError('');
    if (file.binary) return;
    setContentLoading(true);
    const fetchAt = (ref: string, path: string) =>
      (useLocal && localRepoId
        ? gitAPI.localFile(localRepoId, { path, ref })
        : gitAPI.file(connId, { project, ref, path })
      ).then((res) => {
        const d = (res.data ?? {}) as { content?: string; encoding?: string };
        return decodeGitContent(d.content, d.encoding);
      });
    try {
      const [original, modified] = await Promise.all([
        file.status === 'added' || !parent ? Promise.resolve('') : fetchAt(parent, file.oldPath).catch(() => ''),
        file.status === 'deleted' ? Promise.resolve('') : fetchAt(commit.sha, file.newPath).catch(() => ''),
      ]);
      setContent({ original, modified });
    } catch (err) {
      setContentError(extractErr(err, t('errors.loadFileContents')));
    }
    setContentLoading(false);
  }, [connId, project, commit.sha, parent, useLocal, localRepoId, t]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 border-b px-3 py-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium truncate">{commit.title || commit.message}</p>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
              <span className="font-mono">{commit.shortSha}</span>
              <span className="flex items-center gap-1"><User className="h-2.5 w-2.5" />{commit.authorName}</span>
              <span>{timeAgo(commit.authoredAt)}</span>
            </div>
          </div>
          {commit.webUrl && (
            <a href={commit.webUrl} target="_blank" rel="noreferrer" title={t('openOnGitlab')}
              className="text-muted-foreground hover:text-foreground shrink-0">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 -mr-1" onClick={onClose}>×</Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="w-56 shrink-0 border-r overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('common:loading')}
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 m-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          ) : files.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">{t('commitDetail.noFileChanges')}</p>
          ) : (
            <div className="py-1">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t(files.length === 1 ? 'commitDetail.fileCountOne' : 'commitDetail.fileCountOther', { n: files.length })}
              </div>
              {files.map((f) => (
                <button
                  key={f.newPath || f.oldPath}
                  type="button"
                  onClick={() => openFile(f)}
                  className={cn(
                    'w-full flex items-center gap-1.5 px-2 py-1 text-left text-xs hover:bg-accent/40',
                    active === f && 'bg-accent/60',
                  )}
                  title={f.newPath || f.oldPath}
                >
                  <span
                    className={cn(
                      'shrink-0 w-3 text-center font-mono text-[10px]',
                      f.status === 'added' && 'text-emerald-500',
                      f.status === 'deleted' && 'text-red-500',
                      f.status === 'renamed' && 'text-sky-500',
                      f.status === 'modified' && 'text-amber-500',
                    )}
                  >
                    {f.status[0].toUpperCase()}
                  </span>
                  <span className="truncate">{f.newPath || f.oldPath}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 min-h-0">
          {!active ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              {t('commitDetail.selectFile')}
            </div>
          ) : active.binary ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              {t('commitDetail.binary')}
            </div>
          ) : contentLoading ? (
            <div className="flex items-center justify-center gap-2 h-full text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('diff.loading')}
            </div>
          ) : contentError ? (
            <div className="flex items-start gap-2 m-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="min-w-0 break-words">{contentError}</span>
            </div>
          ) : content ? (
            <GitDiffViewer
              original={content.original}
              modified={content.modified}
              path={active.newPath || active.oldPath}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  icon: Icon, label, active, onClick,
}: {
  icon: typeof GitBranchIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-left transition-colors',
        active ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent/40',
      )}
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0', active && 'text-orange-500')} />
      {label}
    </button>
  );
}

function EmptyState({
  icon, title, hint, action,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
      {icon}
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">{hint}</p>
      </div>
      {action}
    </div>
  );
}
