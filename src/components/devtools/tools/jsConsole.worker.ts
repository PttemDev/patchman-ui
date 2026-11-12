/// <reference lib="webworker" />
// Runs user JavaScript off the main thread for the JS Console tool. It can't
// touch the DOM or freeze the UI, and the host terminates it on timeout.
// console.* calls, the completion value, and top-level variables are posted
// back as pre-formatted strings.
/* eslint-disable @typescript-eslint/no-explicit-any */

const ctx: any = self;

function inspect(v: any, seen: Set<any>, depth: number): string {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'string') return depth === 0 ? v : JSON.stringify(v);
  if (t === 'number' || t === 'boolean') return String(v);
  if (t === 'bigint') return String(v) + 'n';
  if (t === 'undefined') return 'undefined';
  if (t === 'symbol') return v.toString();
  if (t === 'function') return '[Function: ' + (v.name || 'anonymous') + ']';
  if (v instanceof Error) return v.stack ? String(v.stack) : v.name + ': ' + v.message;
  if (seen.has(v)) return '[Circular]';
  if (depth > 4) return Array.isArray(v) ? '[Array]' : '[Object]';
  seen.add(v);
  try {
    if (Array.isArray(v)) return '[ ' + v.map((x) => inspect(x, seen, depth + 1)).join(', ') + ' ]';
    if (v instanceof Map)
      return 'Map(' + v.size + ') { ' + Array.from(v.entries()).map((e) => inspect(e[0], seen, depth + 1) + ' => ' + inspect(e[1], seen, depth + 1)).join(', ') + ' }';
    if (v instanceof Set)
      return 'Set(' + v.size + ') { ' + Array.from(v.values()).map((x) => inspect(x, seen, depth + 1)).join(', ') + ' }';
    const keys = Object.keys(v);
    const body = keys.map((k) => k + ': ' + inspect(v[k], seen, depth + 1));
    const ctor = v.constructor && v.constructor.name && v.constructor.name !== 'Object' ? v.constructor.name + ' ' : '';
    return ctor + '{ ' + body.join(', ') + ' }';
  } finally {
    seen.delete(v);
  }
}
function fmt(v: any): string {
  return inspect(v, new Set(), 0);
}

// jsonSafe deep-converts a value into a structured-clone-safe, JSON-shaped
// tree so the UI can render it as a collapsible viewer. Non-JSON leaves
// (undefined, bigint, functions, symbols, Errors, Dates) become descriptive
// strings; circular refs and very deep nodes are cut off.
function jsonSafe(v: any, seen: Set<any>, depth: number): any {
  if (v === null) return null;
  const t = typeof v;
  if (t === 'number' || t === 'boolean' || t === 'string') return v;
  if (t === 'undefined') return 'undefined';
  if (t === 'bigint') return String(v) + 'n';
  if (t === 'symbol') return v.toString();
  if (t === 'function') return '[Function: ' + (v.name || 'anonymous') + ']';
  if (v instanceof Error) return v.stack ? String(v.stack) : v.name + ': ' + v.message;
  if (v instanceof Date) return v.toISOString();
  if (seen.has(v)) return '[Circular]';
  if (depth > 6) return Array.isArray(v) ? '[Array]' : '[Object]';
  seen.add(v);
  try {
    if (Array.isArray(v)) return v.map((x) => jsonSafe(x, seen, depth + 1));
    if (v instanceof Map) {
      const o: Record<string, any> = {};
      v.forEach((val: any, key: any) => { o[String(key)] = jsonSafe(val, seen, depth + 1); });
      return o;
    }
    if (v instanceof Set) return Array.from(v.values()).map((x) => jsonSafe(x, seen, depth + 1));
    const o: Record<string, any> = {};
    Object.keys(v).forEach((k) => { o[k] = jsonSafe(v[k], seen, depth + 1); });
    return o;
  } finally {
    seen.delete(v);
  }
}

function isIdStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
}
function isIdPart(c: string): boolean {
  return isIdStart(c) || (c >= '0' && c <= '9');
}

// Best-effort scan for declared identifiers (const/let/var/function/class),
// including simple destructuring. Over-capture is fine — the try/catch filter
// downstream drops anything not actually in scope.
function declaredNames(src: string): string[] {
  const kws = ['const', 'let', 'var', 'function', 'class'];
  const out: string[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    if (isIdStart(src[i])) {
      let j = i;
      while (j < n && isIdPart(src[j])) j++;
      const w = src.slice(i, j);
      if (kws.indexOf(w) !== -1) {
        let k = j;
        while (k < n && src[k] <= ' ') k++;
        if (src[k] === '*') {
          k++;
          while (k < n && src[k] <= ' ') k++;
        }
        if (src[k] === '{' || src[k] === '[') {
          const open = src[k];
          const close = open === '{' ? '}' : ']';
          let d = 0;
          let m = k;
          for (; m < n; m++) {
            if (src[m] === open) d++;
            else if (src[m] === close) {
              d--;
              if (d === 0) {
                m++;
                break;
              }
            }
          }
          const inner = src.slice(k + 1, m - 1);
          let p = 0;
          while (p < inner.length) {
            if (isIdStart(inner[p])) {
              let q = p;
              while (q < inner.length && isIdPart(inner[q])) q++;
              out.push(inner.slice(p, q));
              p = q;
            } else p++;
          }
          i = m;
          continue;
        } else if (isIdStart(src[k])) {
          let m2 = k;
          while (m2 < n && isIdPart(src[m2])) m2++;
          out.push(src.slice(k, m2));
          i = m2;
          continue;
        }
      }
      i = j;
      continue;
    }
    i++;
  }
  const seen: Record<string, boolean> = {};
  const uniq: string[] = [];
  for (let x = 0; x < out.length; x++) {
    if (!seen[out[x]]) {
      seen[out[x]] = true;
      uniq.push(out[x]);
    }
  }
  return uniq;
}

ctx.onmessage = async (e: MessageEvent) => {
  const code: string = (e.data && e.data.code) || '';
  const emit = (level: string, args: IArguments) => {
    ctx.postMessage({ type: 'log', level, text: Array.prototype.map.call(args, fmt).join(' ') });
  };
  console.log = function () { emit('log', arguments); };
  console.info = function () { emit('info', arguments); };
  console.warn = function () { emit('warn', arguments); };
  console.error = function () { emit('error', arguments); };
  console.debug = function () { emit('log', arguments); };

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as any;
  const names = declaredNames(code);
  try {
    let fn: any;
    let isExpr = false;
    try {
      // Echo the value if the whole input is a single expression.
      fn = new AsyncFunction('return (' + code + '\n);');
      isExpr = true;
    } catch {
      let body = code + '\n;var __vars__ = {};';
      for (let a = 0; a < names.length; a++) {
        body += 'try{__vars__[' + JSON.stringify(names[a]) + '] = ' + names[a] + ';}catch(_e){}';
      }
      body += 'return { __vars__: __vars__ };';
      fn = new AsyncFunction(body);
    }
    const result = await fn();
    if (isExpr) {
      if (result !== undefined) ctx.postMessage({ type: 'result', text: fmt(result) });
    } else {
      const vm = (result && result.__vars__) || {};
      const arr = Object.keys(vm).map((kk) => ({ name: kk, value: jsonSafe(vm[kk], new Set(), 0) }));
      ctx.postMessage({ type: 'vars', vars: arr });
    }
    ctx.postMessage({ type: 'done' });
  } catch (err: any) {
    ctx.postMessage({ type: 'log', level: 'error', text: err && err.stack ? String(err.stack) : String(err) });
    ctx.postMessage({ type: 'done' });
  }
};

export {};
