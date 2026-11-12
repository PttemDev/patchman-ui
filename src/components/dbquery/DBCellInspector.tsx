import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Copy, ExternalLink, X, ChevronDown, ChevronRight, Braces } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { DBJsonModal, canShowAsJson } from './DBJsonModal';
import {
  classifyValue,
  formatBytes,
  formatDurationMs,
  formatDate,
  isLikelyBytes,
  isLikelyMs,
  isLikelyTimestamp,
  shortColumnType,
} from './formatters';

interface DBCellInspectorProps {
  open: boolean;
  onClose: () => void;
  value: unknown;
  colName: string;
  colType?: string;
  rowIndex?: number;
}

// DBCellInspector is the right-drawer that shows a single cell in
// long form: full text, decoded JSON tree, byte size, parsed
// timestamps, etc. It is a sibling of DBResultTable rather than a
// child so its lifecycle is decoupled from the table's row data.
export function DBCellInspector({
  open, onClose, value, colName, colType, rowIndex,
}: DBCellInspectorProps) {
  const { t } = useTranslation('dbquery');
  if (!open) return null;

  const cls = classifyValue(value, colType);
  const isNull = value === null;
  const isObject = !isNull && typeof value === 'object';

  return (
    <div className="absolute right-0 top-0 bottom-0 w-[420px] max-w-[60vw] z-30 border-l bg-background shadow-xl flex flex-col">
      <header className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('cell.title')}
          </span>
          <Badge variant="secondary" className="text-[9px] font-mono">
            {cls}
          </Badge>
          {colType && (
            <Badge variant="outline" className="text-[9px] font-mono">
              {shortColumnType(colType)}
            </Badge>
          )}
        </div>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </header>

      <div className="px-3 py-1.5 border-b text-[11px] text-muted-foreground shrink-0 flex items-center gap-2">
        <span className="font-mono truncate">{colName}</span>
        {rowIndex != null && (
          <>
            <span>·</span>
            <span>{t('cell.rowN', { n: rowIndex + 1 })}</span>
          </>
        )}
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        <CellMetaBlock value={value} colName={colName} colType={colType} />
        <CellBodyBlock value={value} isNull={isNull} isObject={isObject} />
      </div>

      <footer className="flex items-center gap-1 px-3 py-2 border-t shrink-0">
        <CopyMenu value={value} />
        <CopyMenuJsonButton value={value} colName={colName} />
      </footer>
    </div>
  );
}

function CopyMenuJsonButton({ value, colName }: { value: unknown; colName: string }) {
  const { t } = useTranslation('dbquery');
  const [open, setOpen] = useState(false);
  if (!canShowAsJson(value)) return null;
  return (
    <>
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(true)}>
        <Braces className="h-3 w-3 mr-1" />
        {t('cell.showAsJson')}
      </Button>
      <DBJsonModal open={open} onClose={() => setOpen(false)} value={value} colName={colName} />
    </>
  );
}

function CellMetaBlock({ value, colName, colType }: { value: unknown; colName: string; colType?: string }) {
  const { t } = useTranslation('dbquery');
  const lines = useMemo(() => buildMetaLines(value, colName, colType, t), [value, colName, colType, t]);
  if (lines.length === 0) return null;
  return (
    <div className="border rounded-md divide-y text-xs">
      {lines.map((l) => (
        <div key={l.k} className="px-2 py-1.5 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground min-w-[78px]">{l.k}</span>
          <span className="font-mono flex-1 break-all">{l.v}</span>
        </div>
      ))}
    </div>
  );
}

function chars(t: TFunction, n: number): string {
  return n === 1 ? t('units.charsOne', { count: n }) : t('units.charsOther', { count: n });
}

function buildMetaLines(value: unknown, colName: string, colType: string | undefined, t: TFunction): { k: string; v: string }[] {
  const out: { k: string; v: string }[] = [];
  if (value == null) return out;
  if (typeof value === 'string') {
    out.push({ k: t('cell.metaLength'), v: chars(t, value.length) });
  }
  if (typeof value === 'number') {
    if (isLikelyBytes(colName, colType)) {
      out.push({ k: t('cell.metaSize'), v: `${formatBytes(value)} (${value.toLocaleString()} B)` });
    } else if (isLikelyMs(colName)) {
      out.push({ k: t('cell.metaDuration'), v: formatDurationMs(value) });
    } else {
      out.push({ k: t('cell.metaValue'), v: value.toLocaleString() });
      if (Number.isInteger(value) && value > 1e9) {
        // Maybe an epoch — show ISO conversion as a hint.
        const d = new Date(value > 1e11 ? value : value * 1000);
        if (!Number.isNaN(d.getTime())) {
          out.push({ k: t('cell.metaAsDate'), v: d.toISOString() });
        }
      }
    }
  }
  if (typeof value === 'string' && isLikelyTimestamp(colType)) {
    const d = formatDate(value);
    out.push({ k: t('cell.metaIso'), v: d.full });
    out.push({ k: t('cell.metaLocal'), v: d.short });
    if (d.relative) out.push({ k: t('cell.metaRelative'), v: d.relative });
  }
  if (typeof value === 'object') {
    out.push({ k: t('cell.metaJsonSize'), v: chars(t, JSON.stringify(value).length) });
    if (Array.isArray(value)) {
      out.push({ k: t('cell.metaLength'), v: value.length === 1 ? t('units.itemsOne', { count: value.length }) : t('units.itemsOther', { count: value.length }) });
    } else if (value) {
      out.push({ k: t('cell.metaKeys'), v: `${Object.keys(value).length}` });
    }
  }
  return out;
}

function CellBodyBlock({ value, isNull, isObject }: { value: unknown; isNull: boolean; isObject: boolean }) {
  if (isNull) {
    return (
      <pre className="text-xs italic text-muted-foreground select-none">NULL</pre>
    );
  }
  if (isObject) {
    return <JsonTree node={value} />;
  }
  return (
    <pre className="font-mono text-xs whitespace-pre-wrap break-words">{String(value)}</pre>
  );
}

// Lightweight collapsible JSON tree. Doesn't try to compete with
// Monaco — just keeps deep structures scannable.
function JsonTree({ node, depth = 0, label }: { node: unknown; depth?: number; label?: string }) {
  const [open, setOpen] = useState(depth < 2);
  if (node === null) return <Leaf label={label} value="null" cls="text-muted-foreground italic" />;
  if (typeof node !== 'object') {
    const cls = typeof node === 'number' ? 'text-purple-500' : typeof node === 'boolean' ? 'text-emerald-500' : 'text-amber-500';
    const v = typeof node === 'string' ? `"${node}"` : String(node);
    return <Leaf label={label} value={v} cls={cls} />;
  }
  const entries = Array.isArray(node)
    ? node.map((v, i) => [String(i), v] as const)
    : Object.entries(node as Record<string, unknown>);
  const isArr = Array.isArray(node);
  return (
    <div className="text-xs font-mono">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {label !== undefined && <span className="text-blue-500">{label}</span>}
        {label !== undefined && <span>:</span>}
        <span>{isArr ? `[${entries.length}]` : `{${entries.length}}`}</span>
      </button>
      {open && (
        <div className="pl-4 border-l border-border ml-1.5">
          {entries.map(([k, v]) => (
            <JsonTree key={k} node={v} depth={depth + 1} label={k} />
          ))}
        </div>
      )}
    </div>
  );
}

function Leaf({ label, value, cls }: { label?: string; value: string; cls: string }) {
  return (
    <div className="text-xs font-mono pl-4 flex gap-1">
      {label !== undefined && <span className="text-blue-500">{label}:</span>}
      <span className={cn('break-all', cls)}>{value}</span>
    </div>
  );
}

function CopyMenu({ value }: { value: unknown }) {
  const { t } = useTranslation('dbquery');
  const text = useMemo(() => {
    if (value == null) return 'NULL';
    if (typeof value === 'object') {
      try { return JSON.stringify(value, null, 2); } catch { return String(value); }
    }
    return String(value);
  }, [value]);
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    } catch { /* ignore */ }
  };
  const open = () => {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
      window.open(value, '_blank', 'noopener,noreferrer');
    }
  };
  const isUrl = typeof value === 'string' && /^https?:\/\//i.test(value);
  return (
    <>
      <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={copy}>
        <Copy className="h-3 w-3 mr-1" />
        {done ? t('common:copied') : t('common:copy')}
      </Button>
      {isUrl && (
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={open}>
          <ExternalLink className="h-3 w-3 mr-1" />
          {t('cell.open')}
        </Button>
      )}
    </>
  );
}
