import { useCallback, useMemo, useState } from 'react';
import { Globe, Loader2, Search, AlertCircle, Info, Copy, Check } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { dnsAPI, type DnsLookupResponse, type DnsRecord } from '@/services/api';

// The record types the UI offers as toggles. SOA and CAA are now real options —
// the BE speaks actual DNS (miekg/dns), so it can fetch both. PTR sits last as
// the reverse (IP→name) query. Default is A + AAAA (matches the BE default).
const RECORD_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SRV', 'SOA', 'CAA', 'PTR'] as const;
type RecordType = (typeof RECORD_TYPES)[number];
// Default to every forward record type so a lookup returns the full picture
// without clicking. PTR is left out — it's a reverse (IP→name) query that
// errors on a hostname; the IP nudge below enables it when it's relevant.
const DEFAULT_TYPES: RecordType[] = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SRV', 'SOA', 'CAA'];

// Presentation string for one record, given its type. Mirrors what the BE would
// print but composes from the structured fields so MX/SRV/SOA/CAA render as
// their canonical multi-field forms. Also what the copy button copies.
function recordText(type: string, rec: DnsRecord): string {
  switch (type) {
    case 'MX':
      return rec.preference !== undefined ? `${rec.preference} ${rec.target ?? rec.value}` : rec.value;
    case 'SRV':
      return rec.priority !== undefined
        ? `${rec.priority} ${rec.weight} ${rec.port} ${rec.target}`
        : rec.value;
    case 'CAA':
      return rec.flag !== undefined ? `${rec.flag} ${rec.tag} "${rec.value}"` : rec.value;
    case 'SOA':
      return rec.mname
        ? `${rec.mname} ${rec.rname} · serial ${rec.serial} · refresh ${rec.refresh} · retry ${rec.retry} · expire ${rec.expire} · min ${rec.minttl}`
        : rec.value;
    default:
      return rec.value;
  }
}

// Loose check for a bare IPv4/IPv6 literal so we can nudge toward PTR/reverse.
function looksLikeIP(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return true; // IPv4
  if (s.includes(':') && /^[0-9a-fA-F:]+$/.test(s)) return true; // IPv6 (loose)
  return false;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation('devtools');
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ title: t('copy.copiedLabel', { label }) });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: t('copy.failed'), variant: 'destructive' });
    }
  };
  return (
    <Button type="button" size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={copy} disabled={!value}>
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

export function DnsToolkit() {
  const { t } = useTranslation('devtools');
  const [name, setName] = useState('');
  const [types, setTypes] = useState<RecordType[]>(DEFAULT_TYPES);
  const [server, setServer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DnsLookupResponse | null>(null);

  const isIP = useMemo(() => looksLikeIP(name), [name]);
  const canRun = name.trim().length > 0 && types.length > 0 && !loading;

  const toggleType = useCallback((t: RecordType) => {
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }, []);

  const run = useCallback(async () => {
    const q = name.trim();
    if (!q || types.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await dnsAPI.lookup({ name: q, types, server: server.trim() || undefined });
      setResult(res.data);
    } catch (e) {
      // The axios interceptor only unwraps success envelopes, so error bodies
      // are still shaped { error: string }.
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err.response?.data?.error ?? err.message ?? t('dns.lookupFailed'));
      setResult(null);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, types, server]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (canRun) void run();
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Controls */}
      <div className="shrink-0 border-b px-4 pt-4 pb-3 space-y-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('dns.hostPlaceholder')}
            className="h-8 flex-1 text-xs font-mono"
            spellCheck={false}
            autoFocus
          />
          <Input
            value={server}
            onChange={(e) => setServer(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('dns.serverPlaceholder')}
            className="h-8 w-56 text-xs font-mono"
            spellCheck={false}
          />
          <Button size="sm" className="h-8 gap-1.5" disabled={!canRun} onClick={() => void run()}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            <span className="text-xs">{t('dns.lookup')}</span>
          </Button>
        </div>

        {/* Record-type toggles */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mr-1">
            {t('dns.records')}
          </Label>
          <button
            type="button"
            onClick={() => setTypes([...RECORD_TYPES])}
            className="h-6 rounded-md border border-input bg-background px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {t('dns.all')}
          </button>
          <button
            type="button"
            onClick={() => setTypes([])}
            className="h-6 rounded-md border border-input bg-background px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {t('dns.none')}
          </button>
          <span className="mx-0.5 h-4 w-px bg-border" />
          {RECORD_TYPES.map((t) => {
            const active = types.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                className={cn(
                  'h-6 rounded-md border px-2 text-[11px] font-mono font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {t}
              </button>
            );
          })}
          {isIP && !types.includes('PTR') && (
            <button
              type="button"
              onClick={() => toggleType('PTR')}
              className="ml-1 inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
            >
              <Info className="h-3 w-3" />
              {t('dns.ipNudge')}
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-auto">
        {error ? (
          <div className="p-4">
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="break-all">{error}</span>
            </div>
          </div>
        ) : loading && !result ? (
          <div className="h-full flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('dns.resolving')}
          </div>
        ) : !result ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            <Trans i18nKey="dns.emptyState" ns="devtools">
              Enter a hostname or IP, pick record types, then press <span className="mx-1 font-medium text-foreground">Lookup</span>.
            </Trans>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="font-mono text-foreground break-all">{result.name}</span>
              <span>·</span>
              <span>
                {t('dns.resolverLabel')} <span className="font-mono">{result.resolver}</span>
              </span>
            </div>

            {result.results.map((r) => {
              const count = r.records.length;
              return (
                <div key={r.type} className="rounded-md border overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30">
                    <span className="text-xs font-semibold font-mono">{r.type}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {r.error ? '—' : t(count === 1 ? 'dns.recordCountOne' : 'dns.recordCountOther', { count })}
                    </span>
                    <div className="flex-1" />
                    <span className="text-[10px] text-muted-foreground/70">{r.durationMs} ms</span>
                    {!r.error && count > 0 && (
                      <CopyButton
                        value={r.records
                          // SOA's display form is dot-separated + labelled for
                          // readability; copy the canonical 7-field value instead
                          // so it's paste-friendly.
                          .map((rec) => (r.type === 'SOA' ? rec.value : recordText(r.type, rec)))
                          .join('\n')}
                        label={t('dns.typeRecords', { type: r.type })}
                      />
                    )}
                  </div>
                  {r.error ? (
                    <div className="flex items-start gap-1.5 px-3 py-2 text-[11px] text-destructive">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span className="break-all">{r.error}</span>
                    </div>
                  ) : count === 0 ? (
                    <div className="px-3 py-2 text-[11px] italic text-muted-foreground">{t('dns.noRecords')}</div>
                  ) : (
                    <div className="divide-y">
                      {r.records.map((rec, i) => (
                        <div key={i} className="flex items-start gap-3 px-3 py-1.5">
                          <span className="flex-1 text-xs font-mono break-all">{recordText(r.type, rec)}</span>
                          <span className="shrink-0 pt-px text-[10px] font-mono text-muted-foreground/70">
                            TTL {rec.ttl}s
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <p className="flex items-start gap-1.5 pt-1 text-[11px] text-muted-foreground">
              <Info className="h-3 w-3 shrink-0 mt-0.5" />
              {t('dns.footer')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
