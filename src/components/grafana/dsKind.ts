import type { GrafanaDatasource, GrafanaVarValue } from '@/types';

// Datasource-kind helpers shared by Explore and the query inspector: which
// target field holds the human-editable query, what a blank target looks
// like, and how a panel's datasource reference resolves.

export type DsKind = 'prom' | 'loki' | 'sql' | 'es' | 'influx' | 'other';

export function kindOf(ds?: Pick<GrafanaDatasource, 'type'>): DsKind {
  const t = (ds?.type ?? '').toLowerCase();
  if (['prometheus', 'victoria', 'mimir', 'thanos', 'cortex'].some((k) => t.includes(k))) return 'prom';
  if (t.includes('loki')) return 'loki';
  if (t.includes('elasticsearch') || t.includes('opensearch')) return 'es';
  if (t.includes('influx')) return 'influx';
  if (t.includes('postgres') || t.includes('mysql') || t.includes('mssql') || t.includes('clickhouse') || t.includes('sql')) return 'sql';
  return 'other';
}

/** The string field of a target a person edits (expr / rawSql / query). */
export function textFieldOf(target: Record<string, unknown>, kind: DsKind): string | null {
  for (const k of ['expr', 'rawSql']) if (typeof target[k] === 'string') return k;
  if (typeof target.query === 'string') return 'query';
  if (kind === 'prom' || kind === 'loki') return 'expr';
  if (kind === 'sql') return 'rawSql';
  if (kind === 'es' || kind === 'influx') return 'query';
  return null;
}

export function newTargetFor(ds: GrafanaDatasource | undefined, refId: string): Record<string, unknown> {
  const base: Record<string, unknown> = { refId };
  if (ds) base.datasource = { uid: ds.uid, type: ds.type };
  switch (kindOf(ds)) {
    case 'prom': return { ...base, expr: '', range: true };
    case 'loki': return { ...base, expr: '', queryType: 'range' };
    case 'sql': return { ...base, rawSql: '', format: 'table', rawQuery: true, editorMode: 'code' };
    case 'influx': return { ...base, query: '', rawQuery: true, resultFormat: 'time_series' };
    case 'es': {
      const tf = ds?.timeField || '@timestamp';
      return {
        ...base, query: '*', timeField: tf,
        metrics: [{ type: 'count', id: '1' }],
        bucketAggs: [{ type: 'date_histogram', id: '2', field: tf, settings: { interval: 'auto' } }],
      };
    }
  }
  return base;
}

/** Resolve a classic datasource reference (string name, {uid,type}, "${ds}")
 *  against the server's datasource list and the dashboard variables. */
export function resolveDatasource(
  ref: unknown,
  list: GrafanaDatasource[],
  vars: Record<string, GrafanaVarValue> = {},
): GrafanaDatasource | undefined {
  let key = '';
  if (typeof ref === 'string') key = ref;
  else if (ref && typeof ref === 'object') {
    const r = ref as { uid?: string; name?: string };
    key = r.uid || r.name || '';
  }
  key = key.replace(/^\$\{?(\w+)\}?$/, (m, name) => vars[name]?.values?.[0] ?? m);
  if (!key || key === 'default') return list.find((d) => d.isDefault) ?? list[0];
  return list.find((d) => d.uid === key) ?? list.find((d) => d.name === key);
}

export const PLACEHOLDER: Record<DsKind, string> = {
  prom: 'sum by (job) (rate(http_requests_total[$__rate_interval]))',
  loki: '{job="api"} |= "error"',
  sql: 'SELECT $__timeGroupAlias(created_at, $__interval), count(*) AS value\nFROM events\nWHERE $__timeFilter(created_at)\nGROUP BY 1 ORDER BY 1',
  es: 'service:"order-api" AND status:>=500',
  influx: 'SELECT mean("value") FROM "cpu" WHERE $timeFilter GROUP BY time($__interval)',
  other: '{\n  "refId": "A"\n}',
};
