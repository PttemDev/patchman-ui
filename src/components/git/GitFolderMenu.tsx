// Git tab → Open folder: pick any git working tree on this machine (desktop
// only) and reopen recent ones. The folder is used where it is — nothing is
// copied, and removing it from the list never touches the files.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderGit2, FolderInput, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useGitRecentFoldersStore, type RecentGitFolder } from '@/stores/gitRecentFoldersStore';
import { gitAPI } from '@/services/api';
import type { Tab } from '@/types';

/** The local-repo row the BE returns for an opened folder (models.GitRepo). */
export interface OpenedFolder {
  id: string; connectionId: string; projectRef: string; projectName: string; localPath: string;
}

/** Register a folder with the local BE, record it in the recent list and
 *  return the Git-tab fields that show it. Linked = origin matched one of the
 *  user's git connections (decided by the BE row). */
export async function openGitFolder(path: string, recentId?: string): Promise<{ repo: OpenedFolder; tab: Partial<Tab> }> {
  const res = await gitAPI.openFolder({ repoId: crypto.randomUUID(), path });
  const repo = (res.data as { repo: OpenedFolder }).repo;
  const recents = useGitRecentFoldersStore.getState();
  if (recentId && recentId !== repo.id) recents.remove(recentId);
  recents.touch({ repoId: repo.id, path: repo.localPath, name: repo.projectName || repo.localPath });
  const linked = !!repo.connectionId;
  return {
    repo,
    tab: {
      gitConnectionId: linked ? repo.connectionId : '',
      ...(linked ? { gitScope: 'local' as const } : {}),
      gitRepoRef: linked ? repo.projectRef : `local:${repo.id}`,
      gitRepoName: repo.projectName || repo.localPath,
      gitRepoId: repo.id,
      gitRef: '',
      gitView: 'changes',
    },
  };
}

/** Native folder picker (tauri-plugin-dialog, already registered in the
 *  shell with `dialog:default`). Returns null when cancelled. */
export async function pickGitFolder(title: string): Promise<string | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  const res = await invoke<string | string[] | null>('plugin:dialog|open', {
    options: { directory: true, multiple: false, title },
  });
  return Array.isArray(res) ? (res[0] ?? null) : res;
}

export function RecentFolderList({ onOpen, missing, activeRepoId, busy }: {
  onOpen: (f: RecentGitFolder) => void;
  missing: (repoId: string) => boolean;
  activeRepoId?: string;
  busy?: string | null;
}) {
  const { t } = useTranslation('git');
  const { folders, remove } = useGitRecentFoldersStore();
  if (!folders.length) return <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">{t('folder.noRecent')}</p>;
  return (
    <div className="space-y-0.5">
      {folders.map((f) => {
        const gone = missing(f.repoId);
        return (
          <div key={f.repoId} className={cn('group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent/50', f.repoId === activeRepoId && 'bg-primary/5')}>
            <button type="button" disabled={gone || !!busy} onClick={() => onOpen(f)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
              title={gone ? t('folder.missing') : f.path}>
              {busy === f.repoId
                ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                : <FolderGit2 className={cn('h-3.5 w-3.5 shrink-0', gone ? 'text-muted-foreground' : 'text-orange-500')} />}
              <span className={cn('min-w-0 flex-1', gone && 'opacity-50')}>
                <span className="block truncate text-xs font-medium">{f.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{gone ? t('folder.missing') : f.path}</span>
              </span>
            </button>
            <button type="button" onClick={() => remove(f.repoId)} title={t('folder.removeRecent')} aria-label={t('folder.removeRecent')}
              className="hidden shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground group-hover:block">
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function GitFolderMenu({ onOpenPath, missing, activeRepoId }: {
  onOpenPath: (path: string, repoId?: string) => Promise<void>;
  missing: (repoId: string) => boolean;
  activeRepoId?: string;
}) {
  const { t } = useTranslation('git');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); setOpen(false); } finally { setBusy(null); }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" title={t('folder.open')}>
          <FolderInput className="h-3.5 w-3.5" />
          {t('folder.button')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-1.5">
        <button type="button" disabled={!!busy}
          onClick={() => void run('pick', async () => { const p = await pickGitFolder(t('folder.pickTitle')); if (p) await onOpenPath(p); })}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-medium hover:bg-accent/50">
          {busy === 'pick' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderInput className="h-3.5 w-3.5" />}
          {t('folder.open')}
        </button>
        <div className="mb-1 mt-1.5 border-t px-2 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t('folder.recent')}</div>
        <div className="max-h-[50vh] overflow-auto">
          <RecentFolderList busy={busy} missing={missing} activeRepoId={activeRepoId}
            onOpen={(f) => void run(f.repoId, () => onOpenPath(f.path, f.repoId))} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
