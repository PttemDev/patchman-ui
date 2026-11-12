import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  RefreshCw,
  MoreHorizontal,
  Edit3,
  Trash2,
  Share2,
  GitBranch,
  MonitorSmartphone,
  Cloud,
  Loader2,
  ChevronRight,
  FolderGit2,
  Search,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useGitConnectionStore, scopeForGit } from '@/stores/gitConnectionStore';
import { useGitSidebarUI } from '@/stores/gitSidebarUIStore';
import { useRequestStore } from '@/stores/requestStore';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { gitAPI } from '@/services/api';
import type { GitConnection, GitRepoSummary } from '@/types';
import { extractErr } from './util';
import { GitConnectionDialog } from './GitConnectionDialog';
import { GitShareDialog } from './GitShareDialog';

// GitHeaderActions renders the Git panel's Refresh + New-connection buttons in
// the sidebar's shared header (next to the "Git" title) — replacing the old
// redundant in-body "GIT CONNECTIONS" sub-header row.
export function GitHeaderActions() {
  const { t } = useTranslation('git');
  const fetchConnections = useGitConnectionStore((s) => s.fetchConnections);
  const openAdd = useGitSidebarUI((s) => s.openAdd);
  return (
    <div className="flex items-center gap-0.5">
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => fetchConnections()} title={t('common:refresh')}>
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={openAdd} title={t('sidebar.newConnection')}>
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// GitSidebar mirrors K8sSidebar / ESSidebar: a list of Git connections.
// Clicking a connection opens the three-pane Git client as a wide main tab
// (type 'git'), seeded with the connection's resolved scope; the chevron
// expands a searchable repository list under it (a repo opens the client with
// that repo picked); the 3-dot menu exposes edit / share / delete. New / Refresh live in the header. The client
// itself (repo + branch pickers, commit graph, file tree, changes + diff)
// is the tab panel, not the sidebar tree.
export function GitSidebar() {
  const { t } = useTranslation('git');
  const connections = useGitConnectionStore((s) => s.connections);
  const loading = useGitConnectionStore((s) => s.loading);
  const loaded = useGitConnectionStore((s) => s.loaded);
  const fetchConnections = useGitConnectionStore((s) => s.fetchConnections);
  const deleteConnection = useGitConnectionStore((s) => s.deleteConnection);
  const addTab = useRequestStore((s) => s.addTab);
  const setActiveTab = useRequestStore((s) => s.setActiveTab);
  const { toast } = useToast();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const dialogOpen = useGitSidebarUI((s) => s.dialogOpen);
  const editing = useGitSidebarUI((s) => s.editing);
  const openEdit = useGitSidebarUI((s) => s.openEdit);
  const openAdd = useGitSidebarUI((s) => s.openAdd);
  const setDialogOpen = useGitSidebarUI((s) => s.setDialogOpen);
  const [sharing, setSharing] = useState<GitConnection | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<GitConnection | null>(null);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const openConnTab = useCallback((conn: GitConnection) => {
    addTab({
      type: 'git',
      name: conn.name,
      method: 'GET',
      url: '',
      gitConnectionId: conn.id,
      gitScope: scopeForGit(connections, conn.id),
    }, true);
  }, [addTab, connections]);

  // A repo from the sidebar list: focus its tab if one is already open for
  // this connection, else open the Git client with the repo picked (an empty
  // gitRef lets the panel seed main / master / the default branch).
  const openRepoTab = useCallback((conn: GitConnection, repo: GitRepoSummary) => {
    const ref = String(repo.id);
    const existing = useRequestStore.getState().tabs.find(
      (tb) => tb.type === 'git' && tb.gitConnectionId === conn.id && tb.gitRepoRef === ref,
    );
    if (existing) { setActiveTab(existing.id); return; }
    addTab({
      type: 'git',
      name: repo.name,
      method: 'GET',
      url: '',
      gitConnectionId: conn.id,
      gitScope: scopeForGit(connections, conn.id),
      gitRepoRef: ref,
      gitRepoName: repo.fullPath || repo.name,
      gitRef: '',
    }, true);
  }, [addTab, setActiveTab, connections]);

  // Delete rides the git store's dual-write wrapper (like GitPanel did): it
  // fans the removal out to every reachable BE and returns a partial-write
  // descriptor we toast when a backend was missed.
  const handleDeleteConnection = useCallback(async () => {
    if (!confirmDelete) return;
    const partial = await deleteConnection(confirmDelete);
    if (partial) toast(partial);
    setConfirmDelete(null);
  }, [confirmDelete, deleteConnection, toast]);

  return (
    <>
      <div>
        {connections.length === 0 && (loading || !loaded) ? (
          <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 p-8 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground">{t('sidebar.loadingConnections')}</p>
          </div>
        ) : connections.length === 0 ? (
          <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 p-8 text-center">
            <GitBranch className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">{t('sidebar.noConnections')}</p>
            <Button size="sm" className="mt-1 h-7 text-xs" onClick={openAdd}>
              {t('sidebar.addFirst')}
            </Button>
          </div>
        ) : (
          <div className="space-y-0.5 p-2">
            {connections.map((conn) => (
              <div key={conn.id}>
              <div className="group flex items-center rounded hover:bg-accent/40 transition-colors">
                <button
                  type="button"
                  onClick={() => setExpanded((e) => ({ ...e, [conn.id]: !e[conn.id] }))}
                  className="shrink-0 pl-1 py-1 text-muted-foreground hover:text-foreground"
                  title={expanded[conn.id] ? t('sidebar.hideRepos') : t('sidebar.showRepos')}
                  aria-label={expanded[conn.id] ? t('sidebar.hideRepos') : t('sidebar.showRepos')}
                  aria-expanded={!!expanded[conn.id]}
                >
                  <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', expanded[conn.id] && 'rotate-90')} />
                </button>
                <button
                  type="button"
                  onClick={() => openConnTab(conn)}
                  className="flex-1 min-w-0 flex items-center gap-1.5 px-1.5 py-1 text-left"
                  title={conn.baseUrl}
                >
                  <GitBranch className={cn('h-3.5 w-3.5 shrink-0', conn.shared ? 'text-green-500' : 'text-orange-500')} />
                  <span className="text-sm truncate">{conn.name}</span>
                  <span className="flex items-center gap-0.5 shrink-0">
                    <MonitorSmartphone
                      className={cn(
                        'h-2.5 w-2.5',
                        (conn.availableScopes ?? [conn.scope]).includes('local')
                          ? 'text-emerald-500/80'
                          : 'text-muted-foreground/30',
                      )}
                    />
                    <Cloud
                      className={cn(
                        'h-2.5 w-2.5',
                        (conn.availableScopes ?? [conn.scope]).includes('remote')
                          ? 'text-sky-500/80'
                          : 'text-muted-foreground/30',
                      )}
                    />
                  </span>
                  {conn.shared && (
                    <span className="text-[9px] text-muted-foreground/70 ml-auto">
                      {conn.grantRole === 'write' ? t('role.write') : t('role.readOnly')}
                    </span>
                  )}
                </button>
                {!conn.shared && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => openEdit(conn)}>
                        <Edit3 className="h-3.5 w-3.5 mr-2" /> {t('common:edit')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSharing(conn)}>
                        <Share2 className="h-3.5 w-3.5 mr-2" /> {t('share')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setConfirmDelete(conn)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" /> {t('common:delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {expanded[conn.id] && <RepoList conn={conn} onOpen={(r) => openRepoTab(conn, r)} />}
              </div>
            ))}
          </div>
        )}
      </div>

      <GitConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={() => fetchConnections()}
      />
      {sharing && (
        <GitShareDialog
          open={!!sharing}
          onOpenChange={(o) => { if (!o) setSharing(null); }}
          connection={sharing}
        />
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sidebar.deleteTitle', { name: confirmDelete?.name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('sidebar.deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConnection}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {t('common:delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// RepoList: the connection's repositories under its sidebar row. Search runs
// server-side (the BE returns one page of the caller's projects, so a filter
// over that page would miss most repos), debounced like the Git client's
// picker. Mounted on expand, so the first expand is the first fetch.
function RepoList({ conn, onOpen }: { conn: GitConnection; onOpen: (repo: GitRepoSummary) => void }) {
  const { t } = useTranslation('git');
  const [query, setQuery] = useState('');
  const [repos, setRepos] = useState<GitRepoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seq = useRef(0);

  const load = useCallback(async (search: string) => {
    const mine = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const res = await gitAPI.repos(conn.id, { search: search || undefined });
      if (mine === seq.current) setRepos((res.data as GitRepoSummary[]) ?? []);
    } catch (err) {
      // e.g. 412 "Link your GitLab account in Settings…" — shown verbatim.
      if (mine === seq.current) { setRepos([]); setError(extractErr(err, t('errors.listRepos'))); }
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [conn.id, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(query.trim()), query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [query, load]);

  return (
    <div className="ml-4 pl-2 border-l border-border/60 mt-0.5 mb-1 space-y-0.5">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('repoPicker.searchPlaceholder')}
          className="w-full h-6 pl-6 pr-6 rounded border bg-transparent text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {loading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
      {error ? (
        <p className="px-1 py-1 text-[11px] text-destructive break-words">{error}</p>
      ) : !loading && repos.length === 0 ? (
        <p className="px-1 py-1 text-[11px] text-muted-foreground">{t('repoPicker.noResults')}</p>
      ) : (
        repos.map((r) => {
          const ns = r.fullPath && r.fullPath.endsWith(`/${r.path || r.name}`)
            ? r.fullPath.slice(0, -(r.path || r.name).length - 1)
            : '';
          return (
            <button
              key={String(r.id)}
              type="button"
              onClick={() => onOpen(r)}
              title={r.fullPath || r.name}
              className="w-full flex items-center gap-1.5 px-1 py-0.5 rounded text-left hover:bg-accent/40"
            >
              <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs truncate">{r.name}</span>
              {ns && <span className="text-[10px] text-muted-foreground/70 truncate min-w-0">{ns}</span>}
            </button>
          );
        })
      )}
    </div>
  );
}
