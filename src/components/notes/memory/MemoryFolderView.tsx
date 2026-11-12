import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, ChevronDown, ChevronRight, FileText, Folder as FolderIcon, Inbox, List, Loader2, Plus, Search, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useNotesStore } from '@/stores/notesStore';
import { useMemoryStore } from '@/stores/memoryStore';
import { notesAPI } from '@/services/api';
import { cn } from '@/lib/utils';
import type { Note, NoteMeta } from '@/types';
import { ScopeBadge, SourceBadge } from './MemoryBits';
import { SuggestionsDialog } from './SuggestionsDialog';
import { MemorySettingsDialog } from './MemorySettingsDialog';
import { openNoteTab } from '../useOpenNote';
import { formatWhen, noteTimesTitle } from '../time';
import { lazyWithReload } from '@/lib/lazyWithReload';
import { NoteLinksPanel } from './NoteLinksPanel';
import { BrainHelpButton } from './BrainHelp';
import { memoryRootOf } from '../noteUtils';

const MemoryBrain = lazyWithReload(() => import('./MemoryBrain'));

const VIEW_KEY = 'patchman_memory_view';

// MemoryFolderView is an agent memory folder (or one of its project folders)
// opened in a tab. List: its cards grouped by project (title, one-line
// summary, who wrote it; outdated ones faded at the bottom) instead of a tree
// of tiny pages. Brain: the same memory as a living graph of projects, cards
// and their links (MemoryBrain). The folder's scope, its open suggestions and
// the memory settings stay at hand.
export function MemoryFolderView({ note, canEdit, titleBlock }: { note: Note; canEdit: boolean; titleBlock: ReactNode }) {
  const { t, i18n } = useTranslation('notes');
  const { toast } = useToast();
  const own = useNotesStore((s) => s.notes);
  const shared = useNotesStore((s) => s.shared);
  const refreshAll = useNotesStore((s) => s.refreshAll);
  const all = useMemo(() => {
    const seen = new Set<string>();
    return [...own, ...shared].filter((n) => !seen.has(n.id) && seen.add(n.id));
  }, [own, shared]);
  // A folder inside a memory (a project or any other) opens here too; the
  // memory it belongs to holds the scope, the inbox and the counts.
  const isSub = !note.memory;
  const isProject = isSub && !!note.project;
  const memoryId = useMemo(() => (note.memory ? note.id : memoryRootOf(note.id, all) || note.id), [note.id, note.memory, all]);
  const folder = useMemoryStore((s) => s.folders.find((f) => f.id === memoryId));
  const suggestions = useMemoryStore((s) => s.suggestions.filter((x) => x.folderId === memoryId).length);
  const refreshMemory = useMemoryStore((s) => s.refresh);
  const [q, setQ] = useState('');
  const [showInbox, setShowInbox] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<'list' | 'brain'>(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'brain' ? 'brain' : 'list'; } catch { return 'list'; }
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const switchMode = (m: 'list' | 'brain') => {
    setMode(m);
    try { localStorage.setItem(VIEW_KEY, m); } catch { /* per-viewer convenience only */ }
  };

  useEffect(() => { void refreshMemory(); }, [refreshMemory, note.id]);

  // Groups: every folder right under this one — projects and plain folders
  // alike; '' holds what sits in this folder itself. Each lists its cards,
  // pages and inner folders.
  const { subfolders, groups, cardCount, pageCount } = useMemo(() => {
    const kids = new Map<string, NoteMeta[]>();
    for (const n of all) {
      if (!n.parentId) continue;
      if (!kids.has(n.parentId)) kids.set(n.parentId, []);
      kids.get(n.parentId)!.push(n);
    }
    const byOrder = (a: NoteMeta, b: NoteMeta) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.title.localeCompare(b.title);
    const subs = (kids.get(note.id) ?? []).filter((n) => n.type === 'folder').sort(byOrder);
    const needle = q.trim().toLocaleLowerCase();
    const hit = (n: NoteMeta) => !needle || n.title.toLocaleLowerCase().includes(needle) || (n.summary ?? '').toLocaleLowerCase().includes(needle);
    const rank = (n: NoteMeta) => (n.type === 'folder' ? 0 : n.type === 'card' ? 2 : 1);
    const itemsOf = (id: string, nested: boolean) => (kids.get(id) ?? [])
      .filter((n) => (nested || n.type !== 'folder') && hit(n))
      .sort((a, b) => rank(a) - rank(b) || (a.type === 'card' && b.type === 'card'
        ? Number(!!a.stale) - Number(!!b.stale) || b.updatedAt.localeCompare(a.updatedAt)
        : byOrder(a, b)));
    const by = new Map<string, NoteMeta[]>();
    by.set('', itemsOf(note.id, false));
    for (const f of subs) by.set(f.id, itemsOf(f.id, true));
    // Totals over the whole subtree.
    let cards = 0, pages = 0;
    const walk = (id: string, depth: number) => {
      for (const n of kids.get(id) ?? []) {
        if (n.type === 'card') cards++;
        else if (n.type === 'page') pages++;
        else if (n.type === 'folder' && depth < 16) walk(n.id, depth + 1);
      }
    };
    walk(note.id, 0);
    return { subfolders: subs, groups: by, cardCount: cards, pageCount: pages };
  }, [all, note.id, q]);
  const itemTotal = useMemo(() => [...groups.values()].reduce((n, l) => n + l.length, 0), [groups]);

  const newCard = async () => {
    try {
      const res = await notesAPI.create({ title: t('memory.newCardTitle'), type: 'card', parentId: note.id });
      const n = res.data as Note;
      await refreshAll();
      openNoteTab(n.id, n.title);
    } catch {
      toast({ title: t('createFailed'), variant: 'destructive' });
    }
  };

  return (
    <div className={cn('flex-1 min-h-0 flex flex-col', mode === 'list' && 'overflow-y-auto')}>
      <div className={cn('mx-auto px-6 pt-8 pb-3 w-full', mode === 'brain' ? 'max-w-none' : 'max-w-3xl')}>
        {titleBlock}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <ScopeBadge scope={folder?.scope} />
          <span className="text-xs text-muted-foreground">{t('memory.cardsCount', { count: cardCount })}</span>
          {pageCount > 0 && <span className="text-xs text-muted-foreground">· {t('memory.pagesCount', { count: pageCount })}</span>}
          {subfolders.length > 0 && <span className="text-xs text-muted-foreground">· {t('memory.foldersCount', { count: subfolders.length })}</span>}
          <div className="ml-auto flex items-center gap-1">
            <div className="flex rounded-md border p-0.5" role="tablist" aria-label={t('memory.viewMode')}>
              <button type="button" role="tab" aria-selected={mode === 'list'} onClick={() => switchMode('list')} className={cn('h-6 px-2 rounded text-xs flex items-center gap-1', mode === 'list' && 'bg-accent font-medium')}>
                <List className="h-3.5 w-3.5" /> {t('memory.listView')}
              </button>
              <button type="button" role="tab" aria-selected={mode === 'brain'} onClick={() => switchMode('brain')} className={cn('h-6 px-2 rounded text-xs flex items-center gap-1', mode === 'brain' && 'bg-accent font-medium')}>
                <Brain className="h-3.5 w-3.5" /> {t('memory.brainView')}
              </button>
            </div>
            <BrainHelpButton variant="outline" className="h-7 w-7" />
            {(folder?.canWrite ?? canEdit) && (
              <Button size="sm" variant={suggestions > 0 ? 'default' : 'outline'} className="h-7 text-xs gap-1" onClick={() => setShowInbox(true)}>
                <Inbox className="h-3.5 w-3.5" /> {t('memory.suggestionsN', { count: suggestions })}
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowSettings(true)} title={t('memory.settings')}>
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
            {canEdit && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => void newCard()}>
                <Plus className="h-3.5 w-3.5" /> {t('memory.newCard')}
              </Button>
            )}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{mode === 'brain' ? t('memory.brainHint') : t('memory.folderHint')}</p>

        {mode === 'list' && (
          <div className="relative mt-4">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('memory.filter')}
              className="w-full h-8 pl-7 pr-2 rounded-md border bg-transparent text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        )}
      </div>

      {/* A project's links to other projects (depends on, related…). */}
      {isSub && mode === 'list' && (
        <div className="max-w-3xl w-full mx-auto px-6">
          <NoteLinksPanel noteId={note.id} canEdit={canEdit} onOpen={(id) => openNoteTab(id, '')} />
        </div>
      )}

      {mode === 'brain' ? (
        <div className="flex-1 min-h-0 flex px-6 pb-6">
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
            <MemoryBrain rootId={note.id} rootLabel={isProject ? t('memory.brain.thisProject') : isSub ? t('memory.brain.thisFolder') : t('memory.brain.thisMemory')} />
          </Suspense>
        </div>
      ) : (
        <div className="max-w-3xl w-full mx-auto px-6 pb-8">
          {itemTotal === 0 && subfolders.length === 0 ? (
            <div className="mt-8 flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
              <Brain className="h-8 w-8 opacity-40" />
              <p className="max-w-sm">{q ? t('noResults') : t('memory.empty')}</p>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {[...subfolders.map((f) => ({ id: f.id, title: f.title, project: !!f.project })), { id: '', title: '', project: false }]
                .filter((g) => (groups.get(g.id)?.length ?? 0) > 0 || (g.id !== '' && !q))
                .map((g) => {
                  const list = groups.get(g.id) ?? [];
                  const grouped = subfolders.length > 0;
                  const open = !collapsed.has(g.id) && list.length > 0;
                  return (
                    <section key={g.id || 'root'}>
                      {grouped && (
                        <button
                          type="button"
                          onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}
                          className="w-full flex items-center gap-2 py-1 text-left"
                          aria-expanded={open}
                          disabled={list.length === 0}
                        >
                          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground', list.length === 0 && 'opacity-30')} />}
                          {g.id ? (
                            <FolderIcon className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                          ) : null}
                          <span className="text-sm font-semibold">{g.id ? g.title : t('memory.notInFolder')}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{list.length > 0 ? list.length : t('memory.emptyFolder')}</span>
                          {g.id && (
                            <span
                              role="link"
                              tabIndex={0}
                              onClick={(e) => { e.stopPropagation(); openNoteTab(g.id, g.title); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); openNoteTab(g.id, g.title); } }}
                              className="ml-auto text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                            >
                              {t('memory.openFolder')}
                            </span>
                          )}
                        </button>
                      )}
                      {open && (
                        <ul className="divide-y border rounded-md">
                          {list.map((c) => (
                            <li key={c.id}>
                              <button
                                type="button"
                                onClick={() => openNoteTab(c.id, c.title)}
                                className={cn('w-full text-left px-3 py-2 hover:bg-accent/40 transition-colors', c.stale && 'opacity-55')}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {c.type === 'page' && <FileText className="h-3.5 w-3.5 shrink-0 text-sky-500/80" />}
                                  {c.type === 'folder' && <FolderIcon className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
                                  <span className={cn('text-sm font-medium truncate', c.stale && 'line-through')}>{c.title || t('untitled')}</span>
                                  {c.stale && <span className="text-[10px] rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 px-1.5">{t('memory.stale')}</span>}
                                  <span className="ml-auto shrink-0 flex items-center gap-2">
                                    {c.type === 'card' && <SourceBadge source={c.source} agent={c.agent} />}
                                    <span className="text-[10px] text-muted-foreground" title={noteTimesTitle(c, i18n.language, t)}>{formatWhen(c.updatedAt, i18n.language)}</span>
                                  </span>
                                </div>
                                {c.summary && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{c.summary}</p>}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  );
                })}
            </div>
          )}
        </div>
      )}
      {showInbox && <SuggestionsDialog open={showInbox} onOpenChange={setShowInbox} folderId={memoryId} />}
      {showSettings && <MemorySettingsDialog open={showSettings} onOpenChange={setShowSettings} />}
    </div>
  );
}
