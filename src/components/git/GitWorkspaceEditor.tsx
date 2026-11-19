import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type * as Monaco from 'monaco-editor';
import { Circle, FileCode2, Loader2, Save, UserRound, X } from 'lucide-react';
import { CodeEditor } from '@/components/ui/CodeEditor';
import { Button } from '@/components/ui/button';
import { useThemeStore } from '@/stores/themeStore';
import { useCodeTheme } from '@/lib/monacoShiki';
import { useToast } from '@/components/ui/use-toast';
import { confirmDialog } from '@/components/ui/confirm';
import { gitAPI } from '@/services/api';
import { cn } from '@/lib/utils';
import { decodeGitContent, extractErr, languageForPath, timeAgo } from './util';
import { diffHunks, type ChangeHunk } from './lineDiff';
import { matchesAction, shortcutHint } from '@/lib/keymap';
import { AUTO_SAVE_DELAY_MS, useEditorPrefsStore } from '@/stores/editorPrefsStore';

// IDE-style editing of the local clone (GIT_IDE_PLAN §H): file tabs that keep
// their unsaved buffers, ⌘S to save, gutter markers for lines changed since
// HEAD (click one to roll that hunk back) and an Annotate (blame) gutter.

interface Buffer {
  baseline: string;
  content: string;
  head: string | null; // null = not in HEAD (new file)
  loading: boolean;
  error: string;
  binary: boolean;
  /** SHA-256 of the bytes on disk when `baseline` was loaded / saved (from
   *  the BE; undefined on an older BE → saves aren't hash-guarded). */
  sha?: string;
  /** The file changed on disk under us (409): auto save stops for it. */
  stale?: boolean;
}
interface BlameLine { sha: string; author: string; time: number; summary: string }

// The edit that puts a hunk's HEAD lines back.
function rollbackEdit(monaco: typeof Monaco, model: Monaco.editor.ITextModel, hk: ChangeHunk): Monaco.editor.IIdentifiedSingleEditOperation {
  const eol = model.getEOL();
  const lines = model.getLineCount();
  const end = hk.newStart + hk.newCount - 1;
  if (hk.kind === 'modified') {
    return { range: new monaco.Range(hk.newStart, 1, end, model.getLineMaxColumn(end)), text: hk.oldLines.join(eol) };
  }
  if (hk.kind === 'added') {
    // Remove the lines and one line break.
    if (end < lines) return { range: new monaco.Range(hk.newStart, 1, end + 1, 1), text: '' };
    const from = hk.newStart > 1 ? new monaco.Position(hk.newStart - 1, model.getLineMaxColumn(hk.newStart - 1)) : new monaco.Position(1, 1);
    return { range: new monaco.Range(from.lineNumber, from.column, end, model.getLineMaxColumn(end)), text: '' };
  }
  // deleted: put the old lines back before newStart (or after the last line).
  if (hk.newStart <= lines) return { range: new monaco.Range(hk.newStart, 1, hk.newStart, 1), text: hk.oldLines.join(eol) + eol };
  return { range: new monaco.Range(lines, model.getLineMaxColumn(lines), lines, model.getLineMaxColumn(lines)), text: eol + hk.oldLines.join(eol) };
}

async function readFile(repoId: string, path: string, ref?: string): Promise<{ text: string; sha?: string }> {
  const res = await gitAPI.localFile(repoId, ref ? { path, ref } : { path });
  const d = (res.data ?? {}) as { content?: string; encoding?: string; sha256?: string };
  return { text: decodeGitContent(d.content, d.encoding), sha: d.sha256 };
}
const read = async (repoId: string, path: string, ref?: string) => (await readFile(repoId, path, ref)).text;

export interface RevealTarget { path: string; line: number; nonce: number }

export function GitWorkspaceEditor({ repoId, files, active, onActivate, onClose, onDirtyChange, onSaved, registerFlush, reveal, onGotoDefinition, onFindUsages, onCaret }: {
  /** Jump here once the file is open (search results, navigation). */
  reveal?: RevealTarget;
  /** ⌘B / F12 / ⌘+click on an identifier. */
  onGotoDefinition?: (word: string, path: string, line: number) => void;
  /** ⌥F7 on an identifier. */
  onFindUsages?: (word: string) => void;
  /** caret moves (for Back / Forward history) */
  onCaret?: (path: string, line: number) => void;
  repoId: string;
  files: string[];
  active?: string;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** auto = an auto save (the panel refreshes lightly). */
  onSaved?: (opts?: { auto?: boolean }) => void;
  /** Receives a "save every dirty file now" function (auto save on), so the
   *  panel can flush instead of asking to discard. */
  registerFlush?: (fn: (() => Promise<boolean>) | null) => void;
}) {
  const { t } = useTranslation('git');
  const autoSave = useEditorPrefsStore((s) => s.autoSave);
  const { theme } = useThemeStore();
  const codeTheme = useCodeTheme(theme === 'dark', languageForPath(active));
  const { toast } = useToast();
  const [bufs, setBufs] = useState<Record<string, Buffer>>({});
  const [blame, setBlame] = useState<Record<string, BlameLine[] | null>>({});
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const decoRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const hunksRef = useRef<ChangeHunk[]>([]);

  // Load newly opened files (working tree + HEAD for the markers).
  useEffect(() => {
    for (const p of files) {
      if (bufs[p]) continue;
      setBufs((b) => ({ ...b, [p]: { baseline: '', content: '', head: null, loading: true, error: '', binary: false } }));
      Promise.all([readFile(repoId, p), read(repoId, p, 'HEAD').catch(() => null)]).then(([{ text, sha }, head]) => {
        setBufs((b) => ({ ...b, [p]: { baseline: text, content: text, head, loading: false, error: '', binary: text.includes('\u0000'), sha } }));
      }).catch((e) => setBufs((b) => ({ ...b, [p]: { baseline: '', content: '', head: null, loading: false, error: extractErr(e, t('errors.loadFile')), binary: false } })));
    }
    // Forget closed files.
    setBufs((b) => Object.fromEntries(Object.entries(b).filter(([p]) => files.includes(p))));
  }, [files, repoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirtyPaths = useMemo(() => files.filter((p) => bufs[p] && bufs[p].content !== bufs[p].baseline), [files, bufs]);
  useEffect(() => { onDirtyChange?.(dirtyPaths.length > 0); }, [dirtyPaths.length, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const buf = active ? bufs[active] : undefined;

  // Latest buffers for async savers (auto save timers, blur, unmount).
  const bufsRef = useRef(bufs);
  bufsRef.current = bufs;
  // One save per file at a time; a second caller awaits the same one.
  const inFlight = useRef(new Map<string, Promise<boolean>>());

  /** Save one file. Hash-guarded: a file changed on disk since it was loaded
   *  is never overwritten silently — an auto save stops for it and a manual
   *  save asks first. Resolves true when nothing is left unsaved. */
  const save = useCallback(async (path?: string, opts: { auto?: boolean; force?: boolean } = {}): Promise<boolean> => {
    const p = path ?? active;
    if (!p) return true;
    const b = bufsRef.current[p];
    if (!b || b.loading || b.binary || b.content === b.baseline) return true;
    if (opts.auto && b.stale) return false;
    const pending = inFlight.current.get(p);
    if (pending) {
      // Wait for it, then save whatever was typed since (if anything).
      await pending;
      return save(p, opts);
    }
    let release: (v: boolean) => void = () => {};
    inFlight.current.set(p, new Promise<boolean>((r) => { release = r; }));
    if (!opts.auto) setSaving(true);
    const content = b.content;
    let ok = false;
    try {
      const res = await gitAPI.writeFile(repoId, { path: p, content, ...(b.sha && !opts.force ? { expectedSha256: b.sha } : {}) });
      const sha = (res.data as { sha256?: string } | undefined)?.sha256;
      // Update the ref right away too: a caller awaiting this save (flush,
      // blur) re-reads it before React re-renders.
      const upd = (x: Record<string, Buffer>) => (x[p] ? { ...x, [p]: { ...x[p], baseline: content, sha: sha ?? x[p].sha, stale: false } } : x);
      bufsRef.current = upd(bufsRef.current);
      setBufs(upd);
      setBlame((x) => ({ ...x, [p]: x[p] ? null : x[p] })); // stale after a save
      onSaved?.({ auto: opts.auto });
      ok = true;
      return true;
    } catch (e) {
      const status = (e as { response?: { status?: number } }).response?.status;
      if (status === 409) {
        const mark = (x: Record<string, Buffer>) => (x[p] ? { ...x, [p]: { ...x[p], stale: true } } : x);
        bufsRef.current = mark(bufsRef.current);
        setBufs(mark);
        if (opts.auto) {
          if (!b.stale) toast({ title: t('workspace.changedOnDiskTitle', { name: p.split('/').pop() }), description: t('workspace.autoSavePaused'), variant: 'destructive' });
          return false;
        }
        const yes = await confirmDialog({ title: t('workspace.changedOnDiskTitle', { name: p.split('/').pop() }), description: t('workspace.overwriteBody'), destructive: true, confirmLabel: t('workspace.overwrite') });
        inFlight.current.delete(p);
        release(false);
        return yes ? save(p, { force: true }) : false;
      }
      toast({ title: t('toast.saveFailed'), description: extractErr(e, t('errors.saveFile')), variant: 'destructive' });
      return false;
    } finally {
      inFlight.current.delete(p);
      release(ok);
      if (!opts.auto) setSaving(false);
    }
  }, [active, repoId, onSaved, toast, t]);

  const saveAll = useCallback(async (auto: boolean) => {
    const dirty = Object.entries(bufsRef.current).filter(([, b]) => b.content !== b.baseline).map(([p]) => p);
    const results = await Promise.all(dirty.map((p) => save(p, { auto })));
    return results.every(Boolean);
  }, [save]);
  const saveAllRef = useRef(saveAll);
  saveAllRef.current = saveAll;
  const autoSaveRef = useRef(autoSave);
  autoSaveRef.current = autoSave;

  // Auto save — after a pause in typing…
  const activeContent = active ? bufs[active]?.content : undefined;
  useEffect(() => {
    if (autoSave !== 'afterDelay' || !active) return;
    const b = bufsRef.current[active];
    if (!b || b.content === b.baseline) return;
    const h = setTimeout(() => { void save(active, { auto: true }); }, AUTO_SAVE_DELAY_MS);
    return () => clearTimeout(h);
  }, [autoSave, active, activeContent, save]);
  // …and, in both auto modes, when focus leaves: another file tab, the
  // window, or this editor being closed (mode switch / tab close).
  const prevActive = useRef(active);
  useEffect(() => {
    const prev = prevActive.current;
    prevActive.current = active;
    if (autoSave !== 'off' && prev && prev !== active) void save(prev, { auto: true });
  }, [active, autoSave, save]);
  useEffect(() => {
    if (autoSave === 'off') return;
    const onBlur = () => { void saveAllRef.current(true); };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [autoSave]);
  useEffect(() => () => { if (autoSaveRef.current !== 'off') void saveAllRef.current(true); }, []);
  useEffect(() => {
    registerFlush?.(autoSave === 'off' ? null : () => saveAllRef.current(true));
    return () => registerFlush?.(null);
  }, [autoSave, registerFlush]);

  const saveRef = useRef(save);
  saveRef.current = save;
  const navRef = useRef({ onGotoDefinition, onFindUsages, onCaret, active });
  navRef.current = { onGotoDefinition, onFindUsages, onCaret, active };
  const [ready, setReady] = useState(0);

  // Reveal a line once the target file's editor is up.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !reveal || reveal.path !== active || !buf || buf.loading) return;
    ed.revealLineInCenter(reveal.line);
    ed.setPosition({ lineNumber: reveal.line, column: 1 });
    ed.setSelection({ startLineNumber: reveal.line, startColumn: 1, endLineNumber: reveal.line, endColumn: 1 });
    ed.focus();
  }, [reveal, active, buf?.loading, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = async (p: string) => {
    if (autoSave !== 'off' && (await save(p, { auto: true }))) { onClose(p); return; }
    const b = bufsRef.current[p];
    if (b && b.content !== b.baseline) {
      const ok = await confirmDialog({ title: t('workspace.closeDirtyTitle', { name: p.split('/').pop() }), description: t('workspace.closeDirtyBody'), destructive: true, confirmLabel: t('workspace.discardClose') });
      if (!ok) return;
    }
    onClose(p);
  };

  // Change markers vs HEAD, repainted as you type.
  useEffect(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco || !buf || buf.loading) return;
    const h = setTimeout(() => {
      const hunks = buf.head === null
        ? (buf.content ? [{ kind: 'added' as const, newStart: 1, newCount: buf.content.split('\n').length, oldLines: [] }] : [])
        : diffHunks(buf.head, buf.content);
      hunksRef.current = hunks;
      const decos: Monaco.editor.IModelDeltaDecoration[] = hunks.map((hk) => {
        const start = Math.max(1, hk.newStart);
        const end = hk.kind === 'deleted' ? start : hk.newStart + hk.newCount - 1;
        return {
          range: new monaco.Range(start, 1, end, 1),
          options: {
            isWholeLine: true,
            linesDecorationsClassName: `pm-git-gutter pm-git-${hk.kind}`,
            overviewRuler: { color: hk.kind === 'added' ? '#22c55e' : hk.kind === 'deleted' ? '#ef4444' : '#3b82f6', position: monaco.editor.OverviewRulerLane.Left },
          },
        };
      });
      if (!decoRef.current) decoRef.current = ed.createDecorationsCollection(decos);
      else decoRef.current.set(decos);
    }, 250);
    return () => clearTimeout(h);
  }, [buf, active, ready]);

  const onMount = (ed: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
    editorRef.current = ed;
    monacoRef.current = monaco;
    decoRef.current = null;
    setReady((n) => n + 1);
    // Navigation: ⌘B / F12 declaration, ⌥F7 usages, ⌘+click declaration.
    const wordAt = (pos: Monaco.IPosition | null | undefined) => (pos ? ed.getModel()?.getWordAtPosition(pos)?.word : undefined);
    const gotoDef = (pos: Monaco.IPosition | null | undefined) => {
      const w = wordAt(pos);
      const { onGotoDefinition: go, active: p } = navRef.current;
      if (w && go && p && pos) go(w, p, pos.lineNumber);
    };
    // Editor shortcuts come from the keymap (Settings → Keymap), read live.
    ed.onKeyDown((ev) => {
      const e = ev.browserEvent;
      if (matchesAction(e, 'editor.save')) { ev.preventDefault(); ev.stopPropagation(); void saveRef.current(); return; }
      if (matchesAction(e, 'editor.declaration')) { ev.preventDefault(); ev.stopPropagation(); gotoDef(ed.getPosition()); return; }
      if (matchesAction(e, 'editor.usages')) {
        ev.preventDefault(); ev.stopPropagation();
        const w = wordAt(ed.getPosition());
        if (w) navRef.current.onFindUsages?.(w);
      }
    });
    ed.onDidBlurEditorWidget(() => {
      if (autoSaveRef.current !== 'off' && navRef.current.active) void saveRef.current(navRef.current.active, { auto: true });
    });
    ed.onDidChangeCursorPosition((e) => {
      const { onCaret: c, active: p } = navRef.current;
      if (c && p) c(p, e.position.lineNumber);
    });
    // ⌘-hover underlines the identifier like a link.
    const linkDeco = ed.createDecorationsCollection([]);
    ed.onMouseMove((e) => {
      const pos = e.target.position;
      const w = pos && (e.event.metaKey || e.event.ctrlKey) && e.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT
        ? ed.getModel()?.getWordAtPosition(pos) : null;
      linkDeco.set(w && pos ? [{ range: new monaco.Range(pos.lineNumber, w.startColumn, pos.lineNumber, w.endColumn), options: { inlineClassName: 'pm-git-link' } }] : []);
    });
    ed.onMouseLeave(() => linkDeco.set([]));
    ed.onMouseDown((e) => {
      if ((e.event.metaKey || e.event.ctrlKey) && e.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT) {
        e.event.preventDefault();
        gotoDef(e.target.position);
      }
    });
    // Click a change marker → roll that hunk back to HEAD.
    ed.onMouseDown(async (e) => {
      if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS) return;
      const line = e.target.position?.lineNumber;
      if (!line) return;
      const hk = hunksRef.current.find((x) => line >= x.newStart && line <= Math.max(x.newStart, x.newStart + x.newCount - 1));
      if (!hk) return;
      const ok = await confirmDialog({
        title: t('workspace.rollbackTitle', { count: Math.max(hk.newCount, hk.oldLines.length) }),
        description: hk.oldLines.length ? hk.oldLines.slice(0, 12).join('\n') : t('workspace.rollbackRemove'),
        confirmLabel: t('workspace.rollback'),
      });
      if (!ok) return;
      const model = ed.getModel();
      if (!model) return;
      ed.executeEdits('pm-rollback', [rollbackEdit(monaco, model, hk)]);
    });
  };

  // Annotate (blame): author + age in the line-number gutter.
  const blameLines = active ? blame[active] : undefined;
  const toggleBlame = async () => {
    if (!active) return;
    if (blameLines) { setBlame((x) => ({ ...x, [active]: undefined as unknown as null })); return; }
    try {
      const res = await gitAPI.blame(repoId, active);
      setBlame((x) => ({ ...x, [active]: (res.data as BlameLine[]) ?? [] }));
    } catch (e) {
      toast({ title: t('workspace.blameFailed'), description: extractErr(e, t('workspace.blameFailed')), variant: 'destructive' });
    }
  };
  const lineNumbers = useMemo(() => {
    if (!blameLines) return 'on' as const;
    return (n: number) => {
      const b = blameLines[n - 1];
      if (!b) return String(n);
      if (/^0+$/.test(b.sha)) return `${t('workspace.notCommitted').padEnd(16).slice(0, 16)}       ${n}`;
      const age = timeAgo(new Date(b.time * 1000).toISOString());
      return `${b.author.slice(0, 14).padEnd(14)} ${age.padStart(8)} ${n}`;
    };
  }, [blameLines, t]);

  if (files.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <FileCode2 className="h-8 w-8 opacity-40" />
        <p className="text-xs">{t('workspace.empty')}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center border-b bg-muted/20">
        <div className="flex min-w-0 flex-1 overflow-x-auto">
          {files.map((p) => {
            const dirty = dirtyPaths.includes(p);
            return (
              <div key={p} className={cn('group flex shrink-0 items-center gap-1.5 border-r px-3 py-1.5 text-xs', p === active ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-accent/40')}
                title={p} onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); void close(p); } }}>
                <button type="button" onClick={() => onActivate(p)} className="max-w-[180px] truncate">{p.split('/').pop()}</button>
                <button type="button" onClick={() => void close(p)} aria-label={t('workspace.closeTab')} className="rounded p-0.5 hover:bg-accent">
                  {dirty ? <Circle className="h-2 w-2 fill-amber-500 text-amber-500 group-hover:hidden" /> : null}
                  <X className={cn('h-3 w-3', dirty && 'hidden group-hover:block')} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-1 px-2">
          <Button size="sm" variant={blameLines ? 'secondary' : 'ghost'} className="h-6 gap-1 text-[11px]" disabled={!active || buf?.head === null} onClick={() => void toggleBlame()} title={t('workspace.annotateHint')}>
            <UserRound className="h-3 w-3" /> {t('workspace.annotate')}
          </Button>
          <Button size="sm" className="h-6 gap-1 text-[11px]" disabled={!active || saving || !dirtyPaths.includes(active)} onClick={() => void save()} title={shortcutHint(undefined, 'editor.save')}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} {t('common:save')}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {!buf || buf.loading ? (
          <div className="flex h-full items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : buf.error ? (
          <p className="m-3 rounded bg-destructive/10 p-2 text-xs text-destructive">{buf.error}</p>
        ) : (
          <CodeEditor
            key={active}
            height="100%"
            language={languageForPath(active)}
            theme={codeTheme}
            value={buf.content}
            onChange={(v) => active && setBufs((x) => ({ ...x, [active]: { ...x[active], content: v ?? '' } }))}
            onMount={onMount}
            options={{
              readOnly: buf.binary,
              minimap: { enabled: true, renderCharacters: false },
              fontSize: 12,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              wordWrap: 'off',
              padding: { top: 8 },
              lineNumbers,
              lineNumbersMinChars: blameLines ? 32 : 4,
              lineDecorationsWidth: 10,
            }}
          />
        )}
      </div>
    </div>
  );
}
