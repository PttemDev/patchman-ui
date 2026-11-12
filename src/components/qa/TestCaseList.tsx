import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  Plus, Search, FlaskConical, ChevronRight, ChevronDown, Play, CheckCircle2, XCircle, AlertTriangle, Loader2,
  Send, ShieldCheck, Variable, Clock, Folder, FolderOpen, FolderPlus, FolderInput, GripVertical, MoreHorizontal,
  Pencil, Trash2, CornerLeftUp,
} from 'lucide-react';
import { testCasesAPI, testFoldersAPI } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { confirmDialog } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { TestCaseEditor } from './TestCaseEditor';
import { RunFolderDialog } from './RunFolderDialog';
import {
  buildFolderIndex,
  casesIn,
  childFolders,
  effectiveFolderId,
  flattenFolders,
  folderCasesInOrder,
  folderPath,
  type FolderIndex,
} from './folderTree';
import { activeRunEnv, isExecutableCase, runErrorResult } from './stepVars';
import type { TestCase, TestCaseFolder, TestExecutionResult } from '@/types';

const statusConfig: Record<string, { variant: string; labelKey: string }> = {
  draft: { variant: 'secondary', labelKey: 'caseStatus.draft' },
  active: { variant: 'success', labelKey: 'caseStatus.active' },
  deprecated: { variant: 'warning', labelKey: 'caseStatus.deprecated' },
};

const priorityConfig: Record<string, { variant: string; labelKey: string; color: string }> = {
  P0: { variant: 'destructive', labelKey: 'priorityShort.P0', color: 'text-red-500' },
  P1: { variant: 'destructive', labelKey: 'priorityShort.P1', color: 'text-orange-500' },
  P2: { variant: 'warning', labelKey: 'priorityShort.P2', color: 'text-yellow-500' },
  P3: { variant: 'info', labelKey: 'priorityShort.P3', color: 'text-blue-500' },
  P4: { variant: 'secondary', labelKey: 'priorityShort.P4', color: 'text-gray-400' },
  high: { variant: 'destructive', labelKey: 'priorityShort.high', color: 'text-red-500' },
  medium: { variant: 'warning', labelKey: 'priorityShort.medium', color: 'text-yellow-500' },
  low: { variant: 'secondary', labelKey: 'priorityShort.low', color: 'text-gray-400' },
};

// Expanded folders survive a reload (per browser; a convenience only).
const EXPANDED_KEY = 'patchman_qa_expanded_folders';
function loadExpanded(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(EXPANDED_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
function saveExpanded(s: Set<string>) {
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify(Array.from(s))); } catch { /* storage unavailable */ }
}

const ROOT_DROP = 'qa-root';
const CASE_PREFIX = 'case:';
const FOLDER_PREFIX = 'folder:';
const INDENT_PX = 14;

type NameDialogState =
  | { mode: 'create'; parentId: string | null }
  | { mode: 'rename'; folder: TestCaseFolder };

export function TestCaseList() {
  const { t } = useTranslation('qa');
  const { toast } = useToast();
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [folders, setFolders] = useState<TestCaseFolder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<TestCase | null>(null);
  const [newCaseFolderId, setNewCaseFolderId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TestExecutionResult>>({});
  const [expandedResult, setExpandedResult] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [runFolder, setRunFolder] = useState<TestCaseFolder | null>(null);
  const [dragLabel, setDragLabel] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    const [casesRes, foldersRes] = await Promise.allSettled([testCasesAPI.list(), testFoldersAPI.list()]);
    if (casesRes.status === 'fulfilled') setTestCases(casesRes.value.data);
    // An older BE without folders 404s here — the list still works, flat.
    setFolders(foldersRes.status === 'fulfilled' && Array.isArray(foldersRes.value.data) ? foldersRes.value.data : []);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const index = useMemo(() => buildFolderIndex(folders, testCases), [folders, testCases]);

  const setFolderExpanded = useCallback((id: string, open: boolean) => {
    setExpanded((prev) => {
      if (prev.has(id) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      saveExpanded(next);
      return next;
    });
  }, []);

  const handleRun = async (e: React.MouseEvent, tc: TestCase) => {
    e.stopPropagation();
    if (runningId) return;
    setRunningId(tc.id);
    setExpandedResult(tc.id);
    try {
      // Run against the active environment — the one the step editors'
      // {{var}} autocomplete offers — so {{base_url}} etc. are substituted.
      const res = await testCasesAPI.execute(tc.id, activeRunEnv());
      setResults((prev) => ({ ...prev, [tc.id]: res.data }));
    } catch (err) {
      setResults((prev) => ({ ...prev, [tc.id]: runErrorResult(err) }));
    }
    setRunningId(null);
  };

  // ── Folder / move actions ──

  const moveCase = useCallback(async (tc: TestCase, folderId: string | null) => {
    if (effectiveFolderId(index, tc) === folderId) return;
    const before = tc.folderId ?? null;
    setTestCases((prev) => prev.map((c) => (c.id === tc.id ? { ...c, folderId } : c)));
    if (folderId) setFolderExpanded(folderId, true);
    try {
      await testCasesAPI.move(tc.id, folderId);
    } catch {
      setTestCases((prev) => prev.map((c) => (c.id === tc.id ? { ...c, folderId: before } : c)));
      toast({ title: t('folders.moveFailed', { defaultValue: 'Could not move the test case' }), variant: 'destructive' });
    }
  }, [index, setFolderExpanded, t, toast]);

  const submitName = async (name: string) => {
    const state = nameDialog;
    if (!state) return;
    try {
      if (state.mode === 'create') {
        await testFoldersAPI.create({ name, parentId: state.parentId });
        if (state.parentId) setFolderExpanded(state.parentId, true);
      } else {
        await testFoldersAPI.rename(state.folder.id, name);
      }
      setNameDialog(null);
      await fetchAll();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast({
        title: state.mode === 'create'
          ? t('folders.createFailed', { defaultValue: 'Could not create the folder' })
          : t('folders.renameFailed', { defaultValue: 'Could not rename the folder' }),
        description: msg,
        variant: 'destructive',
      });
    }
  };

  const deleteFolder = async (f: TestCaseFolder) => {
    const directCases = casesIn(index, f.id).length;
    const subfolders = childFolders(index, f.id).length;
    const isEmpty = directCases === 0 && subfolders === 0;
    const parentName = f.parentId ? index.byId.get(f.parentId)?.name : undefined;
    const target = parentName ?? t('folders.root', { defaultValue: 'Root' });
    const ok = await confirmDialog({
      title: t('folders.deleteTitle', { defaultValue: 'Delete folder “{{name}}”?', name: f.name }),
      description: isEmpty
        ? t('folders.deleteEmptyDesc', { defaultValue: 'The folder is empty.' })
        : t('folders.deleteMoveDesc', {
          defaultValue: 'Its {{cases}} test case(s) and {{folders}} subfolder(s) will move to “{{target}}”. No test case is deleted.',
          cases: directCases,
          folders: subfolders,
          target,
        }),
      confirmLabel: isEmpty
        ? t('folders.delete', { defaultValue: 'Delete' })
        : t('folders.deleteAndMove', { defaultValue: 'Move contents & delete' }),
      destructive: true,
    });
    if (!ok) return;
    try {
      await testFoldersAPI.delete(f.id, !isEmpty);
      await fetchAll();
    } catch {
      toast({ title: t('folders.deleteFailed', { defaultValue: 'Could not delete the folder' }), variant: 'destructive' });
      await fetchAll();
    }
  };

  const newCaseIn = (folderId: string | null) => {
    setEditingCase(null);
    setNewCaseFolderId(folderId);
    setEditorOpen(true);
  };

  // ── Drag & drop (cases onto folders / the root strip) ──

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const collision: CollisionDetection = (args) => {
    const p = pointerWithin(args);
    if (p.length) return p;
    const r = rectIntersection(args);
    return r.length ? r : closestCenter(args);
  };
  const handleDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id).slice(CASE_PREFIX.length);
    setDragLabel(testCases.find((c) => c.id === id)?.title ?? null);
  };
  const handleDragEnd = (e: DragEndEvent) => {
    setDragLabel(null);
    const { active, over } = e;
    if (!over) return;
    const tc = testCases.find((c) => c.id === String(active.id).slice(CASE_PREFIX.length));
    if (!tc) return;
    const overId = String(over.id);
    if (overId === ROOT_DROP) void moveCase(tc, null);
    else if (overId.startsWith(FOLDER_PREFIX)) void moveCase(tc, overId.slice(FOLDER_PREFIX.length));
  };

  // ── Rendering ──

  const q = searchQuery.trim().toLowerCase();
  const filteredCases = q
    ? testCases.filter(
      (tc) => tc.title.toLowerCase().includes(q) || tc.tags.some((tag) => tag.toLowerCase().includes(q)),
    )
    : testCases;

  const caseRowProps = (tc: TestCase, depth: number, showPath: boolean): CaseRowProps => ({
    tc,
    depth,
    path: showPath ? folderPath(index, effectiveFolderId(index, tc)) : '',
    result: results[tc.id],
    isRunning: runningId === tc.id,
    anyRunning: !!runningId,
    isExpanded: expandedResult === tc.id && !!results[tc.id],
    draggable: folders.length > 0 && !q,
    index,
    onOpen: () => { setEditingCase(tc); setEditorOpen(true); },
    onRun: (e) => handleRun(e, tc),
    onToggleResult: () => setExpandedResult(expandedResult === tc.id ? null : tc.id),
    onMove: (folderId) => void moveCase(tc, folderId),
  });

  const renderFolder = (f: TestCaseFolder, depth: number): React.ReactNode => {
    const open = expanded.has(f.id);
    const subtree = folderCasesInOrder(index, f.id, true);
    const executable = subtree.filter(isExecutableCase).length;
    return (
      <div key={f.id}>
        <FolderRow
          folder={f}
          depth={depth}
          open={open}
          caseCount={subtree.length}
          canRun={executable > 0}
          onToggle={() => setFolderExpanded(f.id, !open)}
          onRunAll={() => setRunFolder(f)}
          onNewCase={() => { setFolderExpanded(f.id, true); newCaseIn(f.id); }}
          onNewSubfolder={() => setNameDialog({ mode: 'create', parentId: f.id })}
          onRename={() => setNameDialog({ mode: 'rename', folder: f })}
          onDelete={() => void deleteFolder(f)}
        />
        {open && (
          <div>
            {childFolders(index, f.id).map((kid) => renderFolder(kid, depth + 1))}
            {casesIn(index, f.id).map((tc) => <CaseRow key={tc.id} {...caseRowProps(tc, depth + 1, false)} />)}
            {childFolders(index, f.id).length === 0 && casesIn(index, f.id).length === 0 && (
              <p className="text-[10px] text-muted-foreground italic py-1" style={{ paddingLeft: (depth + 1) * INDENT_PX + 28 }}>
                {t('folders.emptyHint', { defaultValue: 'Empty — drag test cases here or use “Move to…”.' })}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  const nothingAtAll = testCases.length === 0 && folders.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={t('caseList.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 text-xs pl-7"
          />
        </div>
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0 shrink-0"
                aria-label={t('folders.newFolder', { defaultValue: 'New folder' })}
                onClick={() => setNameDialog({ mode: 'create', parentId: null })}
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p className="text-xs">{t('folders.newFolder', { defaultValue: 'New folder' })}</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button size="sm" className="h-7 text-xs" onClick={() => newCaseIn(null)}>
          <Plus className="h-3 w-3 mr-1" />
          {t('caseList.new')}
        </Button>
      </div>

      {/* One DndContext for every mode: the rows' drag hooks always have a provider. */}
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragLabel(null)}
      >
        {isLoading && testCases.length === 0 ? (
          <div className="flex items-center justify-center py-6">
            <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : q ? (
          filteredCases.length === 0 ? (
            <EmptyState text={t('caseList.emptyMatching')} />
          ) : (
            <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
              {filteredCases.map((tc) => <CaseRow key={tc.id} {...caseRowProps(tc, 0, true)} />)}
            </div>
          )
        ) : nothingAtAll ? (
          <EmptyState text={t('caseList.empty')} />
        ) : (
          <div className="space-y-0.5 max-h-[60vh] overflow-y-auto pr-1">
            {dragLabel !== null && <RootDropStrip label={t('folders.dropToRoot', { defaultValue: 'Drop here to move to the root' })} />}
            {childFolders(index, null).map((f) => renderFolder(f, 0))}
            {casesIn(index, null).map((tc) => <CaseRow key={tc.id} {...caseRowProps(tc, 0, false)} />)}
          </div>
        )}
        <DragOverlay>
          {dragLabel ? <div className="px-2 py-1 rounded bg-popover border shadow text-xs truncate max-w-[240px]">{dragLabel}</div> : null}
        </DragOverlay>
      </DndContext>

      <TestCaseEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        testCase={editingCase}
        folderId={editingCase ? undefined : newCaseFolderId}
        onSaved={fetchAll}
      />

      <FolderNameDialog
        state={nameDialog}
        onCancel={() => setNameDialog(null)}
        onSubmit={submitName}
      />

      <RunFolderDialog
        folder={runFolder}
        index={index}
        open={!!runFolder}
        onOpenChange={(o) => { if (!o) setRunFolder(null); }}
        onResults={(byCase) => setResults((prev) => ({ ...prev, ...byCase }))}
      />
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
      <FlaskConical className="h-8 w-8 mb-2 opacity-30" />
      <p className="text-xs">{text}</p>
    </div>
  );
}

function RootDropStrip({ label }: { label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: ROOT_DROP });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'sticky top-0 z-10 flex items-center gap-1.5 rounded-md border border-dashed bg-background px-2 py-1.5 text-[10px] text-muted-foreground transition-colors',
        isOver ? 'border-primary bg-primary/10 text-primary' : 'border-border',
      )}
    >
      <CornerLeftUp className="h-3 w-3" />
      {label}
    </div>
  );
}

// ── Folder row ──

interface FolderRowProps {
  folder: TestCaseFolder;
  depth: number;
  open: boolean;
  caseCount: number;
  canRun: boolean;
  onToggle: () => void;
  onRunAll: () => void;
  onNewCase: () => void;
  onNewSubfolder: () => void;
  onRename: () => void;
  onDelete: () => void;
}

function FolderRow({ folder, depth, open, caseCount, canRun, onToggle, onRunAll, onNewCase, onNewSubfolder, onRename, onDelete }: FolderRowProps) {
  const { t } = useTranslation('qa');
  const { setNodeRef, isOver } = useDroppable({ id: FOLDER_PREFIX + folder.id });
  const runLabel = t('folders.runAll', { defaultValue: 'Run all' });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group flex items-center gap-1 rounded-md pr-1 transition-colors',
        isOver ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-accent/50',
      )}
      style={{ paddingLeft: depth * INDENT_PX }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex flex-1 min-w-0 items-center gap-1.5 py-1.5 pl-1 text-left cursor-pointer"
      >
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
        {open ? <FolderOpen className="h-3.5 w-3.5 text-amber-500 shrink-0" /> : <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
        <span className="text-xs font-medium truncate">{folder.name}</span>
        <span className="text-[10px] text-muted-foreground shrink-0">{caseCount}</span>
      </button>
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onRunAll}
              disabled={!canRun}
              aria-label={runLabel}
              className="p-1 rounded-md text-muted-foreground hover:text-green-500 hover:bg-green-500/10 opacity-60 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground cursor-pointer disabled:cursor-default shrink-0"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{canRun ? runLabel : t('folders.nothingToRun', { defaultValue: 'No executable test cases in this folder' })}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('folders.actions', { defaultValue: 'Folder actions' })}
            className="p-1 rounded-md text-muted-foreground hover:bg-accent opacity-60 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 cursor-pointer shrink-0"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem className="text-xs" disabled={!canRun} onSelect={onRunAll}>
            <Play className="h-3.5 w-3.5 mr-2" />{runLabel}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-xs" onSelect={onNewCase}>
            <Plus className="h-3.5 w-3.5 mr-2" />{t('folders.newCaseHere', { defaultValue: 'New test case here' })}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-xs" onSelect={onNewSubfolder}>
            <FolderPlus className="h-3.5 w-3.5 mr-2" />{t('folders.newSubfolder', { defaultValue: 'New subfolder' })}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-xs" onSelect={onRename}>
            <Pencil className="h-3.5 w-3.5 mr-2" />{t('folders.rename', { defaultValue: 'Rename' })}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-xs text-destructive focus:text-destructive" onSelect={onDelete}>
            <Trash2 className="h-3.5 w-3.5 mr-2" />{t('folders.delete', { defaultValue: 'Delete' })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ── Case row ──

interface CaseRowProps {
  tc: TestCase;
  depth: number;
  /** Folder path shown under the title (search results only). */
  path: string;
  result?: TestExecutionResult;
  isRunning: boolean;
  anyRunning: boolean;
  isExpanded: boolean;
  draggable: boolean;
  index: FolderIndex;
  onOpen: () => void;
  onRun: (e: React.MouseEvent) => void;
  onToggleResult: () => void;
  onMove: (folderId: string | null) => void;
}

function CaseRow({ tc, depth, path, result, isRunning, anyRunning, isExpanded, draggable, index, onOpen, onRun, onToggleResult, onMove }: CaseRowProps) {
  const { t } = useTranslation('qa');
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: CASE_PREFIX + tc.id, disabled: !draggable });
  const priority = priorityConfig[tc.priority] || priorityConfig.medium;
  const status = statusConfig[tc.status] || statusConfig.draft;
  const stepCount = Array.isArray(tc.steps) ? tc.steps.length : 0;
  const current = effectiveFolderId(index, tc);
  const targets = flattenFolders(index);

  return (
    <div
      ref={setNodeRef}
      className={cn('rounded-lg border border-transparent hover:border-border hover:bg-accent/50 transition-all group', isDragging && 'opacity-40')}
      style={{ marginLeft: depth * INDENT_PX }}
    >
      <div className="flex items-start gap-2 p-2.5">
        {draggable && (
          <button
            type="button"
            {...listeners}
            {...attributes}
            aria-label={t('folders.dragHandle', { defaultValue: 'Drag to a folder' })}
            className="-ml-1.5 mt-0.5 p-0.5 rounded text-muted-foreground/60 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 cursor-grab active:cursor-grabbing touch-none shrink-0"
          >
            <GripVertical className="h-3 w-3" />
          </button>
        )}
        {/* Priority + result indicator */}
        <div className="flex flex-col items-center gap-1 w-6 shrink-0 mt-0.5">
          <span className={`text-[10px] font-bold ${priority.color}`}>
            {t(priority.labelKey)}
          </span>
          {result && (
            result.status === 'passed' ? <CheckCircle2 className="h-3 w-3 text-green-500" />
              : result.status === 'failed' ? <XCircle className="h-3 w-3 text-red-500" />
                : <AlertTriangle className="h-3 w-3 text-orange-500" />
          )}
        </div>

        <button
          onClick={onOpen}
          className="flex-1 min-w-0 text-left cursor-pointer"
        >
          {/* Title row */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium truncate">
              {tc.title}
            </span>
            <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </div>
          {path && (
            <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground min-w-0">
              <Folder className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{path}</span>
            </div>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <Badge
              variant={status.variant as 'secondary' | 'success' | 'warning'}
              className="text-[10px] px-1.5 py-0"
            >
              {t(status.labelKey)}
            </Badge>
            {tc.type && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {t(`caseType.${tc.type}`, { defaultValue: tc.type })}
              </Badge>
            )}
            {stepCount > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {stepCount === 1
                  ? t('caseList.stepCountOne', { count: stepCount })
                  : t('caseList.stepCountOther', { count: stepCount })}
              </span>
            )}
            {result && (
              <span className={`text-[10px] ${
                result.status === 'passed' ? 'text-green-500' : result.status === 'failed' ? 'text-red-500' : 'text-orange-500'
              }`}>
                {result.summary.passed}/{result.summary.total}
                {result.duration > 0 && ` · ${result.duration}ms`}
              </span>
            )}
            {tc.tags.length > 0 && (
              <div className="flex items-center gap-1 ml-auto">
                {tc.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0 rounded">
                    {tag}
                  </span>
                ))}
                {tc.tags.length > 3 && (
                  <span className="text-[10px] text-muted-foreground">+{tc.tags.length - 3}</span>
                )}
              </div>
            )}
          </div>
        </button>

        {/* Result toggle + Run button + menu */}
        <div className="flex items-center gap-0.5 shrink-0">
          {result && (
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleResult(); }}
                    className="p-1.5 rounded-md hover:bg-accent text-muted-foreground transition-colors cursor-pointer"
                  >
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">{isExpanded ? t('caseList.hideResults') : t('caseList.showResults')}</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {stepCount > 0 && (
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onRun}
                    disabled={anyRunning}
                    className="p-1.5 rounded-md hover:bg-green-500/10 text-muted-foreground hover:text-green-500 transition-colors shrink-0 disabled:opacity-50 cursor-pointer"
                  >
                    {isRunning
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Play className="h-3.5 w-3.5" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">{t('caseList.runTest')}</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('folders.caseActions', { defaultValue: 'Test case actions' })}
                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground opacity-60 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 transition-opacity cursor-pointer"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="text-xs">
                  <FolderInput className="h-3.5 w-3.5 mr-2" />
                  {t('folders.moveTo', { defaultValue: 'Move to…' })}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-72 overflow-y-auto w-52">
                  <DropdownMenuItem className="text-xs" disabled={current === null} onSelect={() => onMove(null)}>
                    <CornerLeftUp className="h-3.5 w-3.5 mr-2" />
                    {t('folders.root', { defaultValue: 'Root' })}
                  </DropdownMenuItem>
                  {targets.length > 0 && <DropdownMenuSeparator />}
                  {targets.map(({ folder, depth: d }) => (
                    <DropdownMenuItem
                      key={folder.id}
                      className="text-xs"
                      disabled={current === folder.id}
                      onSelect={() => onMove(folder.id)}
                    >
                      <span style={{ paddingLeft: d * 10 }} className="flex items-center min-w-0">
                        <Folder className="h-3.5 w-3.5 mr-2 text-amber-500 shrink-0" />
                        <span className="truncate">{folder.name}</span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                  {targets.length === 0 && (
                    <p className="px-2 py-1.5 text-[10px] text-muted-foreground">
                      {t('folders.noFoldersYet', { defaultValue: 'No folders yet — create one with the folder button.' })}
                    </p>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Collapsible result panel */}
      {isExpanded && result && <CaseResultPanel result={result} />}
    </div>
  );
}

function CaseResultPanel({ result }: { result: TestExecutionResult }) {
  const { t } = useTranslation('qa');
  return (
    <div className="border-t border-border/50 mx-2.5 mb-2.5 pt-2 space-y-1.5">
      {/* Summary bar */}
      <div className="flex items-center gap-2 text-[10px]">
        <span className={`font-semibold ${
          result.status === 'passed' ? 'text-green-500' : result.status === 'failed' ? 'text-red-500' : 'text-orange-500'
        }`}>
          {t(`runStatus.${result.status}`, { defaultValue: result.status }).toUpperCase()}
        </span>
        <span className="text-muted-foreground">
          {t('caseList.passedCount', { count: result.summary.passed })} · {t('caseList.failedCount', { count: result.summary.failed })}
          {result.summary.skipped > 0 && ` · ${t('caseList.skippedCount', { count: result.summary.skipped })}`}
        </span>
        {result.duration > 0 && (
          <span className="text-muted-foreground ml-auto">{result.duration}ms</span>
        )}
      </div>

      {/* Per-step results */}
      {result.steps.map((step, i) => {
        const stepIcon = step.type === 'request' ? <Send className="h-2.5 w-2.5" />
          : step.type === 'assertion' ? <ShieldCheck className="h-2.5 w-2.5" />
          : step.type === 'extract' ? <Variable className="h-2.5 w-2.5" />
          : <Clock className="h-2.5 w-2.5" />;
        const stepColor = step.status === 'passed' ? 'text-green-500'
          : step.status === 'failed' ? 'text-red-500'
          : step.status === 'error' ? 'text-orange-500'
          : 'text-muted-foreground';

        return (
          <div key={i} className="rounded border border-border/40 bg-muted/30 p-1.5">
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className={stepColor}>{stepIcon}</span>
              <span className="font-medium text-[10px]">{t('caseList.step', { n: step.stepNo })}</span>
              <span className="text-muted-foreground">{t(`stepType.${step.type}`, { defaultValue: step.type })}</span>
              {step.status === 'passed' ? (
                <CheckCircle2 className="h-2.5 w-2.5 text-green-500 ml-auto" />
              ) : step.status === 'failed' ? (
                <XCircle className="h-2.5 w-2.5 text-red-500 ml-auto" />
              ) : step.status === 'error' ? (
                <AlertTriangle className="h-2.5 w-2.5 text-orange-500 ml-auto" />
              ) : (
                <span className="text-muted-foreground ml-auto text-[10px]">{t('caseList.skippedInline')}</span>
              )}
              {step.duration > 0 && (
                <span className="text-[10px] text-muted-foreground">{step.duration}ms</span>
              )}
            </div>

            {/* Request info */}
            {step.request && (
              <div className="mt-1 text-[10px] text-muted-foreground truncate">
                {step.request.method} {step.request.url}
                {step.response && (
                  <span className={`ml-1 ${step.response.statusCode < 400 ? 'text-green-500' : 'text-red-500'}`}>
                    → {step.response.statusCode}
                  </span>
                )}
              </div>
            )}

            {/* Assertion results */}
            {step.assertions && step.assertions.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {step.assertions.map((a, j) => (
                  <div key={j} className={`text-[10px] flex items-start gap-1 ${a.passed ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    <span>{a.passed ? '✓' : '✗'}</span>
                    <span className="break-all">
                      {a.passed
                        ? t('caseList.assertExpected', { type: a.type, expected: a.expected })
                        : t('caseList.assertExpectedGot', { type: a.type, expected: a.expected, actual: a.actual })}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Extraction results */}
            {step.extractions && step.extractions.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {step.extractions.map((ext, j) => (
                  <div key={j} className="text-[10px] text-muted-foreground">
                    <span className="font-mono">{`{{${ext.variable}}}`}</span> = <span className="text-foreground">{ext.value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Error */}
            {step.error && (
              <div className="mt-1 text-[10px] text-red-500 break-all">{step.error}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Create / rename folder ──

function FolderNameDialog({
  state,
  onCancel,
  onSubmit,
}: {
  state: NameDialogState | null;
  onCancel: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const { t } = useTranslation('qa');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (state) setName(state.mode === 'rename' ? state.folder.name : '');
  }, [state]);

  const submit = async () => {
    const v = name.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      await onSubmit(v);
    } finally {
      setBusy(false);
    }
  };

  const title = state?.mode === 'rename'
    ? t('folders.renameTitle', { defaultValue: 'Rename folder' })
    : state?.parentId
      ? t('folders.newSubfolder', { defaultValue: 'New subfolder' })
      : t('folders.newFolder', { defaultValue: 'New folder' });

  return (
    <Dialog open={!!state} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          maxLength={255}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
          placeholder={t('folders.namePlaceholder', { defaultValue: 'Folder name' })}
          className="h-8 text-sm"
        />
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={onCancel}>
            {t('folders.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button size="sm" className="h-8" disabled={!name.trim() || busy} onClick={() => void submit()}>
            {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            {state?.mode === 'rename'
              ? t('folders.save', { defaultValue: 'Save' })
              : t('folders.create', { defaultValue: 'Create' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
