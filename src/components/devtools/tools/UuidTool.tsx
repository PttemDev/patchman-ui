import { useState } from 'react';
import { Copy, Check, RefreshCw, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// generateUlid builds a 26-char ULID: 48-bit time (10 Crockford base32 chars)
// + 80 bits of randomness (16 chars).
function generateUlid(): string {
  let now = Date.now();
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[now % 32] + time;
    now = Math.floor(now / 32);
  }
  const rand = new Uint8Array(16);
  crypto.getRandomValues(rand);
  let randStr = '';
  for (let i = 0; i < 16; i++) randStr += CROCKFORD[rand[i] % 32];
  return time + randStr;
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
    <Button type="button" size="sm" variant={variant} onClick={copy} disabled={!value}>
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}

export function UuidTool() {
  const { t } = useTranslation('devtools');
  const [count, setCount] = useState(5);
  const [uppercase, setUppercase] = useState(false);
  const [hyphens, setHyphens] = useState(true);
  const [uuids, setUuids] = useState<string[]>(() => [crypto.randomUUID()]);
  const [ulid, setUlid] = useState<string>(() => generateUlid());

  const fmt = (u: string): string => {
    let s = hyphens ? u : u.replace(/-/g, '');
    return uppercase ? s.toUpperCase() : s.toLowerCase();
  };

  const clampCount = (n: number) => Math.max(1, Math.min(100, n || 1));

  const generate = () => {
    const n = clampCount(count);
    setUuids(Array.from({ length: n }, () => crypto.randomUUID()));
  };

  const formatted = uuids.map(fmt);
  const allText = formatted.join('\n');

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-end flex-wrap gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t('uuid.count')}</Label>
          <Input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(clampCount(Number(e.target.value)))}
            className="w-24 h-8 font-mono text-xs"
          />
        </div>
        <Button size="sm" onClick={generate}>
          <RefreshCw className="h-3.5 w-3.5" /> {t('uuid.generateV4')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setUuids([NIL_UUID])}>
          {t('uuid.nilUuid')}
        </Button>
        <div className="flex items-center gap-4 ml-auto">
          <div className="flex items-center gap-2">
            <Label htmlFor="uuid-upper" className="text-xs text-muted-foreground cursor-pointer">{t('uuid.uppercase')}</Label>
            <Switch id="uuid-upper" checked={uppercase} onCheckedChange={setUppercase} />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="uuid-hyphens" className="text-xs text-muted-foreground cursor-pointer">{t('uuid.hyphens')}</Label>
            <Switch id="uuid-hyphens" checked={hyphens} onCheckedChange={setHyphens} />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">
            {t('uuid.uuidV4Label')} <span className="opacity-60">· {formatted.length}</span>
          </Label>
          <CopyButton value={allText} label={t('copy.all')} variant="outline" />
        </div>
        <div className="rounded-md border divide-y">
          {formatted.map((u, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5">
              <span className="text-[11px] text-muted-foreground w-6 shrink-0 tabular-nums">{i + 1}</span>
              <span className="text-xs font-mono break-all flex-1">{u}</span>
              <CopyButton value={u} />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2 border-t pt-4">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">{t('uuid.ulidLabel')} <span className="opacity-60">· {t('uuid.sortable')}</span></Label>
          <Button size="sm" variant="outline" onClick={() => setUlid(generateUlid())}>
            <RefreshCw className="h-3.5 w-3.5" /> {t('uuid.regenerate')}
          </Button>
        </div>
        <div className="flex items-center gap-2 rounded-md border px-3 py-2">
          <span className="text-xs font-mono break-all flex-1">{uppercase ? ulid : ulid.toLowerCase()}</span>
          <CopyButton value={uppercase ? ulid : ulid.toLowerCase()} />
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Info className="h-3 w-3" /> {t('uuid.footer')}
      </p>
    </div>
  );
}
