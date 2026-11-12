import { useMemo, useState, type ReactNode } from 'react';
import { Copy, Check, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';

type Mode = 'component' | 'full';
type Side = 'decoded' | 'encoded';

function CopyButton({
  value,
  label,
  variant = 'ghost',
  className,
}: {
  value: string;
  label?: string;
  variant?: 'ghost' | 'outline';
  className?: string;
}) {
  const { t } = useTranslation('devtools');
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ title: t('copy.toClipboard') });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: t('copy.failed'), variant: 'destructive' });
    }
  };
  return (
    <Button type="button" size="sm" variant={variant} className={className} onClick={copy} disabled={!value}>
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}

// encode/decode honour the active mode: `component` escapes reserved
// characters (& = ? / …), `full` preserves URL structure. decode* throw on
// malformed percent-encoding, so callers must guard.
function encodeWith(value: string, mode: Mode): string {
  return mode === 'component' ? encodeURIComponent(value) : encodeURI(value);
}
function tryDecode(value: string, mode: Mode): { ok: true; value: string } | { ok: false; error: string } {
  try {
    return { ok: true, value: mode === 'component' ? decodeURIComponent(value) : decodeURI(value) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Malformed percent-encoding.' };
  }
}

type Analysis = { origin: string | null; path: string | null; params: [string, string][] };

// analyze the raw (decoded) text: prefer a full URL parse (origin + path +
// params), otherwise fall back to a bare query string. Returns null when the
// input doesn't look like a URL or query string so the breakdown stays hidden.
function analyze(raw: string): Analysis | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol && u.host) {
      return {
        origin: u.origin && u.origin !== 'null' ? u.origin : null,
        path: u.pathname || null,
        params: Array.from(u.searchParams.entries()),
      };
    }
  } catch {
    // not a full URL — fall through to query-string parsing
  }
  if (!s.includes('=')) return null;
  let qs = s;
  const hash = qs.indexOf('#');
  if (hash >= 0) qs = qs.slice(0, hash);
  const q = qs.indexOf('?');
  if (q >= 0) qs = qs.slice(q + 1);
  let params: [string, string][];
  try {
    params = Array.from(new URLSearchParams(qs).entries());
  } catch {
    return null;
  }
  if (params.length === 0) return null;
  return { origin: null, path: null, params };
}

function Pane({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint?: ReactNode;
}) {
  const { t } = useTranslation('devtools');
  const bytes = useMemo(() => new TextEncoder().encode(value).length, [value]);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => onChange('')} disabled={!value}>
            {t('actions.clear')}
          </Button>
          <CopyButton value={value} label={t('common:copy')} variant="outline" />
        </div>
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="font-mono text-xs min-h-[150px] break-all"
        spellCheck={false}
      />
      <div className="flex items-center justify-between gap-2 min-h-[16px]">
        <span className="text-[11px] text-muted-foreground">
          {t('units.charsBytes', { chars: value.length, bytes })}
        </span>
        {hint}
      </div>
    </div>
  );
}

function KvLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <span className="text-muted-foreground w-16 shrink-0">{label}</span>
      <span className="font-mono break-all flex-1">{value}</span>
      <CopyButton value={value} className="h-6 w-6 p-0 shrink-0" />
    </div>
  );
}

export function UrlTool() {
  const { t } = useTranslation('devtools');
  const [mode, setMode] = useState<Mode>('component');
  // Both panes are independent, editable state kept in sync on each keystroke.
  // `edited` remembers which side is authoritative so a mode switch re-derives
  // the other pane from the right source instead of clobbering user input.
  const [decoded, setDecoded] = useState('');
  const [encoded, setEncoded] = useState('');
  const [edited, setEdited] = useState<Side>('decoded');
  const [decodeError, setDecodeError] = useState<string | null>(null);

  const onDecodedChange = (text: string) => {
    setEdited('decoded');
    setDecoded(text);
    setEncoded(encodeWith(text, mode));
    setDecodeError(null);
  };

  const onEncodedChange = (text: string) => {
    setEdited('encoded');
    setEncoded(text);
    const r = tryDecode(text, mode);
    if (r.ok) {
      setDecoded(r.value);
      setDecodeError(null);
    } else {
      setDecodeError(r.error);
    }
  };

  const changeMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    if (edited === 'encoded') {
      const r = tryDecode(encoded, next);
      if (r.ok) {
        setDecoded(r.value);
        setDecodeError(null);
      } else {
        setDecodeError(r.error);
      }
    } else {
      setEncoded(encodeWith(decoded, next));
      setDecodeError(null);
    }
  };

  const analysis = useMemo(() => analyze(decoded), [decoded]);

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-1.5">
        <Tabs value={mode} onValueChange={(v) => changeMode(v as Mode)}>
          <TabsList className="h-8">
            <TabsTrigger value="component" className="text-xs h-6 px-3">
              {t('url.component')}
            </TabsTrigger>
            <TabsTrigger value="full" className="text-xs h-6 px-3">
              {t('url.fullUrl')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-[11px] text-muted-foreground">
          {mode === 'component' ? t('url.componentDesc') : t('url.fullDesc')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Pane
          label={t('url.decodedRaw')}
          value={decoded}
          onChange={onDecodedChange}
          placeholder="https://api.example.com/search?q=São Paulo&page=2"
        />
        <Pane
          label={t('url.encoded')}
          value={encoded}
          onChange={onEncodedChange}
          placeholder="https%3A%2F%2Fapi.example.com%2Fsearch%3Fq%3DS%C3%A3o%20Paulo"
          hint={
            decodeError ? (
              <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {t('url.cantDecode')}
              </span>
            ) : null
          }
        />
      </div>

      <p className="text-[11px] text-muted-foreground">
        {t('url.liveBidirectional')}
      </p>

      {analysis && (
        <div className="space-y-2 border-t pt-4">
          <Label className="text-xs text-muted-foreground">{t('url.breakdown')}</Label>
          {(analysis.origin || analysis.path) && (
            <div className="rounded-md border divide-y text-xs">
              {analysis.origin && <KvLine label={t('url.origin')} value={analysis.origin} />}
              {analysis.path && <KvLine label={t('url.path')} value={analysis.path} />}
            </div>
          )}
          {analysis.params.length > 0 ? (
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-[11px] text-muted-foreground">
                    <th className="px-3 py-1.5 font-medium w-1/3">{t('url.key')}</th>
                    <th className="px-3 py-1.5 font-medium">{t('url.valueDecoded')}</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {analysis.params.map(([k, v], i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-1.5 font-mono break-all align-top">{k}</td>
                      <td className="px-3 py-1.5 font-mono break-all align-top">
                        {v || <span className="text-muted-foreground italic">{t('placeholders.empty')}</span>}
                      </td>
                      <td className="px-2 py-1 align-top">
                        <CopyButton value={v} className="h-6 w-6 p-0 shrink-0" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">{t('url.noQueryParams')}</p>
          )}
        </div>
      )}
    </div>
  );
}
