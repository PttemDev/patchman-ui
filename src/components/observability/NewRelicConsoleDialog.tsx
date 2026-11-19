import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, Play, RefreshCw, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { observabilityConnectionAPI } from '@/services/api';
import { cn } from '@/lib/utils';
import type { ObservabilityConnection } from '@/types';
import { useProviderScopes } from './providerScopes';

type Row = Record<string, unknown>;
type View = 'nrql' | 'alerts' | 'entities';

const DEFAULT_NRQL = 'SELECT count(*), average(duration), percentage(count(*), WHERE error IS true) FROM Transaction FACET appName SINCE 1 hour ago';

function errText(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
}

// A cell: numbers rounded, epoch-ms timestamps as dates, objects as JSON.
function cell(key: string, v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (/(timestamp|At)$/.test(key) && v > 1e12) return new Date(v).toLocaleString();
    return Number.isInteger(v) ? String(v) : v.toFixed(3);
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function ResultTable({ rows, prefer }: { rows: Row[]; prefer?: string[] }) {
  const cols = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows.slice(0, 200)) Object.keys(r).forEach((k) => seen.add(k));
    const rest = [...seen].filter((k) => !prefer?.includes(k));
    return [...(prefer ?? []).filter((k) => seen.has(k)), ...rest];
  }, [rows, prefer]);
  if (rows.length === 0) return null;
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur">
          <tr>{cols.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1 text-left font-medium">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t hover:bg-accent/30">
              {cols.map((c) => <td key={c} className="max-w-[420px] truncate whitespace-nowrap px-2 py-1 font-mono" title={cell(c, r[c])}>{cell(c, r[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// New Relic console for one connection: run NRQL, see alert incidents and
// search entities — through PatchMan, with the connection's stored key.
export function NewRelicConsoleDialog({ open, onOpenChange, connection }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: ObservabilityConnection;
}) {
  const { t } = useTranslation('servicemap');
  const be = connection.beScope;
  const [view, setView] = useState<View>('nrql');
  const { scopes } = useProviderScopes(open ? connection.id : undefined, be);
  const [account, setAccount] = useState(connection.scope ?? '');
  useEffect(() => { if (open) setAccount(connection.scope ?? ''); }, [open, connection.scope]);

  // NRQL
  const [nrql, setNrql] = useState(DEFAULT_NRQL);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState<{ count: number; ms: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const run = useCallback(async () => {
    if (!nrql.trim() || running) return;
    setRunning(true);
    setError('');
    try {
      const res = await observabilityConnectionAPI.newRelicNRQL(connection.id, { query: nrql, accountId: account || undefined }, be);
      const d = res.data as { rows: Row[]; count: number; elapsedMs: number };
      setRows(d.rows ?? []);
      setMeta({ count: d.count ?? 0, ms: d.elapsedMs ?? 0 });
    } catch (e) {
      setRows(null);
      setMeta(null);
      setError(errText(e, t('newrelic.failed')));
    }
    setRunning(false);
  }, [nrql, running, connection.id, account, be, t]);

  // Alerts
  const [alerts, setAlerts] = useState<Row[] | null>(null);
  const [openOnly, setOpenOnly] = useState(true);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState('');
  const loadAlerts = useCallback(async () => {
    setAlertsLoading(true);
    setAlertsError('');
    try {
      const res = await observabilityConnectionAPI.newRelicAlerts(connection.id, { accountId: account || undefined, hours: 24, open: openOnly }, be);
      setAlerts((res.data as Row[]) ?? []);
    } catch (e) {
      setAlerts(null);
      setAlertsError(errText(e, t('newrelic.failed')));
    }
    setAlertsLoading(false);
  }, [connection.id, account, openOnly, be, t]);
  useEffect(() => { if (open && view === 'alerts') void loadAlerts(); }, [open, view, loadAlerts]);

  // Entities
  const [entityQ, setEntityQ] = useState('');
  const [entities, setEntities] = useState<Row[] | null>(null);
  const [entitiesLoading, setEntitiesLoading] = useState(false);
  const [entitiesError, setEntitiesError] = useState('');
  const loadEntities = useCallback(async (q: string) => {
    setEntitiesLoading(true);
    setEntitiesError('');
    try {
      const res = await observabilityConnectionAPI.newRelicEntities(connection.id, q, be);
      setEntities((res.data as Row[]) ?? []);
    } catch (e) {
      setEntities(null);
      setEntitiesError(errText(e, t('newrelic.failed')));
    }
    setEntitiesLoading(false);
  }, [connection.id, be, t]);
  useEffect(() => { if (open && view === 'entities' && entities === null) void loadEntities(''); }, [open, view, entities, loadEntities]);

  const tabs: [View, string][] = [['nrql', t('newrelic.tabNrql')], ['alerts', t('newrelic.tabAlerts')], ['entities', t('newrelic.tabEntities')]];
  const errBox = (msg: string) => (
    <div className="flex items-start gap-2 rounded bg-destructive/10 p-2 text-xs text-destructive">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0 break-words">{msg}</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-[94vw] max-w-[1400px] flex-col gap-3 overflow-hidden">
        <DialogTitle className="text-base">{t('newrelic.title', { name: connection.name })}</DialogTitle>
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <div className="flex items-center rounded-md border p-0.5" role="tablist">
            {tabs.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
                className={cn('h-7 rounded px-3 text-xs', view === k ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {label}
              </button>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {t('conn.scope.account')}
            <select value={account} onChange={(e) => setAccount(e.target.value)} className="h-7 rounded-md border bg-background px-2 text-xs">
              {!account && <option value="">—</option>}
              {account && !scopes?.some((s) => s.id === account) && <option value={account}>{account}</option>}
              {(scopes ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}
            </select>
          </label>
        </div>

        {view === 'nrql' && (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <textarea
              value={nrql}
              onChange={(e) => setNrql(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void run(); } }}
              spellCheck={false}
              rows={4}
              className="w-full resize-y rounded-md border bg-background p-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
              aria-label="NRQL"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" className="h-7 gap-1" disabled={running || !nrql.trim()} onClick={() => void run()}>
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {t('newrelic.run')}
              </Button>
              <span className="text-[11px] text-muted-foreground">{t('newrelic.runHint')}</span>
              {meta && <span className="ml-auto text-[11px] text-muted-foreground">{t('newrelic.rows', { count: meta.count, ms: meta.ms })}</span>}
            </div>
            {error && errBox(error)}
            {rows && rows.length === 0 && <p className="text-xs text-muted-foreground">{t('newrelic.noRows')}</p>}
            {rows && <ResultTable rows={rows} />}
          </div>
        )}

        {view === 'alerts' && (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> {t('newrelic.openOnly')}
              </label>
              <span className="text-[11px] text-muted-foreground">{t('newrelic.last24h')}</span>
              <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1" onClick={() => void loadAlerts()} disabled={alertsLoading}>
                <RefreshCw className={cn('h-3.5 w-3.5', alertsLoading && 'animate-spin')} /> {t('newrelic.refresh')}
              </Button>
            </div>
            {alertsError && errBox(alertsError)}
            {alerts && alerts.length === 0 && !alertsLoading && <p className="text-xs text-muted-foreground">{t('newrelic.noAlerts')}</p>}
            {alerts && <ResultTable rows={alerts} prefer={['state', 'priority', 'title', 'entity', 'condition', 'policy', 'openedAt']} />}
          </div>
        )}

        {view === 'entities' && (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void loadEntities(entityQ); }}>
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={entityQ} onChange={(e) => setEntityQ(e.target.value)} className="h-8 pl-7 font-mono text-xs" placeholder={t('newrelic.entitySearch')} />
              </div>
              <Button size="sm" type="submit" className="h-8" disabled={entitiesLoading}>
                {entitiesLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('newrelic.search')}
              </Button>
            </form>
            {entitiesError && errBox(entitiesError)}
            {entities && entities.length === 0 && !entitiesLoading && <p className="text-xs text-muted-foreground">{t('newrelic.noEntities')}</p>}
            {entities && <ResultTable rows={entities} prefer={['name', 'entityType', 'domain', 'alertSeverity', 'reporting', 'accountId', 'guid']} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
