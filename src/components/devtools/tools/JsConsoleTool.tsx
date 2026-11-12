import { useCallback, useEffect, useRef, useState } from 'react';
import { CodeEditor } from '@/components/ui/CodeEditor';
import { Play, Trash2, Square, Loader2, TerminalSquare, Variable, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useThemeStore } from '@/stores/themeStore';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ---- collapsible JSON tree for the Variables panel ------------------------

function CollapsibleNode({ kind, value, depth }: { kind: 'array' | 'object'; value: unknown; depth: number }) {
  const entries: [string, unknown][] = kind === 'array'
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  const [open, setOpen] = useState(depth === 0);
  if (entries.length === 0) {
    return <span className="text-muted-foreground">{kind === 'array' ? '[]' : '{}'}</span>;
  }
  const summary = kind === 'array' ? `Array(${entries.length})` : `{${entries.length}}`;
  return (
    <span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-0.5 align-middle text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
        {!open && <span>{summary}</span>}
      </button>
      {open && (
        <div className="ml-1.5 border-l border-border/60 pl-2.5">
          {entries.map(([k, v]) => (
            <div key={k} className="flex gap-1.5">
              <span className="shrink-0 text-sky-600 dark:text-sky-400">{k}:</span>
              <ValueView value={v} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

function ValueView({ value, depth }: { value: unknown; depth: number }) {
  if (value === null) return <span className="text-muted-foreground">null</span>;
  const t = typeof value;
  if (t === 'string') return <span className="text-emerald-600 dark:text-emerald-400 break-all">"{value as string}"</span>;
  if (t === 'number') return <span className="text-amber-600 dark:text-amber-400">{String(value)}</span>;
  if (t === 'boolean') return <span className="text-violet-600 dark:text-violet-400">{String(value)}</span>;
  if (Array.isArray(value)) return <CollapsibleNode kind="array" value={value} depth={depth} />;
  if (t === 'object') return <CollapsibleNode kind="object" value={value} depth={depth} />;
  return <span className="break-all">{String(value)}</span>;
}

// The worker (jsConsole.worker.ts) runs user code off the main thread: it can't
// touch the DOM or freeze the UI, and a runaway script is terminated on
// timeout. console.* calls, the completion value, and the top-level variables
// are posted back as pre-formatted strings.

const SAMPLE = `// JS scratchpad — runs in a sandboxed Web Worker (no DOM access).
// Print with console.log(...). Top-level await is supported.
// Declared variables show in the Variables panel — handy for spotting a
// value you accidentally overwrote.

let total = 0;
const orders = [
  { id: 1, total: 240, status: "paid" },
  { id: 2, total: 90,  status: "pending" },
  { id: 3, total: 500, status: "paid" },
];

for (const o of orders) total += o.total; // total = 830 (all orders)

// oops, reassigned — the Variables panel makes this easy to catch:
total = orders.filter(o => o.status === "paid").reduce((s, o) => s + o.total, 0);

console.log("paid revenue:", total);

await new Promise(r => setTimeout(r, 30));
console.log("done ✔");
`;

const TIMEOUT_MS = 5000;

type Level = 'log' | 'info' | 'warn' | 'error' | 'result';
interface Entry {
  level: Level;
  text: string;
}
interface VarEntry {
  name: string;
  value: unknown;
}

const LEVEL_CLASS: Record<Level, string> = {
  log: 'text-foreground',
  info: 'text-sky-600 dark:text-sky-400',
  warn: 'text-amber-600 dark:text-amber-400',
  error: 'text-red-600 dark:text-red-400',
  result: 'text-emerald-600 dark:text-emerald-400',
};

export function JsConsoleTool() {
  const { t } = useTranslation('devtools');
  const { theme } = useThemeStore();
  const [code, setCode] = useState(SAMPLE);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [vars, setVars] = useState<VarEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [varsWidth, setVarsWidth] = useState(300);

  const outputRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);

  const startVarsResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const rect = outputRef.current?.getBoundingClientRect();
      if (!rect) return;
      const max = Math.max(200, rect.width - 220);
      setVarsWidth(Math.min(Math.max(rect.right - ev.clientX, 180), max));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeRef = useRef(code);
  codeRef.current = code;

  const teardown = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    teardown();
    setRunning(false);
    setEntries((prev) => [...prev, { level: 'warn', text: t('jsConsole.stopped') }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teardown]);

  const run = useCallback(() => {
    teardown();
    setEntries([]);
    setVars([]);
    setRunning(true);
    const worker = new Worker(new URL('./jsConsole.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as { type: string; level?: Level; text?: string; vars?: VarEntry[] };
      if (msg.type === 'log') {
        setEntries((prev) => [...prev, { level: (msg.level as Level) ?? 'log', text: msg.text ?? '' }]);
      } else if (msg.type === 'result') {
        setEntries((prev) => [...prev, { level: 'result', text: msg.text ?? '' }]);
      } else if (msg.type === 'vars') {
        setVars(msg.vars ?? []);
      } else if (msg.type === 'done') {
        teardown();
        setRunning(false);
      }
    };
    worker.onerror = (err) => {
      setEntries((prev) => [...prev, { level: 'error', text: err.message || t('jsConsole.workerError') }]);
      teardown();
      setRunning(false);
    };

    timeoutRef.current = setTimeout(() => {
      setEntries((prev) => [...prev, { level: 'error', text: t('jsConsole.timedOut', { seconds: TIMEOUT_MS / 1000 }) }]);
      teardown();
      setRunning(false);
    }, TIMEOUT_MS);

    worker.postMessage({ code: codeRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teardown]);

  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    return () => {
      teardown();
    };
  }, [teardown]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b px-3 py-2 shrink-0">
        {running ? (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={stop}>
            <Square className="h-3.5 w-3.5" /> {t('jsConsole.stop')}
          </Button>
        ) : (
          <Button size="sm" className="h-7 text-xs" onClick={run}>
            <Play className="h-3.5 w-3.5" /> {t('actions.run')}
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEntries([]); setVars([]); }} disabled={!entries.length && !vars.length}>
          <Trash2 className="h-3.5 w-3.5" /> {t('actions.clear')}
        </Button>
        {running && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <span className="ml-auto text-[10px] text-muted-foreground font-mono">{t('jsConsole.runHint')}</span>
      </div>

      {/* Editor */}
      <div className="min-h-0 flex-[3]">
        <CodeEditor
          height="100%"
          language="javascript"
          theme={theme === 'dark' ? 'vs-dark' : 'light'}
          value={code}
          onChange={(v) => setCode(v ?? '')}
          onMount={(editor, monaco) => {
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
          }}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            padding: { top: 8 },
          }}
        />
      </div>

      {/* Output: console + resizable variables */}
      <div ref={outputRef} className="min-h-0 flex-[2] border-t flex">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b bg-muted/30 shrink-0">
            <TerminalSquare className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">{t('jsConsole.console')}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-3 font-mono text-xs space-y-0.5">
            {entries.length === 0 ? (
              <span className="text-muted-foreground">{t('jsConsole.consoleEmpty')}</span>
            ) : (
              entries.map((e, i) => (
                <div key={i} className={cn('whitespace-pre-wrap break-all', LEVEL_CLASS[e.level])}>
                  {e.level === 'result' && <span className="text-muted-foreground select-none">⟵ </span>}
                  {e.text}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Drag handle */}
        <div
          onMouseDown={startVarsResize}
          className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/50 transition-colors"
          title={t('jsConsole.dragResize')}
        />

        <div className="shrink-0 flex flex-col" style={{ width: varsWidth }}>
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b bg-muted/30 shrink-0">
            <Variable className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">{t('jsConsole.variables')}</span>
            {vars.length > 0 && <span className="ml-auto text-[10px] text-muted-foreground">{vars.length}</span>}
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-2 font-mono text-xs space-y-1">
            {vars.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">{t('jsConsole.varsEmpty')}</span>
            ) : (
              vars.map((v) => (
                <div key={v.name} className="leading-snug break-all">
                  <span className="text-violet-600 dark:text-violet-400">{v.name}</span>
                  <span className="text-muted-foreground"> = </span>
                  <ValueView value={v.value} depth={0} />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
