import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Loader2,
  RefreshCw,
  AlertTriangle,
  FilePlus2,
  FileMinus2,
  FilePen,
  FileQuestion,
  Plus,
  Minus,
  GitBranch,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  UploadCloud,
  GitMerge,
  Copy,
  EyeOff,
  FileCode2,
  Undo2,
} from 'lucide-react';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { gitAPI } from '@/services/api';
import { confirmDialog } from '@/components/ui/confirm';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { decodeGitContent, extractErr } from './util';
import { GitConflictResolver } from './GitConflictResolver';
import type { GitStatus, GitStatusEntry } from '@/types';

interface GitChangesPanelProps {
  repoId: string;
  /** The clone's connection — picks the push token (see gitOpsToken). */
  connectionId?: string;
  onChanged?: () => void;
  /** Bubbles the conflict resolver's unsaved-work flag so the parent (GitPanel)
   *  can guard mode / repo / connection switches, mirroring the editor guard. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Jump to Source: open the file in the editor (Browse). */
  onOpenFile?: (path: string) => void;
}

// The JetBrains Push dialog lives in GitPanel (shared with ⌘⇧K and the
// toolbar); the Changes panel asks for it with an event.
const openPushDialog = () => window.dispatchEvent(new CustomEvent('patchman:git-open-push'));

// ── Unified-diff hunk parsing ────────────────────────────────────────────────
// A `git diff` patch = a file header (diff --git / index / --- / +++), then one
// or more `@@ … @@` hunks. To stage/unstage a single hunk we resend the file
// header + that hunk verbatim as {path, patch} — git apply --cached needs the
// header to locate the file, and sending whole hunks means no line renumbering.
function parsePatch(patch: string): { fileHeader: string; hunks: string[] } {
  const lines = patch.split('\n');
  let i = 0;
  const header: string[] = [];
  while (i < lines.length && !lines[i].startsWith('@@')) { header.push(lines[i]); i++; }
  const hunks: string[] = [];
  let current: string[] | null = null;
  for (; i < lines.length; i++) {
    if (lines[i].startsWith('@@')) {
      if (current) hunks.push(current.join('\n'));
      current = [lines[i]];
    } else if (current) {
      current.push(lines[i]);
    }
  }
  if (current) hunks.push(current.join('\n'));
  return { fileHeader: header.join('\n'), hunks };
}

function hunkPatch(fileHeader: string, hunk: string): string {
  const body = `${fileHeader}\n${hunk}`;
  return body.endsWith('\n') ? body : `${body}\n`;
}

const STATUS_ICON = {
  added: FilePlus2,
  modified: FilePen,
  deleted: FileMinus2,
  renamed: FilePen,
  untracked: FileQuestion,
} as const;

// Same colours as the file tree and editor tabs (JetBrains-like): modified
// blue, added green, new/untracked red, deleted grey.
const STATUS_TONE = {
  added: 'text-emerald-600 dark:text-emerald-400',
  modified: 'text-sky-600 dark:text-sky-400',
  deleted: 'text-muted-foreground',
  renamed: 'text-sky-600 dark:text-sky-400',
  untracked: 'text-red-500 dark:text-red-400',
} as const;

type Selected = { path: string; staged: boolean } | null;

// GitChangesPanel is the local, desktop-only working-tree view: `git status`
// grouped into staged / unstaged / untracked, per-file AND per-hunk Stage /
// Unstage, a commit box (message + amend) and Commit / Commit & Push. The push
// dialog defaults to branch + MR.
export function GitChangesPanel({ repoId, onChanged, onDirtyChange, onOpenFile }: GitChangesPanelProps) {
  const { t } = useTranslation('git');
  const { toast } = useToast();

  // Tracks the open resolver's unsaved-work flag. Guards within-panel file
  // navigation here, and is bubbled up via onDirtyChange for parent-level
  // (mode / repo / connection) switch guards.
  const resolverDirtyRef = useRef(false);
  const handleResolverDirty = useCallback((d: boolean) => {
    resolverDirtyRef.current = d;
    onDirtyChange?.(d);
  }, [onDirtyChange]);
  const confirmResolverDiscard = useCallback(async () => {
    if (!resolverDirtyRef.current) return true;
    const ok = await confirmDialog({ title: t('confirm.unsavedConflict'), destructive: true });
    if (ok) handleResolverDirty(false);
    return ok;
  }, [handleResolverDirty, t]);

  const [status, setStatus] = useState<GitStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');

  const [selected, setSelected] = useState<Selected>(null);
  // Path of the conflicted file whose merge-resolver is open (mutually
  // exclusive with `selected`'s plain diff).
  const [resolving, setResolving] = useState<string | null>(null);
  const [patch, setPatch] = useState<string>('');
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState('');
  const [busy, setBusy] = useState(false); // a stage/unstage is in flight

  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState('');
  const messageRef = useRef<HTMLTextAreaElement>(null);
  // ⌘K / ⌘⇧K from the Git tab's keymap (GitPanel dispatches these).
  useEffect(() => {
    const focus = () => messageRef.current?.focus();
    window.addEventListener('patchman:git-commit-focus', focus);
    return () => {
      window.removeEventListener('patchman:git-commit-focus', focus);
    };
  }, []);

  const loadStatus = useCallback(async (): Promise<GitStatus | null> => {
    setStatusLoading(true);
    setStatusError('');
    try {
      const res = await gitAPI.status(repoId);
      setStatus(res.data as GitStatus);
      return res.data as GitStatus;
    } catch (err) {
      setStatusError(extractErr(err, t('errors.readStatus')));
      setStatus(null);
      return null;
    } finally {
      setStatusLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  useEffect(() => {
    setSelected(null);
    setResolving(null);
    setPatch('');
    loadStatus();
  }, [repoId, loadStatus]);

  // If the file being resolved leaves the conflicted list (resolved elsewhere,
  // staged, or the repo re-read), drop the resolver back to the empty state.
  useEffect(() => {
    if (resolving && status && !status.conflicted.includes(resolving)) setResolving(null);
  }, [resolving, status]);

  const loadDiff = useCallback(async (sel: Selected) => {
    if (!sel) { setPatch(''); return; }
    setDiffLoading(true);
    setDiffError('');
    try {
      const res = await gitAPI.localDiff(repoId, { path: sel.path, staged: sel.staged });
      const d = (res.data ?? {}) as { patch?: string };
      setPatch(d.patch ?? '');
    } catch (err) {
      setDiffError(extractErr(err, t('errors.loadDiff')));
      setPatch('');
    } finally {
      setDiffLoading(false);
    }
  }, [repoId, t]);

  const selectFile = useCallback(async (path: string, staged: boolean) => {
    if (resolving && !(await confirmResolverDiscard())) return;
    const sel = { path, staged };
    setResolving(null);
    setSelected(sel);
    loadDiff(sel);
  }, [loadDiff, resolving, confirmResolverDiscard]);

  // Open the merge-conflict resolver for a conflicted path (replaces the plain
  // diff in the center pane).
  const selectConflict = useCallback(async (path: string) => {
    if (resolving === path) return; // already open
    if (resolving && !(await confirmResolverDiscard())) return;
    setSelected(null);
    setPatch('');
    setContinueMerge(false);
    setResolving(path);
  }, [resolving, confirmResolverDiscard]);

  // After a conflict is resolved (written + staged, or staged as-is) refresh
  // status; the cleanup effect then drops the resolver as the file leaves the
  // conflicted list.
  // Resolving one file moves straight on to the next conflicted one, with the
  // Merge window already open (JetBrains walks the list the same way).
  const [continueMerge, setContinueMerge] = useState(false);
  const onConflictResolved = useCallback(async () => {
    const done = resolving;
    setResolving(null);
    const st = await loadStatus();
    onChanged?.();
    const next = st?.conflicted.find((p) => p !== done);
    if (next) {
      setContinueMerge(true);
      setResolving(next);
    }
  }, [resolving, loadStatus, onChanged]);

  // After any stage/unstage the index shifts, so refetch BOTH status and the
  // open file's diff before the next hunk action (a stale hunk can fail to
  // apply against a moved index).
  const refreshAfterMutation = useCallback(async (sel: Selected) => {
    await loadStatus();
    if (sel) await loadDiff(sel);
  }, [loadStatus, loadDiff]);

  const stageFile = useCallback(async (path: string, unstage: boolean) => {
    setBusy(true);
    try {
      if (unstage) await gitAPI.unstage(repoId, { path });
      else await gitAPI.stage(repoId, { path });
      const keep = selected && selected.path === path ? selected : null;
      await refreshAfterMutation(keep);
      onChanged?.();
    } catch (err) {
      toast({ title: unstage ? t('stage.unstageFailedTitle') : t('stage.stageFailedTitle'), description: extractErr(err, t('errors.requestFailed')), variant: 'destructive' });
    }
    setBusy(false);
  }, [repoId, selected, refreshAfterMutation, onChanged, toast, t]);

  // Rollback (back to HEAD; a new file is removed), Add to .gitignore.
  const rollbackFile = useCallback(async (e: GitStatusEntry) => {
    const isNew = e.status === 'untracked' || e.status === 'added';
    const name = e.path.split('/').pop() ?? e.path;
    const ok = await confirmDialog({
      title: t('tree.rollbackTitle', { name }),
      description: isNew ? t('tree.rollbackNewBody') : t('tree.rollbackBody'),
      destructive: true, confirmLabel: t('tree.rollback'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await gitAPI.fsOp(repoId, { op: 'rollback', path: e.path });
      if (selected?.path === e.path) setSelected(null);
      await loadStatus();
      onChanged?.();
      toast({ title: t('tree.rolledBack', { name }) });
    } catch (err) {
      toast({ title: t('tree.failed'), description: extractErr(err, t('tree.failed')), variant: 'destructive' });
    }
    setBusy(false);
  }, [repoId, selected, loadStatus, onChanged, toast, t]);
  const ignoreFile = useCallback(async (path: string) => {
    try {
      let content = '';
      try {
        const res = await gitAPI.localFile(repoId, { path: '.gitignore' });
        const d = (res.data ?? {}) as { content?: string; encoding?: string };
        content = decodeGitContent(d.content, d.encoding);
      } catch { /* no .gitignore yet */ }
      const line = `/${path}`;
      if (!content.split('\n').some((l) => l.trim() === line)) {
        const next = (content && !content.endsWith('\n') ? content + '\n' : content) + line + '\n';
        await gitAPI.writeFile(repoId, { path: '.gitignore', content: next });
      }
      await loadStatus();
      onChanged?.();
      toast({ title: t('tree.ignored', { line }) });
    } catch (err) {
      toast({ title: t('tree.failed'), description: extractErr(err, t('tree.failed')), variant: 'destructive' });
    }
  }, [repoId, loadStatus, onChanged, toast, t]);
  const groupActions = { onRollback: rollbackFile, onIgnore: ignoreFile, onOpenFile };

  const stageHunk = useCallback(async (hunk: string, fileHeader: string, unstage: boolean) => {
    if (!selected) return;
    setBusy(true);
    try {
      const p = hunkPatch(fileHeader, hunk);
      if (unstage) await gitAPI.unstage(repoId, { path: selected.path, patch: p });
      else await gitAPI.stage(repoId, { path: selected.path, patch: p });
      await refreshAfterMutation(selected);
      onChanged?.();
    } catch (err) {
      toast({ title: unstage ? t('stage.unstageHunkFailedTitle') : t('stage.stageHunkFailedTitle'), description: extractErr(err, t('errors.hunkRejected')), variant: 'destructive' });
    }
    setBusy(false);
  }, [repoId, selected, refreshAfterMutation, onChanged, toast, t]);

  const doCommit = useCallback(async (): Promise<boolean> => {
    setCommitError('');
    if (!message.trim() && !amend) { setCommitError(t('commit.enterMessage')); return false; }
    setCommitting(true);
    try {
      await gitAPI.localCommit(repoId, { message: message.trim(), amend });
      setMessage('');
      setAmend(false);
      setSelected(null);
      setPatch('');
      await loadStatus();
      onChanged?.();
      return true;
    } catch (err) {
      setCommitError(extractErr(err, t('errors.commit')));
      return false;
    } finally {
      setCommitting(false);
    }
  }, [repoId, message, amend, loadStatus, onChanged, t]);

  const commitAndPush = useCallback(async () => {
    const ok = await doCommit();
    if (ok) openPushDialog();
  }, [doCommit]);

  const { fileHeader, hunks } = useMemo(() => parsePatch(patch), [patch]);

  const hasStaged = (status?.staged.length ?? 0) > 0;

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      {/* Left: status lists + commit box */}
      <div className="w-80 shrink-0 border-r flex flex-col min-h-0">
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b bg-muted/20">
          {status && (
            <>
              <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs font-mono truncate" title={status.branch}>{status.branch}</span>
              {status.ahead > 0 && (
                <span className="flex items-center text-[10px] text-emerald-500"><ArrowUp className="h-3 w-3" />{status.ahead}</span>
              )}
              {status.behind > 0 && (
                <span className="flex items-center text-[10px] text-amber-500"><ArrowDown className="h-3 w-3" />{status.behind}</span>
              )}
            </>
          )}
          <div className="flex-1" />
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={loadStatus} disabled={statusLoading} title={t('changes.refreshStatus')}>
            <RefreshCw className={cn('h-3.5 w-3.5', statusLoading && 'animate-spin')} />
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          {statusError ? (
            <div className="flex items-start gap-2 m-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="min-w-0 break-words">{statusError}</span>
            </div>
          ) : statusLoading && !status ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('changes.readingStatus')}
            </div>
          ) : status && status.clean ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 opacity-40" />
              <p className="text-xs">{t('changes.clean')}</p>
            </div>
          ) : status ? (
            <>
              <ConflictGroup
                paths={status.conflicted}
                activePath={resolving}
                onResolve={selectConflict}
              />
              <FileGroup
                title={t('changes.staged')}
                entries={status.staged}
                staged
                selected={selected}
                busy={busy}
                onSelect={selectFile}
                onToggle={(path) => stageFile(path, true)}
                {...groupActions}
              />
              <FileGroup
                title={t('changes.unstaged')}
                entries={status.unstaged}
                staged={false}
                selected={selected}
                busy={busy}
                onSelect={selectFile}
                onToggle={(path) => stageFile(path, false)}
                {...groupActions}
              />
              <FileGroup
                title={t('changes.untracked')}
                entries={status.untracked.map<GitStatusEntry>((p) => ({ path: p, x: '?', y: '?', status: 'untracked' }))}
                staged={false}
                selected={selected}
                busy={busy}
                onSelect={selectFile}
                onToggle={(path) => stageFile(path, false)}
                {...groupActions}
              />
            </>
          ) : null}
        </div>

        {/* Commit box */}
        <div className="shrink-0 border-t p-2 space-y-2">
          <Textarea
            ref={messageRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('commit.messagePlaceholder')}
            className="min-h-[64px] text-xs resize-none"
            spellCheck={false}
          />
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
              <Switch checked={amend} onCheckedChange={setAmend} className="scale-90" />
              {t('commit.amend')}
            </Label>
            {status && status.ahead > 0 && (
              <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1" onClick={openPushDialog}>
                <UploadCloud className="h-3 w-3" /> {t('push.pushEllipsis')}
              </Button>
            )}
          </div>
          {commitError && <p className="text-[11px] text-destructive break-words">{commitError}</p>}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="flex-1 h-7 text-xs"
              disabled={committing || (!hasStaged && !amend) || (!message.trim() && !amend)}
              onClick={doCommit}
            >
              {committing && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              {t('commit.commit')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 h-7 text-xs"
              disabled={committing || (!hasStaged && !amend) || (!message.trim() && !amend)}
              onClick={commitAndPush}
            >
              {t('commit.commitAndPush')}
            </Button>
          </div>
        </div>
      </div>

      {/* Right: merge resolver (conflicted file) or per-hunk diff */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {resolving ? (
          <GitConflictResolver
            key={`${repoId}:${resolving}`}
            repoId={repoId}
            path={resolving}
            onResolved={onConflictResolved}
            onDirtyChange={handleResolverDirty}
            autoOpen={continueMerge}
            remaining={status?.conflicted.length ?? 0}
          />
        ) : !selected ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <FilePen className="h-8 w-8 opacity-40" />
            <p className="text-xs">{t('changes.selectFile')}</p>
          </div>
        ) : (
          <>
            <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b bg-muted/20">
              <span className="text-xs font-mono truncate min-w-0" title={selected.path}>{selected.path}</span>
              <Badge variant="secondary" className="text-[9px] shrink-0">{selected.staged ? t('badge.staged') : t('badge.unstaged')}</Badge>
              <div className="flex-1" />
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[11px] gap-1"
                disabled={busy}
                onClick={() => stageFile(selected.path, selected.staged)}
              >
                {selected.staged ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                {selected.staged ? t('stage.unstageFile') : t('stage.stageFile')}
              </Button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              {diffLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t('diff.loading')}
                </div>
              ) : diffError ? (
                <div className="flex items-start gap-2 m-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span className="min-w-0 break-words">{diffError}</span>
                </div>
              ) : hunks.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground">
                  <Trans
                    t={t}
                    i18nKey="changes.noLineDiff"
                    values={{ action: selected.staged ? t('stage.unstageFile') : t('stage.stageFile') }}
                    components={{ b: <span className="font-medium" /> }}
                  />
                </div>
              ) : (
                <div className="divide-y">
                  {hunks.map((hunk, idx) => (
                    <div key={idx}>
                      <div className="flex items-center gap-2 px-2 py-1 bg-muted/30 sticky top-0">
                        <span className="text-[10px] font-mono text-sky-600 dark:text-sky-400 truncate min-w-0">
                          {hunk.split('\n')[0]}
                        </span>
                        <div className="flex-1" />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 text-[10px] gap-1 px-1.5"
                          disabled={busy}
                          onClick={() => stageHunk(hunk, fileHeader, selected.staged)}
                        >
                          {selected.staged ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                          {selected.staged ? t('stage.unstageHunk') : t('stage.stageHunk')}
                        </Button>
                      </div>
                      <HunkBody hunk={hunk} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

    </div>
  );
}

function FileGroup({
  title, entries, staged, selected, busy, onSelect, onToggle, onRollback, onIgnore, onOpenFile,
}: {
  title: string;
  entries: GitStatusEntry[];
  staged: boolean;
  selected: Selected;
  busy: boolean;
  onSelect: (path: string, staged: boolean) => void;
  onToggle: (path: string) => void;
  onRollback?: (e: GitStatusEntry) => void;
  onIgnore?: (path: string) => void;
  onOpenFile?: (path: string) => void;
}) {
  const { t } = useTranslation('git');
  if (entries.length === 0) return null;
  return (
    <div className="select-none py-1">
      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        {title}
        <Badge variant="secondary" className="text-[9px] px-1 py-0">{entries.length}</Badge>
      </div>
      {entries.map((e) => {
        const Icon = STATUS_ICON[e.status] ?? FilePen;
        const active = selected?.path === e.path && selected?.staged === staged;
        const slash = e.path.lastIndexOf('/');
        const name = slash < 0 ? e.path : e.path.slice(slash + 1);
        const dir = slash < 0 ? '' : e.path.slice(0, slash);
        return (
          <ContextMenu key={`${staged ? 's' : 'u'}:${e.path}`}>
            <ContextMenuTrigger asChild>
              <div
                className={cn('group flex items-center gap-1 pr-2 hover:bg-accent/40', active && 'bg-accent/60')}
                onContextMenu={() => onSelect(e.path, staged)}
                onDoubleClick={() => e.status !== 'deleted' && onOpenFile?.(e.path)}
              >
                <button
                  type="button"
                  onClick={() => onSelect(e.path, staged)}
                  className="flex-1 min-w-0 flex items-center gap-1.5 pl-3 py-1 text-left"
                  title={e.oldPath ? `${e.oldPath} → ${e.path}` : e.path}
                >
                  <Icon className={cn('h-3.5 w-3.5 shrink-0', STATUS_TONE[e.status])} />
                  <span className={cn('text-xs truncate', STATUS_TONE[e.status], e.status === 'deleted' && 'line-through')}>{name}</span>
                  {dir && <span className="truncate text-[10px] text-muted-foreground">{dir}</span>}
                </button>
                <span className={cn('shrink-0 text-[10px]', STATUS_TONE[e.status])}>{t(`tree.status.${e.status}`)}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100"
                  disabled={busy}
                  title={staged ? t('stage.unstageFile') : t('stage.stageFile')}
                  onClick={() => onToggle(e.path)}
                >
                  {staged ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                </Button>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
              {onOpenFile && e.status !== 'deleted' && <ContextMenuItem onClick={() => onOpenFile(e.path)}><FileCode2 className="mr-2 h-3.5 w-3.5" />{t('changes.jumpToSource')}</ContextMenuItem>}
              <ContextMenuItem disabled={busy} onClick={() => onToggle(e.path)}>
                {staged ? <Minus className="mr-2 h-3.5 w-3.5" /> : <Plus className="mr-2 h-3.5 w-3.5" />}{staged ? t('stage.unstageFile') : t('stage.stageFile')}
              </ContextMenuItem>
              {onRollback && <ContextMenuItem disabled={busy} onClick={() => onRollback(e)}><Undo2 className="mr-2 h-3.5 w-3.5" />{t('tree.rollback')}…</ContextMenuItem>}
              {onIgnore && e.status === 'untracked' && <ContextMenuItem onClick={() => onIgnore(e.path)}><EyeOff className="mr-2 h-3.5 w-3.5" />{t('tree.addToGitignore')}</ContextMenuItem>}
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => void navigator.clipboard.writeText(e.path)}><Copy className="mr-2 h-3.5 w-3.5" />{t('tree.copyRelative')}</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </div>
  );
}

// Merge-conflict group: unmerged paths from `status.conflicted`. Distinct from
// FileGroup (whose toggle stages/unstages) — the primary action here is Resolve,
// which opens the JetBrains-style resolver in the center pane. The Resolve
// button is always visible (not hover-only) since it's the intended next step.
function ConflictGroup({
  paths, activePath, onResolve,
}: {
  paths: string[];
  activePath: string | null;
  onResolve: (path: string) => void;
}) {
  const { t } = useTranslation('git');
  if (paths.length === 0) return null;
  return (
    <div className="py-1">
      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-red-600 dark:text-red-400 flex items-center gap-1.5">
        {t('conflicts.groupTitle')}
        <Badge variant="secondary" className="text-[9px] px-1 py-0">{paths.length}</Badge>
      </div>
      {paths.map((p) => {
        const active = activePath === p;
        return (
          <div
            key={`c:${p}`}
            className={cn('group flex items-center gap-1 pr-2 hover:bg-accent/40', active && 'bg-accent/60')}
          >
            <button
              type="button"
              onClick={() => onResolve(p)}
              className="flex-1 min-w-0 flex items-center gap-1.5 pl-3 py-1 text-left"
              title={p}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />
              <span className="text-xs truncate">{p}</span>
            </button>
            <Button
              size="sm"
              variant="outline"
              className="h-5 shrink-0 text-[10px] gap-1 px-1.5 border-amber-500/50 text-amber-700 dark:text-amber-300"
              onClick={() => onResolve(p)}
              title={t('conflicts.openResolver')}
            >
              <GitMerge className="h-3 w-3" /> {t('conflicts.resolve')}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function HunkBody({ hunk }: { hunk: string }) {
  const lines = hunk.split('\n').slice(1); // drop the @@ header (shown above)
  return (
    <div className="font-mono text-[11px] leading-[1.4]">
      {lines.map((line, i) => {
        const added = line.startsWith('+');
        const removed = line.startsWith('-');
        return (
          <div
            key={i}
            className={cn(
              'whitespace-pre px-2',
              added && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
              removed && 'bg-red-500/10 text-red-700 dark:text-red-300',
              !added && !removed && 'text-muted-foreground',
            )}
          >
            {line || ' '}
          </div>
        );
      })}
    </div>
  );
}
