import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, FolderPlus, Loader2, NotebookText, Users2, Globe2, ChevronDown, ChevronRight, Search, X, FileText, Brain, Inbox, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { useNotesStore } from '@/stores/notesStore';
import { useAuthStore } from '@/stores/authStore';
import { useMemoryStore } from '@/stores/memoryStore';
import { notesAPI } from '@/services/api';
import type { NoteMeta, NoteSearchHit } from '@/types';
import { NoteTree } from './NoteTree';
import { openNoteTab } from './useOpenNote';
import { SuggestionsDialog } from './memory/SuggestionsDialog';
import { MemorySettingsDialog } from './memory/MemorySettingsDialog';
import { BrainHelpButton, BrainHelpCard } from './memory/BrainHelp';

// MemoryStrip: agent memory at a glance — open your memory, review what
// agents suggested (badge = open suggestions), memory settings. Shown once
// there is a memory folder or something to review.
function MemoryStrip() {
  const { t } = useTranslation('notes');
  const folders = useMemoryStore((s) => s.folders);
  const pending = useMemoryStore((s) => s.suggestions.length);
  const refresh = useMemoryStore((s) => s.refresh);
  const [inbox, setInbox] = useState(false);
  const [settings, setSettings] = useState(false);
  useEffect(() => { void refresh(); }, [refresh]);
  if (folders.length === 0 && pending === 0) return null;
  const personal = folders.find((f) => f.isOwner && f.scope.kind === 'personal') ?? folders[0];
  return (
    <div className="flex items-center gap-1 rounded-md border bg-violet-500/5 border-violet-500/20 px-1.5 py-1">
      <button
        type="button"
        className="flex-1 min-w-0 flex items-center gap-1.5 text-xs font-medium hover:text-foreground text-foreground/90"
        onClick={() => personal && openNoteTab(personal.id, personal.title)}
        title={t('memory.openMemory')}
      >
        <Brain className="h-3.5 w-3.5 text-violet-400 shrink-0" />
        <span className="truncate">{t('memory.title')}</span>
        {folders.length > 1 && <span className="text-[10px] text-muted-foreground">{folders.length}</span>}
      </button>
      <Button size="sm" variant={pending > 0 ? 'default' : 'ghost'} className="h-6 px-1.5 text-[11px] gap-1" onClick={() => setInbox(true)} title={t('memory.inboxTitle')}>
        <Inbox className="h-3.5 w-3.5" />{pending > 0 && <span className="tabular-nums">{pending}</span>}
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setSettings(true)} title={t('memory.settings')}>
        <Settings2 className="h-3.5 w-3.5" />
      </Button>
      {inbox && <SuggestionsDialog open={inbox} onOpenChange={setInbox} />}
      {settings && <MemorySettingsDialog open={settings} onOpenChange={setSettings} />}
    </div>
  );
}

function usePersistedOpen(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(key) !== '0'; } catch { return true; }
  });
  const toggle = useCallback(() => {
    setOpen((v) => {
      try { localStorage.setItem(key, v ? '0' : '1'); } catch { /* ignore */ }
      return !v;
    });
  }, [key]);
  return [open, toggle];
}

function SectionHeader({ open, onToggle, icon, label, count }: { open: boolean; onToggle: () => void; icon: ReactNode; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/40 rounded transition-colors"
    >
      {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      {icon}
      <span className="uppercase tracking-wider">{label}</span>
      {count > 0 && <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5">{count}</Badge>}
    </button>
  );
}

const open = (n: NoteMeta) => openNoteTab(n.id, n.title);

// NotesHeaderActions — Refresh + New space + New page in the panel header,
// plus the "how to turn on Brain" help (always reachable, even after the
// sidebar card is dismissed).
export function NotesHeaderActions() {
  const { t } = useTranslation(['notes', 'common']);
  const { toast } = useToast();
  const refreshAll = useNotesStore((s) => s.refreshAll);
  const createNote = useNotesStore((s) => s.createNote);
  const create = async (type: 'page' | 'folder') => {
    try {
      const n = await createNote({ title: type === 'folder' ? t('newSpaceTitle') : t('untitled'), type });
      if (type === 'page') open(n);
    } catch {
      toast({ title: t('createFailed'), variant: 'destructive' });
    }
  };
  return (
    <div className="flex items-center gap-0.5">
      <BrainHelpButton />
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => refreshAll()} title={t('common:refresh')}>
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => create('folder')} title={t('newSpace')}>
        <FolderPlus className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => create('page')} title={t('newPage')}>
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function SearchResults({ query }: { query: string }) {
  const { t } = useTranslation('notes');
  const [hits, setHits] = useState<NoteSearchHit[] | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    setHits(null);
    const timer = window.setTimeout(() => {
      notesAPI.search(query, 30)
        .then((res) => { if (mine === seq.current) setHits((res.data as NoteSearchHit[]) ?? []); })
        .catch(() => { if (mine === seq.current) setHits([]); });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query]);
  if (!hits) return <div className="flex justify-center py-3"><Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /></div>;
  if (hits.length === 0) return <p className="px-2 py-2 text-[11px] text-muted-foreground italic">{t('noResults')}</p>;
  return (
    <div className="space-y-0.5">
      {hits.map((h) => (
        <button
          key={h.id}
          type="button"
          onClick={() => openNoteTab(h.id, h.title)}
          className="w-full text-left px-2 py-1.5 rounded hover:bg-accent/40"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {h.icon ? <span className="text-sm leading-none">{h.icon}</span> : <FileText className="h-3.5 w-3.5 shrink-0 text-sky-500/80" />}
            <span className="text-sm truncate font-medium">{h.title}</span>
          </div>
          {(h.breadcrumb?.length ?? 0) > 0 && <div className="pl-5 text-[10px] text-muted-foreground truncate">{h.breadcrumb.join(' / ')}</div>}
          {h.snippet && <div className="pl-5 text-[11px] text-muted-foreground line-clamp-2">{h.snippet}</div>}
        </button>
      ))}
    </div>
  );
}

export function NotesSidebar() {
  const { t } = useTranslation(['notes', 'common']);
  const { notes, shared, loading, loaded, fetchNotes, fetchShared, createNote } = useNotesStore();
  const isLocal = useAuthStore((s) => s.mode === 'local');
  const [mineOpen, toggleMine] = usePersistedOpen('patchman_notes_mine_open');
  const [sharedOpen, toggleShared] = usePersistedOpen('patchman_notes_shared_open');
  const [everyoneOpen, toggleEveryone] = usePersistedOpen('patchman_notes_everyone_open');
  const [query, setQuery] = useState('');

  useEffect(() => {
    void fetchNotes();
    if (!isLocal) void fetchShared();
  }, [fetchNotes, fetchShared, isLocal]);

  // Split the shared list by its share root: company-wide ("everyone") spaces
  // get their own section; direct/team shares stay in "Shared with me".
  const { direct, everyone } = useMemo(() => {
    const byId = new Map(shared.map((n) => [n.id, n]));
    const rootOf = (n: NoteMeta) => {
      let cur = n;
      for (let i = 0; i < 64 && cur.parentId && byId.has(cur.parentId); i++) cur = byId.get(cur.parentId)!;
      return cur;
    };
    const d: NoteMeta[] = [];
    const e: NoteMeta[] = [];
    for (const n of shared) (rootOf(n).everyone ? e : d).push(n);
    return { direct: d, everyone: e };
  }, [shared]);

  const newPage = async () => {
    const n = await createNote({ title: t('untitled') });
    open(n);
  };

  return (
    <div className="p-2 flex flex-col gap-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="w-full h-7 pl-7 pr-7 rounded-md border bg-transparent text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={t('clearSearch')}>
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {query.trim() ? (
        <SearchResults query={query.trim()} />
      ) : (
        <>
          <MemoryStrip />
          <BrainHelpCard />
          <section className="flex flex-col">
            <SectionHeader open={mineOpen} onToggle={toggleMine} icon={<NotebookText className="h-3 w-3 text-sky-500" />} label={t('myNotes')} count={notes.filter((n) => !n.parentId).length} />
            {mineOpen && (
              <div className="pl-1 pr-0.5 pt-1">
                {notes.length === 0 && (loading || !loaded) ? (
                  <div className="flex items-center justify-center py-3"><Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /></div>
                ) : notes.length === 0 ? (
                  <div className="px-2 py-1.5">
                    <p className="text-[11px] text-muted-foreground italic">{t('empty')}</p>
                    <Button size="sm" variant="outline" className="mt-2 h-7 text-xs gap-1" onClick={newPage}>
                      <Plus className="h-3.5 w-3.5" /> {t('addFirst')}
                    </Button>
                  </div>
                ) : (
                  <NoteTree notes={notes} mode="own" onOpen={open} />
                )}
              </div>
            )}
          </section>

          {!isLocal && (
            <>
              <div className="h-px bg-border mx-2" />
              <section className="flex flex-col">
                <SectionHeader open={sharedOpen} onToggle={toggleShared} icon={<Users2 className="h-3 w-3 text-primary" />} label={t('sharedWithMe')} count={direct.filter((n) => !n.parentId).length} />
                {sharedOpen && (
                  <div className="pl-1 pr-0.5 pt-1">
                    {direct.length === 0
                      ? <p className="text-[11px] text-muted-foreground italic px-2 py-1.5">{t('sharedEmpty')}</p>
                      : <NoteTree notes={direct} mode="shared" onOpen={open} />}
                  </div>
                )}
              </section>
              {everyone.length > 0 && (
                <>
                  <div className="h-px bg-border mx-2" />
                  <section className="flex flex-col">
                    <SectionHeader open={everyoneOpen} onToggle={toggleEveryone} icon={<Globe2 className="h-3 w-3 text-sky-500" />} label={t('everyoneSpaces')} count={everyone.filter((n) => !n.parentId).length} />
                    {everyoneOpen && (
                      <div className="pl-1 pr-0.5 pt-1">
                        <NoteTree notes={everyone} mode="shared" onOpen={open} />
                      </div>
                    )}
                  </section>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
