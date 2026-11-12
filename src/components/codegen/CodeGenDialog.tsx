import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check } from 'lucide-react';
import { CodeEditor } from '@/components/ui/CodeEditor';
import { useThemeStore } from '@/stores/themeStore';
import { useEnvironmentStore } from '@/stores/environmentStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { generateCode, type CodegenLanguage } from '@/lib/codegen';
import { substituteEnvVars } from '@/lib/envSubstitute';
import type { Tab, KeyValue, Environment } from '@/types';

interface CodeGenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: Tab;
}

const languages: { id: CodegenLanguage; label: string; lang: string }[] = [
  { id: 'curl', label: 'cURL', lang: 'shell' },
  { id: 'javascript_fetch', label: 'JavaScript - Fetch', lang: 'javascript' },
  { id: 'javascript_axios', label: 'JavaScript - Axios', lang: 'javascript' },
  { id: 'python_requests', label: 'Python - Requests', lang: 'python' },
  { id: 'go', label: 'Go', lang: 'go' },
  { id: 'java', label: 'Java - HttpClient', lang: 'java' },
  { id: 'csharp', label: 'C# - HttpClient', lang: 'csharp' },
  { id: 'php_curl', label: 'PHP - cURL', lang: 'php' },
  { id: 'ruby', label: 'Ruby - Net::HTTP', lang: 'ruby' },
  { id: 'swift', label: 'Swift - URLSession', lang: 'swift' },
  { id: 'kotlin', label: 'Kotlin - OkHttp', lang: 'kotlin' },
  { id: 'rust', label: 'Rust - reqwest', lang: 'rust' },
  { id: 'dart', label: 'Dart - http', lang: 'dart' },
];

function kvToMap(items: KeyValue[], env: Environment | null): Record<string, string> {
  const out: Record<string, string> = {};
  items.forEach((it) => {
    if (it.enabled && it.key) {
      out[substituteEnvVars(it.key, env)] = substituteEnvVars(it.value, env);
    }
  });
  return out;
}

export function codeFromTab(tab: Tab, language: CodegenLanguage, env: Environment | null): string {
  const sub = (s: string | undefined) => (s === undefined ? undefined : substituteEnvVars(s, env));
  const subAuth: Tab['auth'] = {
    ...tab.auth,
    token: sub(tab.auth.token),
    username: sub(tab.auth.username),
    password: sub(tab.auth.password),
    value: sub(tab.auth.value),
    key: sub(tab.auth.key),
  };
  // Mirror requestStore's scheme prepending — the URL bar lets the user
  // omit the scheme and falls back to tab.protocol (default https://).
  // Without this, generated curl would emit a schemeless URL that won't
  // parse and breaks paste-and-run.
  let substitutedUrl = substituteEnvVars(tab.url, env);
  // Replace single-brace path params {name} with their entered values, mirroring
  // requestStore's send path. Without this, generated code (curl et al.) would
  // emit the literal {name} placeholder instead of the value. Env vars are
  // substituted first (above), so only single-brace path params remain here.
  (tab.pathParams ?? []).forEach((pp) => {
    if (pp.enabled && pp.key && pp.value) {
      substitutedUrl = substitutedUrl.replace(
        new RegExp(`\\{${pp.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g'),
        substituteEnvVars(pp.value, env),
      );
    }
  });
  const fullUrl = /^https?:\/\//i.test(substitutedUrl)
    ? substitutedUrl
    : (tab.protocol || 'https://') + substitutedUrl;
  return generateCode(
    {
      method: tab.method,
      url: fullUrl,
      headers: kvToMap(tab.headers, env),
      params: kvToMap(tab.params, env),
      body: { ...tab.body, content: substituteEnvVars(tab.body?.content ?? '', env) },
      auth: subAuth,
    },
    language,
  );
}

export function CodeGenDialog({ open, onOpenChange, tab }: CodeGenDialogProps) {
  const { t } = useTranslation('codegen');
  const { theme } = useThemeStore();
  const activeEnv = useEnvironmentStore((s) => s.activeEnvironment);
  const [selectedLang, setSelectedLang] = useState<CodegenLanguage>('curl');
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState('');

  useEffect(() => {
    setCode(codeFromTab(tab, selectedLang, activeEnv));
  }, [tab, selectedLang, activeEnv]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const currentLang = languages.find((l) => l.id === selectedLang);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {t('description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-4 h-[450px]">
          {/* Language selector */}
          <div className="w-48 border-r pr-3 shrink-0">
            <ScrollArea className="h-full">
              <div className="space-y-0.5">
                {languages.map((lang) => (
                  <button
                    key={lang.id}
                    onClick={() => setSelectedLang(lang.id)}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded-md text-sm transition-colors cursor-pointer',
                      selectedLang === lang.id
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent'
                    )}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Code output */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">
                {currentLang?.label}
              </span>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCopy}>
                {copied ? (
                  <Check className="h-3 w-3 mr-1" />
                ) : (
                  <Copy className="h-3 w-3 mr-1" />
                )}
                {copied ? t('common:copied') : t('common:copy')}
              </Button>
            </div>
            <div className="flex-1 border rounded-md overflow-hidden">
              <CodeEditor
                height="100%"
                language={currentLang?.lang || 'plaintext'}
                theme={theme === 'dark' ? 'vs-dark' : 'light'}
                value={code}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  tabSize: 2,
                  automaticLayout: true,
                  padding: { top: 8 },
                  domReadOnly: true,
                }}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
