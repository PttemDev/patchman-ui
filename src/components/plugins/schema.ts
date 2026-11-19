// JSON Schema helpers for the generated plugin forms.

import type { JSONSchema } from '@/lib/plugins/pluginApi';

export function kind(s: JSONSchema): string {
  const t = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type;
  if (s.enum) return 'enum';
  return t ?? 'string';
}

/** Initial values: schema defaults, then existing values. */
export function schemaDefaults(schema: JSONSchema | undefined, existing?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(schema?.properties ?? {})) {
    if (p.default !== undefined) out[k] = p.default;
  }
  return { ...out, ...(existing ?? {}) };
}

/** Values to send: empty strings dropped, numbers parsed, JSON fields parsed. */
export function schemaValues(schema: JSONSchema | undefined, values: Record<string, unknown>, skip: string[] = []): { value: Record<string, unknown>; error?: string } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (skip.includes(k)) continue;
    const p = schema?.properties?.[k];
    if (v === '' || v === undefined) continue;
    const kd = p ? kind(p) : 'string';
    if ((kd === 'number' || kd === 'integer') && typeof v === 'string') {
      const n = Number(v);
      if (Number.isNaN(n)) return { value: out, error: k };
      out[k] = kd === 'integer' ? Math.trunc(n) : n;
    } else if ((kd === 'object' || kd === 'array') && typeof v === 'string') {
      try {
        out[k] = JSON.parse(v);
      } catch {
        return { value: out, error: k };
      }
    } else {
      out[k] = v;
    }
  }
  return { value: out };
}
