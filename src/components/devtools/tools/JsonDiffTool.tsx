import { useCallback, useRef, useState } from 'react';
import { CodeDiffEditor } from '@/components/ui/CodeEditor';
import { AlignLeft, ArrowLeftRight, Trash2, AlertTriangle } from 'lucide-react';
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
  const diffRef = useRef<any>(null);
  const [original, setOriginal] = useState(SEED_ORIGINAL);
  const [modified, setModified] = useState(SEED_MODIFIED);
  const [ignoreWs, setIgnoreWs] = useState(false);
  const [validOriginal, setValidOriginal] = useState(true);
  const [validModified, setValidModified] = useState(true);

  const handleMount = useCallback((editor: any) => {
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
  }, []);

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
        <div className="flex items-center gap-2 ml-auto">
          <Label htmlFor="ignore-ws" className="text-xs text-muted-foreground cursor-pointer">
            {t('jsonDiff.ignoreWhitespace')}
          </Label>
          <Switch id="ignore-ws" checked={ignoreWs} onCheckedChange={setIgnoreWs} />
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground shrink-0 px-1">
        <span>{t('jsonDiff.original')}</span>
        <span>{t('jsonDiff.modified')}</span>
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
            renderSideBySide: true,
            ignoreTrimWhitespace: ignoreWs,
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
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
