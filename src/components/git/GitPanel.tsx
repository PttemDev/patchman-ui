import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  GitBranch as GitBranchIcon,
  GitCommitHorizontal,
  FolderTree,
  FolderOpen,
  FileDiff,
  Loader2,
  AlertTriangle,
  Search,
  DownloadCloud,
  ExternalLink,
  ChevronDown,
  User,
  Workflow,
  GitPullRequest,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Maximize2,
  RefreshCw,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { SplitHandle } from './SplitHandle';
import { usePersistedWidth } from './usePersistedWidth';
import { decodeGitContent, extractErr, timeAgo, usableForFolder } from './util';
import { GitBranchPopup, GitOperationBanner } from './GitBranchPopup';
import { GitNamePrompt, GitRemotesDialog, GitUpdateDialog, type NamePromptState, type PullStrategy } from './GitVcsDialogs';
import { useGitRepoOps } from './useGitRepoOps';
import { GitCommitDialog, GitPushDialog } from './GitCommitPushDialogs';
import { GitMRPanel } from './GitMRPanel';
import { GitLinkProjectDialog } from './GitLinkProjectDialog';
import { GitLocalTree } from './GitLocalTree';
import { GitWorkspaceEditor, type RevealTarget } from './GitWorkspaceEditor';
import { GitFindInFiles, GitSearchEverywhere } from './GitSearchDialogs';
import { GitFolderMenu, RecentFolderList, openGitFolder, pickGitFolder } from './GitFolderMenu';
import { useGitRecentFoldersStore } from '@/stores/gitRecentFoldersStore';
import { GIT_KEYMAP, shortcutHint, useScopedKeymap } from '@/lib/keymap';
import type { GitRefs } from '@/types';
import type { Tab, GitRepoSummary, GitBranch, GitCommit, GitFileDiff } from '@/types';

type Mode = 'history' | 'browse' | 'changes' | 'mrs' | 'ci';

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
  /** 'external' = a folder opened from disk (Open folder), not a managed clone. */
  cloneKind?: string;
  /** The folder no longer exists on disk (set by the list endpoint). */
  missing?: boolean;
}

// A local work tree belongs to a remote project when it was cloned for it
// (projectRef = the project's id) or it is a folder opened from disk whose
// origin matched the same connection (projectRef = the project's path).
function isProjectRepo(lr: GitLocalRepo, ref: string, path: string, connId: string): boolean {
  if (lr.missing) return false;
  return lr.projectRef === ref || (!!path && !!connId && lr.connectionId === connId && lr.projectRef === path);
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
  // The list holds only the 50 most recently active projects (or the last
  // search's hits), so a repo picked via search — or restored on a reopened
  // tab — can be missing from it. `pinnedRepo` keeps the picked summary, and
  // the effect below looks a missing one up by name, so everything gated on
  // selectedRepo (Open locally / clone) keeps working.
  const [pinnedRepo, setPinnedRepo] = useState<GitRepoSummary | null>(null);
  const selectedRepo = useMemo(
    () => repos.find((r) => String(r.id) === project || r.fullPath === project)
      ?? (pinnedRepo && (String(pinnedRepo.id) === project || pinnedRepo.fullPath === project) ? pinnedRepo : null),
    [repos, project, pinnedRepo],
  );

  // Local clones (desktop only) — decide Changes visibility + local history.
  // `localReposReady` guards the mode-reset below: until the managed-clone
  // list has actually loaded we can't tell a genuinely-orphaned Changes view
  // from one whose clone simply hasn't been fetched yet on this mount.
  const [localRepos, setLocalRepos] = useState<GitLocalRepo[]>([]);
  const [localReposReady, setLocalReposReady] = useState(false);
  // Prefer the tab's own clone id: a project can have both a managed clone and
  // a folder opened from disk.
  const localRepo = useMemo(
    () => localRepos.find((r) => r.id === tab.gitRepoId && (isProjectRepo(r, project, tab.gitRepoName ?? '', connId) || project === `local:${r.id}`))
      ?? localRepos.find((r) => isProjectRepo(r, project, tab.gitRepoName ?? '', connId)) ?? null,
    [localRepos, project, tab.gitRepoId, tab.gitRepoName, connId],
  );
  const useLocal = desktop && !!localRepo;
  // A folder opened from disk with no matching git connection: only the
  // local views (History / Browse / Changes) apply — there is no GitLab
  // project behind it for MRs / CI.
  const folderMode = project.startsWith('local:');
  const [linkOpen, setLinkOpen] = useState(false);
  // A folder opened from disk (not a managed clone) can be (re)linked to a
  // project. Its link is "broken" when the connection it matched can't serve
  // MRs / CI here (e.g. an OAuth connection kept only on this computer).
  const externalFolder = !!(desktop && localRepo && localRepo.cloneKind === 'external');
  const linkedConn = localRepo?.connectionId ? connections.find((c) => c.id === localRepo.connectionId) : undefined;
  const linkBroken = externalFolder && !folderMode && connections.length > 0 && (!linkedConn || !usableForFolder(linkedConn));
  // GitHub connections: pull requests (phase 3) and Actions (phase 4) aren't
  // wired yet — their views are hidden rather than failing.
  const isGitHubConn = conn?.provider === 'github';

  // Branch list for the selected repo.
  const [branches, setBranches] = useState<GitBranch[]>([]);
  // Why the branch list failed to load (shown beside the picker), and a key
  // bumped by its Retry.
  const [branchesError, setBranchesError] = useState('');
  const [branchesReload, setBranchesReload] = useState(0);
  const [cloning, setCloning] = useState(false);
  // Bumped after a successful pull to force HistoryView to reload the (now
  // advanced) local log.
  const [reloadKey, setReloadKey] = useState(0);

  // JetBrains-style VCS surface for a local clone (GIT_IDE_PLAN P1).
  const [refs, setRefs] = useState<GitRefs | null>(null);
  const [refsKey, setRefsKey] = useState(0);
  const [branchPopupOpen, setBranchPopupOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [remotesOpen, setRemotesOpen] = useState(false);
  const [namePrompt, setNamePrompt] = useState<NamePromptState | null>(null);
  // A fresh tab opens the connection picker — on the web only: the desktop
  // empty state offers both a connection and Open folder, and a folder tab
  // (gitRepoRef local:…) has no connection by design.
  const [connPickerOpen, setConnPickerOpen] = useState(
    !tab.gitConnectionId && !(tab.gitRepoRef ?? '').startsWith('local:') && !isDesktop(),
  );
  const [commitOpen, setCommitOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);

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
  // A folder / worktree / clone registered from elsewhere (sidebar, another
  // tab) isn't in a list this panel loaded earlier: reload once per repo
  // before declaring it gone.
  const reloadedFor = useRef('');
  useEffect(() => {
    const key = `${project}|${tab.gitRepoId ?? ''}`;
    if (!desktop || !localReposReady || !project || reloadedFor.current === key) return;
    if (!project.startsWith('local:') && !tab.gitRepoId) return;
    if (localRepos.some((r) => r.id === tab.gitRepoId || r.projectRef === project)) return;
    reloadedFor.current = key;
    setLocalReposReady(false);
    void loadLocalRepos();
  }, [desktop, localReposReady, project, tab.gitRepoId, localRepos, loadLocalRepos]);

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

  // Resolve a selected repo that isn't in the loaded list: GitLab's project
  // search matches name/path (not the full namespace), so search by the last
  // path segment and pick the exact id. Uses the existing repos endpoint, so
  // it works against older BEs too.
  const repoName = tab.gitRepoName ?? '';
  useEffect(() => {
    if (!connId || !project || folderMode || reposLoading || selectedRepo) return;
    const term = repoName.split('/').pop()?.trim();
    if (!term) return;
    let cancelled = false;
    gitAPI.repos(connId, { search: term })
      .then((res) => {
        const hit = ((res.data as GitRepoSummary[]) ?? []).find((r) => String(r.id) === project || r.fullPath === project);
        if (!cancelled && hit) setPinnedRepo(hit);
      })
      .catch(() => { /* label falls back to tab.gitRepoName */ });
    return () => { cancelled = true; };
  }, [connId, project, folderMode, repoName, reposLoading, selectedRepo]);

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
    if (!project || (folderMode && !localRepo)) { setBranches([]); setBranchesError(''); return; }
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
    else if (folderMode && (tab.gitView === 'mrs' || tab.gitView === 'ci')) updateTab(tab.id, { gitView: 'history' });
  }, [localReposReady, tab.gitView, useLocal, folderMode, tab.id, updateTab]);

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
  // Auto save on: the workspace editor hands us a flush, so leaving the
  // editor saves instead of asking to discard (it still asks if a save fails).
  const flushRef = useRef<(() => Promise<boolean>) | null>(null);
  const registerFlush = useCallback((fn: (() => Promise<boolean>) | null) => { flushRef.current = fn; }, []);
  const confirmDiscard = useCallback(async () => {
    if (editorDirtyRef.current && flushRef.current && (await flushRef.current())) editorDirtyRef.current = false;
    if (!editorDirtyRef.current && !changesDirtyRef.current) return true;
    const ok = await confirmDialog({ title: t('confirm.unsavedChanges'), destructive: true });
    if (ok) { editorDirtyRef.current = false; changesDirtyRef.current = false; }
    return ok;
  }, [t]);

  // ── local VCS: refs + ops ──────────────────────────────────────────
  useEffect(() => {
    if (!useLocal || !localRepo) { setRefs(null); return; }
    let cancelled = false;
    gitAPI.refs(localRepo.id)
      .then((res) => { if (!cancelled) setRefs(res.data as GitRefs); })
      .catch(() => { if (!cancelled) setRefs(null); });
    return () => { cancelled = true; };
  }, [useLocal, localRepo, refsKey]);

  const afterOp = useCallback(() => {
    setRefsKey((k) => k + 1);
    setBranchesReload((k) => k + 1);
    setReloadKey((k) => k + 1);
  }, []);
  const goResolve = useCallback(() => updateTab(tab.id, { gitView: 'changes' }), [tab.id, updateTab]);
  const ops = useGitRepoOps(localRepo, { onDone: afterOp, onConflicts: goResolve });

  const currentBranch = refs?.local.find((b) => b.current);

  const onCheckedOut = useCallback((branch: string) => {
    if (branch) updateTab(tab.id, { gitRef: branch });
  }, [tab.id, updateTab]);

  const runUpdate = useCallback(async (strategy: PullStrategy, autostash: boolean) => {
    if (!localRepo) return;
    await ops.run('pull', (accessToken) => gitAPI.pull(localRepo.id, { accessToken, strategy, autostash }), { success: t('pull.successTitle') });
  }, [localRepo, ops, t]);

  // JetBrains Commit / Push dialogs: modal, from any view.
  const openCommit = useCallback(() => { if (useLocal) setCommitOpen(true); }, [useLocal]);
  const openPush = useCallback(() => { if (useLocal) setPushOpen(true); }, [useLocal]);
  useEffect(() => {
    const h = () => openPush();
    window.addEventListener('patchman:git-open-push', h);
    return () => window.removeEventListener('patchman:git-open-push', h);
  }, [openPush]);

  const isActiveTab = useRequestStore((s) => s.activeTabId === tab.id);
  useScopedKeymap(GIT_KEYMAP, isActiveTab && useLocal, {
    'git.searchEverywhere': () => setEverywhere('all'),
    'git.findInFiles': () => { setFindInitial(undefined); setFindOpen(true); },
    'git.gotoFile': () => setEverywhere('files'),
    'git.gotoSymbol': () => setEverywhere('symbols'),
    'git.back': () => navigate(-1),
    'git.forward': () => navigate(1),
    'git.commit': openCommit,
    'git.push': openPush,
    'git.update': () => { if (!refs?.state.operation) setUpdateOpen(true); },
    'git.branches': () => setBranchPopupOpen(true),
    'git.vcsOperations': () => setBranchPopupOpen(true),
  });

  // ── local editor: open files, reveal, Back / Forward ───────────────
  const [reveal, setReveal] = useState<RevealTarget | undefined>();
  const caretRef = useRef<{ path: string; line: number } | null>(null);
  const navRef = useRef<{ stack: { path: string; line: number }[]; idx: number }>({ stack: [], idx: -1 });
  const show = useCallback((p: string, line?: number) => {
    const files = tab.gitOpenFiles ?? [];
    const patch: Partial<Tab> = { gitOpenFiles: files.includes(p) ? files : [...files, p], gitActiveFile: p, gitView: 'browse' };
    if (refs?.current && gitRef !== refs.current) patch.gitRef = refs.current; // the editor works on the checked-out branch
    updateTab(tab.id, patch);
    if (line) setReveal({ path: p, line, nonce: Date.now() });
  }, [tab.id, tab.gitOpenFiles, updateTab, refs, gitRef]);
  // Every jump records where we were, so ⌘[ / ⌘] can walk it back.
  const openFile = useCallback((p: string, line?: number) => {
    const nav = navRef.current;
    const from = caretRef.current;
    nav.stack = nav.stack.slice(0, nav.idx + 1);
    if (from) nav.stack.push(from);
    nav.stack.push({ path: p, line: line ?? 1 });
    nav.idx = nav.stack.length - 1;
    show(p, line);
  }, [show]);
  const navigate = useCallback((d: -1 | 1) => {
    const nav = navRef.current;
    const i = nav.idx + d;
    if (i < 0 || i >= nav.stack.length) return;
    nav.idx = i;
    show(nav.stack[i].path, nav.stack[i].line);
  }, [show]);

  // Go to Declaration: same file first, then the same language, else a picker.
  const [defChoices, setDefChoices] = useState<{ word: string; list: { name: string; kind: string; path: string; line: number; text: string }[] } | null>(null);
  const gotoDefinition = useCallback(async (word: string, fromPath: string, fromLine: number) => {
    if (!localRepo) return;
    try {
      const res = await gitAPI.symbols(localRepo.id, word, true);
      let list = (res.data as { name: string; kind: string; path: string; line: number; text: string }[]) ?? [];
      list = list.filter((x) => !(x.path === fromPath && x.line === fromLine));
      const ext = fromPath.split('.').pop();
      const same = list.filter((x) => x.path === fromPath);
      const lang = list.filter((x) => x.path.split('.').pop() === ext);
      const pick = same.length === 1 ? same : lang.length ? lang : list;
      if (pick.length === 0) { toast({ title: t('nav.noDeclaration', { word }) }); return; }
      if (pick.length === 1) { openFile(pick[0].path, pick[0].line); return; }
      setDefChoices({ word, list: pick });
    } catch (e) {
      toast({ title: t('nav.noDeclaration', { word }), description: extractErr(e, ''), variant: 'destructive' });
    }
  }, [localRepo, openFile, toast, t]);

  const [findOpen, setFindOpen] = useState(false);
  const [findInitial, setFindInitial] = useState<{ q: string; word?: boolean; caseSensitive?: boolean } | undefined>();
  const [everywhere, setEverywhere] = useState<null | 'all' | 'files' | 'symbols' | 'actions'>(null);
  const findUsages = useCallback((word: string) => { setFindInitial({ q: word, word: true, caseSensitive: true }); setFindOpen(true); }, []);
  const closeFile = useCallback((p: string) => {
    const files = (tab.gitOpenFiles ?? []).filter((x) => x !== p);
    const i = (tab.gitOpenFiles ?? []).indexOf(p);
    updateTab(tab.id, { gitOpenFiles: files, gitActiveFile: tab.gitActiveFile === p ? files[Math.max(0, i - 1)] ?? '' : tab.gitActiveFile });
  }, [tab.id, tab.gitOpenFiles, tab.gitActiveFile, updateTab]);
  const closeFiles = useCallback((paths: string[]) => {
    const drop = new Set(paths);
    const all = tab.gitOpenFiles ?? [];
    const files = all.filter((x) => !drop.has(x));
    let activeFile = tab.gitActiveFile ?? '';
    if (drop.has(activeFile)) {
      // The nearest kept tab to the left of the closed active one, else the first.
      const i = all.indexOf(activeFile);
      activeFile = [...all.slice(0, i)].reverse().find((x) => !drop.has(x)) ?? files[0] ?? '';
    }
    updateTab(tab.id, { gitOpenFiles: files, gitActiveFile: activeFile });
  }, [tab.id, tab.gitOpenFiles, tab.gitActiveFile, updateTab]);
  const onTreeChanged = useCallback((from?: string, to?: string) => {
    const files = tab.gitOpenFiles ?? [];
    const next = files.flatMap((f) => {
      if (f !== from && !(from && f.startsWith(from + '/'))) return [f];
      return to ? [to + f.slice(from!.length)] : [];
    });
    updateTab(tab.id, { gitOpenFiles: next, gitActiveFile: next.includes(tab.gitActiveFile ?? '') ? tab.gitActiveFile : next[0] ?? '' });
    setRefsKey((k) => k + 1);
  }, [tab.id, tab.gitOpenFiles, tab.gitActiveFile, updateTab]);

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
    const localId = localRepos.find((lr) => isProjectRepo(lr, String(r.id), r.fullPath || '', connId))?.id ?? '';
    setPinnedRepo(r);
    updateTab(tab.id, {
      gitRepoRef: String(r.id),
      gitRepoName: r.fullPath || r.name,
      gitRepoId: localId,
      gitRef: '', // re-seeded from the new repo's branches
    });
    setRepoPickerOpen(false);
  }, [localRepos, tab.id, updateTab, confirmDiscard, connId]);

  // ── clone ───────────────────────────────────────────────────────────
  const touchRecent = useGitRecentFoldersStore((s) => s.touch);
  const recentCount = useGitRecentFoldersStore((s) => s.folders.length);
  const handleClone = useCallback(async () => {
    if (!conn || !selectedRepo) return;
    setCloning(true);
    try {
      const accessToken = await gitOpsToken(conn.id);
      const repoId = crypto.randomUUID();
      const cloned = await gitAPI.clone(conn.id, {
        repoId,
        projectRef: String(selectedRepo.id),
        projectName: selectedRepo.fullPath || selectedRepo.name,
        remoteUrl: selectedRepo.httpUrl,
        defaultBranch: selectedRepo.defaultBranch,
        accessToken,
      });
      toast({ title: t('clone.successTitle'), description: t('clone.successDesc', { repo: selectedRepo.fullPath || selectedRepo.name }) });
      const row = (cloned.data as { repo?: GitLocalRepo } | undefined)?.repo;
      if (row?.localPath) touchRecent({ repoId: row.id, path: row.localPath, name: row.projectName || row.localPath });
      await loadLocalRepos();
      // The BE answers an existing tree of this project instead of cloning
      // again — open that one.
      updateTab(tab.id, { gitRepoId: row?.id || repoId, gitView: 'changes' });
    } catch (err) {
      toast({ title: t('clone.failedTitle'), description: extractErr(err, t('errors.clone')), variant: 'destructive' });
    }
    setCloning(false);
  }, [conn, selectedRepo, toast, loadLocalRepos, tab.id, updateTab, t, touchRecent]);

  // A folder that auto-matched a connection unusable here (CI/CD then said
  // "Connection not found") is moved, once, to a usable connection on the
  // same host; the BE re-checks the origin host before linking.
  const healTried = useRef('');
  useEffect(() => {
    if (!linkBroken || !localRepo || healTried.current === localRepo.id) return;
    healTried.current = localRepo.id;
    const hostOf = (u?: string): string => {
      if (!u) return '';
      const scp = u.match(/^[^@/]+@([^:/]+):/);
      if (scp) return scp[1].toLowerCase();
      try { return new URL(u).hostname.toLowerCase(); } catch { return ''; }
    };
    const want = hostOf(linkedConn?.baseUrl) || hostOf(localRepo.remoteUrl);
    const alt = want ? connections.find((c) => c.id !== localRepo.connectionId && usableForFolder(c) && hostOf(c.baseUrl) === want) : undefined;
    if (!alt) return;
    void gitAPI.linkRepo(localRepo.id, { connectionId: alt.id, projectRef: localRepo.projectRef, projectName: localRepo.projectName })
      .then(async (res) => {
        const r = (res.data as { repo: GitLocalRepo }).repo;
        await loadLocalRepos();
        updateTab(tab.id, { gitConnectionId: r.connectionId, gitScope: 'local', gitRepoRef: r.projectRef, gitRepoName: r.projectName || r.localPath, gitRepoId: r.id });
      })
      .catch(() => { /* the "Fix link" button stays */ });
  }, [linkBroken, localRepo, linkedConn, connections, loadLocalRepos, updateTab, tab.id]);

  // ── open folder (any git work tree on this machine) ────────────────
  const openFolderPath = useCallback(async (path: string, recentId?: string) => {
    if (!(await confirmDiscard())) return;
    try {
      const { tab: fields } = await openGitFolder(path, recentId);
      await loadLocalRepos();
      updateTab(tab.id, fields);
    } catch (err) {
      toast({ title: t('folder.openFailed'), description: extractErr(err, t('folder.openFailed')), variant: 'destructive' });
    }
  }, [confirmDiscard, loadLocalRepos, tab.id, updateTab, toast, t]);
  const folderMissing = useCallback(
    (repoId: string) => !!localRepos.find((r) => r.id === repoId)?.missing,
    [localRepos],
  );

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

  // Empty states on desktop: open a folder from disk or a recent one.
  const folderStart = desktop ? (
    <div className="w-[320px] space-y-2">
      <Button size="sm" className="h-8 gap-1.5 text-xs"
        onClick={async () => { try { const p = await pickGitFolder(t('folder.pickTitle')); if (p) await openFolderPath(p); } catch (err) { toast({ title: t('folder.openFailed'), description: extractErr(err, t('folder.openFailed')), variant: 'destructive' }); } }}>
        <FolderOpen className="h-3.5 w-3.5" /> {t('folder.open')}
      </Button>
      {recentCount > 0 && (
        <div className="rounded-md border p-1 text-left">
          <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t('folder.recent')}</div>
          <RecentFolderList missing={folderMissing} onOpen={(f) => void openFolderPath(f.path, f.repoId)} />
        </div>
      )}
    </div>
  ) : undefined;

  const repoLabel = selectedRepo
    ? (selectedRepo.fullPath || selectedRepo.name)
    : (tab.gitRepoName || t('repoPicker.placeholder'));

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Header — two rows: connection alone, then repo + branch. */}
      <div className="shrink-0 border-b">
        {/* Row 2: repo picker (leading icon aligned under row 1), branch
            picker pushed to the far right, then scope / clone on desktop. */}
        <div className="px-3 py-2 flex items-center gap-2 flex-wrap">
          {/* Connection: just its icon; the picker is a modal (rarely changed). */}
          <button
            type="button"
            onClick={() => setConnPickerOpen(true)}
            className={cn(
              'flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs hover:bg-accent/50',
              !connId && 'border-orange-500/60 text-orange-600 dark:text-orange-400',
            )}
            title={conn ? t('connectionPicker.current', { name: conn.name }) : t('connectionPicker.placeholder')}
            aria-label={t('connectionPicker.change')}
          >
            <GitBranchIcon className="h-4 w-4 text-orange-500" />
            {!connId && <span>{t('connectionPicker.placeholder')}</span>}
          </button>
          <span className="text-[11px] font-medium text-muted-foreground">{t('header.project')}</span>
          {/* Repo picker (searchable) */}
          <Popover open={repoPickerOpen} onOpenChange={(o) => {
            if (!(connId || (desktop && recentCount > 0))) return;
            setRepoPickerOpen(o);
            // A list that failed (VPN was off, network blip) loads again on open.
            if (o && connId && !reposLoading && (reposError || repos.length === 0)) void loadRepos(connId, repoSearch);
          }}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs min-w-[170px] max-w-[260px] justify-between font-normal"
                disabled={!connId && !(desktop && recentCount > 0)}
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
                  className="h-9 border-0 pl-8 pr-8 text-xs focus-visible:ring-0"
                  autoFocus
                />
                {reposLoading ? (
                  <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : connId && (
                  <button type="button" onClick={() => void loadRepos(connId, repoSearch)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    title={t('common:refresh')} aria-label={t('common:refresh')}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="max-h-[300px] overflow-auto py-1">
                {reposError ? (
                  <div className="flex items-start gap-2 m-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span className="min-w-0 flex-1 break-words">{reposError}</span>
                    {connId && (
                      <button type="button" onClick={() => void loadRepos(connId, repoSearch)} disabled={reposLoading}
                        className="shrink-0 underline underline-offset-2 hover:no-underline">
                        {t('common:retry')}
                      </button>
                    )}
                  </div>
                ) : repos.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {reposLoading ? t('common:loading') : t('repoPicker.noResults')}
                  </div>
                ) : (
                  repos.map((r) => {
                    const cloned = localRepos.some((lr) => isProjectRepo(lr, String(r.id), r.fullPath || '', connId));
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
              {desktop && recentCount > 0 && !repoSearch && (
                <div className="border-t p-1">
                  <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t('folder.recent')}</div>
                  <RecentFolderList missing={folderMissing} activeRepoId={localRepo?.id}
                    onOpen={(f) => { setRepoPickerOpen(false); void openFolderPath(f.path, f.repoId); }} />
                </div>
              )}
            </PopoverContent>
          </Popover>

          {project && <span className="text-[11px] font-medium text-muted-foreground">{t('header.branch')}</span>}
          {/* Local clone: JetBrains branch popup (checked-out branch + every
              VCS action). The view ref (history / browse) follows checkout;
              "Show" on a branch views it without checking it out. */}
          {useLocal && localRepo && (
            <>
              {gitRef && refs && gitRef !== refs.current && (
                <button
                  type="button"
                  className="flex items-center gap-1 h-8 px-2 rounded border border-dashed text-[11px] text-muted-foreground hover:bg-accent/40"
                  title={t('vcs.viewingHint')}
                  onClick={() => { if (refs.current) updateTab(tab.id, { gitRef: refs.current }); }}
                >
                  {t('vcs.viewing', { ref: gitRef })}
                </button>
              )}
              <GitBranchPopup
                repo={localRepo}
                refs={refs}
                open={branchPopupOpen}
                onOpenChange={setBranchPopupOpen}
                run={ops.run}
                busy={ops.busy}
                onShowRef={async (r) => { if (await confirmDiscard()) updateTab(tab.id, { gitRef: r }); }}
                onCheckedOut={onCheckedOut}
                onUpdate={() => setUpdateOpen(true)}
                onCommit={openCommit}
                onPush={openPush}
                onRemotes={() => setRemotesOpen(true)}
                onPrompt={setNamePrompt}
              />
              {/* JetBrains toolbar trio next to the branch widget: pull,
                  commit, push — with behind / ahead counts. */}
              <div className="flex items-center h-8 rounded-md border divide-x overflow-hidden">
                <ToolbarBtn
                  icon={ops.busy === 'pull' ? Loader2 : ArrowDownToLine}
                  spin={ops.busy === 'pull'}
                  label={t('vcs.toolbar.pull')}
                  count={currentBranch?.behind}
                  countClass="text-sky-600 dark:text-sky-400"
                  title={`${t('vcs.update.title')} (${shortcutHint(GIT_KEYMAP, 'git.update')})`}
                  disabled={!!ops.busy || !!refs?.state.operation}
                  onClick={() => setUpdateOpen(true)}
                />
                <ToolbarBtn
                  icon={Check}
                  label={t('vcs.toolbar.commit')}
                  title={`${t('vcs.commitAction')} (${shortcutHint(GIT_KEYMAP, 'git.commit')})`}
                  onClick={openCommit}
                />
                <ToolbarBtn
                  icon={ArrowUpFromLine}
                  label={t('vcs.toolbar.push')}
                  count={currentBranch?.ahead}
                  countClass="text-emerald-600 dark:text-emerald-400"
                  title={`${t('vcs.pushAction')} (${shortcutHint(GIT_KEYMAP, 'git.push')})`}
                  disabled={!!refs?.state.operation}
                  onClick={openPush}
                />
              </div>
            </>
          )}

          {/* Branch picker (far right, with a small leading branch icon) */}
          {!useLocal && <GitBranchIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          {!useLocal && <Select
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
          </Select>}
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

          {desktop && (
            <GitFolderMenu onOpenPath={openFolderPath} missing={folderMissing} activeRepoId={localRepo?.id} />
          )}

          {/* Open locally (clone) — desktop only */}
          {desktop && selectedRepo && !localRepo && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={cloning} onClick={handleClone}>
              {cloning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
              {t('openLocally')}
            </Button>
          )}
          {desktop && localRepo && localRepo.cloneKind !== 'external' && (
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
              title={t('badge.cloned')}
              aria-label={t('badge.cloned')}
            >
              <DownloadCloud className="h-3.5 w-3.5" />
            </span>
          )}
          {desktop && localRepo && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-8 p-0"
              onClick={handleReveal}
              title={t('showInFinder')}
              aria-label={t('showInFinder')}
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {useLocal && localRepo && refs?.state.operation && (
        <GitOperationBanner state={refs.state} run={ops.run} repoId={localRepo.id} onResolve={goResolve} />
      )}
      {useLocal && localRepo && (
        <>
          <GitUpdateDialog
            open={updateOpen}
            onOpenChange={setUpdateOpen}
            branch={refs?.current ?? ''}
            upstream={currentBranch?.upstream}
            onRun={runUpdate}
          />
          <GitRemotesDialog repoId={localRepo.id} open={remotesOpen} onOpenChange={setRemotesOpen} onChanged={afterOp} />
          <GitNamePrompt state={namePrompt} onClose={() => setNamePrompt(null)} />
          {localRepo && externalFolder && (
            <GitLinkProjectDialog
              open={linkOpen}
              onOpenChange={setLinkOpen}
              repoId={localRepo.id}
              origin={localRepo.remoteUrl}
              currentConnectionId={localRepo.connectionId}
              onLinked={async (r) => {
                await loadLocalRepos();
                updateTab(tab.id, {
                  gitConnectionId: r.connectionId,
                  gitScope: 'local',
                  gitRepoRef: r.projectRef,
                  gitRepoName: r.projectName || r.localPath,
                  gitRepoId: r.id,
                  gitRef: '',
                });
                toast({ title: t('link.done', { project: r.projectName }) });
              }}
            />
          )}
          <GitFindInFiles repoId={localRepo.id} open={findOpen} onOpenChange={setFindOpen} initial={findInitial} onOpenHit={openFile} />
          <GitSearchEverywhere
            repoId={localRepo.id}
            open={everywhere !== null}
            onOpenChange={(o) => { if (!o) setEverywhere(null); }}
            initialTab={everywhere ?? 'all'}
            onOpenFile={openFile}
            onFindText={(q) => { setFindInitial({ q }); setFindOpen(true); }}
            actions={[
              { id: 'update', label: t('vcs.update.title'), hint: shortcutHint(GIT_KEYMAP, 'git.update'), run: () => setUpdateOpen(true) },
              { id: 'commit', label: t('vcs.commitAction'), hint: shortcutHint(GIT_KEYMAP, 'git.commit'), run: openCommit },
              { id: 'push', label: t('vcs.pushAction'), hint: shortcutHint(GIT_KEYMAP, 'git.push'), run: openPush },
              { id: 'branches', label: t('vcs.branchesTitle'), hint: shortcutHint(GIT_KEYMAP, 'git.branches'), run: () => setBranchPopupOpen(true) },
              { id: 'find', label: t('search.findInFiles'), hint: shortcutHint(GIT_KEYMAP, 'git.findInFiles'), run: () => { setFindInitial(undefined); setFindOpen(true); } },
              { id: 'remotes', label: t('vcs.remotes.title'), run: () => setRemotesOpen(true) },
              { id: 'mrs', label: t('mode.mrs', { context: isGitHubConn ? 'pr' : undefined }), run: () => updateTab(tab.id, { gitView: 'mrs' }) },
              { id: 'changes', label: t('mode.changes'), run: () => updateTab(tab.id, { gitView: 'changes' }) },
            ]}
          />
          <Dialog open={!!defChoices} onOpenChange={(o) => { if (!o) setDefChoices(null); }}>
            <DialogContent className="max-w-xl gap-2 p-3">
              <DialogTitle className="text-sm">{t('nav.chooseDeclaration', { word: defChoices?.word })}</DialogTitle>
              <div className="max-h-[50vh] overflow-auto">
                {defChoices?.list.map((d) => (
                  <button key={`${d.path}:${d.line}`} type="button" onClick={() => { setDefChoices(null); openFile(d.path, d.line); }}
                    className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent/50">
                    <span className="font-mono">{d.text}</span>
                    <span className="text-[10px] text-muted-foreground">{d.path}:{d.line}</span>
                  </button>
                ))}
              </div>
            </DialogContent>
          </Dialog>
          <GitCommitDialog
            open={commitOpen}
            onOpenChange={setCommitOpen}
            repoId={localRepo.id}
            branch={refs?.current || refs?.state.head || ''}
            onCommitted={(push) => { afterOp(); if (push) setPushOpen(true); }}
          />
          <GitPushDialog
            open={pushOpen}
            onOpenChange={setPushOpen}
            repoId={localRepo.id}
            connectionId={localRepo.connectionId}
            branch={refs?.current || 'HEAD'}
            defaultBranch={localRepo.defaultBranch}
            onPushed={afterOp}
            onUpdate={() => setUpdateOpen(true)}
          />
        </>
      )}

      <Dialog open={connPickerOpen} onOpenChange={setConnPickerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('connectionPicker.title')}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-1 overflow-auto">
            {connections.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">{t('connectionPicker.empty')}</p>
            ) : connections.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { setConnPickerOpen(false); if (c.id !== connId) void handleConn(c.id); }}
                className={cn('flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-xs hover:bg-accent/50', c.id === connId && 'border-primary bg-primary/5')}
              >
                <GitBranchIcon className="h-4 w-4 shrink-0 text-orange-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  {c.baseUrl && <span className="block truncate text-[10px] text-muted-foreground">{c.baseUrl}</span>}
                </span>
                {c.shared && <span className="shrink-0 text-[10px] text-muted-foreground">{c.grantRole === 'write' ? t('role.write') : t('role.read')}</span>}
                {c.id === connId && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Body */}
      {folderMode && localReposReady && !localRepo ? (
        <EmptyState
          icon={<FolderOpen className="h-10 w-10 opacity-30" />}
          title={t('folder.goneTitle')}
          hint={t('folder.goneHint')}
          action={folderStart}
        />
      ) : !connId && !folderMode ? (
        <EmptyState
          icon={<GitBranchIcon className="h-10 w-10 opacity-30" />}
          title={t('empty.noConnectionTitle')}
          hint={desktop ? t('folder.noConnectionHint') : t('empty.noConnectionHint')}
          action={folderStart}
        />
      ) : !project ? (
        <EmptyState
          icon={<GitBranchIcon className="h-10 w-10 opacity-30" />}
          title={t('empty.noRepoTitle')}
          hint={t('empty.noRepoHint')}
          action={folderStart}
        />
      ) : folderMode && !localRepo ? (
        <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
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
              {externalFolder && (
                <button
                  type="button"
                  onClick={() => setLinkOpen(true)}
                  className={cn(
                    'mt-1 w-full rounded-md border border-dashed px-2 py-1.5 text-left text-[11px] hover:border-primary hover:text-foreground',
                    linkBroken ? 'border-amber-500/60 text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
                  )}
                  title={linkBroken ? t('link.brokenHint') : t('link.hint')}
                >
                  <span className="flex items-center gap-1.5">
                    <Workflow className="h-3 w-3" />
                    {folderMode ? t('link.button') : linkBroken ? t('link.fix') : t('link.change')}
                  </span>
                </button>
              )}
              {!folderMode && (
                <>
                  <ModeButton icon={GitPullRequest} label={t('mode.mrs', { context: isGitHubConn ? 'pr' : undefined })} active={mode === 'mrs'} onClick={async () => { if (await confirmDiscard()) updateTab(tab.id, { gitView: 'mrs' }); }} />
                  <ModeButton icon={Workflow} label={t('mode.ci')} active={mode === 'ci'} onClick={async () => { if (await confirmDiscard()) updateTab(tab.id, { gitView: 'ci' }); }} />
                </>
              )}
            </nav>
            {mode === 'browse' && editable && localRepo && (
              <div className="flex-1 min-h-0 overflow-auto border-t">
                <GitLocalTree
                  key={`tree-${localRepo.id}`}
                  repoId={localRepo.id}
                  selected={tab.gitActiveFile}
                  onOpen={openFile}
                  onPrompt={setNamePrompt}
                  onChanged={onTreeChanged}
                  onReverted={(path) => {
                    // Reload an open file (or files under a folder) from disk:
                    // drop the tabs, then reopen them so their buffers re-read.
                    const open = (tab.gitOpenFiles ?? []).filter((f) => f === path || f.startsWith(path + '/'));
                    if (open.length === 0) return;
                    const all = tab.gitOpenFiles ?? [];
                    const active = tab.gitActiveFile;
                    updateTab(tab.id, { gitOpenFiles: all.filter((f) => !open.includes(f)) });
                    setTimeout(() => updateTab(tab.id, { gitOpenFiles: all, gitActiveFile: active }), 0);
                    setRefsKey((k) => k + 1);
                  }}
                  reloadKey={reloadKey}
                />
              </div>
            )}
            {mode === 'browse' && gitRef && !editable && !folderMode && (
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
            {mode === 'browse' && editable && localRepo ? (
              <GitWorkspaceEditor
                key={`ws-${localRepo.id}`}
                reveal={reveal}
                onGotoDefinition={(w, p, l) => void gotoDefinition(w, p, l)}
                onFindUsages={findUsages}
                onCaret={(p, l) => { caretRef.current = { path: p, line: l }; }}
                repoId={localRepo.id}
                files={tab.gitOpenFiles ?? []}
                active={tab.gitActiveFile}
                onActivate={(p) => updateTab(tab.id, { gitActiveFile: p })}
                onClose={closeFile}
                onCloseMany={closeFiles}
                onReorder={(files) => updateTab(tab.id, { gitOpenFiles: files })}
                onDirtyChange={handleEditorDirty}
                registerFlush={registerFlush}
                onSaved={(o) => {
                  // An auto save fires often: only the refs bar refreshes; the
                  // tree / history reload on a manual save.
                  setRefsKey((k) => k + 1);
                  if (!o?.auto) { void loadLocalRepos(); setReloadKey((k) => k + 1); }
                }}
              />
            ) : mode === 'browse' && (
              folderMode ? (
                <div className="flex-1 flex items-center justify-center p-6 text-center text-xs text-muted-foreground">
                  {t('folder.browseCheckout')}
                </div>
              ) : gitRef ? (
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
            {mode === 'mrs' && !folderMode && (
              <GitMRPanel
                provider={conn?.provider}
                connId={connId}
                project={project}
                canWrite={!!conn && (!conn.shared || conn.grantRole === 'write')}
                localRepo={useLocal && localRepo ? { id: localRepo.id, connectionId: localRepo.connectionId } : null}
                currentBranch={refs?.current}
                defaultBranch={localRepo?.defaultBranch || selectedRepo?.defaultBranch}
                onCheckedOut={(b) => { afterOp(); onCheckedOut(b); }}
              />
            )}
            {mode === 'ci' && !folderMode && (
              <GitCIPanel provider={conn?.provider} connId={connId} project={project} gitRef={gitRef} canWrite={!!conn && (!conn.shared || conn.grantRole === 'write')} />
            )}
            {mode === 'changes' && useLocal && localRepo && (
              <GitChangesPanel key={`changes-${localRepo.id}-${reloadKey}`} repoId={localRepo.id} connectionId={localRepo.connectionId} onChanged={() => { void loadLocalRepos(); setRefsKey((k) => k + 1); }} onDirtyChange={handleChangesDirty} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolbarBtn({ icon: Icon, spin, label, count, countClass, title, disabled, onClick }: {
  icon: React.ComponentType<{ className?: string }>;
  spin?: boolean;
  label: string;
  count?: number;
  countClass?: string;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-1.5 h-full px-2.5 text-xs hover:bg-accent/50 disabled:opacity-40 disabled:pointer-events-none"
    >
      <Icon className={cn('h-3.5 w-3.5', spin && 'animate-spin')} />
      <span>{label}</span>
      {!!count && <span className={cn('text-[10px] font-medium tabular-nums', countClass)}>{count}</span>}
    </button>
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
  // The commit detail opened in a large modal (the pane can be cramped);
  // path is the file that was open in the pane, reopened there.
  const [expanded, setExpanded] = useState<{ path?: string } | null>(null);
  // Commit list ↔ detail split, as the list's share of the width (%).
  const splitRef = useRef<HTMLDivElement>(null);
  const [listPct, setListPct] = usePersistedWidth('patchman_git_history_split', 46, 20, 80);
  const dragFrom = useRef(46);
  const listPctRef = useRef(listPct);
  listPctRef.current = listPct;

  // Only the latest load may write state: a slower, superseded request (e.g.
  // the remote read fired before the local clone list arrived) must not
  // overwrite the local history with its error.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError('');
    setSelected(null);
    try {
      if (useLocal && localRepoId) {
        const res = await gitAPI.log(localRepoId, { ref: gitRef || undefined, limit: 200 });
        if (seq !== loadSeq.current) return;
        setCommits((res.data as GitCommit[]) ?? []);
        setNextPage(null);
      } else {
        const res = await gitAPI.commits(connId, { project, ref: gitRef || undefined, page: 1 });
        if (seq !== loadSeq.current) return;
        const d = (res.data ?? {}) as { commits?: GitCommit[]; nextPage?: number };
        setCommits(d.commits ?? []);
        setNextPage(d.nextPage && d.nextPage > 0 ? d.nextPage : null);
      }
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setError(extractErr(err, t('errors.loadHistory')));
      setCommits([]);
      setNextPage(null);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
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
    <div ref={splitRef} className="flex-1 min-h-0 flex overflow-hidden">
      <div className={cn('min-h-0 overflow-auto', selected ? 'shrink-0' : 'flex-1')} style={selected ? { width: `${listPct}%` } : undefined}>
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
        <SplitHandle
          label={t('commitDetail.resize')}
          onDragStart={() => { dragFrom.current = listPct; }}
          onDrag={(dx) => {
            const w = splitRef.current?.getBoundingClientRect().width || 1;
            setListPct(dragFrom.current + (dx / w) * 100, false);
          }}
          onDragEnd={() => setListPct(listPctRef.current)}
          onStep={(d) => setListPct(listPct + d * 2)}
        />
      )}
      {selected && (
        <div className="flex-1 min-w-0 min-h-0">
          <CommitDetail
            connId={connId}
            project={project}
            commit={selected}
            useLocal={useLocal}
            localRepoId={localRepoId}
            onClose={() => setSelected(null)}
            onExpand={(path) => setExpanded({ path })}
          />
        </div>
      )}
      {selected && (
        <Dialog open={!!expanded} onOpenChange={(o) => { if (!o) setExpanded(null); }}>
          <DialogContent className="flex h-[90vh] w-[96vw] max-w-[1600px] flex-col gap-0 overflow-hidden p-0">
            <DialogTitle className="sr-only">{selected.title || selected.message}</DialogTitle>
            {expanded && (
              <CommitDetail
                connId={connId}
                project={project}
                commit={selected}
                useLocal={useLocal}
                localRepoId={localRepoId}
                initialPath={expanded.path}
                inModal
                onClose={() => setExpanded(null)}
              />
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// CommitDetail lists the commit's changed files and shows the selected file's
// Monaco diff (base = parent content, modified = this commit's content).
function CommitDetail({
  connId, project, commit, useLocal, localRepoId, onClose, onExpand, initialPath, inModal,
}: {
  connId: string;
  project: string;
  commit: GitCommit;
  useLocal: boolean;
  localRepoId: string;
  onClose: () => void;
  /** Opens this commit in the large modal, with the active file's path. */
  onExpand?: (path?: string) => void;
  /** File to open once the file list loads (the modal reopens the pane's). */
  initialPath?: string;
  /** Rendered inside the modal: the dialog's own × closes it. */
  inModal?: boolean;
}) {
  const { t } = useTranslation('git');
  const [files, setFiles] = useState<GitFileDiff[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState<GitFileDiff | null>(null);
  const [content, setContent] = useState<{ original: string; modified: string } | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState('');
  const [filesW, setFilesW] = usePersistedWidth('patchman_git_commit_files_w', 224, 140, 520);
  const filesFrom = useRef(224);
  const filesWRef = useRef(filesW);
  filesWRef.current = filesW;

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

  const initialOpened = useRef(false);
  useEffect(() => {
    if (initialOpened.current || !initialPath || files.length === 0) return;
    const f = files.find((x) => (x.newPath || x.oldPath) === initialPath);
    initialOpened.current = true;
    if (f) openFile(f);
  }, [files, initialPath, openFile]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={cn('shrink-0 border-b px-3 py-2', inModal && 'pr-12')}>
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
          {onExpand && (
            <Button
              size="icon" variant="ghost" className="h-6 w-6 shrink-0"
              title={t('commitDetail.expand')} aria-label={t('commitDetail.expand')}
              onClick={() => onExpand(active ? active.newPath || active.oldPath : undefined)}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          )}
          {!inModal && (
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 -mr-1" onClick={onClose}>×</Button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="shrink-0 overflow-auto" style={{ width: filesW }}>
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
        <SplitHandle
          label={t('commitDetail.resize')}
          onDragStart={() => { filesFrom.current = filesW; }}
          onDrag={(dx) => setFilesW(filesFrom.current + dx, false)}
          onDragEnd={() => setFilesW(filesWRef.current)}
          onStep={(d) => setFilesW(filesW + d * 16)}
        />
        <div className="flex-1 min-w-0 min-h-0">
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
