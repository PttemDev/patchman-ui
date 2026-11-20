import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Copy, EyeOff, File, FileDiff, FilePlus, FileSearch, Folder, FolderOpen, FolderPlus, GitBranch, GitCompare, History, Loader2, Pencil, Plus, RefreshCw, SquareArrowOutUpRight, Trash2, Undo2, UserRound } from 'lucide-react';
import { isDesktop } from '@/lib/platform';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { GitDiffViewer } from './GitDiffViewer';
import { gitAPI } from '@/services/api';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent,
  ContextMenuSubTrigger, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { confirmDialog } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import type { NamePromptState } from './GitVcsDialogs';
import { decodeGitContent, extractErr } from './util';

interface Entry { name: string; path: string; type: 'dir' | 'file' | 'symlink'; status?: string; ignored?: boolean }

// One-letter badge like an IDE's project view (M modified, A added, …).
const STATUS_LETTER: Record<string, string> = {
  modified: 'M', added: 'A', untracked: 'U', renamed: 'R', conflicted: 'C', deleted: 'D',
};

async function readAt(repoId: string, path: string, ref?: string): Promise<string> {
  try {
    const res = await gitAPI.localFile(repoId, ref ? { path, ref } : { path });
    const d = (res.data ?? {}) as { content?: string; encoding?: string };
    return decodeGitContent(d.content, d.encoding);
  } catch {
    return '';
  }
}

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
export function GitLocalTree({ repoId, selected, onOpen, onPrompt, onChanged, onReverted, onShowHistory, onAnnotate, onFindInFolder, compareRef, unsaved, reloadKey }: {
  repoId: string;
  selected?: string;
  onOpen: (path: string) => void;
  onPrompt: (p: NamePromptState) => void;
  /** a path was renamed (from → to) or deleted (to undefined) */
  onChanged?: (from?: string, to?: string) => void;
  /** a file went back to HEAD (its open editor must reload) */
  onReverted?: (path: string) => void;
  /** Git → Show History (commits touching this file / folder). */
  onShowHistory?: (path: string) => void;
  /** Git → Annotate (open the file with blame on). */
  onAnnotate?: (path: string) => void;
  /** Find in Folder (find in files limited to this folder). */
  onFindInFolder?: (dir: string) => void;
  /** Default ref for Compare with Branch (upstream / main). */
  compareRef?: string;
  /** Open files with unsaved edits: shown as modified (and their folders). */
  unsaved?: string[];
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

  // Show diff: HEAD (or another ref) ↔ working tree for one file.
  const [diff, setDiff] = useState<{ path: string; ref: string; original: string; modified: string } | null>(null);
  const showDiff = async (e: Entry, ref = 'HEAD') => {
    const isNew = ref === 'HEAD' && (e.status === 'untracked' || e.status === 'added');
    const [original, modified] = await Promise.all([isNew ? Promise.resolve('') : readAt(repoId, e.path, ref), readAt(repoId, e.path)]);
    setDiff({ path: e.path, ref, original, modified });
  };
  const compareWith = (e: Entry) => onPrompt({
    title: t('tree.compareTitle', { name: e.name }),
    label: t('tree.compareRef'),
    initial: compareRef || 'HEAD',
    submitLabel: t('tree.compare'),
    onSubmit: async (ref) => { await showDiff(e, ref.trim()); return true; },
  });

  // Absolute path on disk (copy / reveal).
  const absPath = async (rel: string) => {
    const { data } = await gitAPI.localPath(repoId);
    const root = String((data as { path: string }).path).replace(/\/+$/, '');
    return rel ? `${root}/${rel}` : root;
  };
  const copy = async (text: string | Promise<string>) => {
    try {
      await navigator.clipboard.writeText(await text);
      toast({ title: t('workspace.pathCopied') });
    } catch (err) {
      toast({ title: t('tree.failed'), description: extractErr(err, t('tree.failed')), variant: 'destructive' });
    }
  };
  const reveal = async (rel: string) => {
    try {
      const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
      await revealItemInDir(await absPath(rel));
    } catch (err) {
      toast({ title: t('reveal.failedTitle'), description: extractErr(err, t('errors.reveal')), variant: 'destructive' });
    }
  };
  // Git → Add (stage the file / folder).
  const stage = async (e: Entry) => {
    try {
      await gitAPI.stage(repoId, { path: e.path });
      refresh();
      toast({ title: t('tree.staged', { name: e.name }) });
    } catch (err) {
      toast({ title: t('tree.failed'), description: extractErr(err, t('tree.failed')), variant: 'destructive' });
    }
  };
  // Git → Add to .gitignore (appends "/path", a folder with a trailing "/").
  const ignore = async (e: Entry) => {
    try {
      let content = '';
      let sha: string | undefined;
      try {
        const res = await gitAPI.localFile(repoId, { path: '.gitignore' });
        const d = (res.data ?? {}) as { content?: string; encoding?: string; sha256?: string };
        content = decodeGitContent(d.content, d.encoding);
        sha = d.sha256;
      } catch { /* no .gitignore yet */ }
      const line = `/${e.path}${e.type === 'dir' ? '/' : ''}`;
      if (content.split('\n').some((l) => l.trim() === line)) { toast({ title: t('tree.alreadyIgnored') }); return; }
      const next = (content && !content.endsWith('\n') ? content + '\n' : content) + line + '\n';
      await gitAPI.writeFile(repoId, { path: '.gitignore', content: next, ...(sha ? { expectedSha256: sha } : {}) });
      refresh();
      toast({ title: t('tree.ignored', { line }) });
    } catch (err) {
      toast({ title: t('tree.failed'), description: extractErr(err, t('tree.failed')), variant: 'destructive' });
    }
  };
  // Rollback: back to HEAD (a new file is removed).
  const rollback = async (e: Entry) => {
    const isNew = e.status === 'untracked' || e.status === 'added';
    const ok = await confirmDialog({
      title: t('tree.rollbackTitle', { name: e.name }),
      description: isNew ? t('tree.rollbackNewBody') : e.type === 'dir' ? t('tree.rollbackFolderBody') : t('tree.rollbackBody'),
      destructive: true,
      confirmLabel: t('tree.rollback'),
    });
    if (!ok) return;
    if (await op({ op: 'rollback', path: e.path })) {
      refresh();
      if (isNew && e.type !== 'dir') onChanged?.(e.path, undefined);
      else onReverted?.(e.path);
      toast({ title: t('tree.rolledBack', { name: e.name }) });
    }
  };

  const unsavedSet = new Set(unsaved ?? []);
  const unsavedIn = (dir: string) => (unsaved ?? []).some((p) => p.startsWith(dir + '/'));
  const row = (raw: Entry, depth: number): React.ReactNode => {
    // An unsaved edit counts as modified before it reaches the disk.
    const e = raw.status ? raw : (raw.type === 'dir' ? unsavedIn(raw.path) : unsavedSet.has(raw.path)) ? { ...raw, status: 'modified' } : raw;
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
              {loading.has(e.path) ? <Loader2 className="ml-auto h-3 w-3 animate-spin text-muted-foreground" />
                : e.status && STATUS_LETTER[e.status] && (
                  isDir
                    ? <span className={cn('ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-current', STATUS_TONE[e.status])} title={t(`tree.status.${e.status}`)} />
                    : <span className={cn('ml-auto shrink-0 font-mono text-[10px] font-semibold', STATUS_TONE[e.status])} title={t(`tree.status.${e.status}`)}>{STATUS_LETTER[e.status]}</span>
                )}
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-60">
            {!isDir && <ContextMenuItem onClick={() => onOpen(e.path)}><File className="mr-2 h-3.5 w-3.5" />{t('tree.open')}</ContextMenuItem>}
            {isDir && <ContextMenuItem onClick={() => toggle(e.path)}>{isOpen ? <FolderOpen className="mr-2 h-3.5 w-3.5" /> : <Folder className="mr-2 h-3.5 w-3.5" />}{isOpen ? t('tree.collapse') : t('tree.expand')}</ContextMenuItem>}
            <ContextMenuSub>
              <ContextMenuSubTrigger><Plus className="mr-2 h-3.5 w-3.5" />{t('tree.new')}</ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-44">
                <ContextMenuItem onClick={() => create(isDir ? e.path : parentOf(e.path), 'create')}><FilePlus className="mr-2 h-3.5 w-3.5" />{t('tree.newFile')}</ContextMenuItem>
                <ContextMenuItem onClick={() => create(isDir ? e.path : parentOf(e.path), 'mkdir')}><FolderPlus className="mr-2 h-3.5 w-3.5" />{t('tree.newFolder')}</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger><Copy className="mr-2 h-3.5 w-3.5" />{t('tree.copyPathMenu')}</ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-56">
                <ContextMenuItem onClick={() => void copy(absPath(e.path))}>{t('tree.copyAbsolute')}</ContextMenuItem>
                <ContextMenuItem onClick={() => void copy(e.path)}>{t('tree.copyRelative')}</ContextMenuItem>
                <ContextMenuItem onClick={() => void copy(e.name)}>{t('tree.copyName')}</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            {onFindInFolder && (
              <ContextMenuItem onClick={() => onFindInFolder(isDir ? e.path : parentOf(e.path))}><FileSearch className="mr-2 h-3.5 w-3.5" />{t('tree.findInFolder')}<ContextMenuShortcut>⇧⌘F</ContextMenuShortcut></ContextMenuItem>
            )}
            <ContextMenuItem onClick={() => rename(e)}><Pencil className="mr-2 h-3.5 w-3.5" />{t('vcs.rename')}…</ContextMenuItem>
            <ContextMenuItem className="text-destructive" onClick={() => void remove(e)}><Trash2 className="mr-2 h-3.5 w-3.5" />{t('vcs.delete')}…</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger><GitBranch className="mr-2 h-3.5 w-3.5" />Git</ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-56">
                {(e.status === 'untracked' || e.status === 'modified' || e.status === 'conflicted') && (
                  <ContextMenuItem onClick={() => void stage(e)}><Plus className="mr-2 h-3.5 w-3.5" />{t('tree.gitAdd')}</ContextMenuItem>
                )}
                {!isDir && (
                  <ContextMenuItem disabled={!e.status || e.status === 'deleted'} onClick={() => void showDiff(e)}><FileDiff className="mr-2 h-3.5 w-3.5" />{t('tree.showDiff')}</ContextMenuItem>
                )}
                {!isDir && e.status !== 'untracked' && (
                  <ContextMenuItem onClick={() => compareWith(e)}><GitCompare className="mr-2 h-3.5 w-3.5" />{t('tree.compareWithBranch')}…</ContextMenuItem>
                )}
                {onShowHistory && e.status !== 'untracked' && (
                  <ContextMenuItem onClick={() => onShowHistory(e.path)}><History className="mr-2 h-3.5 w-3.5" />{t('tree.showHistory')}</ContextMenuItem>
                )}
                {onAnnotate && !isDir && e.status !== 'untracked' && e.status !== 'added' && (
                  <ContextMenuItem onClick={() => onAnnotate(e.path)}><UserRound className="mr-2 h-3.5 w-3.5" />{t('tree.annotate')}</ContextMenuItem>
                )}
                <ContextMenuSeparator />
                <ContextMenuItem disabled={!e.status || e.status === 'deleted'} onClick={() => void rollback(e)}><Undo2 className="mr-2 h-3.5 w-3.5" />{t('tree.rollback')}…</ContextMenuItem>
                {e.status === 'untracked' && (
                  <ContextMenuItem onClick={() => void ignore(e)}><EyeOff className="mr-2 h-3.5 w-3.5" />{t('tree.addToGitignore')}</ContextMenuItem>
                )}
              </ContextMenuSubContent>
            </ContextMenuSub>
            {isDesktop() && (
              <ContextMenuItem onClick={() => void reveal(e.path)}><SquareArrowOutUpRight className="mr-2 h-3.5 w-3.5" />{t('tree.revealInFinder')}</ContextMenuItem>
            )}
          </ContextMenuContent>
        </ContextMenu>
        {isDir && isOpen && (kids[e.path] ?? []).map((c) => row(c, depth + 1))}
      </div>
    );
  };

  return (
    // select-none: a right-click must open our menu, not select text.
    <div className="flex min-h-full flex-col select-none py-1">
      <div className="flex items-center gap-1 px-2 pb-1">
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t('tree.title')}</span>
        <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" title={t('tree.newFile')} aria-label={t('tree.newFile')} onClick={() => create('', 'create')}><FilePlus className="h-3.5 w-3.5" /></button>
        <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" title={t('tree.newFolder')} aria-label={t('tree.newFolder')} onClick={() => create('', 'mkdir')}><FolderPlus className="h-3.5 w-3.5" /></button>
        <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" title={t('mr.refresh')} aria-label={t('mr.refresh')} onClick={refresh}><RefreshCw className="h-3.5 w-3.5" /></button>
      </div>
      {!kids[''] ? <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div> : kids[''].map((e) => row(e, 0))}
      {/* Empty space below the files: new file / folder at the root (and no
          browser menu). */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="min-h-8 flex-1" />
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onClick={() => create('', 'create')}><FilePlus className="mr-2 h-3.5 w-3.5" />{t('tree.newFile')}</ContextMenuItem>
          <ContextMenuItem onClick={() => create('', 'mkdir')}><FolderPlus className="mr-2 h-3.5 w-3.5" />{t('tree.newFolder')}</ContextMenuItem>
          <ContextMenuSeparator />
          {onFindInFolder && <ContextMenuItem onClick={() => onFindInFolder('')}><FileSearch className="mr-2 h-3.5 w-3.5" />{t('tree.findInProject')}</ContextMenuItem>}
          <ContextMenuItem onClick={() => setOpen(new Set())}><Folder className="mr-2 h-3.5 w-3.5" />{t('tree.collapseAll')}</ContextMenuItem>
          {isDesktop() && <ContextMenuItem onClick={() => void reveal('')}><SquareArrowOutUpRight className="mr-2 h-3.5 w-3.5" />{t('tree.revealInFinder')}</ContextMenuItem>}
          <ContextMenuItem onClick={refresh}><RefreshCw className="mr-2 h-3.5 w-3.5" />{t('mr.refresh')}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <Dialog open={!!diff} onOpenChange={(o) => { if (!o) setDiff(null); }}>
        <DialogContent className="flex h-[80vh] w-[92vw] max-w-[1300px] flex-col gap-2 overflow-hidden p-3">
          <DialogTitle className="text-sm">{diff && diff.ref !== 'HEAD' ? t('tree.compareDiffTitle', { path: diff.path, ref: diff.ref }) : t('tree.diffTitle', { path: diff?.path ?? '' })}</DialogTitle>
          {diff && <div className="min-h-0 flex-1 rounded border"><GitDiffViewer original={diff.original} modified={diff.modified} path={diff.path} /></div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
