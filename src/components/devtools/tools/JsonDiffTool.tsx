import { useCallback, useRef, useState } from 'react';
import { CodeDiffEditor } from '@/components/ui/CodeEditor';
import { AlignLeft, ArrowLeftRight, Trash2, AlertTriangle, ChevronUp, ChevronDown, Copy, MinusCircle, PlusCircle, CheckCircle2 } from 'lucide-react';
import type * as Monaco from 'monaco-editor';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useThemeStore } from '@/stores/themeStore';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

const SEED_ORIGINAL = `{
  "name": "getman",
  "version": "1.0.0",
  "features": ["diff", "jwt"],
  "beta": false
}`;

const SEED_MODIFIED = `{
  "name": "getman",
  "version": "1.1.0",
  "features": ["diff", "jwt", "base64"],
  "beta": true
}`;

// isValidJson treats empty as valid so the "not JSON" hint only shows for
// non-empty, genuinely malformed input.
function isValidJson(s: string): boolean {
  if (!s.trim()) return true;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

// Counts lines the way a diff viewer does (a trailing newline isn't a line).
function lineCount(s: string): number {
  if (!s) return 0;
  const n = s.split('\n').length;
  return s.endsWith('\n') ? n - 1 : n;
}

interface LineChange { originalStartLineNumber: number; originalEndLineNumber: number; modifiedStartLineNumber: number; modifiedEndLineNumber: number }

// Removed / added line totals from Monaco's line changes (an end of 0 means
// that side has no lines in the change).
function diffStats(changes: LineChange[]): { removed: number; added: number } {
  let removed = 0;
  let added = 0;
  for (const c of changes) {
    if (c.originalEndLineNumber > 0) removed += c.originalEndLineNumber - c.originalStartLineNumber + 1;
    if (c.modifiedEndLineNumber > 0) added += c.modifiedEndLineNumber - c.modifiedStartLineNumber + 1;
  }
  return { removed, added };
}

function tryFormat(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

// JsonDiffTool is a git-style side-by-side JSON/text diff built on Monaco's
// DiffEditor. Both panes are editable. Toolbar actions read the live editor
// content (via getOriginalEditor/getModifiedEditor) and drive the panes
// imperatively — state only mirrors so re-renders never clobber typed text.
export function JsonDiffTool() {
  const { t } = useTranslation('devtools');
  const { theme } = useThemeStore();
  const diffRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);
  const [original, setOriginal] = useState(SEED_ORIGINAL);
  const [modified, setModified] = useState(SEED_MODIFIED);
  const [ignoreWs, setIgnoreWs] = useState(false);
  const [validOriginal, setValidOriginal] = useState(true);
  const [validModified, setValidModified] = useState(true);
  const { toast } = useToast();
  const [sideBySide, setSideBySide] = useState(true);
  const [hideUnchanged, setHideUnchanged] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [stats, setStats] = useState({ removed: 0, added: 0, linesO: lineCount(SEED_ORIGINAL), linesM: lineCount(SEED_MODIFIED), computed: false });

  const handleMount = useCallback((editor: Monaco.editor.IStandaloneDiffEditor) => {
    diffRef.current = editor;
    const orig = editor.getOriginalEditor();
    const mod = editor.getModifiedEditor();
    const check = () => {
      setValidOriginal(isValidJson(orig.getValue()));
      setValidModified(isValidJson(mod.getValue()));
    };
    check();
    orig.onDidChangeModelContent(check);
    mod.onDidChangeModelContent(check);
    // Counts follow every recomputed diff (typing, swap, format, clear).
    const recount = () => {
      const { removed, added } = diffStats(editor.getLineChanges() ?? []);
      setStats({ removed, added, linesO: lineCount(orig.getValue()), linesM: lineCount(mod.getValue()), computed: true });
    };
    editor.onDidUpdateDiff(recount);
  }, []);

  const copySide = async (side: 'o' | 'm') => {
    const { o, m } = readLive();
    try {
      await navigator.clipboard.writeText(side === 'o' ? o : m);
      toast({ title: t('copy.toClipboard') });
    } catch {
      toast({ title: t('copy.failed'), variant: 'destructive' });
    }
  };

  const goToDiff = (target: 'next' | 'previous') => diffRef.current?.goToDiff(target);

  // apply drives both panes imperatively (source of truth) and mirrors to
  // state so the DiffEditor props stay consistent on future re-renders.
  const apply = useCallback((o: string, m: string) => {
    const ed = diffRef.current;
    if (ed) {
      ed.getOriginalEditor().setValue(o);
      ed.getModifiedEditor().setValue(m);
    }
    setOriginal(o);
    setModified(m);
    setValidOriginal(isValidJson(o));
    setValidModified(isValidJson(m));
  }, []);

  const readLive = (): { o: string; m: string } => {
    const ed = diffRef.current;
    if (!ed) return { o: original, m: modified };
    return { o: ed.getOriginalEditor().getValue(), m: ed.getModifiedEditor().getValue() };
  };

  const formatBoth = () => {
    const { o, m } = readLive();
    apply(tryFormat(o), tryFormat(m));
  };

  const swap = () => {
    const { o, m } = readLive();
    apply(m, o);
  };

  const clear = () => apply('', '');

  const bothValid = validOriginal && validModified;

  return (
    <div className="h-full flex flex-col p-4 gap-3 min-h-0">
      <div className="flex items-center flex-wrap gap-2 shrink-0">
        <Button size="sm" variant="outline" onClick={formatBoth}>
          <AlignLeft className="h-3.5 w-3.5" /> {t('jsonDiff.formatBoth')}
        </Button>
        <Button size="sm" variant="outline" onClick={swap}>
          <ArrowLeftRight className="h-3.5 w-3.5" /> {t('jsonDiff.swapSides')}
        </Button>
        <Button size="sm" variant="outline" onClick={clear}>
          <Trash2 className="h-3.5 w-3.5" /> {t('actions.clear')}
        </Button>
        <div className="flex items-center rounded-md border p-0.5" role="group" aria-label={t('jsonDiff.layout')}>
          {([['split', true], ['unified', false]] as const).map(([k, v]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSideBySide(v)}
              aria-pressed={sideBySide === v}
              className={cn('h-6 rounded px-2 text-xs', sideBySide === v ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {t(`jsonDiff.${k}`)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 ml-auto">
          {([
            ['ignore-ws', 'jsonDiff.ignoreWhitespace', ignoreWs, setIgnoreWs],
            ['hide-unchanged', 'jsonDiff.hideUnchanged', hideUnchanged, setHideUnchanged],
            ['wrap-lines', 'jsonDiff.wrap', wrap, setWrap],
          ] as const).map(([id, key, val, set]) => (
            <div key={id} className="flex items-center gap-2">
              <Label htmlFor={id} className="whitespace-nowrap text-xs text-muted-foreground cursor-pointer">{t(key)}</Label>
              <Switch id={id} checked={val} onCheckedChange={set} />
            </div>
          ))}
        </div>
      </div>

      {stats.computed && stats.removed === 0 && stats.added === 0 && (stats.linesO > 0 || stats.linesM > 0) && (
        <div className="flex items-center gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-700 dark:text-sky-300 shrink-0">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {t('jsonDiff.identical')}
        </div>
      )}

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground shrink-0 px-1">
        <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 min-w-0 whitespace-nowrap">
          <span className="font-medium text-foreground/80">{t('jsonDiff.original')}</span>
          <span className="flex items-center gap-1 text-red-600 dark:text-red-400"><MinusCircle className="h-3 w-3" />{t('jsonDiff.removals', { count: stats.removed })}</span>
          <span className="ml-auto">{t('jsonDiff.lines', { count: stats.linesO })}</span>
          <button type="button" onClick={() => void copySide('o')} className="flex items-center gap-1 hover:text-foreground"><Copy className="h-3 w-3" />{t('jsonDiff.copy')}</button>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button type="button" onClick={() => goToDiff('previous')} title={t('jsonDiff.prevChange')} aria-label={t('jsonDiff.prevChange')} className="rounded p-0.5 hover:bg-accent hover:text-foreground disabled:opacity-40" disabled={stats.removed + stats.added === 0}><ChevronUp className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => goToDiff('next')} title={t('jsonDiff.nextChange')} aria-label={t('jsonDiff.nextChange')} className="rounded p-0.5 hover:bg-accent hover:text-foreground disabled:opacity-40" disabled={stats.removed + stats.added === 0}><ChevronDown className="h-3.5 w-3.5" /></button>
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 min-w-0 whitespace-nowrap">
          <span className="font-medium text-foreground/80">{t('jsonDiff.modified')}</span>
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><PlusCircle className="h-3 w-3" />{t('jsonDiff.additions', { count: stats.added })}</span>
          <span className="ml-auto">{t('jsonDiff.lines', { count: stats.linesM })}</span>
          <button type="button" onClick={() => void copySide('m')} className="flex items-center gap-1 hover:text-foreground"><Copy className="h-3 w-3" />{t('jsonDiff.copy')}</button>
        </div>
      </div>

      <div className="border rounded-md overflow-hidden flex-1 min-h-0">
        <CodeDiffEditor
          height="100%"
          language="json"
          theme={theme === 'dark' ? 'vs-dark' : 'light'}
          original={original}
          modified={modified}
          onMount={handleMount}
          options={{
            originalEditable: true,
            readOnly: false,
            renderSideBySide: sideBySide,
            useInlineViewWhenSpaceIsLimited: false,
            hideUnchangedRegions: { enabled: hideUnchanged, contextLineCount: 3, minimumLineCount: 3, revealLineCount: 20 },
            ignoreTrimWhitespace: ignoreWs,
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
            wordWrap: wrap ? 'on' : 'off',
            diffWordWrap: wrap ? 'on' : 'off',
            automaticLayout: true,
            padding: { top: 8 },
          }}
        />
      </div>

      {!bothValid && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-400 shrink-0">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            {!validOriginal && !validModified
              ? t('jsonDiff.neitherValid')
              : !validOriginal
              ? t('jsonDiff.leftInvalid')
              : t('jsonDiff.rightInvalid')}{' '}
            {t('jsonDiff.diffingAsText')}
          </span>
        </div>
      )}
    </div>
  );
}
