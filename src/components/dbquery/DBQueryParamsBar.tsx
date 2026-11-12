import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Braces } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useEnvironmentStore } from '@/stores/environmentStore';
import { extractQueryParams } from './queryParamUtils';

interface DBQueryParamsBarProps {
  query: string;
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}

// DBQueryParamsBar shows an input for every {{var}} placeholder in the
// editor. Defaults come from the active environment so the same vars
// used in HTTP requests work for DB queries.
export function DBQueryParamsBar({ query, values, onChange }: DBQueryParamsBarProps) {
  const { t } = useTranslation('dbquery');
  const params = useMemo(() => extractQueryParams(query), [query]);
  // IMPORTANT: keep the selector pure — `?? []` would synthesize a new
  // array reference every render and zustand would interpret each one as
  // a state change, causing an infinite update loop. Return the raw
  // (possibly undefined) value and fall back in the consumer.
  const envValues = useEnvironmentStore((s) => s.activeEnvironment?.variables);
  const envMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of envValues ?? []) m.set(v.key, v.value);
    return m;
  }, [envValues]);

  // Seed missing values from active env on first appearance.
  useEffect(() => {
    if (params.length === 0) return;
    const next = { ...values };
    let dirty = false;
    for (const p of params) {
      if (next[p] == null) {
        const fromEnv = envMap.get(p);
        if (fromEnv !== undefined) { next[p] = fromEnv; dirty = true; }
      }
    }
    if (dirty) onChange(next);
  }, [params.join('|'), envMap]); // eslint-disable-line react-hooks/exhaustive-deps

  if (params.length === 0) return null;

  return (
    <div className="px-3 py-1.5 border-b bg-muted/20 flex items-center gap-2 flex-wrap shrink-0">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
        <Braces className="h-3 w-3" />
        {t('params.label')}
      </div>
      {params.map((p) => (
        <label key={p} className="flex items-center gap-1 text-[11px]">
          <span className="font-mono text-muted-foreground">{p}</span>
          <Input
            value={values[p] ?? ''}
            placeholder={envMap.get(p) ?? '—'}
            onChange={(e) => onChange({ ...values, [p]: e.target.value })}
            className="h-6 text-[11px] w-[140px] font-mono"
          />
        </label>
      ))}
    </div>
  );
}
