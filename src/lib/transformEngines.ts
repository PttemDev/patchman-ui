// Query/transform engines for the response "Transform" tab. All run entirely
// client-side against the parsed response, never mutating the original.
//   - JMESPath   — sync, tiny pure-JS lib
//   - JSONPath   — sync, pure-JS (jsonpath-plus)
//   - jq         — real jq via jq-web (WebAssembly), loaded lazily on first use
import jmespath from 'jmespath';
import { JSONPath } from 'jsonpath-plus';

// 'jq' stays in the union (the persisted store may hold it) but is not wired
// up yet — jq-web is bundler-hostile (auto-instantiates its WASM from a
// non-injectable path at import). Re-add runJq + the wasm import once it's
// integrated via a bundler-friendly build.
export type TransformEngine = 'jmespath' | 'jq' | 'jsonpath';

export function runJmespath(data: unknown, query: string): string {
  const out = jmespath.search(data, query);
  return out === undefined ? 'null' : JSON.stringify(out, null, 2);
}

export function runJsonpath(data: unknown, query: string): string {
  // wrap:true always returns an array of matches — predictable output shape.
  const out = JSONPath({ path: query, json: data as object, wrap: true });
  return JSON.stringify(out, null, 2);
}
