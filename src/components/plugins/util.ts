import type { PluginInfo, PluginView } from '@/lib/plugins/pluginApi';

/** Log lines a failed plugin call returned (shown under the error). */
export function errorLogs(err: unknown): string[] {
  const logs = (err as { response?: { data?: { logs?: unknown } } })?.response?.data?.logs;
  return Array.isArray(logs) ? logs.filter((l): l is string => typeof l === 'string').slice(0, 100) : [];
}

/** Error text from an axios error or anything else. */
export function errorMessage(err: unknown): string {
  const e = err as { response?: { data?: { error?: unknown } }; message?: string };
  const be = e?.response?.data?.error;
  if (typeof be === 'string' && be) return be;
  return e?.message ?? String(err);
}

/** The ops a plugin tab offers: ui.views order first, then the rest
 *  alphabetically. The "test" op is the connection probe, not a view. */
export function pluginViews(p: PluginInfo): PluginView[] {
  const declared = p.ui?.views ?? [];
  const seen = new Set(declared.map((v) => v.op));
  const rest = Object.keys(p.ops)
    .filter((op) => !seen.has(op) && op !== 'test')
    .sort()
    .map((op) => ({ op, result: 'json' as const }));
  return [...declared, ...rest];
}
