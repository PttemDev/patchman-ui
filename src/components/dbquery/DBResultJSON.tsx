import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DBQueryResult } from '@/types';

interface DBResultJSONProps {
  result: DBQueryResult;
}

// DBResultJSON renders the in-memory rows as pretty-printed JSON. Each
// document is its own collapsible block so a long-tail Mongo result
// stays scannable. Defaults to "pretty" but offers raw/jsonl toggles
// for export-paste workflows.
export function DBResultJSON({ result }: DBResultJSONProps) {
  const { t } = useTranslation('dbquery');
  const [mode, setMode] = useState<'pretty' | 'jsonl' | 'raw'>('pretty');
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [copyOne, setCopyOne] = useState<number | null>(null);
  const [copyAll, setCopyAll] = useState(false);

  const objects = useMemo(() => {
    const cols = result.columns ?? [];
    const rows = result.rows ?? [];
    return rows.map((row) => {
      const o: Record<string, unknown> = {};
      cols.forEach((c, i) => { o[c.name] = row[i]; });
      return o;
    });
  }, [result.rows, result.columns]);

  const fullText = useMemo(() => {
    if (mode === 'jsonl') return objects.map((o) => JSON.stringify(o)).join('\n');
    if (mode === 'raw') return JSON.stringify(objects);
    return JSON.stringify(objects, null, 2);
  }, [objects, mode]);

  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(fullText);
      setCopyAll(true);
      setTimeout(() => setCopyAll(false), 1200);
    } catch { /* ignore */ }
  };
  const handleCopyOne = async (i: number) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(objects[i], null, 2));
      setCopyOne(i);
      setTimeout(() => setCopyOne(null), 1200);
    } catch { /* ignore */ }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b text-xs shrink-0">
        <span className="text-muted-foreground">{t('json.format')}</span>
        <div className="flex border rounded">
          <ModeBtn active={mode === 'pretty'} onClick={() => setMode('pretty')} label={t('json.pretty')} />
          <ModeBtn active={mode === 'jsonl'} onClick={() => setMode('jsonl')} label="JSONL" />
          <ModeBtn active={mode === 'raw'} onClick={() => setMode('raw')} label={t('json.compact')} />
        </div>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1.5" onClick={handleCopyAll}>
          <Copy className="h-3 w-3" />
          {copyAll ? t('common:copied') : t('json.copyAll')}
        </Button>
      </div>

      <div className="flex-1 overflow-auto font-mono text-xs leading-relaxed">
        {objects.length === 0 ? (
          <p className="text-center py-6 text-muted-foreground italic">{t('json.noDocuments')}</p>
        ) : mode === 'pretty' ? (
          <div className="divide-y">
            {objects.map((obj, i) => {
              const isCollapsed = collapsed[i];
              const text = JSON.stringify(obj, null, 2);
              return (
                <div key={i} className="group/doc px-3 py-2 hover:bg-accent/20">
                  <div className="flex items-center gap-2 mb-1">
                    <button
                      type="button"
                      onClick={() => setCollapsed((m) => ({ ...m, [i]: !m[i] }))}
                      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    >
                      {isCollapsed
                        ? <ChevronRight className="h-3 w-3" />
                        : <ChevronDown className="h-3 w-3" />}
                      <span className="text-[10px] uppercase tracking-wider">
                        {t('json.docN', { n: i + 1 })}
                      </span>
                    </button>
                    <span className="text-[10px] text-muted-foreground/70">
                      {Object.keys(obj).length === 1
                        ? t('units.fieldsOne', { count: Object.keys(obj).length })
                        : t('units.fieldsOther', { count: Object.keys(obj).length })}
                    </span>
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => handleCopyOne(i)}
                      className="opacity-0 group-hover/doc:opacity-100 transition-opacity text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[10px]"
                    >
                      <Copy className="h-2.5 w-2.5" />
                      {copyOne === i ? t('common:copied') : t('common:copy')}
                    </button>
                  </div>
                  {!isCollapsed && <pre className="whitespace-pre-wrap break-words text-foreground/90">{colorizeJson(text)}</pre>}
                </div>
              );
            })}
          </div>
        ) : (
          <pre className="p-3 whitespace-pre-wrap break-words">{colorizeJson(fullText)}</pre>
        )}
      </div>
    </div>
  );
}

function ModeBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClick}
      className={cn('h-6 px-2 text-[11px] rounded-none', active && 'bg-accent')}
    >
      {label}
    </Button>
  );
}

// colorize wraps strings/numbers/booleans/null in tiny <span>s for
// scannable highlighting. It's a regex pass — fine for the result
// sizes we're showing (Mongo doc-of-docs) and avoids pulling a full
// JSON parser into the render path.
export function colorizeJson(s: string) {
  const parts: React.ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|(-?\d+\.?\d*(?:[eE][-+]?\d+)?)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const [full, k, str, lit, num] = m;
    if (k) parts.push(<span key={key++} className="text-sky-500">{full}</span>);
    else if (str) parts.push(<span key={key++} className="text-amber-500">{full}</span>);
    else if (lit) parts.push(<span key={key++} className={lit === 'null' ? 'text-muted-foreground italic' : 'text-emerald-500'}>{full}</span>);
    else if (num) parts.push(<span key={key++} className="text-purple-500">{full}</span>);
    last = m.index + full.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}
