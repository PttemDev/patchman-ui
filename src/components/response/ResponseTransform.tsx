import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeEditor } from '@/components/ui/CodeEditor';
import { Copy, Check, AlertTriangle, Loader2, BookOpen, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useThemeStore } from '@/stores/themeStore';
import { useResponsePrefsStore } from '@/stores/responsePrefsStore';
import { cn } from '@/lib/utils';
import { runJmespath, runJsonpath, type TransformEngine } from '@/lib/transformEngines';

interface ResponseTransformProps {
  body: string;
}

// jq is temporarily omitted: jq-web (0.6.2) auto-instantiates its WASM at
// import time from a fixed, non-injectable path that breaks under the bundler.
// Re-add once integrated via a bundler-friendly build.
const ENGINES: { id: TransformEngine; label: string; seed: string; docUrl: string }[] = [
  { id: 'jmespath', label: 'JMESPath', seed: '@', docUrl: 'https://jmespath.org/' },
  { id: 'jsonpath', label: 'JSONPath', seed: '$', docUrl: 'https://github.com/JSONPath-Plus/JSONPath' },
];

interface Example {
  q: string;
  // d is a translation key suffix under response:cheat.<engine>.<d>; the query
  // expression `q` is a literal example value and stays untranslated.
  d: string;
}
const CHEATSHEET: Record<TransformEngine, Example[]> = {
  jmespath: [
    { q: '@', d: 'whole' },
    { q: 'data.items', d: 'nested' },
    { q: 'data.items[0]', d: 'first' },
    { q: 'data.items[*].OrderNumber', d: 'pluck' },
    { q: "data.items[?Status=='TeslimEdildi'].OrderNumber", d: 'filterPluck' },
    { q: 'length(data.items)', d: 'count' },
    { q: 'data.items[*].{id: OrderLineId, status: Status}', d: 'reshape' },
  ],
  jq: [
    { q: '.', d: 'identity' },
    { q: '.data.items[0]', d: 'first' },
    { q: '.data.items[].OrderNumber', d: 'stream' },
    { q: '.data.items | map(.OrderNumber)', d: 'map' },
    { q: '.data.items | map(select(.Status == "TeslimEdildi"))', d: 'filter' },
    { q: '.data.items | length', d: 'count' },
    { q: '.data.items | group_by(.Status) | map({status: .[0].Status, n: length})', d: 'group' },
  ],
  jsonpath: [
    { q: '$', d: 'root' },
    { q: '$.data.items[*]', d: 'all' },
    { q: '$.data.items[0]', d: 'first' },
    { q: '$.data.items[*].OrderNumber', d: 'pluck' },
    { q: "$.data.items[?(@.Status=='TeslimEdildi')]", d: 'filter' },
    { q: '$..CargoBarcodeNumber', d: 'recursive' },
  ],
};

// ResponseTransform runs a query language against the response JSON in a
// separate tab, without touching the original response. Purely client-side.
export function ResponseTransform({ body }: ResponseTransformProps) {
  const { t } = useTranslation('response');
  const { theme } = useThemeStore();
  // Engine + per-engine query live in a persisted store so they survive
  // request-tab switches and re-runs (the Transform stays "on the tab").
  const rawEngine = useResponsePrefsStore((s) => s.transformEngine);
  const setEngine = useResponsePrefsStore((s) => s.setTransformEngine);
  const queries = useResponsePrefsStore((s) => s.transformQueries);
  const setTransformQuery = useResponsePrefsStore((s) => s.setTransformQuery);
  // jq isn't selectable right now — normalize a stale persisted 'jq' so the
  // run effect never reaches the jq path (which would import the broken engine).
  const engine: TransformEngine = rawEngine === 'jq' ? 'jmespath' : rawEngine;
  useEffect(() => {
    if (rawEngine === 'jq') setEngine('jmespath');
  }, [rawEngine, setEngine]);
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showCheat, setShowCheat] = useState(false);

  const query = queries[engine];
  const setQuery = (q: string) => setTransformQuery(engine, q);

  // Parse the response body once. If it isn't JSON, all engines are disabled.
  const parsed = useMemo(() => {
    try {
      return { data: JSON.parse(body) as unknown, ok: true as const };
    } catch {
      return { data: undefined, ok: false as const };
    }
  }, [body]);

  useEffect(() => {
    if (!parsed.ok) {
      setError(t('response:transform.notJson'));
      setOutput('');
      return;
    }
    if (!query.trim()) {
      setOutput('');
      setError(null);
      return;
    }
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const out = engine === 'jmespath' ? runJmespath(parsed.data, query) : runJsonpath(parsed.data, query);
        if (!cancelled) {
          setOutput(out);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setOutput('');
        }
      } finally {
        if (!cancelled) setRunning(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engine, query, parsed, t]);

  const copy = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const loadExample = (e: TransformEngine, q: string) => {
    setEngine(e);
    setTransformQuery(e, q);
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      {/* Cheatsheet toggle (front + prominent) + engine picker + actions */}
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <Button
          size="sm"
          variant={showCheat ? 'default' : 'outline'}
          className="h-7 text-xs"
          onClick={() => setShowCheat((v) => !v)}
        >
          <BookOpen className="h-3.5 w-3.5" /> {t('response:transform.cheatsheet')}
        </Button>
        <div className="flex rounded-md border overflow-hidden text-xs">
          {ENGINES.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setEngine(e.id)}
              className={cn(
                'px-2.5 py-1 transition-colors',
                engine === e.id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
              )}
            >
              {e.label}
            </button>
          ))}
        </div>
        {running && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <span className="hidden md:inline text-[10px] text-muted-foreground">{t('response:transform.readsHint')}</span>
        <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={copy} disabled={!output}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* Cheatsheet (per-engine examples) — right under the toolbar so it's
          quick to open and pick an expression before typing. */}
      {showCheat && (
        <div className="shrink-0 rounded-md border bg-muted/20 p-2 text-xs max-h-56 overflow-auto space-y-3">
          {ENGINES.map((e) => (
            <div key={e.id} className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{e.label}</span>
                <a href={e.docUrl} target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground hover:text-foreground underline">
                  {t('response:transform.docs')} ↗
                </a>
              </div>
              {CHEATSHEET[e.id].map((ex) => (
                <button
                  key={ex.q}
                  type="button"
                  onClick={() => loadExample(e.id, ex.q)}
                  className="w-full text-left rounded px-1.5 py-1 hover:bg-accent flex items-baseline gap-2"
                  title={t('response:transform.useExpression')}
                >
                  <ChevronRight className="h-3 w-3 shrink-0 self-center text-muted-foreground" />
                  <code className="font-mono text-[11px] text-foreground break-all">{ex.q}</code>
                  <span className="text-[10px] text-muted-foreground ml-auto shrink-0 hidden sm:block">{t(`response:cheat.${e.id}.${ex.d}`)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Query input */}
      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={ENGINES.find((e) => e.id === engine)?.seed}
        spellCheck={false}
        className="shrink-0 h-16 rounded-md border bg-transparent p-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring resize-none break-all"
      />

      {/* Output */}
      <div className="flex-1 min-h-0 flex flex-col">
        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="break-words whitespace-pre-wrap">{error}</span>
          </div>
        ) : output ? (
          <div className="flex-1 min-h-0 border rounded-md overflow-hidden">
            <CodeEditor
              height="100%"
              // JMESPath/JSONPath emit JSON; jq's raw output may be bare
              // scalars/text, so fall back to plaintext when it doesn't look
              // like JSON.
              language={/^\s*[[{]/.test(output) ? 'json' : 'plaintext'}
              theme={theme === 'dark' ? 'vs-dark' : 'light'}
              value={output}
              options={{
                readOnly: true,
                domReadOnly: true,
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                tabSize: 2,
                automaticLayout: true,
                padding: { top: 8 },
              }}
            />
          </div>
        ) : (
          <div className="flex-1 min-h-0 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            {t('response:transform.resultPlaceholder')}
          </div>
        )}
      </div>
    </div>
  );
}
