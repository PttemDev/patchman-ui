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
import { Input } from '@/components/ui/input';
import { ArrowDown, ArrowUp, Filter, PinIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DBQueryResult, DBSchemaColumn } from '@/types';
import { CellRenderer } from './CellRenderer';
import { DBColumnStats } from './DBColumnStats';
import { stringifyValue, shortColumnType } from './formatters';
import { DBJsonModal, canShowAsJson } from './DBJsonModal';
import {
  columnFingerprint,
  useDBColumnPrefsStore,
} from '@/stores/dbColumnPrefsStore';

const EMPTY_PREFS = { hidden: [], order: [], pinned: [], widths: {} } as const;
const ROW_ESTIMATE = 33; // px — starting guess; measured per row at runtime

interface DBResultTableProps {
  result: DBQueryResult;
  onAddFilter?: (col: string, op: '=' | '!=' | 'LIKE' | 'IS NULL' | 'IS NOT NULL', value: unknown) => void;
  onPickCell?: (rowIndex: number, colName: string, value: unknown) => void;
  onPickRow?: (rowIndex: number) => void;
  onOpenFK?: (col: string, value: unknown) => void;
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
  result, onAddFilter, onPickCell, onPickRow, onOpenFK,
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
                className="flex items-center gap-1 flex-1 min-w-0 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground"
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
    let acc = 0;
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

  // Delegated right-click: figure out which cell was targeted (via data-*
  // attributes) and stash it so the single ContextMenuContent below can
  // render the right actions. Runs in the capture phase so the target is
  // set before Radix opens the menu in the bubble phase.
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const td = (e.target as HTMLElement).closest('td[data-col]') as HTMLElement | null;
    if (!td) { setMenuCell(null); return; }
    const rowIndex = Number(td.dataset.row);
    const colName = td.dataset.col ?? '';
    if (Number.isNaN(rowIndex) || !colName) { setMenuCell(null); return; }
    setMenuCell({ rowIndex, colName });
  }, []);

  const menuValue = menuCell ? data[menuCell.rowIndex]?.[menuCell.colName] : undefined;
  const menuRowObj = menuCell ? data[menuCell.rowIndex] : undefined;

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

  const colCount = visibleLeafCols.length || 1;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={scrollRef}
            className="flex-1 overflow-auto relative"
            onContextMenuCapture={handleContextMenu}
          >
            <table
              className="border-collapse text-xs"
              style={{ width: table.getTotalSize(), tableLayout: 'fixed' }}
            >
              <colgroup>
                {visibleLeafCols.map((col) => (
                  <col key={col.id} style={{ width: col.getSize() }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 bg-background z-20">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((header) => {
                      const id = header.column.id;
                      const isPinned = prefs.pinned.includes(id);
                      return (
                        <th
                          key={header.id}
                          style={{
                            width: header.getSize(),
                            ...(isPinned ? {
                              position: 'sticky',
                              left: stickyLeftMap[id],
                              zIndex: 25,
                            } : {}),
                          }}
                          className={cn(
                            'relative border-b border-r px-2 py-1.5 text-left align-top overflow-hidden bg-background',
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
                      return (
                        <tr
                          key={row.id}
                          data-index={vr.index}
                          ref={rowVirtualizer.measureElement}
                          className="hover:bg-accent/30 group"
                          onDoubleClick={() => onPickRow?.(row.index)}
                        >
                          {row.getVisibleCells().map((cell) => {
                            const id = cell.column.id;
                            const isPinned = prefs.pinned.includes(id);
                            const v = cell.getValue();
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
                                  'border-b border-r px-2 py-1 align-top whitespace-pre-wrap break-words overflow-hidden cursor-pointer',
                                  isPinned && 'bg-background group-hover:bg-accent/30',
                                )}
                                onClick={() => onPickCell?.(row.index, id, v)}
                              >
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
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
        <ContextMenuContent className="w-56">
          {menuCell ? (
            <CellMenu
              colName={menuCell.colName}
              value={menuValue}
              row={menuRowObj ?? {}}
              allColNames={allColNames}
              isPinned={prefs.pinned.includes(menuCell.colName)}
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

function CellMenu({
  colName, value, onAddFilter, onTogglePinned, isPinned, row, allColNames, onOpenFK, onShowJson,
}: {
  colName: string;
  value: unknown;
  onAddFilter?: (col: string, op: '=' | '!=' | 'LIKE' | 'IS NULL' | 'IS NOT NULL', value: unknown) => void;
  onTogglePinned: () => void;
  isPinned: boolean;
  row: Record<string, unknown>;
  allColNames: string[];
  onOpenFK?: (col: string, value: unknown) => void;
  onShowJson: () => void;
}) {
  const { t } = useTranslation('dbquery');
  const text = value == null ? 'NULL' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const copy = (s: string) => navigator.clipboard.writeText(s).catch(() => {/* ignore */});
  const insertSql = (() => {
    const cs = allColNames.map((c) => `"${c}"`).join(', ');
    const vs = allColNames.map((c) => sqlLiteral(row[c])).join(', ');
    return `INSERT INTO "<table>" (${cs}) VALUES (${vs});`;
  })();
  return (
    <>
      <ContextMenuItem onClick={() => copy(text)}>{t('table.copyValue')}</ContextMenuItem>
      {canShowAsJson(value) && (
        <ContextMenuItem onClick={onShowJson}>{t('table.showAsJson')}</ContextMenuItem>
      )}
      <ContextMenuSub>
        <ContextMenuSubTrigger>{t('table.copyAs')}</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem onClick={() => copy(text)}>{t('table.copyPlain')}</ContextMenuItem>
          <ContextMenuItem onClick={() => copy(JSON.stringify(row, null, 2))}>{t('table.copyRowJson')}</ContextMenuItem>
          <ContextMenuItem onClick={() => copy(insertSql)}>{t('table.copyRowInsert')}</ContextMenuItem>
          <ContextMenuItem onClick={() => copy(colName)}>{t('table.copyColumnName')}</ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
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

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

function rowToObject(cols: string[]) {
  return (row: unknown[]): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    cols.forEach((c, i) => { out[c] = row[i]; });
    return out;
  };
}
