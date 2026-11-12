import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Download,
  FileJson,
  FileSpreadsheet,
  FileType,
  Table as TableIcon,
  BarChart3,
  Workflow,
  Braces,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import * as XLSX from 'xlsx';
import type { DBQueryResult } from '@/types';
import { DBResultTable } from './DBResultTable';
import { DBResultChart } from './DBResultChart';
import { DBResultJSON } from './DBResultJSON';
import { DBExplainPlan } from './DBExplainPlan';
import { DBCellInspector } from './DBCellInspector';
import { DBRowInspector } from './DBRowInspector';
import { DBSummaryFooter } from './DBSummaryFooter';
import { DBColumnControl } from './DBColumnControl';
import {
  columnFingerprint,
  useDBColumnPrefsStore,
} from '@/stores/dbColumnPrefsStore';

const EMPTY_HIDDEN: readonly string[] = [];
import { stringifyValue } from './formatters';

interface DBResultPanelProps {
  result: DBQueryResult;
  onAddFilter?: (col: string, op: '=' | '!=' | 'LIKE' | 'IS NULL' | 'IS NOT NULL', value: unknown) => void;
  onOpenFK?: (col: string, value: unknown) => void;
  onPageChange?: (delta: 1 | -1) => void;
  /** Visible row cap so pagination prev/next can be styled */
  rowLimit?: number;
}

type ResultView = 'table' | 'json' | 'chart' | 'explain';

// DBResultPanel composes the toolbar (export/view/columns) over one of
// three views, plus the cell inspector, row inspector and summary footer.
export function DBResultPanel({ result, onAddFilter, onOpenFK, onPageChange, rowLimit }: DBResultPanelProps) {
  const { t } = useTranslation('dbquery');
  const [view, setView] = useState<ResultView>('table');
  const [cell, setCell] = useState<{ rowIndex: number; colName: string; value: unknown } | null>(null);
  const [rowIdx, setRowIdx] = useState<number | null>(null);
  // Large-result guard: even with virtualization, a very wide/tall grid is
  // better exported than scrolled. We gate rendering behind a one-click
  // opt-in above a cell-count threshold (~1000 rows × 50 cols).
  const [forceShowTable, setForceShowTable] = useState(false);

  // BE can return columns=null when a Mongo cursor materializes zero
  // rows (the col list is inferred from the first doc). Normalize so
  // every downstream consumer sees [] for an empty schema.
  const columns = result.columns ?? [];
  const rows = result.rows ?? [];
  const allColNames = useMemo(() => columns.map((c) => c.name), [columns]);
  const fp = useMemo(() => columnFingerprint(allColNames), [allColNames]);
  // Selector stays pure to avoid an infinite re-render via zustand's
  // reference-equality check; fallback applied in the consumer.
  const storedHidden = useDBColumnPrefsStore((s) => s.prefs[fp]?.hidden);
  const hidden = storedHidden ?? EMPTY_HIDDEN;

  const visibleColNames = useMemo(
    () => allColNames.filter((c) => !hidden.includes(c)),
    [allColNames, hidden],
  );

  const objectRows = useMemo(
    () => rows.map((row) => {
      const o: Record<string, unknown> = {};
      allColNames.forEach((c, i) => { o[c] = row[i]; });
      return o;
    }),
    [rows, allColNames],
  );

  const lookExplain = useMemo(() => detectExplain(result), [result]);

  // Reset the large-result opt-in whenever a fresh result arrives.
  useEffect(() => { setForceShowTable(false); }, [result.queryId, rows.length]);
  const LARGE_CELL_THRESHOLD = 50_000; // ≈ 1000 rows × 50 columns
  const cellCount = rows.length * (allColNames.length || 1);
  const isLargeResult = cellCount > LARGE_CELL_THRESHOLD;

  const colMeta = useMemo(
    () => columns.find((c) => c.name === cell?.colName),
    [columns, cell?.colName],
  );
  const rowObj = rowIdx != null ? objectRows[rowIdx] : null;

  const onPickCell = useCallback((rowIndex: number, colName: string, value: unknown) => {
    setCell({ rowIndex, colName, value });
  }, []);
  const onPickRow = useCallback((rowIndex: number) => setRowIdx(rowIndex), []);

  const handleExport = (fmt: 'csv' | 'json' | 'jsonl' | 'xlsx') => {
    const cols = visibleColNames;
    const rows = objectRows;
    if (fmt === 'xlsx') {
      const sheet = XLSX.utils.json_to_sheet(rows.map((r) => Object.fromEntries(cols.map((c) => [c, normalizeCell(r[c])]))));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheet, 'Result');
      XLSX.writeFile(wb, 'result.xlsx');
      return;
    }
    let blob: Blob;
    let filename: string;
    if (fmt === 'json') {
      blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
      filename = 'result.json';
    } else if (fmt === 'jsonl') {
      blob = new Blob([rows.map((r) => JSON.stringify(r)).join('\n')], { type: 'application/jsonl' });
      filename = 'result.jsonl';
    } else {
      const header = cols.map(csvEscape).join(',');
      const body = rows.map((r) => cols.map((c) => csvEscape(stringifyValue(r[c]))).join(',')).join('\n');
      blob = new Blob([header + '\n' + body], { type: 'text/csv' });
      filename = 'result.csv';
    }
    triggerDownload(blob, filename);
  };

  return (
    <div className="h-full flex flex-col relative">
      <div className="flex items-center gap-3 px-3 py-1.5 border-b text-[11px] text-muted-foreground bg-muted/30 shrink-0">
        <span>
          <span className="font-mono text-foreground">{result.rowCount.toLocaleString()}</span> {t('units.rowsWord')}
          {result.rowsTruncated && (
            <Badge variant="outline" className="ml-1.5 text-[9px] border-amber-500/50 text-amber-500">
              {t('results.truncated')}
            </Badge>
          )}
        </span>
        <span>·</span>
        <span>
          <span className="font-mono text-foreground">{result.execMs.toLocaleString()}</span> ms
        </span>
        <span>·</span>
        <span>
          <span className="font-mono text-foreground">{visibleColNames.length}</span>/<span className="font-mono">{allColNames.length}</span> {t('units.colsWord')}
        </span>
        {onPageChange && rowLimit && (
          <>
            <span>·</span>
            <TooltipProvider delayDuration={200}>
              <span className="font-mono">
                {t('results.rowsRange', {
                  start: ((result.offset ?? 0) + 1).toLocaleString(),
                  end: ((result.offset ?? 0) + result.rowCount).toLocaleString(),
                })}
              </span>
              <div className="flex items-center gap-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      disabled={(result.offset ?? 0) <= 0}
                      onClick={() => onPageChange(-1)}
                    >
                      <ChevronLeft className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom"><p className="text-xs">{t('results.prevPage')}</p></TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      disabled={!result.rowsTruncated}
                      onClick={() => onPageChange(1)}
                    >
                      <ChevronRight className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom"><p className="text-xs">{t('results.nextPage')}</p></TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          </>
        )}

        <div className="flex-1" />

        {/* View switcher */}
        <div className="flex border rounded">
          <ViewBtn icon={<TableIcon className="h-3 w-3" />} label={t('results.viewTable')} active={view === 'table'} onClick={() => setView('table')} />
          <ViewBtn icon={<Braces className="h-3 w-3" />} label="JSON" active={view === 'json'} onClick={() => setView('json')} />
          <ViewBtn icon={<BarChart3 className="h-3 w-3" />} label={t('results.viewChart')} active={view === 'chart'} onClick={() => setView('chart')} />
          {lookExplain && (
            <ViewBtn icon={<Workflow className="h-3 w-3" />} label={t('results.viewPlan')} active={view === 'explain'} onClick={() => setView('explain')} />
          )}
        </div>

        <DBColumnControl fingerprint={fp} allColumns={allColNames} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5">
              <Download className="h-3 w-3" />
              {t('results.export')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleExport('xlsx')}>
              <FileSpreadsheet className="h-3.5 w-3.5 mr-2" />
              Excel (.xlsx)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport('csv')}>
              <FileSpreadsheet className="h-3.5 w-3.5 mr-2" />
              CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport('json')}>
              <FileJson className="h-3.5 w-3.5 mr-2" />
              JSON
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport('jsonl')}>
              <FileType className="h-3.5 w-3.5 mr-2" />
              JSONL
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex-1 min-h-0">
        {view === 'table' && (
          isLargeResult && !forceShowTable ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
              <AlertTriangle className="h-8 w-8 text-amber-500" />
              <div className="max-w-md space-y-1">
                <p className="text-sm font-medium text-foreground">{t('results.largeTitle')}</p>
                <p className="text-xs text-muted-foreground">
                  <Trans
                    t={t}
                    i18nKey="results.largeBody"
                    values={{
                      rows: rows.length.toLocaleString(),
                      cols: allColNames.length,
                      cells: cellCount.toLocaleString(),
                    }}
                    components={{ mono: <span className="font-mono text-foreground" /> }}
                  />
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="default" className="h-8 text-xs gap-1.5" onClick={() => handleExport('csv')}>
                  <FileSpreadsheet className="h-3.5 w-3.5" /> {t('results.exportCsvBtn')}
                </Button>
                <Button size="sm" variant="secondary" className="h-8 text-xs gap-1.5" onClick={() => handleExport('xlsx')}>
                  <FileSpreadsheet className="h-3.5 w-3.5" /> {t('results.exportExcelBtn')}
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setForceShowTable(true)}>
                  {t('results.showAnyway')}
                </Button>
              </div>
            </div>
          ) : (
            <DBResultTable
              result={result}
              onAddFilter={onAddFilter}
              onPickCell={onPickCell}
              onPickRow={onPickRow}
              onOpenFK={onOpenFK}
            />
          )
        )}
        {view === 'json' && (
          <DBResultJSON result={result} />
        )}
        {view === 'chart' && (
          <DBResultChart columns={columns} rows={objectRows} />
        )}
        {view === 'explain' && (
          <DBExplainPlan rows={rows} columns={columns} />
        )}
      </div>

      <DBSummaryFooter columns={visibleColNames} rows={objectRows} />

      <DBCellInspector
        open={!!cell}
        onClose={() => setCell(null)}
        value={cell?.value}
        colName={cell?.colName ?? ''}
        colType={colMeta?.type}
        rowIndex={cell?.rowIndex}
      />
      <DBRowInspector
        open={rowIdx != null}
        onClose={() => setRowIdx(null)}
        columns={columns}
        row={rowObj}
        rowIndex={rowIdx ?? 0}
        totalRows={objectRows.length}
        onNavigate={(d) => setRowIdx((r) => Math.max(0, Math.min(objectRows.length - 1, (r ?? 0) + d)))}
        onPickCell={(colName) => setCell({ rowIndex: rowIdx ?? 0, colName, value: rowObj?.[colName] })}
      />
    </div>
  );
}

function ViewBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClick}
      className={cn('h-7 px-2 text-[11px] rounded-none gap-1', active && 'bg-accent')}
    >
      {icon}
      {label}
    </Button>
  );
}

function detectExplain(result: DBQueryResult): boolean {
  const cols = result.columns ?? [];
  if (cols.length === 1) {
    const name = cols[0].name.toLowerCase();
    if (name === 'query plan' || name === 'explain') return true;
  }
  // Plan JSON heuristic
  const first = (result.rows ?? [])[0]?.[0];
  if (typeof first === 'string') {
    if (first.startsWith('[{"Plan":') || first.startsWith('{"Plan":')) return true;
  }
  return false;
}

function normalizeCell(v: unknown): unknown {
  if (v == null) return '';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return v;
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
