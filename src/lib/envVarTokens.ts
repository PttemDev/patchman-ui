import type { Environment } from '@/types';

// Env-variable token helpers for the editor UI (highlight, hover, autocomplete).
// The grammar MUST match send-time substitution in requestStore
// (`/\{\{(\w+)\}\}/g`): a name with `-` or `.` would be suggested/highlighted
// but never substituted.

export type EnvVar = Environment['variables'][number];

/** A complete `{{name}}` occurrence; `end` is exclusive and covers the `}}`. */
export interface VarToken {
  start: number;
  end: number;
  name: string;
}

export function findVarTokens(text: string): VarToken[] {
  const out: VarToken[] = [];
  if (!text || !text.includes('{{')) return out;
  const re = /\{\{(\w+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ start: m.index, end: m.index + m[0].length, name: m[1] });
  return out;
}

/**
 * The `{{…` the caret sits in, for autocomplete. `query` is the name typed so
 * far; `replaceEnd` extends over the rest of a partial name and an existing
 * closing `}}`, so picking a variable replaces the whole token instead of
 * producing `{{name}}}}`. `emptyBraces` is the `{{|}}` case (click-to-list).
 */
export interface VarQuery {
  start: number;
  replaceEnd: number;
  query: string;
  emptyBraces: boolean;
}

export function varQueryAt(text: string, caret: number): VarQuery | null {
  const m = text.slice(0, caret).match(/\{\{(\w*)$/);
  if (!m) return null;
  const start = caret - m[0].length;
  const tail = text.slice(caret).match(/^\w*/)![0];
  let replaceEnd = caret + tail.length;
  const closed = text.startsWith('}}', replaceEnd);
  if (closed) replaceEnd += 2;
  return { start, replaceEnd, query: m[1], emptyBraces: m[1] === '' && tail === '' && closed };
}

/** Replace the queried token with `{{name}}`; returns the new text + caret. */
export function applyVar(text: string, q: VarQuery, name: string): { text: string; caret: number } {
  const ins = `{{${name}}}`;
  return { text: text.slice(0, q.start) + ins + text.slice(q.replaceEnd), caret: q.start + ins.length };
}

export type VarStatus = 'resolved' | 'disabled' | 'missing' | 'noEnv';

export function varStatus(env: Environment | null, name: string): { status: VarStatus; variable?: EnvVar } {
  if (!env) return { status: 'noEnv' };
  const variable = env.variables.find((v) => v.key === name);
  if (!variable) return { status: 'missing' };
  return { status: variable.enabled ? 'resolved' : 'disabled', variable };
}

/** Enabled, substitutable variables matching `query` — prefix matches first. */
export function suggestVars(env: Environment | null, query: string): EnvVar[] {
  if (!env) return [];
  const q = query.toLowerCase();
  const usable = env.variables.filter((v) => v.enabled && /^\w+$/.test(v.key));
  const hits = usable.filter((v) => v.key.toLowerCase().includes(q));
  return hits.sort((a, b) => {
    const ap = a.key.toLowerCase().startsWith(q) ? 0 : 1;
    const bp = b.key.toLowerCase().startsWith(q) ? 0 : 1;
    return ap - bp || a.key.localeCompare(b.key);
  });
}

/** Masked preview for secret values (never render a secret in a list/hover). */
export function previewValue(v: EnvVar): string {
  return v.secret ? '••••••' : v.value;
}
