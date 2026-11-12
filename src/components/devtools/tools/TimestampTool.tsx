import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Copy, Check, Clock, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { DateTimePicker } from '../DateTimePicker';

// formatInZone renders an instant in a specific IANA timezone.
function formatInZone(d: Date, zone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'long',
      timeZone: zone,
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
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

// parseInput accepts an epoch (auto-detecting seconds vs milliseconds by
// digit length) or any Date-parseable string.
function parseInput(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    // 13+ digits => milliseconds; otherwise treat as seconds.
    const ms = s.length > 11 ? n : n * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function relative(date: Date, nowMs: number): string {
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const diff = date.getTime() - nowMs;
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000000],
    ['month', 2592000000],
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000],
    ['second', 1000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === 'second') return rtf.format(Math.round(diff / ms), unit);
  }
  return 'now';
}

function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-xs text-muted-foreground w-32 shrink-0">{label}</span>
      <span className="text-xs font-mono break-all flex-1">{value}</span>
      <CopyButton value={value} />
    </div>
  );
}

export function TimestampTool() {
  const { t } = useTranslation('devtools');
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const zones = useMemo<string[]>(() => {
    try {
      // supportedValuesOf is available in modern browsers / recent TS lib.
      const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
      if (list && list.length) return list;
    } catch {
      /* fall through */
    }
    return Array.from(new Set(['UTC', tz])).sort();
  }, [tz]);
  const [zone, setZone] = useState(tz);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [input, setInput] = useState(() => String(Math.floor(Date.now() / 1000)));

  // Date → epoch: a single source of truth (`pickDate`) shared by the custom
  // calendar picker and the ISO string field. `isoText` mirrors it but stays
  // independently editable so devs can paste/type an ISO 8601 value directly.
  const [pickDate, setPickDate] = useState<Date>(() => new Date());
  const [isoText, setIsoText] = useState<string>(() => new Date().toISOString());
  const [isoValid, setIsoValid] = useState(true);

  const applyPick = (d: Date) => {
    setPickDate(d);
    setIsoText(d.toISOString());
    setIsoValid(true);
  };
  const applyIso = (raw: string) => {
    setIsoText(raw);
    const d = new Date(raw.trim());
    if (raw.trim() && !isNaN(d.getTime())) {
      setPickDate(d);
      setIsoValid(true);
    } else {
      setIsoValid(false);
    }
  };

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const parsed = useMemo(() => parseInput(input), [input]);

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        <span className="shrink-0">{t('timestamp.timezone')}</span>
        <Select value={zone} onValueChange={setZone}>
          <SelectTrigger className="h-7 w-[240px] text-xs font-mono"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            {zones.map((z) => (
              <SelectItem key={z} value={z} className="text-xs font-mono">{z}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {zone !== tz && (
          <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2" onClick={() => setZone(tz)}>
            {t('timestamp.resetToLocal')}
          </Button>
        )}
        <span className="ml-auto font-mono">{t('timestamp.nowEpoch', { epoch: Math.floor(nowMs / 1000) })}</span>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{t('timestamp.epochOrDate')}</Label>
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('timestamp.inputPlaceholder')}
            className="font-mono text-xs"
            spellCheck={false}
          />
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setInput(String(Date.now()))}>
            {t('actions.now')}
          </Button>
        </div>
      </div>

      {input.trim() && !parsed && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{t('timestamp.parseError')}</span>
        </div>
      )}

      {parsed && (
        <div className="rounded-md border divide-y">
          <div className="px-3">
            <ValueRow label={t('timestamp.unixSeconds')} value={String(Math.floor(parsed.getTime() / 1000))} />
            <ValueRow label={t('timestamp.unixMillis')} value={String(parsed.getTime())} />
            <ValueRow label={t('timestamp.iso8601Utc')} value={parsed.toISOString()} />
            <ValueRow label={t('timestamp.local')} value={parsed.toLocaleString()} />
            <ValueRow label="UTC" value={parsed.toUTCString()} />
            <ValueRow label={t('timestamp.inZone', { zone })} value={formatInZone(parsed, zone)} />
            <ValueRow label={t('timestamp.relative')} value={relative(parsed, nowMs)} />
          </div>
        </div>
      )}

      <div className="space-y-3 border-t pt-4">
        <Label className="block text-xs text-muted-foreground">{t('timestamp.dateToEpoch')}</Label>

        {/* Picker + ISO share one instant; equal widths, copy on both. */}
        <div className="space-y-2 max-w-xs">
          <div className="flex items-center gap-1.5">
            <div className="flex-1 min-w-0">
              <DateTimePicker value={pickDate} onChange={applyPick} />
            </div>
            <CopyButton value={format(pickDate, 'yyyy-MM-dd HH:mm:ss')} />
          </div>

          <div className="flex items-center gap-1.5">
            <Input
              value={isoText}
              onChange={(e) => applyIso(e.target.value)}
              placeholder="2026-07-24T12:00:00.000Z"
              className="flex-1 min-w-0 font-mono text-xs"
              spellCheck={false}
            />
            <CopyButton value={isoText} />
          </div>

          <p className={`text-[10px] ${isoValid ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'}`}>
            {isoValid ? t('timestamp.isoSyncHint') : t('timestamp.invalidDate')}
          </p>
        </div>

        <div className="rounded-md border px-3">
          <ValueRow label={t('timestamp.unixSeconds')} value={String(Math.floor(pickDate.getTime() / 1000))} />
          <ValueRow label={t('timestamp.unixMillis')} value={String(pickDate.getTime())} />
          <ValueRow label={t('timestamp.local')} value={pickDate.toLocaleString()} />
          <ValueRow label={t('timestamp.inZone', { zone })} value={formatInZone(pickDate, zone)} />
        </div>
      </div>
    </div>
  );
}
