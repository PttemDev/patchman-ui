import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, X, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import type { DBSchemaColumn } from '@/types';
import { CellRenderer } from './CellRenderer';
import { shortColumnType } from './formatters';

interface DBRowInspectorProps {
  open: boolean;
  onClose: () => void;
  columns: DBSchemaColumn[];
  row: Record<string, unknown> | null;
  rowIndex: number;
  totalRows: number;
  onNavigate: (delta: number) => void;
  onPickCell?: (colName: string) => void;
}

// DBRowInspector flips a single row from horizontal grid to a vertical
// key→value list — much easier to read for wide tables. Includes prev/
// next nav, search-filter on columns, and copy-as-JSON.
export function DBRowInspector({
  open, onClose, columns, row, rowIndex, totalRows, onNavigate, onPickCell,
}: DBRowInspectorProps) {
  const { t } = useTranslation('dbquery');
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    if (!q.trim()) return columns;
    const lower = q.toLowerCase();
    return columns.filter((c) =>
      c.name.toLowerCase().includes(lower)
      || (row && String(row[c.name] ?? '').toLowerCase().includes(lower)),
    );
  }, [columns, row, q]);

  if (!open || !row) return null;

  return (
    <div className="absolute right-0 top-0 bottom-0 w-[460px] max-w-[60vw] z-30 border-l bg-background shadow-xl flex flex-col">
      <header className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('row.title')}
          </span>
          <Badge variant="secondary" className="text-[9px] font-mono">
            {rowIndex + 1} / {totalRows}
          </Badge>
        </div>
        <div className="flex items-center gap-0.5">
          <Button size="icon" variant="ghost" className="h-6 w-6"
            disabled={rowIndex <= 0}
            onClick={() => onNavigate(-1)}
            title={t('row.prevRow')}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6"
            disabled={rowIndex >= totalRows - 1}
            onClick={() => onNavigate(1)}
            title={t('row.nextRow')}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      <div className="px-3 py-1.5 border-b shrink-0 relative">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('row.filterPlaceholder')}
          className="h-7 text-xs pl-6"
        />
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <tbody>
            {filtered.map((col) => (
              <tr
                key={col.name}
                className="border-b last:border-b-0 hover:bg-accent/40 cursor-pointer"
                onClick={() => onPickCell?.(col.name)}
              >
                <td className="px-2 py-1.5 align-top w-[160px] border-r">
                  <div className="flex flex-col">
                    <span className="font-mono text-[11px] truncate">{col.name}</span>
                    {col.type && (
                      <span className="text-[9px] uppercase text-muted-foreground/70 tracking-wider">
                        {shortColumnType(col.type)}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-2 py-1.5 align-top break-words">
                  <CellRenderer value={row[col.name]} colName={col.name} colType={col.type} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="flex items-center gap-1 px-3 py-2 border-t shrink-0">
        <Button
          size="sm"
          variant="secondary"
          className="h-7 text-xs"
          onClick={() => navigator.clipboard.writeText(JSON.stringify(row, null, 2)).catch(() => {/* ignore */})}
        >
          <Copy className="h-3 w-3 mr-1" />
          {t('row.copyJson')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => navigator.clipboard.writeText(rowAsInsert(columns, row)).catch(() => {/* ignore */})}
        >
          <Copy className="h-3 w-3 mr-1" />
          {t('row.copyInsert')}
        </Button>
      </footer>
    </div>
  );
}

function rowAsInsert(cols: DBSchemaColumn[], row: Record<string, unknown>): string {
  const cs = cols.map((c) => `"${c.name}"`).join(', ');
  const vs = cols.map((c) => sqlLiteral(row[c.name])).join(', ');
  return `INSERT INTO "<table>" (${cs}) VALUES (${vs});`;
}

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}
