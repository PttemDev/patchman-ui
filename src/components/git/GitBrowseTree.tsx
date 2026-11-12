import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeEditor } from '@/components/ui/CodeEditor';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File as FileIcon,
  Loader2,
  AlertTriangle,
  FileCode2,
  Pencil,
  Save,
  Undo2,
  Circle,
} from 'lucide-react';
import { gitAPI } from '@/services/api';
import { useThemeStore } from '@/stores/themeStore';
import { useToast } from '@/components/ui/use-toast';
import { confirmDialog } from '@/components/ui/confirm';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { decodeGitContent, extractErr, languageForPath } from './util';
import type { GitStatus, GitTreeEntry } from '@/types';

interface GitBrowseTreePaneProps {
  connId: string;
  project: string;
  // NOTE: named gitRef, not `ref` — `ref` is a reserved JSX prop React would
  // intercept, leaving the component with `undefined` and breaking branch
  // switching in Browse mode.
  gitRef: string;
  // Controlled selection: the currently-open blob path (or '' for none) and a
  // callback fired when a file (not a folder) is picked. State is lifted to
  // GitPanel so the tree can live in the left mode-nav column while the file
  // content renders in the center pane.
  selectedPath: string;
  onSelect: (path: string) => void;
}

interface FileState {
  path: string;
  content: string;
  loading: boolean;
  error: string;
}

// GitBrowseTreePane is the tree half of Browse mode: a lazy-expanded file tree
// at a ref (gitAPI.tree, one fetch per opened folder). It owns folder
// expansion state internally but is otherwise controlled — the selected blob
// and selection callback are passed in so the picked file's content can be
// rendered elsewhere (GitBrowseContent, in the center pane).
export function GitBrowseTreePane({ connId, project, gitRef, selectedPath, onSelect }: GitBrowseTreePaneProps) {
  const { t } = useTranslation('git');
  const [childrenByPath, setChildrenByPath] = useState<Record<string, GitTreeEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [rootError, setRootError] = useState('');
  const [rootLoading, setRootLoading] = useState(false);

  const loadTree = useCallback(async (path: string): Promise<GitTreeEntry[] | null> => {
    setLoadingPaths((s) => new Set(s).add(path));
    try {
      const res = await gitAPI.tree(connId, { project, ref: gitRef, path: path || undefined });
      const entries = (res.data as GitTreeEntry[]) ?? [];
      setChildrenByPath((m) => ({ ...m, [path]: entries }));
      return entries;
    } catch (err) {
      if (!path) setRootError(extractErr(err, t('errors.loadTree')));
      return null;
    } finally {
      setLoadingPaths((s) => { const n = new Set(s); n.delete(path); return n; });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, project, gitRef]);

  // Reset + load the root whenever the repo/ref changes.
  useEffect(() => {
    if (!connId || !project) return;
    setChildrenByPath({});
    setExpanded(new Set());
    setRootError('');
    setRootLoading(true);
    loadTree('').finally(() => setRootLoading(false));
  }, [connId, project, gitRef, loadTree]);

  const toggleFolder = useCallback((path: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(path)) { n.delete(path); return n; }
      n.add(path);
      return n;
    });
    if (!childrenByPath[path]) loadTree(path);
  }, [childrenByPath, loadTree]);

  const renderEntries = (path: string, depth: number): React.ReactNode => {
    const entries = childrenByPath[path];
    if (!entries) return null;
    const sorted = [...entries].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'tree' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return sorted.map((entry) => {
      if (entry.type === 'tree') {
        const isOpen = expanded.has(entry.path);
        const isLoading = loadingPaths.has(entry.path);
        return (
          <div key={entry.path}>
            <button
              type="button"
              onClick={() => toggleFolder(entry.path)}
              style={{ paddingLeft: 8 + depth * 12 }}
              className="w-full flex items-center gap-1 py-1 pr-2 text-xs text-left hover:bg-accent/40"
            >
              {isLoading
                ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
                : isOpen
                  ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                  : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
              {isOpen
                ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                : <Folder className="h-3.5 w-3.5 shrink-0 text-sky-500" />}
              <span className="truncate">{entry.name}</span>
            </button>
            {isOpen && renderEntries(entry.path, depth + 1)}
          </div>
        );
      }
      return (
        <button
          key={entry.path}
          type="button"
          onClick={() => onSelect(entry.path)}
          style={{ paddingLeft: 8 + depth * 12 + 16 }}
          className={cn(
            'w-full flex items-center gap-1.5 py-1 pr-2 text-xs text-left hover:bg-accent/40',
            selectedPath === entry.path && 'bg-accent/60',
          )}
        >
          <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{entry.name}</span>
        </button>
      );
    });
  };

  if (rootLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('browse.loadingTree')}
      </div>
    );
  }
  if (rootError) {
    return (
      <div className="flex items-start gap-2 m-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span className="min-w-0 break-words">{rootError}</span>
      </div>
    );
  }
  return <div className="py-1">{renderEntries('', 0)}</div>;
}

// GitBrowseContent is the content half of Browse mode. Two surfaces:
//  • Remote / read-only (default): fetches the committed blob at `gitRef`
//    (gitAPI.file) and renders it in a read-only Monaco editor. This is the
//    web experience and the fallback whenever editing isn't allowed.
//  • Local / editable (`editable`): the repo is cloned, we're on desktop, and
//    the panel's ref matches the clone's checked-out branch, so the working-
//    tree file itself is shown and can be edited + saved (see GitFileEditor).
// `editHint` carries the one-line reason editing is off when a clone exists but
// the branch doesn't match, so the user knows how to enable it.
export function GitBrowseContent({
  connId, project, gitRef, path, editable, localRepoId, editHint, onDirtyChange, onSaved,
}: {
  connId: string;
  project: string;
  gitRef: string;
  path: string;
  editable?: boolean;
  localRepoId?: string;
  editHint?: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
}) {
  const { t } = useTranslation('git');
  const { theme } = useThemeStore();
  const [file, setFile] = useState<FileState | null>(null);

  const useEditor = !!editable && !!localRepoId && !!path;

  useEffect(() => {
    // The remote read only runs for the read-only surface; the editable surface
    // owns its own load (via GitFileEditor) against the working tree.
    if (useEditor) { setFile(null); return; }
    if (!path) { setFile(null); return; }
    let cancelled = false;
    setFile({ path, content: '', loading: true, error: '' });
    gitAPI.file(connId, { project, ref: gitRef, path })
      .then((res) => {
        if (cancelled) return;
        const d = (res.data ?? {}) as { content?: string; encoding?: string };
        setFile({ path, content: decodeGitContent(d.content, d.encoding), loading: false, error: '' });
      })
      .catch((err) => {
        if (!cancelled) setFile({ path, content: '', loading: false, error: extractErr(err, t('errors.loadFile')) });
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, project, gitRef, path, useEditor]);

  if (useEditor && localRepoId) {
    // Key per file so switching files fully remounts the editor: this discards
    // any in-flight load from the previous file (no cancellation flag needed)
    // and guarantees we never save file A's content to file B's path.
    return (
      <GitFileEditor
        key={`${localRepoId}:${path}`}
        repoId={localRepoId}
        path={path}
        onDirtyChange={onDirtyChange}
        onSaved={onSaved}
      />
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {!file ? (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
          <FileCode2 className="h-8 w-8 opacity-40" />
          <p className="text-xs">{t('browse.selectFileContents')}</p>
        </div>
      ) : file.loading ? (
        <div className="flex items-center justify-center gap-2 h-full text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('editor.loadingFile', { path: file.path })}
        </div>
      ) : file.error ? (
        <div className="flex items-start gap-2 m-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className="min-w-0 break-words">{file.error}</span>
        </div>
      ) : (
        <>
          <div className="shrink-0 flex items-center gap-2 px-2 py-1 border-b bg-muted/20">
            <span className="flex-1 min-w-0 text-[11px] font-mono text-muted-foreground truncate" title={file.path}>
              {file.path}
            </span>
            {editHint && (
              <span className="shrink-0 text-[10px] text-muted-foreground italic" title={editHint}>
                {editHint}
              </span>
            )}
          </div>
          <div className="flex-1 min-h-0">
            <CodeEditor
              height="100%"
              language={languageForPath(file.path)}
              theme={theme === 'dark' ? 'vs-dark' : 'light'}
              value={file.content}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: 'off',
                padding: { top: 8 },
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ── Working-tree file editing ────────────────────────────────────────────────

interface WorkingTreeFile {
  /** On-disk content as last loaded/saved — the "clean" baseline. */
  baseline: string;
  /** Current editor content (may differ from baseline while editing). */
  content: string;
  setContent: (v: string) => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
  loading: boolean;
  /** True once the first load has completed — lets a consumer distinguish the
   *  pre-load empty state from a genuinely-empty file (avoids a content flash). */
  loaded: boolean;
  saving: boolean;
  error: string;
  /** True while editing AND the content diverges from the on-disk baseline. */
  dirty: boolean;
  /** True when the file looks binary (contains NULs) — editing is refused. */
  binary: boolean;
  save: () => Promise<boolean>;
  discard: () => Promise<void>;
  reload: () => Promise<void>;
}

// useWorkingTreeFile owns the load/edit/save/discard lifecycle for ONE
// working-tree file in a local clone. Kept deliberately generic (repoId + path)
// so the upcoming merge-conflict resolver can reuse the exact same save path —
// load the conflicted file, let the user resolve it, writeFile, then stage.
export function useWorkingTreeFile(repoId: string, path: string): WorkingTreeFile {
  const { t } = useTranslation('git');
  const [baseline, setBaseline] = useState('');
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [binary, setBinary] = useState(false);

  const reload = useCallback(async () => {
    if (!repoId || !path) return;
    setLoading(true);
    setError('');
    setEditing(false);
    try {
      const res = await gitAPI.localFile(repoId, { path }); // no ref → working tree
      const d = (res.data ?? {}) as { content?: string; encoding?: string };
      const text = decodeGitContent(d.content, d.encoding);
      setBinary(text.includes('\u0000'));
      setBaseline(text);
      setContent(text);
    } catch (err) {
      setError(extractErr(err, t('errors.loadFile')));
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, path]);

  useEffect(() => { reload(); }, [reload]);

  const dirty = editing && content !== baseline;

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setError('');
    try {
      await gitAPI.writeFile(repoId, { path, content });
      setBaseline(content); // now clean at the saved content
      return true;
    } catch (err) {
      setError(extractErr(err, t('errors.saveFile')));
      return false;
    } finally {
      setSaving(false);
    }
  }, [repoId, path, content, t]);

  const discard = useCallback(async () => {
    await reload();
  }, [reload]);

  return {
    baseline, content, setContent, editing, setEditing,
    loading, loaded, saving, error, dirty, binary, save, discard, reload,
  };
}

// GitFileEditor renders an editable Monaco over a working-tree file. Off by
// default (read-only preview); Edit unlocks it, Save writes through
// gitAPI.writeFile and re-reads git status so the change surfaces under Changes,
// Discard reverts to the on-disk content. A dirty flag drives the unsaved
// indicator, a beforeunload guard, and the parent's file/branch/tab switch
// confirmation (via onDirtyChange).
function GitFileEditor({
  repoId, path, onDirtyChange, onSaved,
}: {
  repoId: string;
  path: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
}) {
  const { t } = useTranslation('git');
  const { theme } = useThemeStore();
  const { toast } = useToast();
  const {
    content, setContent, editing, setEditing,
    loading, saving, error, dirty, binary, save, discard,
  } = useWorkingTreeFile(repoId, path);
  // "modified in working tree" feedback after a save — the consumer of the
  // post-save status re-read the task calls for.
  const [modified, setModified] = useState(false);

  // Surface the dirty flag to the parent (for switch guards) and reset it when
  // this editor unmounts (e.g. the parent switched modes past the guard).
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // A native guard for a full window reload/close while there are unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const onSave = useCallback(async () => {
    const ok = await save();
    if (!ok) {
      toast({ title: t('toast.saveFailed'), variant: 'destructive' });
      return;
    }
    toast({ title: t('toast.saved'), description: t('toast.writtenWorkingTree', { path }) });
    onSaved?.();
    // Re-read status so the editor can confirm the file now shows under Changes.
    try {
      const res = await gitAPI.status(repoId);
      const s = res.data as GitStatus;
      const touched =
        s.staged?.some((e) => e.path === path) ||
        s.unstaged?.some((e) => e.path === path) ||
        s.untracked?.includes(path) ||
        false;
      setModified(!!touched);
    } catch {
      /* status is best-effort feedback only */
    }
  }, [save, toast, path, onSaved, repoId, t]);

  const onDiscard = useCallback(async () => {
    if (dirty && !(await confirmDialog({ title: t('confirm.discardFileChanges'), destructive: true }))) return;
    await discard();
    setModified(false);
  }, [dirty, discard, t]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center gap-2 px-2 py-1 border-b bg-muted/20">
        <span className="flex-1 min-w-0 text-[11px] font-mono text-muted-foreground truncate" title={path}>
          {path}
        </span>
        {dirty && (
          <span className="shrink-0 flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400" title={t('editor.unsavedTitle')}>
            <Circle className="h-2 w-2 fill-current" /> {t('editor.unsaved')}
          </span>
        )}
        {!dirty && modified && (
          <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400" title={t('editor.modifiedTitle')}>
            {t('editor.modified')}
          </span>
        )}
        {binary ? (
          <span className="shrink-0 text-[10px] text-muted-foreground italic">{t('editor.binaryReadOnly')}</span>
        ) : !editing ? (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[11px] gap-1 shrink-0"
            disabled={loading || !!error}
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3 w-3" /> {t('common:edit')}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px] gap-1 shrink-0"
              disabled={saving}
              onClick={onDiscard}
              title={t('editor.discardTitle')}
            >
              <Undo2 className="h-3 w-3" /> {t('editor.discard')}
            </Button>
            <Button
              size="sm"
              className="h-6 text-[11px] gap-1 shrink-0"
              disabled={saving || !dirty}
              onClick={onSave}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              {t('common:save')}
            </Button>
          </>
        )}
      </div>
      {error && (
        <div className="shrink-0 flex items-start gap-2 m-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center gap-2 h-full text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('editor.loadingFile', { path })}
          </div>
        ) : (
          <CodeEditor
            height="100%"
            language={languageForPath(path)}
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            value={content}
            onChange={(v) => setContent(v ?? '')}
            options={{
              readOnly: !editing || binary,
              minimap: { enabled: false },
              fontSize: 12,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              wordWrap: 'off',
              padding: { top: 8 },
            }}
          />
        )}
      </div>
    </div>
  );
}
