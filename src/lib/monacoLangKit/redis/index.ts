import type { Monaco } from '@monaco-editor/react';
import type * as MonacoType from 'monaco-editor';
import { setMarkers } from '../markers';
import rawCommands from './commands.json';

// ── Corpus ────────────────────────────────────────────────────────────
// commands.json is the pruned redis-doc corpus (see
// scripts/vendor-redis-commands.mjs). Keys are command names; container
// subcommands are space-joined ("CONFIG GET", "XINFO STREAM", …).

interface RedisArg {
  name: string;
  type: string;
  token?: string;
  optional?: boolean;
  multiple?: boolean;
  arguments?: RedisArg[];
}

interface RedisCommand {
  summary: string;
  arity: number;
  group: string;
  complexity?: string;
  since?: string;
  arguments?: RedisArg[];
}

const COMMANDS = rawCommands as Record<string, RedisCommand>;

// Top-level (single-word) command names — includes container roots, which
// carry their own entry in the corpus (e.g. "CONFIG", "CLUSTER").
const TOP_LEVEL: string[] = Object.keys(COMMANDS)
  .filter((k) => !k.includes(' '))
  .sort();

// container root → list of subcommand second-words.
const CONTAINERS = new Map<string, string[]>();
for (const k of Object.keys(COMMANDS)) {
  const sp = k.indexOf(' ');
  if (sp < 0) continue;
  const root = k.slice(0, sp);
  const sub = k.slice(sp + 1);
  const list = CONTAINERS.get(root) ?? [];
  list.push(sub);
  CONTAINERS.set(root, list);
}

// splitArgs tokenizes a Redis command line, honoring single/double quotes so
// a quoted value with spaces counts as one token. Good enough for arity +
// signature-help heuristics (not a full RESP parser).
function splitArgs(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inS = false;
  let inD = false;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inS) {
      if (ch === "'") inS = false;
      else cur += ch;
    } else if (inD) {
      if (ch === '"') inD = false;
      else cur += ch;
    } else if (ch === "'") { inS = true; has = true; }
    else if (ch === '"') { inD = true; has = true; }
    else if (/\s/.test(ch)) {
      if (has) { out.push(cur); cur = ''; has = false; }
    } else { cur += ch; has = true; }
  }
  if (has) out.push(cur);
  return out;
}

// resolveCommand maps the leading tokens of a line to a corpus entry,
// preferring the two-word container form ("CLUSTER INFO") over the bare root.
function resolveCommand(tokens: string[]): { name: string; entry: RedisCommand; consumed: number } | null {
  if (tokens.length >= 2) {
    const two = `${tokens[0]} ${tokens[1]}`.toUpperCase();
    if (COMMANDS[two]) return { name: two, entry: COMMANDS[two], consumed: 2 };
  }
  const one = (tokens[0] ?? '').toUpperCase();
  if (one && COMMANDS[one]) return { name: one, entry: COMMANDS[one], consumed: 1 };
  return null;
}

function argLabel(arg: RedisArg): string {
  let base = arg.token ? `${arg.token} ${arg.name}` : arg.name;
  if (arg.multiple) base += ' [' + arg.name + ' ...]';
  return arg.optional ? `[${base}]` : base;
}

function hoverMarkdown(name: string, entry: RedisCommand): string {
  const lines: string[] = [`**${name}**`, '', entry.summary];
  const meta: string[] = [];
  if (entry.complexity) meta.push(`complexity: \`${entry.complexity}\``);
  if (entry.since) meta.push(`since: \`${entry.since}\``);
  meta.push(`group: \`${entry.group}\``);
  lines.push('', meta.join(' · '));
  if (entry.arguments && entry.arguments.length) {
    lines.push('', '`' + name + ' ' + entry.arguments.map(argLabel).join(' ') + '`');
  }
  return lines.join('\n');
}

let registered = false;

// registerRedisLang installs the 'redis' Monarch language plus completion /
// hover / signature-help providers and debounced arity diagnostics. Idempotent
// — safe to call from registerLangKit(monaco) once at startup.
export function registerRedisLang(monaco: Monaco): void {
  if (registered) return;
  registered = true;

  monaco.languages.register({ id: 'redis' });

  monaco.languages.setMonarchTokensProvider('redis', {
    ignoreCase: true,
    keywords: TOP_LEVEL,
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/'([^'\\]|\\.)*'/, 'string'],
        [/[+-]?\d+(\.\d+)?/, 'number'],
        [/[a-zA-Z_][\w-]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/[{}[\]():,]/, 'delimiter'],
      ],
    },
  } as MonacoType.languages.IMonarchLanguage);

  monaco.languages.setLanguageConfiguration('redis', {
    comments: { lineComment: '#' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
    ],
  });

  // ── Completion ──────────────────────────────────────────────────────
  monaco.languages.registerCompletionItemProvider('redis', {
    triggerCharacters: [' '],
    provideCompletionItems: (model: MonacoType.editor.ITextModel, position: MonacoType.Position) => {
      const word = model.getWordUntilPosition(position);
      const range: MonacoType.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const untilCursor = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      if (untilCursor.trimStart().startsWith('#')) return { suggestions: [] };

      const tokens = splitArgs(untilCursor);
      const trailingSpace = /\s$/.test(untilCursor);
      // Index of the token the cursor is composing.
      const idx = trailingSpace ? tokens.length : Math.max(0, tokens.length - 1);

      const kind = monaco.languages.CompletionItemKind;
      const out: MonacoType.languages.CompletionItem[] = [];

      if (idx === 0) {
        for (const name of TOP_LEVEL) {
          const entry = COMMANDS[name];
          out.push({
            label: name,
            kind: CONTAINERS.has(name) ? kind.Module : kind.Function,
            insertText: name,
            detail: entry.group + (CONTAINERS.has(name) ? ' · container' : ''),
            documentation: { value: hoverMarkdown(name, entry) },
            sortText: '0' + name,
            range,
          });
        }
      } else if (idx === 1) {
        const root = (tokens[0] ?? '').toUpperCase();
        const subs = CONTAINERS.get(root);
        if (subs) {
          for (const sub of subs) {
            const full = `${root} ${sub}`;
            const entry = COMMANDS[full];
            out.push({
              label: sub,
              kind: kind.Method,
              insertText: sub,
              detail: entry?.group ?? root,
              documentation: entry ? { value: hoverMarkdown(full, entry) } : undefined,
              sortText: '0' + sub,
              range,
            });
          }
        }
      }
      return { suggestions: out };
    },
  });

  // ── Hover ───────────────────────────────────────────────────────────
  monaco.languages.registerHoverProvider('redis', {
    provideHover: (model: MonacoType.editor.ITextModel, position: MonacoType.Position) => {
      const line = model.getLineContent(position.lineNumber);
      if (line.trimStart().startsWith('#')) return null;
      const tokens = splitArgs(line);
      if (tokens.length === 0) return null;
      const resolved = resolveCommand(tokens);
      if (!resolved) return null;
      // Only surface the hover when the cursor is over the command token(s).
      const wordInfo = model.getWordAtPosition(position);
      if (!wordInfo) return null;
      const hovered = wordInfo.word.toUpperCase();
      const firstTwo = resolved.name.split(' ');
      if (!firstTwo.includes(hovered) && resolved.name !== hovered) return null;
      return {
        contents: [{ value: hoverMarkdown(resolved.name, resolved.entry) }],
      };
    },
  });

  // ── Signature help ──────────────────────────────────────────────────
  monaco.languages.registerSignatureHelpProvider('redis', {
    signatureHelpTriggerCharacters: [' '],
    signatureHelpRetriggerCharacters: [' '],
    provideSignatureHelp: (model: MonacoType.editor.ITextModel, position: MonacoType.Position) => {
      const untilCursor = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      if (untilCursor.trimStart().startsWith('#')) return null;
      const tokens = splitArgs(untilCursor);
      const resolved = resolveCommand(tokens);
      if (!resolved || !resolved.entry.arguments || resolved.entry.arguments.length === 0) return null;

      const args = resolved.entry.arguments;
      const trailingSpace = /\s$/.test(untilCursor);
      // Args typed so far, excluding the command token(s).
      const typed = tokens.length - resolved.consumed;
      const argIdx = trailingSpace ? typed : Math.max(0, typed - 1);

      const parameters: MonacoType.languages.ParameterInformation[] = args.map((a) => ({
        label: argLabel(a),
      }));
      const label = `${resolved.name} ${parameters.map((p) => p.label).join(' ')}`;
      const sig: MonacoType.languages.SignatureInformation = {
        label,
        documentation: { value: resolved.entry.summary },
        parameters,
      };
      return {
        value: {
          signatures: [sig],
          activeSignature: 0,
          activeParameter: Math.min(argIdx, parameters.length - 1),
        },
        dispose: () => {},
      };
    },
  });

  // ── Arity diagnostics (debounced per model) ─────────────────────────
  const hooked = new WeakSet<MonacoType.editor.ITextModel>();
  const timers = new WeakMap<MonacoType.editor.ITextModel, ReturnType<typeof setTimeout>>();

  const validate = (model: MonacoType.editor.ITextModel) => {
    const diags: MonacoType.editor.IMarkerData[] = [];
    const total = model.getLineCount();
    for (let ln = 1; ln <= total; ln++) {
      const raw = model.getLineContent(ln);
      const line = raw.replace(/#.*$/, '');
      if (!line.trim()) continue;
      const tokens = splitArgs(line);
      if (tokens.length === 0) continue;
      const first = tokens[0];
      const resolved = resolveCommand(tokens);
      const firstStart = raw.indexOf(first) + 1;
      const lineEnd = raw.length + 1;
      if (!resolved) {
        if (/^[a-zA-Z][\w-]*$/.test(first)) {
          diags.push({
            severity: monaco.MarkerSeverity.Warning,
            message: `Unknown Redis command "${first.toUpperCase()}".`,
            startLineNumber: ln,
            startColumn: firstStart,
            endLineNumber: ln,
            endColumn: firstStart + first.length,
          });
        }
        continue;
      }
      const { name, entry } = resolved;
      const n = tokens.length;
      const arity = entry.arity;
      const bad = arity >= 0 ? n !== arity : n < Math.abs(arity);
      if (bad) {
        const need = arity >= 0 ? `exactly ${arity - resolved.consumed}` : `at least ${Math.abs(arity) - resolved.consumed}`;
        diags.push({
          severity: monaco.MarkerSeverity.Error,
          message: `${name} expects ${need} argument(s).`,
          startLineNumber: ln,
          startColumn: firstStart,
          endLineNumber: ln,
          endColumn: lineEnd,
        });
      }
    }
    setMarkers(monaco, model, 'redis-arity', diags);
  };

  const schedule = (model: MonacoType.editor.ITextModel) => {
    const prev = timers.get(model);
    if (prev) clearTimeout(prev);
    timers.set(model, setTimeout(() => validate(model), 300));
  };

  const hook = (model: MonacoType.editor.ITextModel) => {
    if (hooked.has(model)) return;
    hooked.add(model);
    model.onDidChangeContent(() => schedule(model));
    validate(model);
  };

  for (const m of monaco.editor.getModels()) {
    if (m.getLanguageId() === 'redis') hook(m);
  }
  monaco.editor.onDidCreateModel((m: MonacoType.editor.ITextModel) => {
    if (m.getLanguageId() === 'redis') hook(m);
  });
  monaco.editor.onDidChangeModelLanguage((e: { model: MonacoType.editor.ITextModel }) => {
    if (e.model.getLanguageId() === 'redis') hook(e.model);
  });
}
