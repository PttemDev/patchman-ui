// Shared helpers for the Git tab. Kept tiny so every git panel/dialog can
// pull the same error-extraction + formatting logic.
import i18n from '@/i18n';

// Pull a human message out of an axios-style error, falling back to `fallback`.
// Mirrors the extractErr used across the K8s / ES panels. A request that got
// no answer at all says which backend was unreachable instead of axios'
// bare "Network Error".
export function extractErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    if (e.response?.data?.error) return e.response.data.error;
  }
  if (err && typeof err === 'object') {
    const e = err as { response?: unknown; code?: string; message?: string; config?: { _executionPin?: string } };
    if (!e.response && (e.code === 'ERR_NETWORK' || e.message === 'Network Error')) {
      return i18n.t(e.config?._executionPin === 'local' ? 'git:errors.networkLocal' : 'git:errors.networkRemote');
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

// Compact "3m ago" / "2d ago" relative time for commit rows. Returns '' for
// an unparseable timestamp so callers can hide it.
export function timeAgo(iso: string | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

// GitLab (and our local `file` op) can hand back base64-encoded blob content.
// Decode to a UTF-8 string when flagged; otherwise pass through unchanged.
export function decodeGitContent(content: string | undefined, encoding?: string): string {
  if (!content) return '';
  if (encoding === 'base64') {
    try {
      const bin = atob(content);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return content;
    }
  }
  return content;
}

// Extension → Monaco language id map for the diff/content viewers and the
// in-app editor. Every id here is a grammar Monaco's basic-languages ships, so
// highlighting + editing work out of the box. Unknown extensions fall back to
// plaintext (Monaco still renders fine). NOTE: Monaco's protobuf id is
// `protobuf` (not `proto`), and there is no `toml` grammar — `ini` is the
// closest built-in.
const LANG_BY_EXT: Record<string, string> = {
  // JS / TS
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  // data / markup
  json: 'json', json5: 'json', jsonc: 'json', md: 'markdown', mdx: 'mdx',
  markdown: 'markdown', rst: 'restructuredtext',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  html: 'html', htm: 'html', xhtml: 'html', vue: 'html', svelte: 'html',
  xml: 'xml', svg: 'xml', xsl: 'xml', xslt: 'xml', plist: 'xml',
  yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini',
  // systems / compiled
  go: 'go', rs: 'rust', c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', 'c++': 'cpp',
  hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
  cs: 'csharp', java: 'java', kt: 'kotlin', kts: 'kotlin',
  scala: 'scala', sc: 'scala', swift: 'swift', dart: 'dart',
  m: 'objective-c', mm: 'objective-c',
  fs: 'fsharp', fsx: 'fsharp', fsi: 'fsharp',
  // scripting / dynamic
  py: 'python', pyi: 'python', pyw: 'python',
  rb: 'ruby', rbw: 'ruby', gemspec: 'ruby', rake: 'ruby',
  php: 'php', pl: 'perl', pm: 'perl', lua: 'lua', r: 'r',
  jl: 'julia', ex: 'elixir', exs: 'elixir',
  clj: 'clojure', cljs: 'clojure', cljc: 'clojure', edn: 'clojure',
  // shells
  sh: 'shell', bash: 'shell', zsh: 'shell', ksh: 'shell', fish: 'shell',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  bat: 'bat', cmd: 'bat',
  // db / infra / IDL
  sql: 'sql', pgsql: 'pgsql', mysql: 'mysql',
  dockerfile: 'dockerfile', containerfile: 'dockerfile',
  tf: 'hcl', tfvars: 'hcl', hcl: 'hcl',
  proto: 'protobuf', graphql: 'graphql', gql: 'graphql',
  sol: 'solidity', wgsl: 'wgsl', tcl: 'tcl', pas: 'pascal',
  vb: 'vb', bicep: 'bicep', hbs: 'handlebars', pug: 'pug', jade: 'pug',
};

// Filenames (no meaningful extension) that map to a known grammar.
const LANG_BY_NAME: Record<string, string> = {
  dockerfile: 'dockerfile', containerfile: 'dockerfile',
  '.gitignore': 'ini', '.gitattributes': 'ini', '.editorconfig': 'ini',
  '.env': 'ini', '.npmrc': 'ini', '.dockerignore': 'ini',
};

export function languageForPath(path: string | undefined): string {
  if (!path) return 'plaintext';
  const base = (path.split('/').pop() ?? path).toLowerCase();
  if (LANG_BY_NAME[base]) return LANG_BY_NAME[base];
  // e.g. `Dockerfile.prod` / `Dockerfile.dev`
  if (base.startsWith('dockerfile')) return 'dockerfile';
  const ext = base.includes('.') ? base.split('.').pop()! : '';
  return LANG_BY_EXT[ext] ?? 'plaintext';
}

// ── Merge-conflict marker parsing ────────────────────────────────────────────
// A git-conflicted working-tree file interleaves plain text with conflict
// blocks delimited by 7-char markers. We support BOTH layouts git writes:
//   2-way:  <<<<<<< ours / ======= / >>>>>>> theirs
//   diff3:  <<<<<<< ours / ||||||| base / ======= / >>>>>>> theirs
// The parser splits the file into an ordered segment list the resolver can
// render, then reassemble with each block's chosen side substituted in.

// One <<<<<<< … >>>>>>> region. `base` is non-null only for a diff3 file.
// Side arrays hold the region's lines WITHOUT their trailing newline (the
// EOL is reapplied at assembly), and WITHOUT the marker lines themselves.
export interface ConflictBlock {
  ours: string[];
  base: string[] | null;
  theirs: string[];
  /** Trailing text of the <<<<<<< line, e.g. "HEAD" (may be empty). */
  oursLabel: string;
  /** Trailing text of the >>>>>>> line, e.g. the incoming branch (may be empty). */
  theirsLabel: string;
  /** Trailing text of the ||||||| line for diff3 (may be empty). */
  baseLabel: string;
}

export type ConflictSegment =
  | { kind: 'text'; lines: string[] }
  | { kind: 'conflict'; block: ConflictBlock };

export interface ParsedConflicts {
  /** Detected line ending, reused when reassembling so CRLF survives. */
  eol: string;
  segments: ConflictSegment[];
  /** Number of conflict segments. */
  conflicts: number;
  /** False when markers were malformed / unterminated (fall back to raw edit). */
  ok: boolean;
}

// Only interpret a `=======` / `|||||||` / `>>>>>>>` line as a marker while a
// conflict block is open — outside one, `=======` is just file text. The
// trailing `(\s|$)` tolerates a marker line with a label and eats a stray \r;
// the separator is matched as exactly seven `=` so an `========` code banner
// (8+) is left alone.
const RE_OURS = /^<{7}(\s|$)/;
const RE_BASE = /^\|{7}(\s|$)/;
const RE_SEP = /^={7}\s*$/;
const RE_THEIRS = /^>{7}(\s|$)/;

const malformed = (eol: string, lines: string[]): ParsedConflicts => ({
  eol,
  segments: [{ kind: 'text', lines }],
  conflicts: 0,
  ok: false,
});

export function parseConflictFile(content: string): ParsedConflicts {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const segments: ConflictSegment[] = [];
  let text: string[] = [];
  const flushText = () => {
    if (text.length) { segments.push({ kind: 'text', lines: text }); text = []; }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!RE_OURS.test(line)) { text.push(line); i++; continue; }

    // Open a conflict block.
    flushText();
    const oursLabel = line.slice(7).trim();
    const ours: string[] = [];
    const base: string[] = [];
    const theirs: string[] = [];
    let hasBase = false;
    let baseLabel = '';
    i++;

    // OURS: until the base marker (diff3) or the separator.
    while (i < lines.length && !RE_BASE.test(lines[i]) && !RE_SEP.test(lines[i])) {
      if (RE_OURS.test(lines[i]) || RE_THEIRS.test(lines[i])) return malformed(eol, lines);
      ours.push(lines[i]); i++;
    }
    // Optional BASE (diff3): until the separator.
    if (i < lines.length && RE_BASE.test(lines[i])) {
      hasBase = true;
      baseLabel = lines[i].slice(7).trim();
      i++;
      while (i < lines.length && !RE_SEP.test(lines[i])) {
        if (RE_OURS.test(lines[i]) || RE_THEIRS.test(lines[i])) return malformed(eol, lines);
        base.push(lines[i]); i++;
      }
    }
    // SEPARATOR is required.
    if (i >= lines.length || !RE_SEP.test(lines[i])) return malformed(eol, lines);
    i++;
    // THEIRS: until the closing marker.
    while (i < lines.length && !RE_THEIRS.test(lines[i])) {
      if (RE_OURS.test(lines[i])) return malformed(eol, lines);
      theirs.push(lines[i]); i++;
    }
    // Closing >>>>>>> is required.
    if (i >= lines.length || !RE_THEIRS.test(lines[i])) return malformed(eol, lines);
    const theirsLabel = lines[i].slice(7).trim();
    i++;

    segments.push({
      kind: 'conflict',
      block: { ours, base: hasBase ? base : null, theirs, oursLabel, theirsLabel, baseLabel },
    });
  }
  flushText();

  const conflicts = segments.reduce((n, s) => n + (s.kind === 'conflict' ? 1 : 0), 0);
  return { eol, segments, conflicts, ok: true };
}

// True when `text` still contains a git conflict marker line — the belt-and-
// suspenders gate on "Mark resolved" and the resolver's already-resolved check.
export function hasConflictMarkers(text: string): boolean {
  return /^<{7}(\s|$)/m.test(text) || /^={7}\s*$/m.test(text) || /^>{7}(\s|$)/m.test(text);
}
