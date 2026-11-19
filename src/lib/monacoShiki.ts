// VS Code-grade syntax colors for the Git code views, via Shiki (the TextMate
// grammars + Dark+/Light+ themes VS Code itself ships). Monaco's own Monarch
// grammars only color keywords / strings / comments; these also color
// function calls, types, fields, packages, parameters…
//
// Scoped on purpose (not @shikijs/monaco's shikiToMonaco, which patches the
// global monaco.editor.setTheme and would throw for every other editor's
// 'vs-dark' / 'light'):
//   • two extra themes, `pm-code-dark` / `pm-code-light`, that INHERIT from
//     vs-dark / vs so Monarch-tokenized languages look exactly as before;
//   • a grammar is loaded and its tokenizer installed only when a Git view
//     first shows a file in that language (lazy chunk per grammar);
//   • languages other tools rely on (JSON / SQL / YAML) are left on Monarch.
// Monaco is reached by a dynamic import of monacoBootstrap, so this module
// never pulls the ~10MB editor into the entry bundle.

import { useEffect, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import type { HighlighterCore, ThemeRegistrationResolved } from 'shiki/core';
import type { StateStack } from 'shiki/textmate';

export const CODE_THEME_DARK = 'pm-code-dark';
export const CODE_THEME_LIGHT = 'pm-code-light';
const SHIKI_DARK = 'dark-plus';
const SHIKI_LIGHT = 'light-plus';

// Monaco language id → Shiki grammar id, where they differ.
const ALIAS: Record<string, string> = {
  shell: 'shellscript', 'c++': 'cpp', protobuf: 'proto', restructuredtext: 'rst',
};
// Left on Monarch: other tools' editors (request bodies, DB console, K8s)
// share these ids, and their look should not change under them.
const SKIP = new Set(['plaintext', 'text', 'conflict', 'json', 'sql', 'mysql', 'pgsql', 'yaml']);

interface Ctx {
  monaco: typeof Monaco;
  hl: HighlighterCore;
  INITIAL: StateStack;
  /** rule token (a TextMate scope) by "color|fontStyle", per Shiki theme. */
  scopeByStyle: Record<string, Map<string, string>>;
  colorMap: string[];
  current: string;
}

let ctxPromise: Promise<Ctx> | null = null;
const loaded = new Map<string, Promise<boolean>>();

const norm = (c?: string) => (c ?? '').replace('#', '').toLowerCase().slice(0, 6);

function init(): Promise<Ctx> {
  ctxPromise ??= (async () => {
    const [{ monaco }, core, engine, tm, monacoAdapter, dark, light] = await Promise.all([
      // The bundled, configured instance (same lazy chunk the editors use).
      // NOT loader.init(): see monacoBootstrap.
      import('./monacoBootstrap'),
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('shiki/textmate'),
      import('@shikijs/monaco'),
      import('@shikijs/themes/dark-plus'),
      import('@shikijs/themes/light-plus'),
    ]);
    const hl = await core.createHighlighterCore({
      themes: [dark.default, light.default],
      langs: [],
      // Pure-JS regex engine: no WASM (CSP-friendly, works offline).
      engine: engine.createJavaScriptRegexEngine({ forgiving: true }),
    });
    const scopeByStyle: Ctx['scopeByStyle'] = {};
    for (const [shikiId, monacoId, base] of [[SHIKI_DARK, CODE_THEME_DARK, 'vs-dark'], [SHIKI_LIGHT, CODE_THEME_LIGHT, 'vs']] as const) {
      const theme = hl.getTheme(shikiId) as ThemeRegistrationResolved;
      // Same shape as Monaco's IStandaloneThemeData (its .d.ts types it loosely).
      const conv = monacoAdapter.textmateThemeToMonacoTheme(theme) as unknown as Monaco.editor.IStandaloneThemeData;
      // Inherit the stock theme: Monarch tokens keep today's colors, and the
      // editor chrome (background, gutter) stays as it is.
      monaco.editor.defineTheme(monacoId, { base, inherit: true, colors: {}, rules: conv.rules });
      const m = new Map<string, string>();
      for (const r of conv.rules) {
        const c = norm(r.foreground);
        if (!c) continue;
        const key = `${c}|${(r.fontStyle ?? '').trim()}`;
        if (!m.has(key)) m.set(key, r.token);
      }
      scopeByStyle[shikiId] = m;
    }
    const ctx: Ctx = { monaco, hl, INITIAL: tm.INITIAL, scopeByStyle, colorMap: [], current: '' };
    setMode(ctx, SHIKI_DARK);
    return ctx;
  })();
  return ctxPromise;
}

function setMode(ctx: Ctx, shikiTheme: string) {
  if (ctx.current === shikiTheme) return;
  ctx.colorMap = ctx.hl.setTheme(shikiTheme).colorMap;
  ctx.current = shikiTheme;
  // Tokens carry the scope picked for the old theme's colors: re-tokenize.
  for (const model of ctx.monaco.editor.getModels()) {
    (model as unknown as { tokenization?: { resetTokenization?: () => void } }).tokenization?.resetTokenization?.();
  }
}

const FONT_STYLES = ['italic', 'bold', 'underline', 'strikethrough'];
function fontStyleOf(bits: number) {
  return FONT_STYLES.filter((_, i) => bits & (1 << i)).join(' ');
}

class TokState implements Monaco.languages.IState {
  constructor(readonly stack: StateStack) {}
  clone() { return new TokState(this.stack); }
  equals(o: Monaco.languages.IState) { return o instanceof TokState && o.stack === this.stack; }
}

/** Load the Shiki grammar for a Monaco language id and install its tokenizer
 *  (once). Resolves false when Shiki has no grammar for it / it is skipped. */
export function ensureShikiLanguage(monacoId: string | undefined): Promise<boolean> {
  if (!monacoId || SKIP.has(monacoId)) return Promise.resolve(false);
  let p = loaded.get(monacoId);
  if (p) return p;
  p = (async () => {
    try {
      const ctx = await init();
      const { bundledLanguages } = await import('shiki/langs');
      const shikiId = ALIAS[monacoId] ?? monacoId;
      const lang = bundledLanguages[shikiId as keyof typeof bundledLanguages];
      if (!lang) return false;
      await ctx.hl.loadLanguage(lang);
      const grammar = ctx.hl.getLanguage(shikiId);
      ctx.monaco.languages.setTokensProvider(monacoId, {
        getInitialState: () => new TokState(ctx.INITIAL),
        tokenize(line, state) {
          const st = state as TokState;
          if (line.length > 20000) return { endState: st, tokens: [{ startIndex: 0, scopes: '' }] };
          const r = grammar.tokenizeLine2(line, st.stack, 500);
          const map = ctx.scopeByStyle[ctx.current];
          const tokens: Monaco.languages.IToken[] = [];
          for (let j = 0; j < r.tokens.length / 2; j++) {
            const meta = r.tokens[2 * j + 1];
            const color = norm(ctx.colorMap[(meta & 0x00ff8000) >>> 15]);
            const style = fontStyleOf((meta & 0x7800) >>> 11);
            tokens.push({ startIndex: r.tokens[2 * j], scopes: (color && (map.get(`${color}|${style}`) ?? map.get(`${color}|`))) || '' });
          }
          return { endState: new TokState(r.ruleStack), tokens };
        },
      });
      return true;
    } catch (e) {
      console.warn('shiki: falling back to Monarch for', monacoId, e);
      return false;
    }
  })();
  loaded.set(monacoId, p);
  return p;
}

/** Theme name for a Git code view: the Shiki-backed theme once its grammar is
 *  installed, else the stock theme (so the first paint never waits). */
export function useCodeTheme(dark: boolean, language?: string): string {
  const stock = dark ? 'vs-dark' : 'light';
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      const ctx = await init().catch(() => null);
      if (!ctx || !live) return;
      setMode(ctx, dark ? SHIKI_DARK : SHIKI_LIGHT);
      await ensureShikiLanguage(language);
      if (live) setReady(true);
    })();
    return () => { live = false; };
  }, [dark, language]);
  return ready ? (dark ? CODE_THEME_DARK : CODE_THEME_LIGHT) : stock;
}
