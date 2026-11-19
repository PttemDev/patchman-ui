import { useTranslation } from 'react-i18next';

// PluginResult shows an op's output as JSON, a table (array of objects, or
// an object holding one) or text. Values are always rendered as text.

const MAX_ROWS = 1000;

function rowsOf(data: unknown): Record<string, unknown>[] | null {
  const arr = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? Object.values(data as Record<string, unknown>).find(Array.isArray)
      : null;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  if (!arr.every((r) => r && typeof r === 'object' && !Array.isArray(r))) return null;
  return arr as Record<string, unknown>[];
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function PluginResult({ data, mode }: { data: unknown; mode: 'json' | 'table' | 'text' }) {
  const { t } = useTranslation('plugins');
  const text = (data as { text?: unknown } | null)?.text;

  if (mode === 'text' || (typeof text === 'string' && data && Object.keys(data as object).length === 1)) {
    const s = typeof text === 'string' ? text : typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    return <pre className="whitespace-pre-wrap break-all font-mono text-xs">{s}</pre>;
  }
  if (mode === 'table') {
    const rows = rowsOf(data);
    if (rows) {
      const cols = Array.from(new Set(rows.slice(0, 200).flatMap((r) => Object.keys(r))));
      return (
        <div className="overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c} className="sticky top-0 border-b bg-muted px-2 py-1 text-left font-medium">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, MAX_ROWS).map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  {cols.map((c) => (
                    <td key={c} className="max-w-[24rem] truncate px-2 py-1 font-mono" title={cell(r[c])}>{cell(r[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > MAX_ROWS && (
            <p className="mt-2 text-[11px] text-muted-foreground">{t('result.truncated', { shown: MAX_ROWS, total: rows.length })}</p>
          )}
        </div>
      );
    }
  }
  return <pre className="whitespace-pre-wrap break-all font-mono text-xs">{JSON.stringify(data, null, 2)}</pre>;
}
