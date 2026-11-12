import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Monaco } from '@monaco-editor/react';
import type * as MonacoType from 'monaco-editor';
import {
  AlertTriangle, BookOpen, Brain, Check, ChevronRight, CircleAlert, Columns2, Copy, FileText, History, Link2, Loader2,
  MoreHorizontal, Pencil, Share2, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CodeDiffEditor, CodeEditor } from '@/components/ui/CodeEditor';
import { useToast } from '@/components/ui/use-toast';
import { notesAPI } from '@/services/api';
import { useNotesStore } from '@/stores/notesStore';
import { useRequestStore } from '@/stores/requestStore';
import { useThemeStore } from '@/stores/themeStore';
import { enableNoteLinks } from '@/lib/monacoNoteLinks';
import { cn } from '@/lib/utils';
import type { Note, Tab } from '@/types';
import { MarkdownView } from './MarkdownView';
import { toggleTaskLine } from './noteUtils';
import { NoteHistoryDialog } from './NoteHistoryDialog';
import { NoteToolbar } from './NoteToolbar';
import { wrapSelection } from './markdownActions';
import { NoteShareDialog } from './NoteShareDialog';
import { MemoryFolderView } from './memory/MemoryFolderView';
import { memoryRootOf } from './noteUtils';
import { CardHeader } from './memory/CardHeader';
import { NoteLinksPanel } from './memory/NoteLinksPanel';
import { openNoteTab, takePendingAnchor } from './useOpenNote';
import { formatWhen, noteTimesTitle } from './time';

type Mode = 'read' | 'edit' | 'split';
type SaveState = 'saved' | 'saving' | 'error' | 'conflict';

const MODE_KEY = 'patchman_note_edit_mode';
const AUTOSAVE_MS = 800;

function preferredEditMode(): Mode {
  try { return localStorage.getItem(MODE_KEY) === 'split' ? 'split' : 'edit'; } catch { return 'edit'; }
}

// NoteView is the main-pane body of a `type: 'note'` tab: read mode (rendered
// markdown + outline + backlinks), edit mode (Monaco markdown) or split. Edits
// autosave with optimistic concurrency — a save carries the version it was
// based on; if someone else saved first the server answers 409 and the
// conflict bar lets the user compare, take theirs, or keep theirs-overwriting.
export function NoteView({ tab }: { tab: Tab }) {
  const noteId = tab.noteId ?? '';
  const { t, i18n } = useTranslation(['notes', 'common']);
  const { toast } = useToast();
  const theme = useThemeStore((s) => s.theme);
  const patchLocal = useNotesStore((s) => s.patchLocal);
  const removeNote = useNotesStore((s) => s.removeNote);
  const ownNotes = useNotesStore((s) => s.notes);
  const sharedNotes = useNotesStore((s) => s.shared);
  const knownIds = useMemo(
    () => (ownNotes.length + sharedNotes.length > 0 ? new Set([...ownNotes, ...sharedNotes].map((n) => n.id)) : undefined),
    [ownNotes, sharedNotes],
  );

  const [note, setNote] = useState<Note | null>(null);
  const [loadError, setLoadError] = useState<'notFound' | 'failed' | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [mode, setMode] = useState<Mode>('read');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [conflict, setConflict] = useState<Note | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [outline, setOutline] = useState<{ id: string; text: string; level: number }[]>([]);
  const [uploading, setUploading] = useState(0);

  // Live values for the save loop (state is stale inside timers/unmount).
  const live = useRef({ title: '', body: '', base: 0, saving: false, conflict: false, dirty: false });
  const timer = useRef<number | undefined>(undefined);
  const previewRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null);
  // The toolbar needs the live editor + monaco (state, so it re-renders once
  // the lazily-loaded editor mounts).
  const [toolbarTarget, setToolbarTarget] = useState<{ editor: MonacoType.editor.IStandaloneCodeEditor; monaco: Monaco } | null>(null);

  const canEdit = !!note && note.role !== 'viewer';
  // A card's [[ links ask for their type (read when the editor mounts).
  const typedLinks = useRef(false);
  typedLinks.current = note?.type === 'card' || note?.type === 'hub';
  const isFolder = note?.type === 'folder';
  // Any folder inside an agent memory opens as memory (cards, pages, Brain).
  const inMemory = useNotesStore((s) => (isFolder && note && !note.memory ? memoryRootOf(note.id, [...s.notes, ...s.shared]) !== '' : false));
  const isCard = note?.type === 'card' || note?.type === 'hub';

  const applyLoaded = useCallback((n: Note) => {
    setNote(n);
    setTitle(n.title);
    setBody(n.body);
    live.current = { ...live.current, title: n.title, body: n.body, base: n.version, dirty: false, conflict: false };
    setConflict(null);
    setSaveState('saved');
  }, []);

  const load = useCallback(async (quiet = false) => {
    try {
      const res = await notesAPI.get(noteId);
      const n = res.data as Note;
      applyLoaded(n);
      if (!quiet) {
        setLoadError(null);
        // An empty page you can edit opens straight into the editor.
        setMode(n.role !== 'viewer' && n.type === 'page' && !n.body.trim() ? preferredEditMode() : 'read');
      }
    } catch (e) {
      const status = (e as { response?: { status?: number } }).response?.status;
      if (!quiet) setLoadError(status === 404 ? 'notFound' : 'failed');
    }
  }, [noteId, applyLoaded]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    const l = live.current;
    if (!l.dirty || l.saving || l.conflict) return;
    l.saving = true;
    setSaveState('saving');
    const sent = { title: l.title, body: l.body };
    try {
      const res = await notesAPI.update(noteId, { title: sent.title, body: sent.body, baseVersion: l.base });
      const saved = res.data as Note;
      l.base = saved.version;
      l.dirty = l.title !== sent.title || l.body !== sent.body;
      setNote((prev) => (prev ? { ...prev, version: saved.version, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy, updatedByName: saved.updatedByName, title: saved.title } : saved));
      patchLocal(noteId, { title: saved.title, version: saved.version, updatedAt: saved.updatedAt });
      setSaveState(l.dirty ? 'saving' : 'saved');
      if (l.dirty) timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
    } catch (e) {
      const err = e as { response?: { status?: number; data?: { current?: Note } } };
      if (err.response?.status === 409 && err.response.data?.current) {
        l.conflict = true;
        setConflict(err.response.data.current);
        setSaveState('conflict');
      } else {
        setSaveState('error');
      }
    } finally {
      l.saving = false;
    }
  }, [noteId, patchLocal]);

  const schedule = useCallback(() => {
    live.current.dirty = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
    setSaveState((s) => (s === 'conflict' ? s : 'saving'));
  }, [save]);

  // Leaving the tab mid-edit still saves the last keystrokes.
  useEffect(() => () => {
    window.clearTimeout(timer.current);
    const l = live.current;
    if (l.dirty && !l.conflict && !l.saving) {
      void notesAPI.update(noteId, { title: l.title, body: l.body, baseVersion: l.base }).catch(() => {});
    }
  }, [noteId]);

  const onTitle = (v: string) => { setTitle(v); live.current.title = v; schedule(); };
  const onBody = (v: string) => { setBody(v); live.current.body = v; schedule(); };

  // Someone else changed this note (realtime): reload when we have nothing
  // unsaved; with unsaved edits the next save surfaces the conflict.
  useEffect(() => {
    const onEvent = (e: Event) => {
      const d = (e as CustomEvent<{ type: string; noteId?: string }>).detail;
      if (d?.noteId !== noteId || d.type === 'note.suggestion') return;
      if (d.type === 'note.deleted') { setLoadError('notFound'); return; }
      if (!live.current.dirty && !live.current.saving) void load(true);
    };
    window.addEventListener('patchman:note-event', onEvent);
    return () => window.removeEventListener('patchman:note-event', onEvent);
  }, [noteId, load]);

  // Renamed from the tab strip / sidebar (this client): adopt title + version.
  useEffect(() => {
    const onRenamed = (e: Event) => {
      const d = (e as CustomEvent<{ noteId: string; title: string; version: number }>).detail;
      if (d?.noteId !== noteId) return;
      live.current.base = d.version;
      live.current.title = d.title;
      setTitle(d.title);
      setNote((prev) => (prev ? { ...prev, title: d.title, version: d.version } : prev));
    };
    window.addEventListener('patchman:note-renamed', onRenamed);
    return () => window.removeEventListener('patchman:note-renamed', onRenamed);
  }, [noteId]);

  // Conflict resolution.
  const takeTheirs = () => { if (conflict) applyLoaded(conflict); setShowCompare(false); };
  const keepMine = () => {
    if (!conflict) return;
    live.current.base = conflict.version;
    live.current.conflict = false;
    setConflict(null);
    setShowCompare(false);
    live.current.dirty = true;
    void save();
  };

  // Outline from the rendered headings (ids come from rehype-slug).
  useEffect(() => {
    if (mode === 'edit') return;
    const id = requestAnimationFrame(() => {
      const hs = previewRef.current?.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id]') ?? [];
      setOutline(Array.from(hs).map((h) => ({ id: h.id, text: h.textContent ?? '', level: Number(h.tagName[1]) })));
    });
    return () => cancelAnimationFrame(id);
  }, [body, mode]);

  const scrollToHeading = useCallback((id: string) => {
    previewRef.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // note:<id>#anchor links: scroll once loaded / when re-targeted.
  useEffect(() => {
    if (!note) return;
    const go = () => {
      const a = takePendingAnchor(noteId);
      if (a) requestAnimationFrame(() => scrollToHeading(a));
    };
    go();
    const onAnchor = (e: Event) => { if ((e as CustomEvent<{ noteId: string }>).detail?.noteId === noteId) go(); };
    window.addEventListener('patchman:note-anchor', onAnchor);
    return () => window.removeEventListener('patchman:note-anchor', onAnchor);
  }, [note, noteId, scrollToHeading]);

  // Images: paste or drop into the editor → upload → insert at the cursor.
  const insertAtCursor = useCallback((text: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    const sel = ed.getSelection();
    if (!sel) return;
    ed.executeEdits('note-image', [{ range: sel, text, forceMoveMarkers: true }]);
    ed.focus();
  }, []);

  const uploadImages = useCallback(async (files: File[]) => {
    for (const f of files) {
      setUploading((n) => n + 1);
      try {
        const res = await notesAPI.uploadAttachment(noteId, f, f.name || 'image.png');
        insertAtCursor((res.data as { markdown: string }).markdown + '\n');
      } catch (e) {
        const msg = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
        toast({ title: t('imageUploadFailed'), description: msg, variant: 'destructive' });
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }, [noteId, insertAtCursor, toast, t]);

  const onEditorMount = useCallback((editor: MonacoType.editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor;
    setToolbarTarget({ editor, monaco });
    const model = editor.getModel();
    const disposeLinks = model ? enableNoteLinks(monaco, model, noteId, typedLinks.current) : () => {};
    const dom = editor.getDomNode();
    const imagesOf = (dt: DataTransfer | null) =>
      Array.from(dt?.files ?? []).filter((f) => f.type.startsWith('image/'));
    // Listen on window (capture), not on the editor node: Monaco's EditContext
    // input handles paste further up and stops it from reaching the editor's
    // own DOM. Only events aimed inside THIS editor are ours.
    const inEditor = (e: Event) => !!dom && e.target instanceof Node && dom.contains(e.target);
    const onPaste = (e: ClipboardEvent) => {
      if (!inEditor(e)) return;
      const files = imagesOf(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void uploadImages(files);
    };
    const onDragOver = (e: DragEvent) => { if (inEditor(e) && e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    const onDrop = (e: DragEvent) => {
      if (!inEditor(e) || !e.dataTransfer?.types.includes('Files')) return;
      // Any file drop is ours — left alone, the browser would open the file in
      // place of the app.
      e.preventDefault();
      e.stopImmediatePropagation();
      const files = imagesOf(e.dataTransfer);
      if (!files.length) {
        toast({ title: t('imagesOnly') });
        return;
      }
      const pos = editor.getTargetAtClientPoint(e.clientX, e.clientY)?.position;
      if (pos) editor.setPosition(pos);
      void uploadImages(files);
    };
    window.addEventListener('paste', onPaste, true);
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('drop', onDrop, true);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      window.clearTimeout(timer.current);
      void save();
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, () => wrapSelection(editor, monaco, '**', '**', t('toolbar.boldText')));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => wrapSelection(editor, monaco, '_', '_', t('toolbar.italicText')));
    editor.onDidDispose(() => {
      disposeLinks();
      window.removeEventListener('paste', onPaste, true);
      window.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('drop', onDrop, true);
      if (editorRef.current === editor) editorRef.current = null;
      setToolbarTarget((cur) => (cur?.editor === editor ? null : cur));
    });
  }, [noteId, uploadImages, save, toast, t]);

  const setEditMode = (m: Mode) => {
    setMode(m);
    if (m !== 'read') { try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ } }
  };

  const onToggleTask = useCallback((line: number) => {
    if (!canEdit) return;
    const next = toggleTaskLine(live.current.body, line);
    if (next !== live.current.body) onBody(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  const openLinked = useCallback((id: string, anchor?: string) => {
    const meta = [...useNotesStore.getState().notes, ...useNotesStore.getState().shared].find((n) => n.id === id);
    openNoteTab(id, meta?.title ?? '', anchor);
  }, []);

  const copyLink = () => {
    void navigator.clipboard.writeText(`[${title}](note:${noteId})`).then(() => toast({ title: t('linkCopied') }));
  };

  const canDelete = !!note && (note.role === 'owner' || (note.role === 'editor' && !!note.parentId));
  const doDelete = async () => {
    setConfirmDelete(false);
    try {
      await removeNote(noteId);
      useRequestStore.getState().removeTab(tab.id);
    } catch {
      toast({ title: t('deleteFailed'), variant: 'destructive' });
    }
  };

  const preview = useMemo(() => (
    <MarkdownView
      markdown={body}
      onOpenNote={openLinked}
      knownNoteIds={knownIds}
      onToggleTask={canEdit ? onToggleTask : undefined}
    />
  ), [body, openLinked, knownIds, canEdit, onToggleTask]);

  if (loadError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <CircleAlert className="h-6 w-6" />
        {loadError === 'notFound' ? t('notFound') : t('loadFailed')}
        {loadError === 'failed' && <Button size="sm" variant="outline" onClick={() => void load()}>{t('retry')}</Button>}
      </div>
    );
  }
  if (!note) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const editor = (
    <CodeEditor
      height="100%"
      language="markdown"
      theme={theme === 'dark' ? 'vs-dark' : 'light'}
      value={body}
      onChange={(v) => onBody(v ?? '')}
      onMount={onEditorMount}
      options={{
        readOnly: !canEdit,
        wordWrap: 'on',
        minimap: { enabled: false },
        lineNumbers: 'off',
        glyphMargin: false,
        folding: true,
        fontSize: 13,
        lineHeight: 21,
        scrollBeyondLastLine: false,
        renderLineHighlight: 'none',
        padding: { top: 12, bottom: 24 },
        quickSuggestions: false,
        wordBasedSuggestions: 'off',
        automaticLayout: true,
        unicodeHighlight: { ambiguousCharacters: false },
      }}
    />
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Header: breadcrumb + status + mode + actions */}
      <div className="shrink-0 h-10 px-3 flex items-center gap-2 border-b text-xs">
        <div className="flex items-center gap-1 min-w-0 flex-1 text-muted-foreground">
          {note.breadcrumb.map((c) => (
            <span key={c.id} className="flex items-center gap-1 min-w-0">
              <button type="button" className="truncate max-w-[160px] hover:text-foreground" onClick={() => openLinked(c.id)}>{c.title}</button>
              <ChevronRight className="h-3 w-3 shrink-0" />
            </span>
          ))}
          <span className="truncate text-foreground font-medium">{title || t('untitled')}</span>
        </div>
        <span className="hidden md:inline text-muted-foreground shrink-0" title={noteTimesTitle(note, i18n.language, t)}>
          {t('editedBy', { name: note.updatedByName || t('someone'), when: formatWhen(note.updatedAt, i18n.language) })}
          {note.createdAt && Math.abs(Date.parse(note.updatedAt) - Date.parse(note.createdAt)) > 60_000 && (
            <span className="hidden lg:inline">
              {' · '}{t('times.createdBy', { name: note.createdByName || t('someone'), when: formatWhen(note.createdAt, i18n.language) })}
            </span>
          )}
        </span>
        {uploading > 0 && <span className="flex items-center gap-1 text-muted-foreground shrink-0"><Loader2 className="h-3 w-3 animate-spin" /> {t('uploading')}</span>}
        {canEdit && <SaveBadge state={saveState} />}
        {!canEdit && <span className="text-muted-foreground shrink-0">{t('readOnly')}</span>}
        {canEdit && !isFolder && (
          <div className="flex items-center rounded-md border p-0.5 shrink-0">
            {([['read', BookOpen], ['edit', Pencil], ['split', Columns2]] as const).map(([m, Icon]) => (
              <button
                key={m}
                type="button"
                onClick={() => setEditMode(m)}
                className={cn('h-6 px-2 rounded flex items-center gap-1', mode === m ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
                title={t(`mode.${m}`)}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">{t(`mode.${m}`)}</span>
              </button>
            ))}
          </div>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0"><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {canEdit && (
              <DropdownMenuItem onClick={() => setShowShare(true)}><Share2 className="h-3.5 w-3.5 mr-2" /> {t('share')}</DropdownMenuItem>
            )}
            {!isFolder && (
              <DropdownMenuItem onClick={() => setShowHistory(true)}><History className="h-3.5 w-3.5 mr-2" /> {t('history.open')}</DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={copyLink}><Link2 className="h-3.5 w-3.5 mr-2" /> {t('copyLink')}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void navigator.clipboard.writeText(body).then(() => toast({ title: t('markdownCopied') }))}>
              <Copy className="h-3.5 w-3.5 mr-2" /> {t('copyMarkdown')}
            </DropdownMenuItem>
            {canDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setConfirmDelete(true)} className="text-destructive focus:text-destructive">
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> {t('common:delete')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {conflict && (
        <div className="shrink-0 px-3 py-2 border-b bg-amber-500/10 text-xs flex items-center gap-2 flex-wrap">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="flex-1 min-w-[200px]">{t('conflict.message', { name: conflict.updatedByName || t('someone') })}</span>
          <Button size="sm" variant="outline" className="h-7" onClick={() => setShowCompare(true)}>{t('conflict.compare')}</Button>
          <Button size="sm" variant="outline" className="h-7" onClick={takeTheirs}>{t('conflict.takeTheirs')}</Button>
          <Button size="sm" className="h-7" onClick={keepMine}>{t('conflict.keepMine')}</Button>
        </div>
      )}

      {isFolder && (note.memory || note.project || inMemory) ? (
        <MemoryFolderView
          note={note}
          canEdit={canEdit}
          titleBlock={<TitleBlock title={title} canEdit={canEdit} onTitle={onTitle} icon={note.icon ? <span className="text-2xl leading-none">{note.icon}</span> : <Brain className="h-6 w-6 text-violet-400" />} />}
        />
      ) : isFolder ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-8">
            <TitleBlock title={title} canEdit={canEdit} onTitle={onTitle} icon={<FileText className="h-6 w-6 text-amber-400" />} />
            <p className="mt-3 text-sm text-muted-foreground">{t('folderHint')}</p>
          </div>
        </div>
      ) : mode === 'read' ? (
        <div className="flex-1 min-h-0 flex">
          <div ref={previewRef} className="flex-1 min-w-0 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-6 py-8">
              <TitleBlock title={title} canEdit={false} onTitle={onTitle} />
              {isCard && <CardHeader note={note} canEdit={canEdit} onOpen={openLinked} onChanged={(patch) => setNote((p) => (p ? { ...p, ...patch } : p))} />}
              <div className="mt-5">
                {body.trim() ? preview : (
                  <p className="text-sm text-muted-foreground italic">
                    {t('emptyPage')}{' '}
                    {canEdit && <button type="button" className="text-primary underline" onClick={() => setEditMode(preferredEditMode())}>{t('startWriting')}</button>}
                  </p>
                )}
              </div>
              <NoteLinksPanel noteId={noteId} canEdit={canEdit} onOpen={openLinked} />
            </div>
          </div>
          {outline.length > 1 && (
            <nav className="hidden xl:block w-56 shrink-0 border-l overflow-y-auto py-8 px-3 text-xs" aria-label={t('outline')}>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">{t('outline')}</div>
              {outline.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => scrollToHeading(h.id)}
                  className="block w-full text-left truncate py-0.5 text-muted-foreground hover:text-foreground"
                  style={{ paddingLeft: (h.level - 1) * 10 }}
                >
                  {h.text}
                </button>
              ))}
            </nav>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex">
          <div className={cn('min-w-0 flex flex-col', mode === 'split' ? 'w-1/2 border-r' : 'flex-1')}>
            <div className="shrink-0 px-4 pt-3">
              <TitleBlock title={title} canEdit={canEdit} onTitle={onTitle} compact />
              {isCard && <CardHeader note={note} canEdit={canEdit} onOpen={openLinked} onChanged={(patch) => setNote((p) => (p ? { ...p, ...patch } : p))} />}
            </div>
            {canEdit && (
              <NoteToolbar
                editor={toolbarTarget?.editor ?? null}
                monaco={toolbarTarget?.monaco ?? null}
                onImages={(files) => void uploadImages(files)}
                className="shrink-0 px-3 py-1 border-b"
              />
            )}
            <div className="flex-1 min-h-0">{editor}</div>
            <div className="shrink-0 px-4 py-1 border-t text-[10px] text-muted-foreground">{t('editorHint')}</div>
          </div>
          {mode === 'split' && (
            <div ref={previewRef} className="w-1/2 min-w-0 overflow-y-auto">
              <div className="px-6 py-6">{preview}</div>
            </div>
          )}
        </div>
      )}

      <Dialog open={showCompare} onOpenChange={setShowCompare}>
        <DialogContent className="sm:max-w-[1000px] w-[min(1000px,calc(100vw-2rem))] h-[min(640px,calc(100vh-4rem))] flex flex-col">
          <DialogHeader><DialogTitle>{t('conflict.compareTitle')}</DialogTitle></DialogHeader>
          <div className="text-[11px] text-muted-foreground">{t('conflict.compareLegend')}</div>
          <div className="flex-1 min-h-0 border rounded-md overflow-hidden">
            <CodeDiffEditor
              height="100%"
              language="markdown"
              theme={theme === 'dark' ? 'vs-dark' : 'light'}
              original={conflict?.body ?? ''}
              modified={body}
              options={{ readOnly: true, originalEditable: false, renderSideBySide: true, minimap: { enabled: false }, fontSize: 12, wordWrap: 'on', automaticLayout: true }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={takeTheirs}>{t('conflict.takeTheirs')}</Button>
            <Button onClick={keepMine}>{t('conflict.keepMine')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {showHistory && (
        <NoteHistoryDialog
          noteId={noteId}
          currentBody={body}
          canRestore={canEdit && !live.current.dirty}
          open={showHistory}
          onOpenChange={setShowHistory}
          onRestored={(n) => { applyLoaded(n); patchLocal(noteId, { version: n.version, title: n.title, updatedAt: n.updatedAt }); }}
        />
      )}
      {showShare && (
        <NoteShareDialog note={{ id: note.id, title, userId: note.userId, visibility: note.visibility }} open={showShare} onOpenChange={setShowShare} />
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle', { name: title })}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doDelete()} className="bg-destructive text-white hover:bg-destructive/90">{t('common:delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TitleBlock({ title, canEdit, onTitle, icon, compact }: { title: string; canEdit: boolean; onTitle: (v: string) => void; icon?: React.ReactNode; compact?: boolean }) {
  const { t } = useTranslation('notes');
  const cls = compact ? 'text-lg' : 'text-3xl';
  if (!canEdit) {
    return <h1 className={cn(cls, 'font-bold flex items-center gap-2 break-words')}>{icon}{title || t('untitled')}</h1>;
  }
  return (
    <div className="flex items-center gap-2">
      {icon}
      <input
        value={title}
        onChange={(e) => onTitle(e.target.value)}
        placeholder={t('untitled')}
        className={cn(cls, 'w-full font-bold bg-transparent outline-none placeholder:text-muted-foreground/50')}
      />
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const { t } = useTranslation('notes');
  if (state === 'saving') return <span className="flex items-center gap-1 text-muted-foreground shrink-0"><Loader2 className="h-3 w-3 animate-spin" /> {t('save.saving')}</span>;
  if (state === 'error') return <span className="flex items-center gap-1 text-destructive shrink-0"><CircleAlert className="h-3 w-3" /> {t('save.error')}</span>;
  if (state === 'conflict') return <span className="flex items-center gap-1 text-amber-600 shrink-0"><AlertTriangle className="h-3 w-3" /> {t('save.conflict')}</span>;
  return <span className="flex items-center gap-1 text-muted-foreground/70 shrink-0"><Check className="h-3 w-3 text-emerald-500/80" /> {t('save.saved')}</span>;
}
