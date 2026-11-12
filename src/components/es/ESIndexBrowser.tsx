import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Search, RefreshCw, Loader2, Database, ChevronRight, ChevronDown, Tags } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { esAPI, type DBScope } from '@/services/api';
import { useESConnectionStore } from '@/stores/esConnectionStore';
import type { IndexRow, AliasRow, Field } from '@/types';
import { colorizeJson } from '@/components/dbquery/DBResultJSON';
import { healthDot, formatCount, formatBytes, aliasRowFiltered, aliasRowRouted } from './esRow';

interface ESIndexBrowserProps {
  connId: string;
  scope: DBScope;
  onClose: () => void;
  /** Insert a starter search targeting the clicked index into the editor. */
  onQueryIndex: (index: string) => void;
}

// ESIndexBrowser is the console's left panel: two collapsible sections —
// Indexes (health, docs, store, shards, created) and Aliases (target index +
// write/filtered/routing badges) — sharing one filter. Clicking an index (or
// an alias's target) opens a detail drawer (mapping / settings / stats) and
// warms the completion mapping cache so field autocomplete lights up.
export function ESIndexBrowser({ connId, scope, onClose, onQueryIndex }: ESIndexBrowserProps) {
  const { t } = useTranslation('es');
  const [indices, setIndices] = useState<IndexRow[]>([]);
  const [aliases, setAliases] = useState<AliasRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const [openIdx, setOpenIdx] = useState(true);
  const [openAlias, setOpenAlias] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ir, ar] = await Promise.allSettled([
        esAPI.indices(connId, scope),
        esAPI.aliases(connId, scope),
      ]);
      setIndices(ir.status === 'fulfilled' ? ((ir.value.data as IndexRow[]) ?? []) : []);
      setAliases(ar.status === 'fulfilled' ? ((ar.value.data as AliasRow[]) ?? []) : []);
    } finally {
      setLoading(false);
    }
  }, [connId, scope]);

  useEffect(() => { load(); }, [load]);

  const q = filter.trim().toLowerCase();
  const filteredIdx = useMemo(
    () => (q ? indices.filter((r) => r.index.toLowerCase().includes(q)) : indices),
    [indices, q],
  );
  const filteredAlias = useMemo(
    () => (q ? aliases.filter((a) => a.alias.toLowerCase().includes(q) || a.index.toLowerCase().includes(q)) : aliases),
    [aliases, q],
  );

  const empty = indices.length === 0 && aliases.length === 0;

  return (
    <div className="w-80 shrink-0 border-r flex flex-col min-h-0 bg-muted/20">
      <div className="shrink-0 px-3 pt-3 pb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('indexBrowser.title')}
        </span>
        <div className="flex items-center gap-0.5">
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={load} title={t('common:refresh')}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose} title={t('indexBrowser.close')}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="shrink-0 px-3 pb-2">
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('indexBrowser.filter')}
            className="h-8 text-xs pl-7"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pb-3">
        {loading && empty ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('common:loading')}
          </div>
        ) : (
          <>
            {/* ── Indexes ─────────────────────────────────────────── */}
            <SectionHeader
              label={t('indexBrowser.sectionIndexes')}
              count={filteredIdx.length}
              open={openIdx}
              onToggle={() => setOpenIdx((v) => !v)}
            />
            {openIdx && (
              <div className="px-2 space-y-0.5">
                {filteredIdx.length === 0 ? (
                  <p className="px-2 py-3 text-center text-[10px] text-muted-foreground">
                    {indices.length === 0 ? t('indexBrowser.noneFound') : t('indexBrowser.noMatch', { filter })}
                  </p>
                ) : (
                  filteredIdx.map((r) => (
                    <div key={r.index} className="group flex items-center rounded hover:bg-accent/40 transition-colors">
                      <button
                        type="button"
                        onClick={() => setDetail(r.index)}
                        className="flex-1 min-w-0 px-2 py-1 text-left"
                        title={t('indexBrowser.rowTitle', {
                          docs: r.docsCount.toLocaleString(),
                          store: formatBytes(r.storeSize),
                          pri: r.priShards,
                          rep: r.repShards,
                        })}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={cn('inline-block h-2 w-2 rounded-full shrink-0', healthDot(r.health))} />
                          <span className="text-xs font-mono truncate">{r.index}</span>
                          <span className="ml-auto flex items-center gap-1 shrink-0">
                            <Badge variant="secondary" className="text-[8px] px-1 py-0 font-mono">{formatCount(r.docsCount)}</Badge>
                            <span className="text-[9px] text-muted-foreground/70">{formatBytes(r.storeSize)}</span>
                          </span>
                        </div>
                        <div className="pl-3.5 text-[9px] text-muted-foreground/60 truncate">
                          {r.status} · {r.priShards}p/{r.repShards}r{r.priStoreSize ? ` · pri ${formatBytes(r.priStoreSize)}` : ''}
                        </div>
                      </button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        title={t('indexBrowser.searchIndex')}
                        onClick={() => onQueryIndex(r.index)}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ── Aliases ─────────────────────────────────────────── */}
            <SectionHeader
              label={t('indexBrowser.sectionAliases')}
              count={filteredAlias.length}
              open={openAlias}
              onToggle={() => setOpenAlias((v) => !v)}
              className="mt-1"
            />
            {openAlias && (
              <div className="px-2 space-y-0.5">
                {filteredAlias.length === 0 ? (
                  <p className="px-2 py-3 text-center text-[10px] text-muted-foreground">
                    {aliases.length === 0 ? t('indexBrowser.aliasesNone') : t('indexBrowser.noMatch', { filter })}
                  </p>
                ) : (
                  filteredAlias.map((a) => {
                    const routed = aliasRowRouted(a);
                    const filtered = aliasRowFiltered(a);
                    return (
                      <div key={`${a.alias}//${a.index}`} className="group flex items-center rounded hover:bg-accent/40 transition-colors">
                        <button
                          type="button"
                          onClick={() => setDetail(a.index)}
                          className="flex-1 min-w-0 px-2 py-1 text-left"
                          title={`${a.alias} → ${a.index}`}
                        >
                          <div className="flex items-center gap-1.5">
                            <Tags className="h-3 w-3 shrink-0 text-violet-400" />
                            <span className="text-xs font-mono truncate">{a.alias}</span>
                            <span className="ml-auto flex items-center gap-0.5 shrink-0">
                              {a.isWriteIndex === 'true' && (
                                <Badge variant="secondary" className="text-[8px] px-1 py-0 bg-emerald-500/15 text-emerald-500">{t('indexBrowser.aliasWrite')}</Badge>
                              )}
                              {filtered && (
                                <Badge variant="secondary" className="text-[8px] px-1 py-0 bg-amber-500/15 text-amber-500">{t('indexBrowser.aliasFiltered')}</Badge>
                              )}
                              {routed && (
                                <Badge variant="secondary" className="text-[8px] px-1 py-0 bg-sky-500/15 text-sky-500">{t('indexBrowser.aliasRouting')}</Badge>
                              )}
                            </span>
                          </div>
                          <div className="pl-4 text-[9px] text-muted-foreground/60 truncate">→ {a.index}</div>
                        </button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          title={t('indexBrowser.searchAlias')}
                          onClick={() => onQueryIndex(a.alias)}
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </>
        )}
      </div>

      {detail && (
        <IndexDetailDrawer
          connId={connId}
          scope={scope}
          index={detail}
          onClose={() => setDetail(null)}
          onQueryIndex={onQueryIndex}
        />
      )}
    </div>
  );
}

function SectionHeader({
  label, count, open, onToggle, className,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'sticky top-0 z-10 w-full flex items-center gap-1 px-3 py-1.5 bg-muted/20 backdrop-blur-sm',
        'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', !open && '-rotate-90')} />
      {label}
      <span className="text-muted-foreground/50">· {count}</span>
    </button>
  );
}

function IndexDetailDrawer({
  connId, scope, index, onClose, onQueryIndex,
}: {
  connId: string;
  scope: DBScope;
  index: string;
  onClose: () => void;
  onQueryIndex: (index: string) => void;
}) {
  const { t } = useTranslation('es');
  const loadMapping = useESConnectionStore((s) => s.loadMapping);
  const [tab, setTab] = useState<'mapping' | 'settings' | 'stats'>('mapping');
  const [fields, setFields] = useState<Field[] | null>(null);
  const [settings, setSettings] = useState<unknown>(null);
  const [stats, setStats] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      // Warm the completion mapping cache + drive the mapping tab.
      const f = await loadMapping(connId, index, scope);
      const [settingsRes, statsRes] = await Promise.allSettled([
        esAPI.request(connId, { method: 'GET', path: `${index}/_settings` }, scope),
        esAPI.request(connId, { method: 'GET', path: `${index}/_stats` }, scope),
      ]);
      if (cancelled) return;
      setFields(f);
      setSettings(settingsRes.status === 'fulfilled' ? (settingsRes.value.data as { body?: unknown })?.body ?? settingsRes.value.data : null);
      setStats(statsRes.status === 'fulfilled' ? (statsRes.value.data as { body?: unknown })?.body ?? statsRes.value.data : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [connId, index, scope, loadMapping]);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl w-[90vw] max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <Database className="h-4 w-4 text-yellow-500" />
            <span className="font-mono">{index}</span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto mr-8 h-7 text-[11px]"
              onClick={() => { onQueryIndex(index); onClose(); }}
            >
              {t('indexBrowser.searchIndex')}
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-1 px-4 py-2 border-b shrink-0">
          <TabBtn label={t('indexBrowser.tabMapping')} active={tab === 'mapping'} onClick={() => setTab('mapping')} />
          <TabBtn label={t('indexBrowser.tabSettings')} active={tab === 'settings'} onClick={() => setTab('settings')} />
          <TabBtn label={t('indexBrowser.tabStats')} active={tab === 'stats'} onClick={() => setTab('stats')} />
        </div>

        <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('common:loading')}
            </div>
          ) : tab === 'mapping' ? (
            fields && fields.length > 0 ? (
              <table className="text-[11px] border-collapse w-full">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="px-2 py-1 text-left border-b font-medium">{t('indexBrowser.colField')}</th>
                    <th className="px-2 py-1 text-left border-b font-medium">{t('indexBrowser.colType')}</th>
                    <th className="px-2 py-1 text-center border-b font-medium">{t('indexBrowser.colSearchable')}</th>
                    <th className="px-2 py-1 text-center border-b font-medium">{t('indexBrowser.colAggregatable')}</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.path} className="hover:bg-accent/20">
                      <td className="px-2 py-0.5 border-b">{f.path}{f.isNested && <span className="text-amber-500"> · {t('indexBrowser.nested')}</span>}</td>
                      <td className="px-2 py-0.5 border-b text-sky-500">{f.type}</td>
                      <td className="px-2 py-0.5 border-b text-center">{f.searchable ? '✓' : '—'}</td>
                      <td className="px-2 py-0.5 border-b text-center">{f.aggregatable ? '✓' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-muted-foreground">{t('indexBrowser.noMappingFields')}</p>
            )
          ) : tab === 'settings' ? (
            <pre className="whitespace-pre-wrap break-words">{colorizeJson(safeJson(settings))}</pre>
          ) : (
            <pre className="whitespace-pre-wrap break-words">{colorizeJson(safeJson(stats))}</pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClick}
      className={cn('h-7 px-2 text-[11px]', active && 'bg-accent')}
    >
      {label}
    </Button>
  );
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v ?? {}, null, 2); } catch { return String(v); }
}
