import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ExtractToEnvDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  responseBody: string | undefined;
  onInsert: (snippet: string) => void;
}

type PathRow = { path: string; preview: string };

function flatten(value: unknown, prefix = '', out: PathRow[] = [], depth = 0): PathRow[] {
  if (depth > 6) return out;
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    out.push({ path: prefix || '(array)', preview: `Array(${value.length})` });
    value.slice(0, 20).forEach((item, i) => {
      const nextPath = `${prefix}[${i}]`;
      if (item !== null && typeof item === 'object') {
        flatten(item, nextPath, out, depth + 1);
      } else {
        out.push({ path: nextPath, preview: formatPreview(item) });
      }
    });
    return out;
  }
  if (typeof value === 'object') {
    if (prefix) out.push({ path: prefix, preview: 'Object' });
    Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
      const nextPath = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === 'object') {
        flatten(v, nextPath, out, depth + 1);
      } else {
        out.push({ path: nextPath, preview: formatPreview(v) });
      }
    });
    return out;
  }
  out.push({ path: prefix, preview: formatPreview(value) });
  return out;
}

function formatPreview(v: unknown): string {
  if (typeof v === 'string') return v.length > 40 ? `"${v.slice(0, 40)}…"` : `"${v}"`;
  if (v === null) return 'null';
  return String(v);
}

function suggestEnvName(path: string): string {
  const last = path.split(/[.[\]]/).filter(Boolean).pop() || 'value';
  return last.replace(/[^a-zA-Z0-9_]/g, '_');
}

function buildSnippet(path: string, envName: string): string {
  const accessor = path.startsWith('[') ? `pm.response.json()${path}` : `pm.response.json().${path}`;
  return `pm.test("Save ${envName}", function () {\n  const value = ${accessor};\n  pm.environment.set("${envName}", value);\n});\n`;
}

export function ExtractToEnvDialog({ open, onOpenChange, responseBody, onInsert }: ExtractToEnvDialogProps) {
  const { t } = useTranslation('request');
  const [selectedPath, setSelectedPath] = useState('');
  const [envName, setEnvName] = useState('');

  const { paths, parseError } = useMemo(() => {
    if (!responseBody) return { paths: [] as PathRow[], parseError: t('extract.noResponse') };
    try {
      const parsed = JSON.parse(responseBody);
      return { paths: flatten(parsed), parseError: null as string | null };
    } catch {
      return { paths: [] as PathRow[], parseError: t('extract.invalidJson') };
    }
  }, [responseBody, t]);

  function handlePick(path: string) {
    setSelectedPath(path);
    setEnvName(suggestEnvName(path));
  }

  function handleInsert() {
    if (!selectedPath || !envName) return;
    onInsert(buildSnippet(selectedPath, envName));
    onOpenChange(false);
    setSelectedPath('');
    setEnvName('');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('extract.title')}</DialogTitle>
          <DialogDescription>
            {t('extract.description')}
          </DialogDescription>
        </DialogHeader>

        {parseError ? (
          <p className="text-xs text-muted-foreground py-4 shrink-0">{parseError}</p>
        ) : (
          <ScrollArea className="h-[50vh] border rounded-md">
            <div className="divide-y text-xs font-mono">
              {paths.map((row) => (
                <button
                  key={row.path}
                  type="button"
                  onClick={() => handlePick(row.path)}
                  className={`w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-3 min-w-0 ${
                    selectedPath === row.path ? 'bg-muted' : ''
                  }`}
                >
                  <span className="flex-1 min-w-0 truncate">{row.path}</span>
                  <span className="text-muted-foreground truncate max-w-[50%] shrink-0">{row.preview}</span>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}

        <div className="grid grid-cols-2 gap-3 pt-2 shrink-0">
          <div className="space-y-1.5">
            <Label className="text-xs">{t('extract.jsonPath')}</Label>
            <Input
              value={selectedPath}
              onChange={(e) => setSelectedPath(e.target.value)}
              placeholder={t('extract.jsonPathPlaceholder')}
              className="h-8 text-xs font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t('extract.envName')}</Label>
            <Input
              value={envName}
              onChange={(e) => setEnvName(e.target.value)}
              placeholder={t('extract.envNamePlaceholder')}
              className="h-8 text-xs font-mono"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 shrink-0">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button
            size="sm"
            disabled={!selectedPath || !envName}
            onClick={handleInsert}
          >
            {t('actions.insertSnippet')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
