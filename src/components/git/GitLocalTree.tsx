import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, File, FilePlus, Folder, FolderOpen, FolderPlus, Loader2, RefreshCw } from 'lucide-react';
import { gitAPI } from '@/services/api';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { confirmDialog } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import type { NamePromptState } from './GitVcsDialogs';
import { extractErr } from './util';

interface Entry { name: string; path: string; type: 'dir' | 'file' | 'symlink'; status?: string; ignored?: boolean }

const STATUS_TONE: Record<string, string> = {
  modified: 'text-sky-600 dark:text-sky-400',
  added: 'text-emerald-600 dark:text-emerald-400',
  untracked: 'text-red-500 dark:text-red-400',
  renamed: 'text-sky-600 dark:text-sky-400',
  conflicted: 'text-red-600 font-semibold',
  deleted: 'text-muted-foreground line-through',
};

// The clone's working tree (not the remote's tree at a ref): status colours
// like an IDE project view, and a context menu for new / rename / delete.
export function GitLocalTree({ repoId, selected, onOpen, onPrompt, onChanged, reloadKey }: {
  repoId: string;
  selected?: string;
  onOpen: (path: string) => void;
  onPrompt: (p: NamePromptState) => void;
  /** a path was renamed (from → to) or deleted (to undefined) */
  onChanged?: (from?: string, to?: string) => void;
  reloadKey?: number;
}) {
  const { t } = useTranslation('git');
  const { toast } = useToast();
  const [kids, setKids] = useState<Record<string, Entry[]>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());

  const load = useCallback(async (dir: string) => {
    setLoading((s) => new Set(s).add(dir));
    try {
      const res = await gitAPI.ls(repoId, dir);
      setKids((k) => ({ ...k, [dir]: (res.data as Entry[]) ?? [] }));
    } catch {
      setKids((k) => ({ ...k, [dir]: [] }));
    } finally {
      setLoading((s) => { const n = new Set(s); n.delete(dir); return n; });
    }
  }, [repoId]);

  // Refresh what is on screen (root + open folders).
  const refresh = useCallback(() => {
    void load('');
    open.forEach((d) => void load(d));
  }, [load, open]);
  useEffect(() => { refresh(); }, [repoId, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (d: string) => {
    setOpen((s) => { const n = new Set(s); if (n.has(d)) n.delete(d); else { n.add(d); if (!kids[d]) void load(d); } return n; });
  };
  const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

  const op = async (body: Parameters<typeof gitAPI.fsOp>[1]) => {
    try {
      await gitAPI.fsOp(repoId, body);
      return true;
    } catch (e) {
      toast({ title: t('tree.failed'), description: extractErr(e, t('tree.failed')), variant: 'destructive' });
      return false;
    }
  };
  const create = (dir: string, kind: 'create' | 'mkdir') => onPrompt({
    title: kind === 'create' ? t('tree.newFile') : t('tree.newFolder'),
    label: dir ? t('tree.inFolder', { dir }) : t('tree.atRoot'),
    placeholder: kind === 'create' ? 'name.go' : 'folder',
    submitLabel: t('vcs.create'),
    onSubmit: async (name) => {
      const path = dir ? `${dir}/${name}` : name;
      const ok = await op({ op: kind, path });
      if (ok) {
        if (dir) setOpen((s) => new Set(s).add(dir));
        await load(dir);
        refresh();
        if (kind === 'create') onOpen(path);
      }
      return ok;
    },
  });
  const rename = (e: Entry) => onPrompt({
    title: t('tree.rename', { name: e.name }),
    label: t('tree.newPath'),
    initial: e.path,
    submitLabel: t('vcs.rename'),
    onSubmit: async (to) => {
      const ok = await op({ op: 'rename', path: e.path, newPath: to });
      if (ok) { refresh(); await load(parentOf(to)); onChanged?.(e.path, to); }
      return ok;
    },
  });
  const remove = async (e: Entry) => {
    const ok = await confirmDialog({
      title: t('tree.deleteTitle', { name: e.name }),
      description: e.type === 'dir' ? t('tree.deleteFolderBody') : t('tree.deleteFileBody'),
      destructive: true,
      confirmLabel: t('vcs.delete'),
    });
    if (!ok) return;
    if (await op({ op: 'delete', path: e.path })) { refresh(); onChanged?.(e.path, undefined); }
  };

  const row = (e: Entry, depth: number): React.ReactNode => {
    const isDir = e.type === 'dir';
    const isOpen = open.has(e.path);
    return (
      <div key={e.path}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              onClick={() => (isDir ? toggle(e.path) : onOpen(e.path))}
              style={{ paddingLeft: 6 + depth * 12 }}
              className={cn('flex w-full items-center gap-1 py-0.5 pr-2 text-left text-xs hover:bg-accent/50',
                selected === e.path && 'bg-accent', e.ignored && 'opacity-50')}
              title={e.path}
            >
              {isDir ? <ChevronRight className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} /> : <span className="w-3 shrink-0" />}
              {isDir ? (isOpen ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />)
                : <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <span className={cn('truncate', e.status && STATUS_TONE[e.status])}>{e.name}</span>
              {loading.has(e.path) && <Loader2 className="ml-auto h-3 w-3 animate-spin text-muted-foreground" />}
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-48">
            <ContextMenuItem onClick={() => create(isDir ? e.path : parentOf(e.path), 'create')}><FilePlus className="mr-2 h-3.5 w-3.5" />{t('tree.newFile')}</ContextMenuItem>
            <ContextMenuItem onClick={() => create(isDir ? e.path : parentOf(e.path), 'mkdir')}><FolderPlus className="mr-2 h-3.5 w-3.5" />{t('tree.newFolder')}</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => rename(e)}>{t('vcs.rename')}…</ContextMenuItem>
            <ContextMenuItem onClick={() => { void navigator.clipboard.writeText(e.path); }}>{t('tree.copyPath')}</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-destructive" onClick={() => void remove(e)}>{t('vcs.delete')}</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {isDir && isOpen && (kids[e.path] ?? []).map((c) => row(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="py-1">
      <div className="flex items-center gap-1 px-2 pb-1">
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t('tree.title')}</span>
        <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" title={t('tree.newFile')} aria-label={t('tree.newFile')} onClick={() => create('', 'create')}><FilePlus className="h-3.5 w-3.5" /></button>
        <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" title={t('tree.newFolder')} aria-label={t('tree.newFolder')} onClick={() => create('', 'mkdir')}><FolderPlus className="h-3.5 w-3.5" /></button>
        <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" title={t('mr.refresh')} aria-label={t('mr.refresh')} onClick={refresh}><RefreshCw className="h-3.5 w-3.5" /></button>
      </div>
      {!kids[''] ? <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div> : kids[''].map((e) => row(e, 0))}
    </div>
  );
}
