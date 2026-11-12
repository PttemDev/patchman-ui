import { useEffect, useRef, useState } from 'react';
import { Copy, Check, UploadCloud, FileUp, Loader2, Info } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

type Algo = 'SHA-1' | 'SHA-256' | 'SHA-512';
const ALGOS: Algo[] = ['SHA-1', 'SHA-256', 'SHA-512'];
type Digests = Record<Algo, string>;

async function digestHex(algo: Algo, data: BufferSource): Promise<string> {
  const buf = await crypto.subtle.digest(algo, data);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

async function digestAll(data: BufferSource): Promise<Digests> {
  const [s1, s256, s512] = await Promise.all([
    digestHex('SHA-1', data),
    digestHex('SHA-256', data),
    digestHex('SHA-512', data),
  ]);
  return { 'SHA-1': s1, 'SHA-256': s256, 'SHA-512': s512 };
}

function CopyButton({ value }: { value: string }) {
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
    <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" onClick={copy} disabled={!value}>
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function DigestList({ digests, upper }: { digests: Digests | null; upper: boolean }) {
  return (
    <div className="rounded-md border divide-y">
      {ALGOS.map((algo) => {
        const raw = digests?.[algo] ?? '';
        const value = upper ? raw.toUpperCase() : raw;
        return (
          <div key={algo} className="flex items-start gap-2 px-3 py-2">
            <span className="text-xs text-muted-foreground w-20 shrink-0 pt-0.5">{algo}</span>
            <span className="text-xs font-mono break-all flex-1 min-h-[16px]">
              {value || <span className="text-muted-foreground italic">—</span>}
            </span>
            <CopyButton value={value} />
          </div>
        );
      })}
    </div>
  );
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function HashTool() {
  const { t } = useTranslation('devtools');
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [upper, setUpper] = useState(false);
  const [textDigests, setTextDigests] = useState<Digests | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [fileDigests, setFileDigests] = useState<Digests | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hashing, setHashing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!text) {
      setTextDigests(null);
      return;
    }
    const data = new TextEncoder().encode(text);
    digestAll(data).then((d) => {
      if (!cancelled) setTextDigests(d);
    });
    return () => {
      cancelled = true;
    };
  }, [text]);

  const hashFile = async (f: File) => {
    setFile({ name: f.name, size: f.size });
    setFileDigests(null);
    setHashing(true);
    try {
      const buf = await f.arrayBuffer();
      setFileDigests(await digestAll(buf));
    } catch {
      toast({ title: t('hash.hashError'), variant: 'destructive' });
    } finally {
      setHashing(false);
    }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void hashFile(f);
    // Reset the value so picking the same file again still fires onChange.
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void hashFile(f);
  };

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{t('hash.text')}</Label>
        <div className="flex items-center gap-2">
          <Label htmlFor="hash-upper" className="text-xs text-muted-foreground cursor-pointer">{t('hash.uppercaseHex')}</Label>
          <Switch id="hash-upper" checked={upper} onCheckedChange={setUpper} />
        </div>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('hash.textPlaceholder')}
        className="font-mono text-xs min-h-[110px] break-all"
        spellCheck={false}
      />
      <DigestList digests={textDigests} upper={upper} />

      <div className="space-y-2 border-t pt-4">
        <Label className="text-xs text-muted-foreground">{t('hash.hashFile')}</Label>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {t('hash.fileDescription')}
        </p>

        <input ref={fileRef} type="file" className="hidden" onChange={onPickFile} />
        <div
          role="button"
          tabIndex={0}
          aria-label={t('hash.dropAria')}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors outline-none',
            'hover:border-primary/50 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring',
            dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
          )}
        >
          <UploadCloud
            className={cn('h-6 w-6', dragging ? 'text-primary' : 'text-muted-foreground')}
          />
          <span className="text-xs text-muted-foreground">
            <Trans i18nKey="hash.dropText" ns="devtools">
              Drop a file here, or <span className="font-medium text-foreground">click to browse</span>
            </Trans>
          </span>
        </div>

        {file && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {hashing ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
            ) : (
              <FileUp className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="font-mono truncate">
              {file.name} · {humanSize(file.size)}
            </span>
            {hashing && <span className="italic shrink-0">{t('hash.hashing')}</span>}
          </div>
        )}

        {file && <DigestList digests={fileDigests} upper={upper} />}
      </div>

      <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
        <Info className="h-3 w-3 shrink-0 mt-0.5" />
        {t('hash.md5Note')}
      </p>
    </div>
  );
}
