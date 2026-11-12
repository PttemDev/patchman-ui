import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeEditor } from '@/components/ui/CodeEditor';
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Check,
  Pencil,
  FileWarning,
  Save,
  Undo2,
  ArrowLeftToLine,
  ArrowRightToLine,
  ChevronsDownUp,
} from 'lucide-react';
import { gitAPI } from '@/services/api';
import { useThemeStore } from '@/stores/themeStore';
import { useToast } from '@/components/ui/use-toast';
import { confirmDialog } from '@/components/ui/confirm';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  extractErr,
  languageForPath,
  parseConflictFile,
  hasConflictMarkers,
  type ConflictBlock,
} from './util';
import { useWorkingTreeFile } from './GitBrowseTree';

// A per-block resolution choice. `edit` carries hand-typed text; the others
// derive their lines from the parsed block. `null` = still unresolved.
type Choice = 'current' | 'incoming' | 'both' | 'edit';
interface BlockState {
  choice: Choice;
  /** Hand-edited text for the `edit` choice (raw, newline-joined). */
  edited: string;
}

// Lines contributed by a block given its (possibly missing) resolution.
function resolutionLines(block: ConflictBlock, st: BlockState | undefined): string[] | null {
  if (!st) return null;
  switch (st.choice) {
    case 'current': return block.ours;
    case 'incoming': return block.theirs;
    case 'both': return [...block.ours, ...block.theirs];
    // An emptied edit box means "delete this region", not "one blank line".
    case 'edit': return st.edited === '' ? [] : st.edited.split('\n');
    default: return null;
  }
}

// Re-emit a block's original conflict markers, so a plain Save can persist
// partial progress without downgrading a diff3 file (base is preserved).
function markerLines(block: ConflictBlock): string[] {
  const open = block.oursLabel ? `<<<<<<< ${block.oursLabel}` : '<<<<<<<';
  const close = block.theirsLabel ? `>>>>>>> ${block.theirsLabel}` : '>>>>>>>';
  const out = [open, ...block.ours];
  if (block.base !== null) {
    out.push(block.baseLabel ? `||||||| ${block.baseLabel}` : '|||||||', ...block.base);
  }
  out.push('=======', ...block.theirs, close);
  return out;
}

// GitConflictResolver is the JetBrains-style merge-conflict view for ONE
// working-tree file in a local clone. It loads the conflicted file (with git
// markers) via useWorkingTreeFile — the same load/save path the in-app editor
// uses — parses it into plain + conflict segments, and lets the user pick a
// side per block (Current / Incoming / Both / hand-Edit). "Mark resolved"
// assembles the chosen file, writes it, stages it, then asks the parent to
// refresh status (the file then leaves the conflicted list). A full-file "Edit
// raw" escape hatch reuses the same working-tree editor for manual resolution.
export function GitConflictResolver({
  repoId, path, onResolved, onDirtyChange,
}: {
  repoId: string;
  path: string;
  /** Called after the file is written+staged (or staged as-is) so the parent
   *  can re-read status and drop the file from the conflicted list. */
  onResolved: () => void;
  /** Reports whether there is unsaved resolution work (in-memory choices or a
   *  dirty raw edit), so the parent can guard navigation away from this file. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation('git');
  const { theme } = useThemeStore();
  const { toast } = useToast();
  const {
    baseline, content, setContent, setEditing,
    loading, loaded, saving, error, dirty, binary, save, reload,
  } = useWorkingTreeFile(repoId, path);

  const lang = languageForPath(path);
  const parsed = useMemo(() => parseConflictFile(baseline), [baseline]);
  const conflictSegs = useMemo(
    () => parsed.segments.filter((s) => s.kind === 'conflict'),
    [parsed],
  );
  const total = conflictSegs.length;

  // Per-conflict choices, keyed by conflict index (0…total-1). Reset whenever
  // the on-disk baseline changes (initial load, reload, or after a raw save).
  const [choices, setChoices] = useState<Record<number, BlockState>>({});
  useEffect(() => { setChoices({}); }, [baseline]);

  // A malformed/unterminated file has no blocks to choose from, so it renders
  // straight into the raw editor — unlock editing there so Save can arm.
  useEffect(() => {
    if (!loading && !parsed.ok) setEditing(true);
  }, [loading, parsed.ok, setEditing]);

  const [rawMode, setRawMode] = useState(false);
  const [marking, setMarking] = useState(false);
  const [staging, setStaging] = useState(false);
  const [actionError, setActionError] = useState('');

  const setChoice = useCallback((idx: number, choice: Choice, edited?: string) => {
    setChoices((m) => ({ ...m, [idx]: { choice, edited: edited ?? m[idx]?.edited ?? '' } }));
  }, []);

  const acceptAll = useCallback((choice: Exclude<Choice, 'edit'>) => {
    setChoices(() => {
      const next: Record<number, BlockState> = {};
      for (let i = 0; i < total; i++) next[i] = { choice, edited: '' };
      return next;
    });
  }, [total]);

  // Assemble the resolved file once per render: chosen side for resolved
  // blocks, original markers for the rest (so Save keeps partial progress).
  const { assembled, resolvedCount, allResolved } = useMemo(() => {
    const out: string[] = [];
    let idx = -1;
    let resolved = 0;
    for (const seg of parsed.segments) {
      if (seg.kind === 'text') { out.push(...seg.lines); continue; }
      idx++;
      const lines = resolutionLines(seg.block, choices[idx]);
      if (lines === null) { out.push(...markerLines(seg.block)); continue; }
      resolved++;
      out.push(...lines);
    }
    return {
      assembled: out.join(parsed.eol),
      resolvedCount: resolved,
      allResolved: total > 0 && resolved === total,
    };
  }, [parsed, choices, total]);

  const canMarkResolved = allResolved && !hasConflictMarkers(assembled);
  // Every block chosen, yet a chosen side still carries a marker-shaped line
  // (e.g. a `=======` setext heading) — explain why Mark resolved stays off.
  const blockedByMarker = allResolved && !canMarkResolved;

  // Unsaved work = in-memory block choices not yet written, or a dirty raw edit.
  const dirtyForGuard = resolvedCount > 0 || dirty;
  useEffect(() => { onDirtyChange?.(dirtyForGuard); }, [dirtyForGuard, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // Refresh: parent re-reads status and drops us once the file is no longer
  // conflicted; onResolved handles the unmount.
  const markResolved = useCallback(async () => {
    setActionError('');
    setMarking(true);
    try {
      await gitAPI.writeFile(repoId, { path, content: assembled });
      await gitAPI.stage(repoId, { path });
      toast({ title: t('toast.conflictResolved'), description: t('toast.writtenStaged', { path }) });
      onResolved();
    } catch (err) {
      setActionError(extractErr(err, t('errors.markResolved')));
    } finally {
      setMarking(false);
    }
  }, [repoId, path, assembled, toast, onResolved, t]);

  // Plain Save: write the assembled (possibly partial) file WITHOUT staging,
  // then reload so the segments re-parse from disk.
  const saveOnly = useCallback(async () => {
    setActionError('');
    setMarking(true);
    try {
      await gitAPI.writeFile(repoId, { path, content: assembled });
      toast({ title: t('toast.saved'), description: t('toast.writtenWorkingTree', { path }) });
      await reload();
    } catch (err) {
      setActionError(extractErr(err, t('errors.saveFile')));
    } finally {
      setMarking(false);
    }
  }, [repoId, path, assembled, toast, reload, t]);

  // "Already resolved on disk" (no markers) → just stage it.
  const stageAsIs = useCallback(async () => {
    setActionError('');
    setStaging(true);
    try {
      await gitAPI.stage(repoId, { path });
      toast({ title: t('toast.staged'), description: t('toast.addedToIndex', { path }) });
      onResolved();
    } catch (err) {
      setActionError(extractErr(err, t('errors.stageFile')));
    } finally {
      setStaging(false);
    }
  }, [repoId, path, toast, onResolved, t]);

  // ── Raw-file escape hatch (single full-file Monaco over the working tree) ──
  const enterRaw = useCallback(() => { setEditing(true); setRawMode(true); }, [setEditing]);
  const exitRaw = useCallback(async () => {
    if (dirty && !(await confirmDialog({ title: t('confirm.discardRawEdits'), destructive: true }))) return;
    setRawMode(false);
    reload();
  }, [dirty, reload, t]);

  const rawSave = useCallback(async () => {
    setActionError('');
    const ok = await save();
    if (!ok) { setActionError(t('errors.saveFile')); return; }
    toast({ title: t('toast.saved'), description: t('toast.writtenWorkingTree', { path }) });
  }, [save, toast, path, t]);

  const rawMarkResolved = useCallback(async () => {
    setActionError('');
    if (hasConflictMarkers(content)) {
      setActionError(t('resolver.stillHasMarkers'));
      return;
    }
    setMarking(true);
    try {
      const ok = await save();
      if (!ok) { setActionError(t('errors.saveFile')); return; }
      await gitAPI.stage(repoId, { path });
      toast({ title: t('toast.conflictResolved'), description: t('toast.writtenStaged', { path }) });
      onResolved();
    } catch (err) {
      setActionError(extractErr(err, t('errors.markResolved')));
    } finally {
      setMarking(false);
    }
  }, [content, save, repoId, path, toast, onResolved, t]);

  // ── Render ────────────────────────────────────────────────────────────────
  const busy = marking || staging || saving;

  if (!loaded || loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('editor.loadingFile', { path })}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <ResolverHeader path={path} total={total} resolvedCount={0} />
        <div className="flex items-start gap-2 m-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      </div>
    );
  }
  if (binary) {
    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <ResolverHeader path={path} total={total} resolvedCount={0} />
        <div className="m-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            {t('resolver.binaryHelp')}
          </p>
          {actionError && <InlineError text={actionError} />}
          <Button size="sm" className="h-7 text-xs gap-1" disabled={staging} onClick={stageAsIs}>
            {staging ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {t('resolver.stageAsResolved')}
          </Button>
        </div>
      </div>
    );
  }

  // Full-file manual escape hatch.
  if (rawMode || !parsed.ok) {
    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b bg-muted/20">
          <FileWarning className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <span className="text-xs font-mono truncate min-w-0" title={path}>{path}</span>
          <Badge variant="secondary" className="text-[9px] shrink-0">{t('resolver.rawEdit')}</Badge>
          {dirty && (
            <span className="shrink-0 flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">{t('editor.unsaved')}</span>
          )}
          <div className="flex-1" />
          <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1" disabled={busy} onClick={exitRaw}>
            <Undo2 className="h-3 w-3" /> {parsed.ok ? t('resolver.backToBlocks') : t('resolver.reload')}
          </Button>
          <Button size="sm" variant="outline" className="h-6 text-[11px] gap-1" disabled={busy || !dirty} onClick={rawSave}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} {t('common:save')}
          </Button>
          <Button size="sm" className="h-6 text-[11px] gap-1" disabled={busy} onClick={rawMarkResolved}>
            {marking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} {t('resolver.markResolved')}
          </Button>
        </div>
        {!parsed.ok && (
          <div className="shrink-0 flex items-start gap-2 m-2 p-2 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px]">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="min-w-0 break-words">
              {t('resolver.malformedMarkers')}
            </span>
          </div>
        )}
        {actionError && <InlineError text={actionError} />}
        <div className="flex-1 min-h-0">
          <CodeEditor
            height="100%"
            language={lang}
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            value={content}
            onChange={(v) => setContent(v ?? '')}
            options={{
              readOnly: false,
              minimap: { enabled: false },
              fontSize: 12,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              wordWrap: 'off',
              padding: { top: 8 },
            }}
          />
        </div>
      </div>
    );
  }

  // Parsed OK but no conflict markers left → already resolved on disk.
  if (total === 0) {
    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <ResolverHeader path={path} total={0} resolvedCount={0} />
        <div className="m-3 space-y-3 max-w-md">
          <div className="flex items-start gap-2 p-2 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{t('resolver.noMarkers')}</span>
          </div>
          {actionError && <InlineError text={actionError} />}
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-7 text-xs gap-1" disabled={staging} onClick={stageAsIs}>
              {staging ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              {t('resolver.stageAsResolved')}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={busy} onClick={enterRaw}>
              <Pencil className="h-3 w-3" /> {t('resolver.editRawFile')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <ResolverHeader
        path={path}
        total={total}
        resolvedCount={resolvedCount}
        onAcceptAllCurrent={() => acceptAll('current')}
        onAcceptAllIncoming={() => acceptAll('incoming')}
        onEditRaw={enterRaw}
      />

      {actionError && <InlineError text={actionError} />}

      <div className="flex-1 min-h-0 overflow-auto p-2 space-y-2">
        {conflictSegs.map((seg, idx) => {
          if (seg.kind !== 'conflict') return null;
          return (
            <ConflictCard
              key={idx}
              index={idx}
              total={total}
              block={seg.block}
              lang={lang}
              state={choices[idx]}
              onChoose={(choice, edited) => setChoice(idx, choice, edited)}
            />
          );
        })}
      </div>

      {blockedByMarker && (
        <div className="shrink-0 flex items-start gap-2 mx-2 mb-1 p-1.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] leading-tight">
          <AlertTriangle className="h-3 w-3 shrink-0 mt-px" />
          <span>{t('resolver.blockedByMarker')}</span>
        </div>
      )}

      {/* Action bar */}
      <div className="shrink-0 border-t p-2 flex items-center gap-2 bg-muted/10">
        <span className="text-[11px] text-muted-foreground">
          {t('resolver.countResolved', { resolved: resolvedCount, total })}
        </span>
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={busy || resolvedCount === 0} onClick={saveOnly}>
          {marking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} {t('common:save')}
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs gap-1"
          disabled={busy || !canMarkResolved}
          onClick={markResolved}
          title={blockedByMarker ? t('resolver.markResolvedTitleBlocked') : t('resolver.markResolvedTitle')}
        >
          {marking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} {t('resolver.markResolved')}
        </Button>
      </div>
    </div>
  );
}

function ResolverHeader({
  path, total, resolvedCount, onAcceptAllCurrent, onAcceptAllIncoming, onEditRaw,
}: {
  path: string;
  total: number;
  resolvedCount: number;
  onAcceptAllCurrent?: () => void;
  onAcceptAllIncoming?: () => void;
  onEditRaw?: () => void;
}) {
  const { t } = useTranslation('git');
  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b bg-muted/20">
      <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />
      <span className="text-xs font-mono truncate min-w-0" title={path}>{path}</span>
      {total > 0 && (
        <Badge variant="secondary" className="text-[9px] shrink-0">
          {t('resolver.badgeResolved', { resolved: resolvedCount, total })}
        </Badge>
      )}
      <div className="flex-1" />
      {onAcceptAllCurrent && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[10px] gap-1 px-1.5 text-amber-600 dark:text-amber-400"
          onClick={onAcceptAllCurrent}
          title={t('resolver.acceptAllCurrentTitle')}
        >
          <ArrowLeftToLine className="h-3 w-3" /> {t('resolver.allCurrent')}
        </Button>
      )}
      {onAcceptAllIncoming && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[10px] gap-1 px-1.5 text-sky-600 dark:text-sky-400"
          onClick={onAcceptAllIncoming}
          title={t('resolver.acceptAllIncomingTitle')}
        >
          <ArrowRightToLine className="h-3 w-3" /> {t('resolver.allIncoming')}
        </Button>
      )}
      {onEditRaw && (
        <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 px-1.5" onClick={onEditRaw} title={t('resolver.editRawTitle')}>
          <Pencil className="h-3 w-3" /> {t('resolver.editRaw')}
        </Button>
      )}
    </div>
  );
}

// A single conflict block: the two sides side-by-side (stacked on narrow
// panels), with per-block Accept Current / Incoming / Both and a hand-Edit box.
function ConflictCard({
  index, total, block, lang, state, onChoose,
}: {
  index: number;
  total: number;
  block: ConflictBlock;
  lang: string;
  state: BlockState | undefined;
  onChoose: (choice: Choice, edited?: string) => void;
}) {
  const { t } = useTranslation('git');
  const choice = state?.choice ?? null;
  const [editingBlock, setEditingBlock] = useState(false);
  const [draft, setDraft] = useState('');
  const [showBase, setShowBase] = useState(false);

  const openEdit = useCallback(() => {
    // Prefill with the current resolution if one exists, else the ours side.
    const prefill = state?.choice === 'edit'
      ? state.edited
      : (resolutionLines(block, state) ?? block.ours).join('\n');
    setDraft(prefill);
    setEditingBlock(true);
  }, [block, state]);

  const saveEdit = useCallback(() => {
    onChoose('edit', draft);
    setEditingBlock(false);
  }, [onChoose, draft]);

  return (
    <div className={cn('rounded border', choice ? 'border-emerald-500/40' : 'border-border')}>
      {/* Block header */}
      <div className="flex items-center gap-2 px-2 py-1 bg-muted/30 border-b">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('resolver.conflictLabel', { index: index + 1, total })}
        </span>
        {choice ? (
          <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
            <Check className="h-3 w-3" />
            {choice === 'current' ? t('resolver.current') : choice === 'incoming' ? t('resolver.incoming') : choice === 'both' ? t('resolver.both') : t('resolver.edited')}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">{t('resolver.unresolved')}</span>
        )}
        <div className="flex-1" />
        {block.base !== null && (
          <Button
            size="sm"
            variant="ghost"
            className="h-5 text-[10px] gap-1 px-1.5 text-muted-foreground"
            onClick={() => setShowBase((v) => !v)}
            title={t('resolver.showBaseTitle')}
          >
            <ChevronsDownUp className="h-3 w-3" /> {t('resolver.base')}
          </Button>
        )}
      </div>

      {editingBlock ? (
        <div className="p-2 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="w-full min-h-[120px] font-mono text-[11px] leading-[1.5] rounded border bg-background p-2 resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-6 text-[11px] gap-1" onClick={saveEdit}>
              <Check className="h-3 w-3" /> {t('resolver.useThisText')}
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setEditingBlock(false)}>
              {t('common:cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {block.base !== null && showBase && (
            <div className="px-2 pt-2">
              <SideBox tone="base" title={t('resolver.base')} label={block.baseLabel || t('resolver.commonAncestor')} lines={block.base} lang={lang} />
            </div>
          )}
          <div className="grid gap-2 p-2 md:grid-cols-2">
            <SideBox
              tone="current"
              title={t('resolver.current')}
              label={block.oursLabel || 'HEAD'}
              lines={block.ours}
              lang={lang}
              active={choice === 'current' || choice === 'both'}
            />
            <SideBox
              tone="incoming"
              title={t('resolver.incoming')}
              label={block.theirsLabel || t('resolver.incomingLabel')}
              lines={block.theirs}
              lang={lang}
              active={choice === 'incoming' || choice === 'both'}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
            <Button
              size="sm"
              variant={choice === 'current' ? 'default' : 'outline'}
              className={cn('h-6 text-[11px] gap-1', choice !== 'current' && 'border-amber-500/50 text-amber-700 dark:text-amber-300')}
              onClick={() => onChoose('current')}
            >
              <ArrowLeftToLine className="h-3 w-3" /> {t('resolver.acceptCurrent')}
            </Button>
            <Button
              size="sm"
              variant={choice === 'incoming' ? 'default' : 'outline'}
              className={cn('h-6 text-[11px] gap-1', choice !== 'incoming' && 'border-sky-500/50 text-sky-700 dark:text-sky-300')}
              onClick={() => onChoose('incoming')}
            >
              <ArrowRightToLine className="h-3 w-3" /> {t('resolver.acceptIncoming')}
            </Button>
            <Button
              size="sm"
              variant={choice === 'both' ? 'default' : 'outline'}
              className="h-6 text-[11px] gap-1"
              onClick={() => onChoose('both')}
              title={t('resolver.acceptBothTitle')}
            >
              {t('resolver.acceptBoth')}
            </Button>
            <Button
              size="sm"
              variant={choice === 'edit' ? 'default' : 'ghost'}
              className="h-6 text-[11px] gap-1"
              onClick={openEdit}
              title={t('resolver.editBlockTitle')}
            >
              <Pencil className="h-3 w-3" /> {t('common:edit')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

const TONE = {
  current: {
    head: 'text-amber-700 dark:text-amber-300 bg-amber-500/10 border-amber-500/30',
    ring: 'ring-1 ring-amber-500/50',
  },
  incoming: {
    head: 'text-sky-700 dark:text-sky-300 bg-sky-500/10 border-sky-500/30',
    ring: 'ring-1 ring-sky-500/50',
  },
  base: {
    head: 'text-muted-foreground bg-muted/40 border-border',
    ring: '',
  },
} as const;

// A read-only monospace box for one side of a conflict. NOTE: this is plain
// monospace, not Monaco-tokenized — rendering 2×N live editors would jank the
// panel — but the resolved file is written back through the same editor path.
// `lang` is accepted (from the file extension) for parity with the editor and
// so a future highlighter can drop in without a signature change.
function SideBox({
  tone, title, label, lines, active,
}: {
  tone: keyof typeof TONE;
  title: string;
  label: string;
  lines: string[];
  lang: string;
  active?: boolean;
}) {
  const { t } = useTranslation('git');
  const tn = TONE[tone];
  return (
    <div className={cn('rounded border overflow-hidden', active && tn.ring)}>
      <div className={cn('flex items-center gap-1.5 px-2 py-0.5 border-b text-[10px] font-medium', tn.head)}>
        <span className="uppercase tracking-wider">{title}</span>
        <span className="font-mono opacity-70 truncate min-w-0" title={label}>{label}</span>
      </div>
      <pre className="max-h-56 overflow-auto px-2 py-1 font-mono text-[11px] leading-[1.5] whitespace-pre">
        {lines.length === 0
          ? <span className="italic text-muted-foreground">{t('resolver.emptySide')}</span>
          : lines.map((l, i) => <div key={i}>{l === '' ? ' ' : l}</div>)}
      </pre>
    </div>
  );
}

function InlineError({ text }: { text: string }) {
  return (
    <div className="shrink-0 flex items-start gap-2 m-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <span className="min-w-0 break-words">{text}</span>
    </div>
  );
}
