import { useMemo, useRef, useState } from 'react';
import { Copy, Check, Upload, AlertTriangle, ArrowLeftRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function toUrlSafe(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeText(text: string, urlSafe: boolean): string {
  const b64 = bytesToBase64(new TextEncoder().encode(text));
  return urlSafe ? toUrlSafe(b64) : b64;
}

function decodeText(input: string, urlSafe: boolean): string {
  // Strip all whitespace so wrapped/MIME base64 pasted from other tools decodes.
  let s = input.replace(/\s+/g, '');
  if (!s) return '';
  if (urlSafe) s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);
  const bin = atob(s);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// Number of decoded bytes a base64 string represents (padding-agnostic, so it
// works for url-safe/unpadded input too). Best-effort for invalid input.
function base64ByteLength(input: string, urlSafe: boolean): number {
  let s = input.replace(/\s+/g, '');
  if (urlSafe) s = s.replace(/-/g, '+').replace(/_/g, '/');
  s = s.replace(/=+$/, '');
  if (!s) return 0;
  const rem = s.length % 4;
  return Math.floor(s.length / 4) * 3 + (rem === 0 ? 0 : rem - 1);
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function CopyButton({ value, label, variant = 'ghost' }: { value: string; label?: string; variant?: 'ghost' | 'outline' }) {
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
    <Button type="button" size="sm" variant={variant} className="h-7 px-2 text-[11px]" onClick={copy} disabled={!value}>
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}

function Counts({ chars, bytes }: { chars: number; bytes: number }) {
  const { t } = useTranslation('devtools');
  return (
    <span className="text-[10px] text-muted-foreground tabular-nums">
      {t('units.charsBytes', { chars: chars.toLocaleString(), bytes: bytes.toLocaleString() })}
    </span>
  );
}

type LoadedFile = { name: string; size: number; rawB64: string; dataUrl: string; isImage: boolean };

export function Base64Tool() {
  const { t } = useTranslation('devtools');
  const { toast } = useToast();
  const [urlSafe, setUrlSafe] = useState(false);
  const [text, setText] = useState('');
  const [b64, setB64] = useState('');
  // Which pane the user last drove, so toggling URL-safe re-derives the right side.
  const [source, setSource] = useState<'text' | 'b64'>('text');
  const [decodeError, setDecodeError] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const textBytes = useMemo(() => new TextEncoder().encode(text).length, [text]);
  const b64Bytes = useMemo(() => base64ByteLength(b64, urlSafe), [b64, urlSafe]);

  const onTextChange = (value: string) => {
    setFile(null);
    setSource('text');
    setText(value);
    setB64(encodeText(value, urlSafe));
    setDecodeError(false);
  };

  const onB64Change = (value: string) => {
    setFile(null);
    setSource('b64');
    setB64(value);
    try {
      setText(decodeText(value, urlSafe));
      setDecodeError(false);
    } catch {
      // Leave the decoded pane as-is and surface a subtle hint instead of throwing.
      setDecodeError(Boolean(value.trim()));
    }
  };

  const onUrlSafeChange = (next: boolean) => {
    setUrlSafe(next);
    if (file) {
      setB64(next ? toUrlSafe(file.rawB64) : file.rawB64);
      setSource('b64');
      setDecodeError(false);
      return;
    }
    if (source === 'text') {
      setB64(encodeText(text, next));
      setDecodeError(false);
    } else {
      try {
        setText(decodeText(b64, next));
        setDecodeError(false);
      } catch {
        setDecodeError(Boolean(b64.trim()));
      }
    }
  };

  const loadFile = (f: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      const rawB64 = comma >= 0 ? result.slice(comma + 1) : result;
      const shown = urlSafe ? toUrlSafe(rawB64) : rawB64;
      setFile({ name: f.name, size: f.size, rawB64, dataUrl: result, isImage: f.type.startsWith('image/') });
      setB64(shown);
      setText('');
      setSource('b64');
      setDecodeError(false);
    };
    reader.onerror = () => toast({ title: t('base64.readError'), variant: 'destructive' });
    reader.readAsDataURL(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) loadFile(f);
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-[11px] text-muted-foreground">
          {t('base64.intro')}
        </p>
        <div className="flex items-center gap-2">
          <Label htmlFor="b64-urlsafe" className="text-xs text-muted-foreground cursor-pointer">{t('base64.urlSafe')}</Label>
          <Switch id="b64-urlsafe" checked={urlSafe} onCheckedChange={onUrlSafeChange} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 items-stretch">
        {/* Plain text pane */}
        <div className="flex flex-col gap-1.5 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">{t('base64.plainText')}</Label>
            <div className="flex items-center gap-0.5">
              <CopyButton value={text} label={t('common:copy')} />
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onTextChange('')} disabled={!text}>
                <X className="h-3.5 w-3.5" /> {t('actions.clear')}
              </Button>
            </div>
          </div>
          <Textarea
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder={t('base64.textPlaceholder')}
            className="font-mono text-xs min-h-[180px] break-all resize-y flex-1"
            spellCheck={false}
          />
          <div className="flex items-center justify-between gap-2 min-h-[16px]">
            <Counts chars={text.length} bytes={textBytes} />
          </div>
        </div>

        {/* Center divider / direction affordance */}
        <div className="flex flex-row md:flex-col items-center justify-center gap-2" aria-hidden>
          <div className="flex-1 bg-border h-px w-full md:h-full md:w-px" />
          <div className="shrink-0 rounded-full border bg-background p-1.5 text-muted-foreground shadow-sm">
            <ArrowLeftRight className="h-3.5 w-3.5 rotate-90 md:rotate-0" />
          </div>
          <div className="flex-1 bg-border h-px w-full md:h-full md:w-px" />
        </div>

        {/* Base64 pane */}
        <div className="flex flex-col gap-1.5 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">{urlSafe ? t('base64.paneLabelUrlSafe') : t('base64.paneLabel')}</Label>
            <div className="flex items-center gap-0.5">
              <CopyButton value={b64} label={t('common:copy')} />
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onB64Change('')} disabled={!b64}>
                <X className="h-3.5 w-3.5" /> {t('actions.clear')}
              </Button>
            </div>
          </div>
          <Textarea
            value={b64}
            onChange={(e) => onB64Change(e.target.value)}
            placeholder={urlSafe ? 'SGVsbG8sIHdvcmxkIQ' : 'SGVsbG8sIHdvcmxkIQ=='}
            className={cn(
              'font-mono text-xs min-h-[180px] break-all resize-y flex-1',
              decodeError && 'border-amber-500/40 focus-visible:ring-amber-500/40',
            )}
            spellCheck={false}
          />
          <div className="flex items-center justify-between gap-2 min-h-[16px]">
            <Counts chars={b64.length} bytes={b64Bytes} />
          </div>
          {decodeError && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{urlSafe ? t('base64.invalid') : t('base64.invalidUrlSafeHint')}</span>
            </div>
          )}
        </div>
      </div>

      {/* File → base64 dropzone */}
      <div className="space-y-2 border-t pt-4">
        <Label className="text-xs text-muted-foreground">{t('base64.fileToBase64')}</Label>
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} />
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            dragging ? 'border-primary bg-primary/5' : 'border-input hover:border-muted-foreground/50 hover:bg-muted/30',
          )}
        >
          <Upload className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {dragging ? t('base64.dropActive') : t('base64.dropIdle')}
          </span>
          <span className="text-[10px] text-muted-foreground/70">{t('base64.dropHint')}</span>
        </div>

        {file && (
          <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
            {file.isImage && (
              <img
                src={file.dataUrl}
                alt={file.name}
                className="h-12 w-12 shrink-0 rounded border object-cover bg-background"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-mono truncate">{file.name}</div>
              <div className="text-[10px] text-muted-foreground">{humanSize(file.size)}</div>
            </div>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] shrink-0" onClick={() => { setFile(null); onB64Change(''); }}>
              <X className="h-3.5 w-3.5" /> {t('common:remove')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
