import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ArrowDown, ArrowUp, Copy, Download, Filter, PinIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import type { DBKind, DBQueryResult, DBSchemaColumn } from '@/types';
import { CellRenderer } from './CellRenderer';
import { DBColumnStats } from './DBColumnStats';
import { stringifyValue, shortColumnType } from './formatters';
import {
  cellText,
  downloadRows,
  formatRows,
  guessSourceTable,
  inList,
  whereCondition,
  type CopyFormat,
  type DownloadFormat,
  type RowObj,
} from './resultFormats';
import { DBJsonModal, canShowAsJson } from './DBJsonModal';
import {
  columnFingerprint,
  useDBColumnPrefsStore,
} from '@/stores/dbColumnPrefsStore';

const EMPTY_PREFS = { hidden: [], order: [], pinned: [], widths: {} } as const;
const ROW_ESTIMATE = 33; // px — starting guess; measured per row at runtime
const GUTTER = 44; // px — row-number / row-selection column

const COPY_FORMATS: CopyFormat[] = ['tsv', 'csv', 'json', 'markdown', 'insert'];
const DOWNLOAD_FORMATS: DownloadFormat[] = ['csv', 'json', 'xlsx'];

// execCommand fallback for webviews that refuse navigator.clipboard
// (no permission / not a secure context). Focus goes back where it was so
// the next ⌘C still reaches the table.
function legacyCopy(text: string): boolean {
  const prev = document.activeElement as HTMLElement | null;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  document.body.removeChild(ta);
  prev?.focus({ preventScroll: true });
  return ok;
}

function copyText(text: string, message: string) {
  const done = () => toast({ title: message, duration: 1500 });
  const fallback = () => { if (legacyCopy(text)) done(); };
  if (!navigator.clipboard?.writeText) { fallback(); return; }
  navigator.clipboard.writeText(text).then(done, fallback);
}

interface DBResultTableProps {
  result: DBQueryResult;
  onAddFilter?: (col: string, op: '=' | '!=' | 'LIKE' | 'IS NULL' | 'IS NOT NULL', value: unknown) => void;
  onPickCell?: (rowIndex: number, colName: string, value: unknown) => void;
  onPickRow?: (rowIndex: number) => void;
  onOpenFK?: (col: string, value: unknown) => void;
  /** Connection kind — picks identifier quoting for SQL copy formats. */
  dbKind?: DBKind;
}

// DBResultTable is the table view. It composes:
//   - Tanstack Table for sort + filter + resize
//   - Tanstack Virtual for row virtualization (only visible rows hit the DOM)
//   - dbColumnPrefsStore for hide/order/pin persistence
//   - a SINGLE delegated Radix context menu for per-cell actions
//   - DBColumnStats popover for per-column histograms
// View-level concerns (chart, explain, summary, inspectors) live in
// DBResultPanel which composes this component.
export function DBResultTable({
  result, onAddFilter, onPickCell, onPickRow, onOpenFK, dbKind,
}: DBResultTableProps) {
  const { t } = useTranslation('dbquery');
  // Defensive — BE returns null columns when a cursor materialized
  // zero rows on Mongo (cols are inferred from the first doc).
  const resultColumns = result.columns ?? [];
  const resultRows = result.rows ?? [];
  const allColNames = resultColumns.map((c) => c.name);
  const fp = useMemo(() => columnFingerprint(allColNames), [allColNames.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  // Same trick as DBColumnControl — selector stays pure, fallback is a
  // stable module-level constant so zustand doesn't see a "new" prefs
  // object on every render.
  const stored = useDBColumnPrefsStore((s) => s.prefs[fp]);
  const prefs = stored ?? EMPTY_PREFS;
  const setWidth = useDBColumnPrefsStore((s) => s.setWidth);
  const togglePinned = useDBColumnPrefsStore((s) => s.togglePinned);
  const setHidden = useDBColumnPrefsStore((s) => s.setHidden);
  const sourceTable = useMemo(() => guessSourceTable(result.statementText), [result.statementText]);

  // Effective column order: persisted order first (where columns still
  // exist), then any new columns at the end. Pinned columns float to
  // the left to provide a sticky leftmost stack.
  const effectiveOrder = useMemo(() => {
    const known = new Set(allColNames);
    const fromPref = prefs.order.filter((c) => known.has(c));
    const missing = allColNames.filter((c) => !fromPref.includes(c));
    const ordered = [...fromPref, ...missing];
    const pinned = ordered.filter((c) => prefs.pinned.includes(c));
    const rest = ordered.filter((c) => !prefs.pinned.includes(c));
    return [...pinned, ...rest];
  }, [prefs.order, prefs.pinned, allColNames]);

  const colByName = useMemo(() => {
    const map = new Map<string, DBSchemaColumn>();
    resultColumns.forEach((c) => map.set(c.name, c));
    return map;
  }, [resultColumns]);

  const data = useMemo(
    () => resultRows.map(rowToObject(allColNames)),
    [resultRows, allColNames.join('|')], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Latest data via a ref so the column defs (and their header closures)
  // do NOT depend on `data` — rebuilding every ColumnDef whenever a row set
  // changes defeated react-table's memoization. Column stats read this
  // lazily, only when a stats popover opens.
  const dataRef = useRef(data);
  dataRef.current = data;

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  // Single, delegated context-menu target + the "show as JSON" modal.
  const [menuCell, setMenuCell] = useState<{ rowIndex: number; colName: string } | null>(null);
  const [menuHeader, setMenuHeader] = useState<string | null>(null);
  // Row selection (data indexes) + the anchor for shift-click ranges
  // (a display position, so ranges follow the current sort/filter).
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [focusCell, setFocusCell] = useState<{ row: number; col: string } | null>(null);
  useEffect(() => {
    setSelected(new Set());
    setAnchor(null);
    setFocusCell(null);
  }, [result.queryId, result.offset]);
  const [jsonModal, setJsonModal] = useState<{ value: unknown; colName: string } | null>(null);

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    return effectiveOrder.map((name) => {
      const meta = colByName.get(name);
      const persistedWidth = prefs.widths[name];
      return {
        id: name,
        accessorKey: name,
        size: persistedWidth ?? 200,
        minSize: 60,
        maxSize: 1600,
        enableSorting: true,
        header: ({ column }) => {
          const isSorted = column.getIsSorted();
          const isPinned = prefs.pinned.includes(name);
          return (
            <div className="flex items-center gap-1 w-full min-w-0">
              <button
                type="button"
                onClick={(e) => column.toggleSorting(undefined, e.shiftKey)}
                className="flex items-center gap-1 flex-1 min-w-0 text-left text-xs font-semibold text-muted-foreground hover:text-foreground"
                title={t('table.sortTitle')}
              >
                <span className="truncate">{name}</span>
                {meta?.type && (
                  <span className="text-[9px] opacity-60 shrink-0">({shortColumnType(meta.type)})</span>
                )}
                {isSorted === 'asc' && <ArrowUp className="h-3 w-3 shrink-0 text-primary" />}
                {isSorted === 'desc' && <ArrowDown className="h-3 w-3 shrink-0 text-primary" />}
              </button>
              {isPinned && (
                <PinIcon className="h-2.5 w-2.5 text-amber-500 fill-current shrink-0" />
              )}
              <DBColumnStats colName={name} getValues={() => dataRef.current.map((r) => r[name])} />
            </div>
          );
        },
        cell: ({ getValue }) => (
          <CellRenderer
            value={getValue()}
            colName={name}
            colType={meta?.type}
          />
        ),
        filterFn: (row, columnId, filterValue) => {
          const v = row.getValue(columnId);
          if (filterValue == null || filterValue === '') return true;
          return stringifyValue(v).toLowerCase().includes(String(filterValue).toLowerCase());
        },
      };
    });
    // NOTE: intentionally NOT depending on `data` — see dataRef above.
    // `t` is intentionally omitted too: rebuilding every ColumnDef on a
    // language switch would defeat react-table's memoization; the sort
    // tooltip renders the current language on the next column rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveOrder, colByName, prefs.widths, prefs.pinned]);

  const columnVisibility = useMemo(() => {
    const hidden = new Set(prefs.hidden);
    const map: Record<string, boolean> = {};
    for (const c of allColNames) map[c] = !hidden.has(c);
    return map;
  }, [prefs.hidden, allColNames.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnVisibility },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    // 'onEnd' commits the new width once on mouse-up instead of firing a
    // full re-render on every mousemove during a drag.
    columnResizeMode: 'onEnd',
    enableColumnResizing: true,
    enableMultiSort: true,
    maxMultiSortColCount: 4,
  });

  // Persist column widths on resize commit (mouseup). We do it via an
  // effect that observes column sizing changes after the user releases.
  const sizing = table.getState().columnSizing;
  const isResizing = !!table.getState().columnSizingInfo?.isResizingColumn;
  useEffect(() => {
    if (isResizing) return;
    Object.entries(sizing).forEach(([k, v]) => {
      if (prefs.widths[k] !== v) setWidth(fp, k, v as number);
    });
  }, [sizing, isResizing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sticky-left offsets for pinned columns.
  const stickyLeftMap = useMemo(() => {
    const map: Record<string, number> = {};
    let acc = GUTTER;
    for (const c of effectiveOrder) {
      if (!prefs.pinned.includes(c)) break;
      if (prefs.hidden.includes(c)) continue;
      map[c] = acc;
      acc += prefs.widths[c] ?? 200;
    }
    return map;
  }, [effectiveOrder, prefs.pinned, prefs.hidden, prefs.widths]);

  const visibleLeafCols = table.getVisibleLeafColumns();
  const rows = table.getRowModel().rows;

  // ── Row virtualization ──────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 12,
    // Measure real row heights so wrapped/multi-line cells stay aligned.
    measureElement:
      typeof window !== 'undefined' && navigator.userAgent.indexOf('Firefox') === -1
        ? (el) => el?.getBoundingClientRect().height
        : undefined,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualRows.length ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length
    ? totalSize - virtualRows[virtualRows.length - 1].end
    : 0;

  // Rows in display order (sort + filter applied) that are selected.
  const visibleColIds = visibleLeafCols.map((c) => c.id);
  const selectedRows = (): RowObj[] => rows.filter((r) => selected.has(r.index)).map((r) => r.original);

  const selectRow = useCallback((displayPos: number, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    const target = rows[displayPos];
    if (!target) return;
    const additive = e.metaKey || e.ctrlKey;
    setSelected((prev) => {
      if (e.shiftKey && anchor != null) {
        const next = additive ? new Set(prev) : new Set<number>();
        const [a, b] = anchor < displayPos ? [anchor, displayPos] : [displayPos, anchor];
        for (let i = a; i <= b; i++) if (rows[i]) next.add(rows[i].index);
        return next;
      }
      if (additive) {
        const next = new Set(prev);
        if (next.has(target.index)) next.delete(target.index); else next.add(target.index);
        return next;
      }
      if (prev.size === 1 && prev.has(target.index)) return new Set();
      return new Set([target.index]);
    });
    if (!e.shiftKey) setAnchor(displayPos);
  }, [rows, anchor]);

  const selectAll = useCallback(() => {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.index))));
  }, [rows]);

  const copyRows = useCallback((fmt: CopyFormat, list: RowObj[]) => {
    if (list.length === 0) return;
    copyText(
      formatRows(fmt, visibleColIds, list, { kind: dbKind, table: sourceTable }),
      t('table.copiedRows', { count: list.length, format: t(`table.fmt.${fmt}`) }),
    );
  }, [visibleColIds, dbKind, sourceTable, t]);

  // Cmd/Ctrl+C copies the selected rows (TSV with header — pastes cleanly
  // into a spreadsheet) or the focused cell; Cmd/Ctrl+A selects every row.
  // Inputs and a real text selection keep the browser's own behaviour.
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea, [contenteditable="true"]')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape' && selected.size > 0) {
      setSelected(new Set());
      return;
    }
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === 'a') {
      e.preventDefault();
      setSelected(new Set(rows.map((r) => r.index)));
      return;
    }
    if (key === 'c') {
      if ((window.getSelection()?.toString() ?? '') !== '') return;
      if (selected.size > 0) {
        e.preventDefault();
        copyRows('tsv', selectedRows());
      } else if (focusCell) {
        e.preventDefault();
        copyText(cellText(data[focusCell.row]?.[focusCell.col]), t('table.copiedValue'));
      }
    }
  }, [selected, rows, focusCell, data, copyRows, t]); // eslint-disable-line react-hooks/exhaustive-deps

  // Delegated right-click: figure out which cell or header was targeted
  // (via data-* attributes) and stash it so the single ContextMenuContent
  // below can render the right actions. Runs in the capture phase so the
  // target is set before Radix opens the menu in the bubble phase.
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    // Right-click selects nothing and shows no browser menu text-selection.
    window.getSelection()?.removeAllRanges();
    const th = el.closest('th[data-colhead]') as HTMLElement | null;
    if (th) {
      setMenuCell(null);
      setMenuHeader(th.dataset.colhead ?? null);
      return;
    }
    setMenuHeader(null);
    const td = el.closest('td[data-col]') as HTMLElement | null;
    if (!td) { setMenuCell(null); return; }
    const rowIndex = Number(td.dataset.row);
    const colName = td.dataset.col ?? '';
    if (Number.isNaN(rowIndex) || !colName) { setMenuCell(null); return; }
    setMenuCell({ rowIndex, colName });
    setFocusCell({ row: rowIndex, col: colName });
  }, []);

  const menuValue = menuCell ? data[menuCell.rowIndex]?.[menuCell.colName] : undefined;
  const menuRowObj = menuCell ? data[menuCell.rowIndex] : undefined;
  // Row actions on a right-clicked row act on the whole selection when
  // that row is part of it, otherwise on the row alone.
  const menuRows: RowObj[] = menuCell
    ? (selected.has(menuCell.rowIndex) ? selectedRows() : (menuRowObj ? [menuRowObj] : []))
    : [];

  // Edge case: server returned a result with zero columns + zero rows
  // (e.g. a Mongo query that hit a non-existent collection). Render a
  // clear empty state instead of an awkward 0-column <table> whose
  // colSpan={0} text wraps a letter at a time.
  if (resultColumns.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-xs text-muted-foreground p-6 text-center">
        <p className="font-medium text-foreground mb-1">{t('table.noRowsTitle')}</p>
        <p>{t('table.noRowsBody')}</p>
        <p className="mt-2 text-[11px]">
          {t('table.noRowsCauses')}
        </p>
      </div>
    );
  }

  const colCount = (visibleLeafCols.length || 1) + 1;
  const allSelected = rows.length > 0 && selected.size === rows.length;

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {selected.size > 0 && (
        <SelectionBar
          count={selected.size}
          onCopy={(fmt) => copyRows(fmt, selectedRows())}
          onDownload={(fmt) => downloadRows(fmt, visibleColIds, selectedRows(), 'selection')}
          onClear={() => setSelected(new Set())}
        />
      )}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={scrollRef}
            tabIndex={0}
            className="flex-1 overflow-auto relative outline-none"
            onContextMenuCapture={handleContextMenu}
            onKeyDown={onKeyDown}
          >
            <table
              className="border-collapse text-xs"
              style={{ width: table.getTotalSize() + GUTTER, tableLayout: 'fixed' }}
            >
              <colgroup>
                <col style={{ width: GUTTER }} />
                {visibleLeafCols.map((col) => (
                  <col key={col.id} style={{ width: col.getSize() }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 bg-background z-20">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    <th
                      rowSpan={2}
                      style={{ width: GUTTER, position: 'sticky', left: 0, zIndex: 26 }}
                      className="border-b border-r bg-background p-0 align-middle"
                    >
                      <button
                        type="button"
                        onClick={selectAll}
                        title={t('table.selectAllRows')}
                        aria-label={t('table.selectAllRows')}
                        className={cn(
                          'w-full h-full min-h-[48px] flex items-center justify-center text-[10px] text-muted-foreground hover:bg-accent/50',
                          allSelected && 'text-primary',
                        )}
                      >
                        <span className={cn(
                          'h-3 w-3 rounded-[3px] border',
                          allSelected ? 'bg-primary border-primary' : selected.size > 0 ? 'bg-primary/40 border-primary' : 'border-muted-foreground/50',
                        )} />
                      </button>
                    </th>
                    {hg.headers.map((header) => {
                      const id = header.column.id;
                      const isPinned = prefs.pinned.includes(id);
                      return (
                        <th
                          key={header.id}
                          data-colhead={id}
                          style={{
                            width: header.getSize(),
                            ...(isPinned ? {
                              position: 'sticky',
                              left: stickyLeftMap[id],
                              zIndex: 25,
                            } : {}),
                          }}
                          className={cn(
                            'relative border-b border-r px-2 py-1.5 text-left align-top overflow-hidden bg-background select-none',
                            isPinned && 'shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]',
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getCanResize() && (
                            <div
                              onMouseDown={header.getResizeHandler()}
                              onTouchStart={header.getResizeHandler()}
                              onDoubleClick={() => header.column.resetSize()}
                              className={cn(
                                'absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none touch-none',
                                'hover:bg-primary/40 active:bg-primary/60',
                                header.column.getIsResizing() && 'bg-primary/70',
                              )}
                              title={t('table.resizeTitle')}
                            />
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
                {/* Filter row */}
                <tr className="bg-muted/30">
                  {table.getHeaderGroups()[0]?.headers.map((header) => {
                    const id = header.column.id;
                    const isPinned = prefs.pinned.includes(id);
                    const meta = colByName.get(id);
                    return (
                      <th
                        key={header.id + '-filter'}
                        style={{
                          width: header.getSize(),
                          ...(isPinned ? {
                            position: 'sticky',
                            left: stickyLeftMap[id],
                            zIndex: 24,
                          } : {}),
                        }}
                        className={cn(
                          'border-b border-r px-1 py-0.5 overflow-hidden bg-muted/30',
                        )}
                      >
                        <div className="flex items-center gap-0.5">
                          <Input
                            placeholder={t('table.filterPlaceholder')}
                            value={(header.column.getFilterValue() as string) ?? ''}
                            onChange={(e) => header.column.setFilterValue(e.target.value)}
                            className="h-6 text-[11px] font-mono px-1.5 py-0.5 flex-1 min-w-0"
                          />
                          {onAddFilter && (
                            <button
                              type="button"
                              onClick={() => {
                                const v = header.column.getFilterValue() as string | undefined;
                                if (!v) return;
                                onAddFilter(id, 'LIKE', `%${v}%`);
                              }}
                              className="shrink-0 text-muted-foreground hover:text-foreground p-0.5"
                              title={t('table.pushWhereLike')}
                            >
                              <Filter className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                        {meta?.type && (
                          <div className="text-[9px] text-muted-foreground/60 truncate">
                            {shortColumnType(meta.type)}
                          </div>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={colCount}
                      className="text-center py-6 text-muted-foreground text-xs italic"
                    >
                      {t('table.noMatch')}
                    </td>
                  </tr>
                ) : (
                  <>
                    {paddingTop > 0 && (
                      <tr aria-hidden>
                        <td colSpan={colCount} style={{ height: paddingTop, padding: 0, border: 0 }} />
                      </tr>
                    )}
                    {virtualRows.map((vr) => {
                      const row = rows[vr.index];
                      const isSel = selected.has(row.index);
                      return (
                        <tr
                          key={row.id}
                          data-index={vr.index}
                          ref={rowVirtualizer.measureElement}
                          className={cn('group', isSel ? 'bg-primary/10' : 'hover:bg-accent/30')}
                          onDoubleClick={() => onPickRow?.(row.index)}
                        >
                          <td
                            style={{ width: GUTTER, position: 'sticky', left: 0, zIndex: 6 }}
                            className={cn(
                              'border-b border-r px-1 py-1 text-right align-top font-mono text-[10px] tabular-nums cursor-pointer select-none',
                              isSel ? 'bg-primary/20 text-primary' : 'bg-muted/40 text-muted-foreground group-hover:text-foreground',
                            )}
                            title={t('table.rowSelectHint')}
                            onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
                            onClick={(e) => selectRow(vr.index, e)}
                          >
                            {(result.offset ?? 0) + row.index + 1}
                          </td>
                          {row.getVisibleCells().map((cell) => {
                            const id = cell.column.id;
                            const isPinned = prefs.pinned.includes(id);
                            const v = cell.getValue();
                            const isFocus = focusCell?.row === row.index && focusCell.col === id;
                            return (
                              <td
                                key={cell.id}
                                data-row={row.index}
                                data-col={id}
                                style={{
                                  width: cell.column.getSize(),
                                  ...(isPinned ? {
                                    position: 'sticky',
                                    left: stickyLeftMap[id],
                                    zIndex: 5,
                                  } : {}),
                                }}
                                className={cn(
                                  'group/cell relative border-b border-r px-2 py-1 align-top whitespace-pre-wrap break-words overflow-hidden cursor-pointer',
                                  isPinned && (isSel ? 'bg-accent' : 'bg-background group-hover:bg-accent/30'),
                                  isFocus && 'outline outline-1 -outline-offset-1 outline-primary',
                                )}
                                onMouseDown={(e) => { if (e.shiftKey || e.metaKey || e.ctrlKey) e.preventDefault(); }}
                                onClick={(e) => {
                                  if (e.shiftKey || e.metaKey || e.ctrlKey) { selectRow(vr.index, e); return; }
                                  setFocusCell({ row: row.index, col: id });
                                  setAnchor(vr.index);
                                  onPickCell?.(row.index, id, v);
                                }}
                              >
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                <button
                                  type="button"
                                  tabIndex={-1}
                                  title={t('table.copyValue')}
                                  aria-label={t('table.copyValue')}
                                  className="absolute top-0.5 right-0.5 hidden group-hover/cell:flex items-center justify-center h-5 w-5 rounded border bg-background/95 text-muted-foreground hover:text-foreground shadow-sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyText(cellText(v), t('table.copiedValue'));
                                  }}
                                >
                                  <Copy className="h-3 w-3" />
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    {paddingBottom > 0 && (
                      <tr aria-hidden>
                        <td colSpan={colCount} style={{ height: paddingBottom, padding: 0, border: 0 }} />
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-60">
          {menuHeader ? (
            <HeaderMenu
              colName={menuHeader}
              visibleCols={visibleColIds}
              values={rows.map((r) => r.original[menuHeader])}
              dbKind={dbKind}
              isPinned={prefs.pinned.includes(menuHeader)}
              onSort={(desc) => table.getColumn(menuHeader)?.toggleSorting(desc, false)}
              onTogglePinned={() => togglePinned(fp, menuHeader)}
              onHide={() => setHidden(fp, [...prefs.hidden, menuHeader])}
            />
          ) : menuCell ? (
            <CellMenu
              colName={menuCell.colName}
              value={menuValue}
              rows={menuRows}
              dbKind={dbKind}
              isPinned={prefs.pinned.includes(menuCell.colName)}
              isRowSelected={selected.has(menuCell.rowIndex)}
              onCopyRows={(fmt) => copyRows(fmt, menuRows)}
              onDownloadRows={(fmt) => downloadRows(fmt, visibleColIds, menuRows, menuRows.length > 1 ? 'selection' : 'row')}
              onToggleRow={() => setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(menuCell.rowIndex)) next.delete(menuCell.rowIndex); else next.add(menuCell.rowIndex);
                return next;
              })}
              onAddFilter={onAddFilter}
              onOpenFK={onOpenFK}
              onTogglePinned={() => togglePinned(fp, menuCell.colName)}
              onShowJson={() => setJsonModal({ value: menuValue, colName: menuCell.colName })}
            />
          ) : (
            <ContextMenuItem disabled>{t('table.rightClickCell')}</ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>

      <DBJsonModal
        open={!!jsonModal}
        onClose={() => setJsonModal(null)}
        value={jsonModal?.value}
        colName={jsonModal?.colName}
      />
    </div>
  );
}

function SelectionBar({
  count, onCopy, onDownload, onClear,
}: {
  count: number;
  onCopy: (fmt: CopyFormat) => void;
  onDownload: (fmt: DownloadFormat) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation('dbquery');
  return (
    // Floats over the grid instead of pushing it down: a bar that shifts the
    // rows would move the next shift-click onto a different row.
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 px-2 py-1 rounded-md border bg-popover shadow-lg text-xs whitespace-nowrap">
      <span className="font-medium">{t('table.rowsSelected', { count })}</span>
      <button
        type="button"
        onClick={() => onCopy('tsv')}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent"
        title={t('table.copyShortcut')}
      >
        <Copy className="h-3 w-3" /> {t('table.copy')}
        <span className="text-[10px] text-muted-foreground">⌘C</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent">
            {t('table.copyAs')}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {COPY_FORMATS.map((f) => (
            <DropdownMenuItem key={f} onClick={() => onCopy(f)}>{t(`table.fmt.${f}`)}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent">
            <Download className="h-3 w-3" /> {t('table.download')}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel className="text-[11px]">{t('table.downloadSelected', { count })}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {DOWNLOAD_FORMATS.map((f) => (
            <DropdownMenuItem key={f} onClick={() => onDownload(f)}>{t(`table.dl.${f}`)}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground hover:bg-accent"
        title="Esc"
      >
        <X className="h-3 w-3" /> {t('table.clearSelection')}
      </button>
    </div>
  );
}

function HeaderMenu({
  colName, visibleCols, values, dbKind, isPinned, onSort, onTogglePinned, onHide,
}: {
  colName: string;
  visibleCols: string[];
  values: unknown[];
  dbKind?: DBKind;
  isPinned: boolean;
  onSort: (desc: boolean) => void;
  onTogglePinned: () => void;
  onHide: () => void;
}) {
  const { t } = useTranslation('dbquery');
  return (
    <>
      <ContextMenuItem onClick={() => copyText(colName, t('table.copiedName'))}>{t('table.copyColumnName')}</ContextMenuItem>
      <ContextMenuItem onClick={() => copyText(visibleCols.join(', '), t('table.copiedName'))}>{t('table.copyAllColumnNames')}</ContextMenuItem>
      <ContextMenuItem onClick={() => copyText(values.map(cellText).join('\n'), t('table.copiedValues', { count: values.length }))}>
        {t('table.copyColumnValues')}
      </ContextMenuItem>
      {dbKind !== 'mongo' && (
        <ContextMenuItem onClick={() => copyText(`${colName} IN ${inList(values, dbKind)}`, t('table.copiedValues', { count: values.length }))}>
          {t('table.copyColumnIn')}
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => onSort(false)}>{t('table.sortAsc')}</ContextMenuItem>
      <ContextMenuItem onClick={() => onSort(true)}>{t('table.sortDesc')}</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onTogglePinned}>
        {isPinned ? t('table.unfreezeColumn') : t('table.freezeColumn')}
      </ContextMenuItem>
      <ContextMenuItem onClick={onHide}>{t('table.hideColumn')}</ContextMenuItem>
    </>
  );
}

function CellMenu({
  colName, value, rows, dbKind, isPinned, isRowSelected,
  onCopyRows, onDownloadRows, onToggleRow, onAddFilter, onTogglePinned, onOpenFK, onShowJson,
}: {
  colName: string;
  value: unknown;
  rows: RowObj[];
  dbKind?: DBKind;
  isPinned: boolean;
  isRowSelected: boolean;
  onCopyRows: (fmt: CopyFormat) => void;
  onDownloadRows: (fmt: DownloadFormat) => void;
  onToggleRow: () => void;
  onAddFilter?: (col: string, op: '=' | '!=' | 'LIKE' | 'IS NULL' | 'IS NOT NULL', value: unknown) => void;
  onTogglePinned: () => void;
  onOpenFK?: (col: string, value: unknown) => void;
  onShowJson: () => void;
}) {
  const { t } = useTranslation('dbquery');
  const n = rows.length;
  return (
    <>
      <ContextMenuItem onClick={() => copyText(cellText(value), t('table.copiedValue'))}>
        {t('table.copyValue')}
        <span className="ml-auto text-[10px] text-muted-foreground">⌘C</span>
      </ContextMenuItem>
      <ContextMenuItem onClick={() => copyText(colName, t('table.copiedName'))}>{t('table.copyColumnName')}</ContextMenuItem>
      {dbKind !== 'mongo' && (
        <ContextMenuItem onClick={() => copyText(whereCondition(colName, value, dbKind), t('table.copiedValue'))}>
          {t('table.copyWhere')}
        </ContextMenuItem>
      )}
      {canShowAsJson(value) && (
        <ContextMenuItem onClick={onShowJson}>{t('table.showAsJson')}</ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>{n > 1 ? t('table.copyRowsAs', { count: n }) : t('table.copyRowAs')}</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {COPY_FORMATS.filter((f) => f !== 'insert' || dbKind !== 'mongo').map((f) => (
            <ContextMenuItem key={f} onClick={() => onCopyRows(f)}>{t(`table.fmt.${f}`)}</ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger>{n > 1 ? t('table.downloadRows', { count: n }) : t('table.downloadRow')}</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {DOWNLOAD_FORMATS.map((f) => (
            <ContextMenuItem key={f} onClick={() => onDownloadRows(f)}>{t(`table.dl.${f}`)}</ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem onClick={onToggleRow}>
        {isRowSelected ? t('table.deselectRow') : t('table.selectRow')}
      </ContextMenuItem>
      {onAddFilter && value != null && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onAddFilter(colName, '=', value)}>
            {t('table.filterByValue')}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onAddFilter(colName, '!=', value)}>
            {t('table.excludeValue')}
          </ContextMenuItem>
        </>
      )}
      {onAddFilter && value == null && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onAddFilter(colName, 'IS NULL', null)}>
            {t('table.filterNull')}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onAddFilter(colName, 'IS NOT NULL', null)}>
            {t('table.filterNotNull')}
          </ContextMenuItem>
        </>
      )}
      {onOpenFK && value != null && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onOpenFK(colName, value)}>
            {t('table.openReferenced')}
          </ContextMenuItem>
        </>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onTogglePinned}>
        {isPinned ? t('table.unfreezeColumn') : t('table.freezeColumn')}
      </ContextMenuItem>
    </>
  );
}

function rowToObject(cols: string[]) {
  return (row: unknown[]): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    cols.forEach((c, i) => { out[c] = row[i]; });
    return out;
  };
}
