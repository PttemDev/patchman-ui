import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronRight, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DBQueryResult } from '@/types';

// Compass-style document list: one card per document, nested objects and
// arrays fold open. Fields a document does not have (result.absent) are left
// out instead of showing as null.

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function DBResultDocs({ result }: { result: DBQueryResult }) {
  const { t } = useTranslation('dbquery');
  const docs = useMemo(() => {
    const cols = result.columns ?? [];
    return (result.rows ?? []).map((row, i) => {
      const skip = new Set(result.absent?.[i] ?? []);
      const o: Record<string, Json> = {};
      cols.forEach((c, j) => { if (!skip.has(j)) o[c.name] = row[j] as Json; });
      return o;
    });
  }, [result]);

  if (docs.length === 0) return <div className="p-6 text-center text-xs text-muted-foreground">{t('docs.empty')}</div>;
  return (
    <div className="h-full space-y-2 overflow-auto p-3">
      {docs.map((d, i) => <DocCard key={i} doc={d} />)}
    </div>
  );
}

function DocCard({ doc }: { doc: Record<string, Json> }) {
  const { t } = useTranslation('dbquery');
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative rounded-md border bg-card px-3 py-2 font-mono text-[12px] leading-5">
      <button
        type="button"
        onClick={() => { void navigator.clipboard.writeText(JSON.stringify(doc, null, 2)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); }}
        className="absolute right-2 top-2 rounded p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
        title={t('docs.copy')}
        aria-label={t('docs.copy')}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      {Object.entries(doc).map(([k, v]) => <Field key={k} name={k} value={v} depth={0} />)}
    </div>
  );
}

function Field({ name, value, depth }: { name: string; value: Json; depth: number }) {
  const nested = value !== null && typeof value === 'object';
  const [open, setOpen] = useState(depth === 0 && Array.isArray(value) ? value.length <= 3 : false);
  const entries = nested ? (Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value)) : [];
  return (
    <div style={{ paddingLeft: depth ? 14 : 0 }}>
      <div className="flex items-start gap-1">
        {nested ? (
          <button type="button" onClick={() => setOpen((o) => !o)} className="mt-[3px] shrink-0 text-muted-foreground hover:text-foreground" aria-expanded={open}>
            <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
          </button>
        ) : <span className="w-3 shrink-0" />}
        <span className="shrink-0 text-violet-600 dark:text-violet-300">{name}</span>
        <span className="text-muted-foreground">:</span>
        {nested ? (
          <span className="text-muted-foreground">
            {Array.isArray(value) ? `Array (${value.length})` : `Object (${entries.length})`}
          </span>
        ) : <Scalar v={value} />}
      </div>
      {nested && open && entries.map(([k, v]) => <Field key={k} name={k} value={v} depth={depth + 1} />)}
    </div>
  );
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const OID = /^[0-9a-f]{24}$/;

function Scalar({ v }: { v: Json }) {
  if (v === null) return <span className="text-muted-foreground">null</span>;
  if (typeof v === 'boolean') return <span className="text-amber-600 dark:text-amber-400">{String(v)}</span>;
  if (typeof v === 'number') return <span className="text-sky-600 dark:text-sky-400">{v}</span>;
  if (typeof v === 'string' && OID.test(v)) return <span className="text-emerald-600 dark:text-emerald-400">ObjectId('{v}')</span>;
  if (typeof v === 'string' && ISO.test(v)) return <span className="text-pink-600 dark:text-pink-400">{v}</span>;
  return <span className="break-all text-emerald-700 dark:text-emerald-300">"{String(v)}"</span>;
}
