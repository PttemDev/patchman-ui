import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { colorizeJson } from './DBResultJSON';

interface DBJsonModalProps {
  open: boolean;
  onClose: () => void;
  value: unknown;
  /** Column name shown in the header. */
  colName?: string;
}

// looksLikeJson is a cheap pre-check so we only attempt JSON.parse on
// strings that plausibly are JSON (avoids treating "42" or "true" as JSON
// objects, and skips arbitrary log lines).
function looksLikeJson(s: string): boolean {
  const t = s.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

// deepParse walks a parsed structure and, when `deep` is on, recursively
// parses string values that are themselves JSON — the common shape for
// log payloads where a field like `body` holds a serialized JSON string.
function deepParse(node: unknown): unknown {
  if (typeof node === 'string') {
    if (looksLikeJson(node)) {
      try { return deepParse(JSON.parse(node)); } catch { return node; }
    }
    return node;
  }
  if (Array.isArray(node)) return node.map(deepParse);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = deepParse(v);
    return out;
  }
  return node;
}

// DBJsonModal renders any cell value as pretty-printed, syntax-highlighted
// JSON. Objects/arrays are shown directly; strings are parsed first (with a
// clear error state if they aren't valid JSON). A "deep parse" toggle
// unwraps JSON-encoded strings nested inside the payload — handy for log
// columns that stash serialized JSON as text.
export function DBJsonModal({ open, onClose, value, colName }: DBJsonModalProps) {
  const { t } = useTranslation('dbquery');
  const [deep, setDeep] = useState(true);
  const [copied, setCopied] = useState(false);

  const parsed = useMemo<{ ok: boolean; data?: unknown; error?: string; wasString: boolean }>(() => {
    if (value == null) return { ok: false, error: t('jsonModal.valueNull'), wasString: false };
    if (typeof value === 'object') {
      return { ok: true, data: deep ? deepParse(value) : value, wasString: false };
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      try {
        const obj = JSON.parse(trimmed);
        return { ok: true, data: deep ? deepParse(obj) : obj, wasString: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : t('jsonModal.notValidJson'), wasString: true };
      }
    }
    // numbers / booleans — wrap so we still show something meaningful
    return { ok: true, data: value, wasString: false };
  }, [value, deep, t]);

  const text = useMemo(() => {
    if (!parsed.ok) return typeof value === 'string' ? value : String(value ?? '');
    try { return JSON.stringify(parsed.data, null, 2); } catch { return String(parsed.data); }
  }, [parsed, value]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* ignore */ }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl w-[90vw] max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            JSON
            {colName && <span className="font-mono text-xs text-muted-foreground">· {colName}</span>}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 px-4 py-2 border-b text-xs shrink-0">
          <label className="flex items-center gap-1.5 cursor-pointer select-none text-muted-foreground">
            <input
              type="checkbox"
              checked={deep}
              onChange={(e) => setDeep(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            {t('jsonModal.deepParse')}
          </label>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1.5" onClick={copy} disabled={!parsed.ok && !text}>
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? t('common:copied') : t('common:copy')}
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
          {parsed.ok ? (
            <pre className="whitespace-pre-wrap break-words text-foreground/90">{colorizeJson(text)}</pre>
          ) : (
            <div className="space-y-3">
              <div className={cn(
                'flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px]',
              )}>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                <span>{t('jsonModal.invalidJson')}<br />{parsed.error}</span>
              </div>
              <pre className="whitespace-pre-wrap break-words">{text}</pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// canShowAsJson gates the "Show as JSON" affordance: objects/arrays always
// qualify; strings only when they look like a JSON object/array.
export function canShowAsJson(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'object') return true;
  if (typeof value === 'string') return looksLikeJson(value);
  return false;
}
