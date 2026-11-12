import { useMemo, useState } from 'react';
import { CodeEditor } from '@/components/ui/CodeEditor';
import { Copy, Check, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useThemeStore } from '@/stores/themeStore';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { SNIPPETS, type Recipe } from '../snippets';

const MONACO_LANG: Record<string, string> = {
  Go: 'go',
  TypeScript: 'typescript',
  JavaScript: 'javascript',
  Python: 'python',
  'C#': 'csharp',
};

const ALL_RECIPES: Recipe[] = SNIPPETS.flatMap((c) => c.recipes);

export function SnippetsTool() {
  const { t } = useTranslation('devtools');
  const { theme } = useThemeStore();
  const { toast } = useToast();
  const [recipeId, setRecipeId] = useState(ALL_RECIPES[0]?.id ?? '');
  const [lang, setLang] = useState('Go');
  const [copied, setCopied] = useState(false);

  const recipe = useMemo(() => ALL_RECIPES.find((r) => r.id === recipeId) ?? ALL_RECIPES[0], [recipeId]);
  const snippet = useMemo(
    () => recipe?.langs.find((l) => l.lang === lang) ?? recipe?.langs[0],
    [recipe, lang]
  );

  const selectRecipe = (r: Recipe) => {
    setRecipeId(r.id);
    // Keep the current language if the new recipe has it, else fall back.
    if (!r.langs.some((l) => l.lang === lang)) setLang(r.langs[0].lang);
  };

  const copy = async () => {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet.code);
      setCopied(true);
      toast({ title: t('snippets.copied') });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: t('copy.failed'), variant: 'destructive' });
    }
  };

  const editorHeight = useMemo(() => {
    const lines = snippet ? snippet.code.split('\n').length : 1;
    return Math.min(Math.max(lines * 19 + 20, 140), 620);
  }, [snippet]);

  return (
    <div className="flex min-h-0 h-full">
      {/* Recipe navigation */}
      <div className="w-56 shrink-0 border-r overflow-y-auto p-2 space-y-3">
        {SNIPPETS.map((cat) => (
          <div key={cat.id} className="space-y-0.5">
            <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">{t(`snippetsLib.cat.${cat.id}`)}</p>
            {cat.recipes.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => selectRecipe(r)}
                className={cn(
                  'w-full text-left rounded-md px-2 py-1.5 text-xs transition-colors',
                  r.id === recipe?.id ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent/60'
                )}
              >
                {t(`snippetsLib.${r.id}.title`)}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Recipe detail */}
      <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-3">
        {recipe && (
          <>
            <h2 className="text-sm font-semibold">{t(`snippetsLib.${recipe.id}.title`)}</h2>

            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span><span className="font-semibold">{t('snippets.commonMistake')}</span> {t(`snippetsLib.${recipe.id}.pitfall`)}</span>
            </div>

            <div className="flex items-center gap-1.5">
              {recipe.langs.map((l) => (
                <button
                  key={l.lang}
                  type="button"
                  onClick={() => setLang(l.lang)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs transition-colors',
                    (snippet?.lang === l.lang)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70'
                  )}
                >
                  {l.lang}
                </button>
              ))}
              <Button size="sm" variant="outline" className="h-7 text-xs ml-auto" onClick={copy}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {t('common:copy')}
              </Button>
            </div>

            {snippet && (
              <div className="rounded-md border overflow-hidden">
                <CodeEditor
                  height={editorHeight}
                  language={MONACO_LANG[snippet.lang] ?? 'plaintext'}
                  theme={theme === 'dark' ? 'vs-dark' : 'light'}
                  value={snippet.code}
                  options={{
                    readOnly: true,
                    domReadOnly: true,
                    minimap: { enabled: false },
                    fontSize: 13,
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    automaticLayout: true,
                    folding: false,
                    lineNumbers: 'on',
                    renderLineHighlight: 'none',
                    padding: { top: 8, bottom: 8 },
                    scrollbar: { alwaysConsumeMouseWheel: false },
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
