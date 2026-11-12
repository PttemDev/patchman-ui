import { useCallback, useMemo, useState } from 'react';
import {
  Globe,
  Loader2,
  Play,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Check,
  X,
  ChevronRight,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Trans, useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { webAuditAPI } from '@/services/api';
import type { WebAuditReport, WebAuditIssue, WebAuditSeverity } from '@/types';

// Severity → presentation. Colors follow the app's semantic palette:
// error=destructive/red, warning=amber, ok=green, info=muted. The icon
// inherits the badge's text color via currentColor. `labelKey` is an i18n key
// (devtools ns) resolved where the badge renders.
const SEVERITY_META: Record<
  WebAuditSeverity,
  { Icon: LucideIcon; badge: string; labelKey: string }
> = {
  error: {
    Icon: AlertCircle,
    badge: 'bg-destructive/10 text-destructive border-destructive/30',
    labelKey: 'webAudit.severity.error',
  },
  warning: {
    Icon: AlertTriangle,
    badge: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30',
    labelKey: 'webAudit.severity.warn',
  },
  ok: {
    Icon: CheckCircle2,
    badge: 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30',
    labelKey: 'webAudit.severity.ok',
  },
  info: {
    Icon: Info,
    badge: 'bg-muted text-muted-foreground border-border',
    labelKey: 'webAudit.severity.info',
  },
};

function formatBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// Value line for the extracted-values sections. Empty strings render as a
// muted em-dash so a missing field reads as "absent", not "blank".
function renderValue(v: string | undefined | null) {
  if (!v) return <span className="italic text-muted-foreground">—</span>;
  return <span className="break-all font-mono text-foreground">{v}</span>;
}

// Label / value definition row.
function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-0.5 text-xs">
      <span className="w-28 shrink-0 text-muted-foreground">{k}</span>
      <span className="min-w-0 flex-1">{v}</span>
    </div>
  );
}

// A boolean header/flag rendered as a green check or a red cross.
function Flag({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-xs">
      {ok ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
      ) : (
        <X className="h-3.5 w-3.5 shrink-0 text-destructive" />
      )}
      <span className={cn(ok ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
    </div>
  );
}

// Collapsible extracted-values section. Manual useState toggle (over the
// shared accordion component) keeps the inline, dense Dev Tools look.
function Section({
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  title: string;
  meta?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-1.5 bg-muted/30 text-left transition-colors hover:bg-muted/50',
          open && 'border-b',
        )}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="text-xs font-semibold">{title}</span>
        {meta && <span className="text-[10px] text-muted-foreground">{meta}</span>}
      </button>
      {open && <div className="px-3 py-2 space-y-0.5">{children}</div>}
    </div>
  );
}

export function WebAuditTool() {
  const { t } = useTranslation('devtools');
  const [url, setUrl] = useState('');
  const [protocol, setProtocol] = useState('https://');
  const [followRedirects, setFollowRedirects] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WebAuditReport | null>(null);

  const canRun = url.trim().length > 0 && !loading;

  const run = useCallback(async () => {
    const q = url.trim();
    if (!q) return;
    // The protocol selector supplies the scheme; if the user pasted a full URL
    // (with http[s]://) use it as-is.
    const full = /^https?:\/\//i.test(q) ? q : protocol + q;
    setLoading(true);
    setError(null);
    try {
      const res = await webAuditAPI.run({ url: full, followRedirects });
      setResult(res.data);
    } catch (e) {
      // The axios interceptor only unwraps success envelopes, so error bodies
      // are still shaped { error: string }.
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err.response?.data?.error ?? err.message ?? t('webAudit.auditFailed'));
      setResult(null);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, protocol, followRedirects]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (canRun) void run();
    }
  };

  // Roll up severity counts + group the issue checklist by category,
  // preserving the BE's first-appearance order (it emits them sensibly).
  const { counts, groups } = useMemo(() => {
    const issues: WebAuditIssue[] = result?.issues ?? [];
    const c = { error: 0, warning: 0, ok: 0, info: 0 } as Record<WebAuditSeverity, number>;
    const order: string[] = [];
    const byCat = new Map<string, WebAuditIssue[]>();
    for (const it of issues) {
      c[it.severity] = (c[it.severity] ?? 0) + 1;
      if (!byCat.has(it.category)) {
        byCat.set(it.category, []);
        order.push(it.category);
      }
      byCat.get(it.category)!.push(it);
    }
    return {
      counts: c,
      groups: order.map((cat) => ({ category: cat, items: byCat.get(cat)! })),
    };
  }, [result]);

  const seo = result?.seo;
  const quality = result?.quality;
  const openGraph = Object.entries(seo?.openGraph ?? {});
  const twitter = Object.entries(seo?.twitter ?? {});
  const structured = seo?.structuredData ?? [];
  const h1 = seo?.h1 ?? [];
  const hreflang = seo?.hreflang ?? [];
  const redirects = result?.redirects ?? [];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Controls */}
      <div className="shrink-0 border-b px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
          <Select value={protocol} onValueChange={setProtocol}>
            <SelectTrigger className="h-8 w-[104px] shrink-0 gap-1 text-xs font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="https://" className="text-xs font-mono">https://</SelectItem>
              <SelectItem value="http://" className="text-xs font-mono">http://</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={url}
            onChange={(e) => {
              let v = e.target.value;
              // If a full URL is pasted, lift its scheme into the selector.
              const m = v.match(/^(https?:\/\/)/i);
              if (m) { setProtocol(m[1].toLowerCase()); v = v.slice(m[1].length); }
              setUrl(v);
            }}
            onKeyDown={onKeyDown}
            placeholder={t('webAudit.urlPlaceholder')}
            className="h-8 flex-1 text-xs font-mono"
            spellCheck={false}
            autoFocus
          />
          <Button size="sm" className="h-8 gap-1.5" disabled={!canRun} onClick={() => void run()}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            <span className="text-xs">{t('actions.run')}</span>
          </Button>
          <div className="flex items-center gap-2 shrink-0 pl-1">
            <Switch id="wa-follow" checked={followRedirects} onCheckedChange={setFollowRedirects} />
            <label htmlFor="wa-follow" className="whitespace-nowrap text-xs text-muted-foreground select-none cursor-pointer">
              {t('webAudit.followRedirects')}
            </label>
          </div>
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
            <Loader2 className="h-4 w-4 animate-spin" /> {t('webAudit.auditing')}
          </div>
        ) : !result ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            <Trans i18nKey="webAudit.emptyState" ns="devtools">
              Enter a URL, then press <span className="mx-1 font-medium text-foreground">Run</span>.
            </Trans>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {/* Header — final URL + status + duration + severity summary */}
            <div className="rounded-md border px-3 py-2 space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                <span
                  className={cn(
                    'inline-flex items-center rounded border px-1.5 py-0.5 font-mono font-medium',
                    result.ok
                      ? 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30'
                      : 'bg-destructive/10 text-destructive border-destructive/30',
                  )}
                >
                  {result.statusCode || '—'}
                </span>
                <span className="font-mono text-foreground break-all">{result.finalUrl || result.url}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{result.durationMs} ms</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px]">
                <span className="inline-flex items-center gap-1 text-destructive">
                  <AlertCircle className="h-3 w-3" /> {t(counts.error === 1 ? 'webAudit.errorCountOne' : 'webAudit.errorCountOther', { count: counts.error })}
                </span>
                <span className="inline-flex items-center gap-1 text-yellow-700 dark:text-yellow-400">
                  <AlertTriangle className="h-3 w-3" /> {t(counts.warning === 1 ? 'webAudit.warningCountOne' : 'webAudit.warningCountOther', { count: counts.warning })}
                </span>
                <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-3 w-3" /> {t('webAudit.okCount', { count: counts.ok })}
                </span>
                {counts.info > 0 && (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Info className="h-3 w-3" /> {t('webAudit.infoCount', { count: counts.info })}
                  </span>
                )}
              </div>
            </div>

            {/* Issues checklist — the headline, grouped by category. A single
                TooltipProvider wraps the whole list so each row's "why it
                matters" hover shares one hover-delay timer. */}
            {groups.length > 0 && (
              <TooltipProvider delayDuration={200}>
                <div className="space-y-2">
                  {groups.map((g) => (
                    <div key={g.category} className="rounded-md border overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30">
                        <span className="text-xs font-semibold">{g.category}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {t(g.items.length === 1 ? 'webAudit.checkCountOne' : 'webAudit.checkCountOther', { count: g.items.length })}
                        </span>
                      </div>
                      <div className="divide-y">
                        {g.items.map((it, i) => {
                          const m = SEVERITY_META[it.severity] ?? SEVERITY_META.info;
                          const badge = (
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide shrink-0',
                                m.badge,
                                it.why && 'cursor-help',
                              )}
                            >
                              <m.Icon className="h-3 w-3" />
                              {t(m.labelKey)}
                            </span>
                          );
                          return (
                            <div key={i} className="flex items-start gap-2 px-3 py-1.5 text-xs">
                              {/* Tooltip is on the badge only — not the whole row. */}
                              {it.why ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>{badge}</TooltipTrigger>
                                  <TooltipContent className="max-w-[280px] text-xs">
                                    {it.why}
                                  </TooltipContent>
                                </Tooltip>
                              ) : (
                                badge
                              )}
                              <span className="min-w-0 flex-1 break-words text-foreground pt-0.5">
                                {it.message}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </TooltipProvider>
            )}

            {/* Extracted values — collapsible secondary sections */}
            <div className="space-y-2">
              <Section title={t('webAudit.section.seo')} defaultOpen>
                <KV
                  k={t('webAudit.kv.title')}
                  v={
                    <span>
                      {renderValue(seo?.title?.value)}
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        {t('webAudit.chars', { count: seo?.title?.length ?? 0 })}
                      </span>
                    </span>
                  }
                />
                <KV
                  k={t('webAudit.kv.metaDesc')}
                  v={
                    <span>
                      {renderValue(seo?.metaDescription?.value)}
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        {t('webAudit.chars', { count: seo?.metaDescription?.length ?? 0 })}
                      </span>
                    </span>
                  }
                />
                <KV k={t('webAudit.kv.canonical')} v={renderValue(seo?.canonical)} />
                <KV k={t('webAudit.kv.robotsMeta')} v={renderValue(seo?.robotsMeta)} />
                <KV k={t('webAudit.kv.lang')} v={renderValue(seo?.lang)} />
                <KV k={t('webAudit.kv.viewport')} v={renderValue(seo?.viewport)} />
                <KV
                  k={t('webAudit.kv.images')}
                  v={
                    <span className="text-xs text-foreground">
                      {t('webAudit.imagesTotal', { count: seo?.images?.total ?? 0 })}
                      <span className="ml-2 text-muted-foreground">
                        {t('webAudit.imagesMissingAlt', { count: seo?.images?.missingAlt ?? 0 })}
                      </span>
                    </span>
                  }
                />
                <KV
                  k={t('webAudit.kv.h1', { count: seo?.h1Count ?? h1.length })}
                  v={
                    h1.length === 0 ? (
                      renderValue('')
                    ) : (
                      <div className="space-y-0.5">
                        {h1.map((h, i) => (
                          <div key={i} className="break-words text-foreground">
                            {h}
                          </div>
                        ))}
                      </div>
                    )
                  }
                />
                <KV
                  k={t('webAudit.kv.hreflang')}
                  v={
                    hreflang.length === 0 ? (
                      renderValue('')
                    ) : (
                      <div className="space-y-0.5">
                        {hreflang.map((h, i) => (
                          <div key={i} className="flex gap-2 font-mono">
                            <span className="text-muted-foreground">{h.lang}</span>
                            <span className="break-all text-foreground">{h.href}</span>
                          </div>
                        ))}
                      </div>
                    )
                  }
                />
              </Section>

              <Section
                title={t('webAudit.section.social')}
                meta={t('webAudit.socialMeta', { og: openGraph.length, twitter: twitter.length })}
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground pt-0.5">
                  {t('webAudit.openGraph')}
                </div>
                {openGraph.length === 0 ? (
                  <div className="text-xs italic text-muted-foreground">{t('webAudit.noOpenGraph')}</div>
                ) : (
                  openGraph.map(([k, v]) => <KV key={k} k={k} v={renderValue(v)} />)
                )}
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground pt-1.5">
                  Twitter
                </div>
                {twitter.length === 0 ? (
                  <div className="text-xs italic text-muted-foreground">{t('webAudit.noTwitter')}</div>
                ) : (
                  twitter.map(([k, v]) => <KV key={k} k={k} v={renderValue(v)} />)
                )}
              </Section>

              <Section title={t('webAudit.section.structuredData')} meta={t(structured.length === 1 ? 'webAudit.typeCountOne' : 'webAudit.typeCountOther', { count: structured.length })}>
                {structured.length === 0 ? (
                  <div className="text-xs italic text-muted-foreground">{t('webAudit.noJsonLd')}</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {structured.map((s, i) => (
                      <span
                        key={i}
                        className="rounded border border-input bg-background px-1.5 py-0.5 text-[11px] font-mono"
                      >
                        {s.type || '—'}
                      </span>
                    ))}
                  </div>
                )}
              </Section>

              <Section title={t('webAudit.section.performance')}>
                <KV
                  k={t('webAudit.kv.compression')}
                  v={
                    quality?.contentEncoding ? (
                      <span className="font-mono text-foreground">{quality.contentEncoding}</span>
                    ) : (
                      <span className="italic text-muted-foreground">{t('webAudit.none')}</span>
                    )
                  }
                />
                <KV k="Cache-Control" v={renderValue(quality?.cacheControl)} />
                <KV k="Content-Type" v={renderValue(quality?.contentType)} />
                <KV
                  k={t('webAudit.kv.htmlSize')}
                  v={<span className="font-mono text-foreground">{formatBytes(quality?.bytes ?? 0)}</span>}
                />
              </Section>

              <Section title={t('webAudit.section.securityHeaders')}>
                <Flag ok={!!quality?.https} label="HTTPS" />
                <Flag ok={!!quality?.security?.hsts} label="Strict-Transport-Security" />
                <Flag ok={!!quality?.security?.csp} label="Content-Security-Policy" />
                <Flag ok={!!quality?.security?.xFrameOptions} label="X-Frame-Options" />
                <Flag ok={!!quality?.security?.xContentTypeOptions} label="X-Content-Type-Options" />
                <Flag ok={!!quality?.security?.referrerPolicy} label="Referrer-Policy" />
              </Section>

              <Section title={t('webAudit.section.crawlability')}>
                <Flag ok={!!result.robotsTxt?.present} label={t('webAudit.robotsPresent')} />
                <Flag ok={!!result.robotsTxt?.hasSitemap} label={t('webAudit.robotsSitemap')} />
                {result.robotsTxt?.url && <KV k="robots.txt" v={renderValue(result.robotsTxt.url)} />}
                <Flag ok={!!result.sitemap?.present} label={t('webAudit.sitemapPresent')} />
                {result.sitemap?.url && <KV k="sitemap" v={renderValue(result.sitemap.url)} />}
              </Section>

              <Section title={t('webAudit.section.redirectChain')} meta={t(redirects.length === 1 ? 'webAudit.hopCountOne' : 'webAudit.hopCountOther', { count: redirects.length })}>
                {redirects.length === 0 ? (
                  <div className="text-xs italic text-muted-foreground">{t('webAudit.noRedirects')}</div>
                ) : (
                  <div className="space-y-1">
                    {redirects.map((r, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className="inline-flex items-center rounded border border-input bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono shrink-0">
                          {r.status}
                        </span>
                        <span className="min-w-0 flex-1 break-all font-mono">
                          <span className="text-muted-foreground">{r.from}</span>
                          <span className="mx-1 text-muted-foreground">→</span>
                          <span className="text-foreground">{r.to}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>

            <p className="flex items-start gap-1.5 pt-1 text-[11px] text-muted-foreground">
              <Info className="h-3 w-3 shrink-0 mt-0.5" />
              {t('webAudit.footer')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
