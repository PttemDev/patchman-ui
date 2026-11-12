import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, ExternalLink, Folder, Globe, Loader2, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { grafanaAPI } from '@/services/api';
import { useGrafanaConnectionStore, scopeForGrafana, grafanaError } from '@/stores/grafanaConnectionStore';
import { useRequestStore } from '@/stores/requestStore';
import { cn } from '@/lib/utils';
import type { GrafanaDashboard, GrafanaPanel, GrafanaVariable, GrafanaVarValue, Tab } from '@/types';
import { TimeRangePicker, RefreshPicker, type TimeRange } from './TimeRangePicker';
import { intervalMs } from './timeRange';
import { VariablePicker } from './VariablePicker';
import { PanelView, type PanelContext } from './panels/PanelView';
import { QueryInspector } from './QueryInspector';
import { grafanaLink, openGrafanaTab } from './useOpenGrafana';

const CELL = 30; // Grafana grid row height (px)
const GAP = 8;

interface Section {
  key: string;
  row?: GrafanaPanel;
  panels: GrafanaPanel[];
}

/** Top-level panels → sections: panels before the first row, then one per
 *  row (expanded rows own the panels that follow them; collapsed rows carry
 *  theirs nested). y is normalised per section. */
function sections(panels: GrafanaPanel[]): Section[] {
  const sorted = [...panels].sort((a, b) => (a.gridPos?.y ?? 0) - (b.gridPos?.y ?? 0) || (a.gridPos?.x ?? 0) - (b.gridPos?.x ?? 0));
  const out: Section[] = [{ key: 'top', panels: [] }];
  for (const p of sorted) {
    if (p.type === 'row') {
      out.push({ key: `row-${p.id ?? out.length}`, row: p, panels: p.collapsed ? [...(p.panels ?? [])] : [] });
      continue;
    }
    out[out.length - 1].panels.push(p);
  }
  return out.filter((s) => s.row || s.panels.length > 0);
}

function useWidth(ref: React.RefObject<HTMLElement>) {
  const [w, setW] = useState(1200);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export function DashboardView({ tab }: { tab: Tab }) {
  const { t } = useTranslation('grafana');
  const updateTab = useRequestStore((s) => s.updateTab);
  const { connections, loaded, fetchConnections } = useGrafanaConnectionStore();
  const connId = tab.grafanaConnectionId ?? '';
  const uid = tab.grafanaDashboardUid ?? '';
  // Public dashboard (shared by link): loaded and queried through Grafana's
  // public API — no variables, no ad-hoc queries.
  const publicToken = tab.grafanaPublicToken ?? '';
  const conn = connections.find((c) => c.id === connId);
  const scope = scopeForGrafana(connections, connId);

  const [dash, setDash] = useState<GrafanaDashboard | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [vars, setVars] = useState<GrafanaVariable[] | null>(null);
  const [varsLoading, setVarsLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const [viewing, setViewing] = useState<GrafanaPanel | null>(null);
  const [querying, setQuerying] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const width = useWidth(bodyRef);

  useEffect(() => { if (!loaded) void fetchConnections(); }, [loaded, fetchConnections]);

  const range: TimeRange = tab.grafanaRange ?? dash?.dashboard.time ?? { from: 'now-6h', to: 'now' };
  const dashRefresh = dash?.dashboard.refresh;
  const refresh = tab.grafanaRefresh ?? (typeof dashRefresh === 'string' ? dashRefresh : '');

  const loadDashboard = useCallback(async () => {
    if (!connId || (!uid && !publicToken)) return;
    setError(null);
    try {
      const res = publicToken ? await grafanaAPI.publicDashboard(connId, publicToken, scope) : await grafanaAPI.dashboard(connId, uid, scope);
      const d = res.data as GrafanaDashboard;
      setDash(d);
      if (d.dashboard.title && d.dashboard.title !== tab.name) updateTab(tab.id, { name: d.dashboard.title });
    } catch (e) {
      setError(grafanaError(e));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, uid, publicToken, scope]);

  useEffect(() => { if (loaded) void loadDashboard(); }, [loaded, loadDashboard]);

  // Resolve variables (in order, server-side) whenever the dashboard, the
  // selection or the range changes.
  const varsKey = JSON.stringify(tab.grafanaVars ?? {});
  useEffect(() => {
    if (!dash) return;
    const list = dash.dashboard.templating?.list ?? [];
    if (list.length === 0 || publicToken) {
      setVars([]);
      return;
    }
    const ac = new AbortController();
    setVarsLoading(true);
    const selected: Record<string, { values: string[] }> = {};
    for (const [k, v] of Object.entries(tab.grafanaVars ?? {})) selected[k] = { values: v };
    grafanaAPI.variables(connId, { templating: list, selected, from: range.from, to: range.to }, scope, ac.signal)
      .then((res) => setVars(((res.data as GrafanaVariable[]) ?? []).map((v) => ({
        ...v,
        options: v.options ?? [],
        current: { ...(v.current ?? {}), values: v.current?.values ?? [], texts: v.current?.texts ?? [] },
      }))))
      .catch((e) => { if (!ac.signal.aborted) { setVars([]); setError(grafanaError(e)); } })
      .finally(() => { if (!ac.signal.aborted) setVarsLoading(false); });
    return () => ac.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dash, varsKey, range.from, range.to, connId, scope]);

  useEffect(() => {
    if (!viewing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role=dialog]')) setViewing(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewing]);

  // Auto refresh.
  useEffect(() => {
    const ms = intervalMs(refresh);
    if (!ms) return;
    const id = window.setInterval(() => setTick((n) => n + 1), Math.max(ms, 5000));
    return () => window.clearInterval(id);
  }, [refresh]);

  const varMap = useMemo(() => {
    const m: Record<string, GrafanaVarValue> = {};
    for (const v of vars ?? []) m[v.name] = v.current;
    return m;
  }, [vars]);

  const interpolate = useCallback((raw: string) => {
    const s = typeof raw === 'string' ? raw : String(raw ?? ''); // arbitrary JSON: titles can be numbers
    if (!s || !s.includes('$')) return s;
    return s.replace(/\$\{(\w+)(?::[^}]*)?\}|\$(\w+)|\[\[(\w+)\]\]/g, (m, a, b, c) => {
      const name = a || b || c;
      const v = varMap[name];
      if (!v) return m;
      if (v.values.includes('$__all')) return 'All';
      return (v.texts?.length ? v.texts : v.values).join(' + ');
    });
  }, [varMap]);

  const setRange = (r: TimeRange) => updateTab(tab.id, { grafanaRange: r });
  const setVar = (name: string, values: string[]) => updateTab(tab.id, { grafanaVars: { ...(tab.grafanaVars ?? {}), [name]: values } });

  const dashboardUrl = useMemo(() => {
    if (!conn || !dash) return '';
    if (publicToken) return grafanaLink(conn.url, `/public-dashboards/${publicToken}`);
    const path = dash.meta.url || `/d/${uid}`;
    try {
      const u = new URL(conn.url);
      if (u.pathname !== '/' && path.startsWith(u.pathname)) return u.origin + path;
    } catch { /* fall through */ }
    return grafanaLink(conn.url, path);
  }, [conn, dash, uid, publicToken]);

  const linkFor = useCallback((panelId?: number) => {
    if (!dashboardUrl) return '';
    if (publicToken) return dashboardUrl;
    const p = new URLSearchParams({ from: range.from, to: range.to });
    if (panelId != null) p.set('viewPanel', String(panelId));
    for (const v of vars ?? []) for (const val of v.current.values) p.append(`var-${v.name}`, val);
    return `${dashboardUrl}?${p.toString()}`;
  }, [dashboardUrl, range.from, range.to, vars, publicToken]);

  // Panel links (polystat click-through …): a dashboard on this Grafana opens
  // as a PatchMan tab with the link's variables and range; anything else in
  // the browser.
  const openLink = useCallback((raw: string) => {
    if (!conn) return;
    const url = raw
      .replace(/\$\{__from\}|\$__from\b/g, range.from)
      .replace(/\$\{__to\}|\$__to\b/g, range.to)
      .replace(/\$\{(\w+)(?::[^}]*)?\}|\$(\w+)/g, (m, a, b) => {
        const v = varMap[a || b];
        return v ? encodeURIComponent(v.values.includes('$__all') ? '$__all' : v.values.join(',')) : m;
      });
    let abs: URL;
    let root: URL;
    try {
      root = new URL(conn.url);
      const rootPath = root.pathname.replace(/\/+$/, '');
      abs = /^https?:\/\//i.test(url) ? new URL(url)
        : new URL(url.startsWith('/') && rootPath && url.startsWith(`${rootPath}/`) ? root.origin + url : grafanaLink(conn.url, url));
    } catch {
      return;
    }
    const rootPath = root.pathname.replace(/\/+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = abs.origin === root.origin ? new RegExp(`^${rootPath}/d/([^/?#]+)(?:/([^/?#]+))?`).exec(abs.pathname) : null;
    if (m && !publicToken) {
      const vars: Record<string, string[]> = {};
      abs.searchParams.forEach((v, k) => { if (k.startsWith('var-')) (vars[k.slice(4)] ??= []).push(v); });
      const from = abs.searchParams.get('from');
      const to = abs.searchParams.get('to');
      openGrafanaTab({
        connId, view: 'dashboard', uid: decodeURIComponent(m[1]), title: m[2] ? decodeURIComponent(m[2]).replace(/-/g, ' ') : m[1],
        vars: Object.keys(vars).length ? vars : undefined,
        range: from && to ? { from, to } : undefined,
      });
      return;
    }
    if (/^https?:$/.test(abs.protocol)) window.open(abs.toString(), '_blank', 'noopener');
  }, [conn, connId, range.from, range.to, varMap, publicToken]);

  const syncId = (dash?.dashboard.graphTooltip ?? 0) > 0 ? `grafana-${tab.id}` : undefined;
  const ctx: PanelContext | null = useMemo(() => (vars === null ? null : {
    connId, scope, from: range.from, to: range.to, vars: varMap, tick, linkFor, interpolate, syncId,
    connName: conn?.name, publicToken: publicToken || undefined, openLink,
    onView: (p: GrafanaPanel) => setViewing(p),
    onZoom: (from: number, to: number) => setRange({ from: String(Math.round(from)), to: String(Math.round(to)) }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [vars, connId, scope, range.from, range.to, varMap, tick, linkFor, interpolate, syncId, conn?.name, publicToken, openLink]);
  // Datasource for a fresh dashboard-level query: the first panel that has one.
  const firstDatasource = useMemo(() => {
    const walk = (ps: GrafanaPanel[] = []): unknown => {
      for (const p of ps) {
        if (p.datasource && p.type !== 'row') return p.datasource;
        const nested = walk(p.panels);
        if (nested) return nested;
      }
      return undefined;
    };
    return walk(dash?.dashboard.panels);
  }, [dash]);

  const secs = useMemo(() => sections(dash?.dashboard.panels ?? []), [dash]);
  const narrow = width < 700;

  if (!connId || (!uid && !publicToken)) return <div className="p-6 text-sm text-muted-foreground">{t('dashboard.missing')}</div>;
  if (loaded && !conn) return <div className="p-6 text-sm text-muted-foreground">{t('dashboard.connectionGone')}</div>;

  return (
    <div className="h-full flex flex-col min-h-0 bg-background">
      <div className="shrink-0 border-b px-3 py-2 space-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
              <Folder className="h-3 w-3 shrink-0" />
              <span className="truncate">{dash?.meta.folderTitle || t('sidebar.general')}</span>
              {conn && <span className="truncate opacity-70">· {conn.name}</span>}
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-semibold truncate">{dash?.dashboard.title ?? tab.name}</h2>
              {dash?.meta.schema === 'v2' && <Badge variant="secondary" className="text-[9px] px-1 py-0">v2</Badge>}
              {publicToken && (
                <Badge variant="secondary" className="text-[9px] px-1 py-0 gap-0.5" title={t('dashboard.publicHint')}>
                  <Globe className="h-2.5 w-2.5" />{t('dashboard.public')}
                </Badge>
              )}
              {varsLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
          </div>
          {viewing && (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setViewing(null)} title="Esc">
              <ArrowLeft className="h-3.5 w-3.5" /> {t('dashboard.backToDashboard')}
            </Button>
          )}
          {ctx && !publicToken && (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setQuerying(true)} title={t('dashboard.runQueryHint')}>
              <Terminal className="h-3.5 w-3.5" /> {t('dashboard.runQuery')}
            </Button>
          )}
          <TimeRangePicker value={range} onChange={setRange} />
          <RefreshPicker value={refresh} onChange={(v) => updateTab(tab.id, { grafanaRefresh: v })} onRefresh={() => setTick((n) => n + 1)} />
          {dashboardUrl && (
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" title={t('panel.openInGrafana')} onClick={() => window.open(linkFor(), '_blank', 'noopener')}>
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        {vars && vars.some((v) => v.hide !== 2) && (
          <div className="flex flex-wrap gap-1.5">
            {vars.filter((v) => v.hide !== 2).map((v) => (
              <VariablePicker key={v.name} v={v} onChange={(vals) => setVar(v.name, vals)} />
            ))}
          </div>
        )}
      </div>

      <div ref={bodyRef} className="flex-1 min-h-0 overflow-auto p-2">
        {error ? (
          <div className="m-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div>{error.message}</div>
              {(error.code === 'session_expired' || error.code === 'auth') && <div className="text-xs text-muted-foreground">{t('dashboard.authHint')}</div>}
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setDash(null); void loadDashboard(); }}>{t('common:retry')}</Button>
            </div>
          </div>
        ) : !dash || !ctx ? (
          <div className="h-full flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : viewing ? (
          <div className="h-full min-h-[320px]">
            <PanelView key={`view-${viewing.id}`} panel={viewing} ctx={{ ...ctx, onView: undefined }} height={Math.max(320, (bodyRef.current?.clientHeight ?? 600) - 16)} />
          </div>
        ) : secs.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">{t('dashboard.empty')}</div>
        ) : (
          <div className="space-y-2">
            {secs.map((s) => {
              const rowOpen = s.row ? (openRows[s.key] ?? !s.row.collapsed) : true;
              const minY = Math.min(...s.panels.map((p) => p.gridPos?.y ?? 0));
              const ordered = [...s.panels].sort((a, b) => (a.gridPos?.y ?? 0) - (b.gridPos?.y ?? 0) || (a.gridPos?.x ?? 0) - (b.gridPos?.x ?? 0));
              return (
                <div key={s.key}>
                  {s.row && (
                    <button type="button" onClick={() => setOpenRows((m) => ({ ...m, [s.key]: !rowOpen }))} className="flex items-center gap-1 text-sm font-semibold py-1 hover:text-primary">
                      {rowOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      {interpolate(s.row.title ?? '') || t('dashboard.row')}
                      {!rowOpen && <span className="text-[11px] font-normal text-muted-foreground">({t('dashboard.panelsCount', { count: s.panels.length })})</span>}
                    </button>
                  )}
                  {rowOpen && s.panels.length > 0 && (
                    narrow ? (
                      <div className="space-y-2">
                        {ordered.map((p, i) => (
                          <PanelView key={p.id ?? i} panel={p} ctx={ctx} height={Math.max(160, (p.gridPos?.h ?? 8) * CELL + ((p.gridPos?.h ?? 8) - 1) * GAP)} />
                        ))}
                      </div>
                    ) : (
                      <div className="grid" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))', gridAutoRows: `${CELL}px`, gap: GAP }}>
                        {ordered.map((p, i) => {
                          const g = p.gridPos ?? { x: 0, y: 0, w: 12, h: 8 };
                          const h = Math.max(1, g.h);
                          return (
                            <div key={p.id ?? i} style={{ gridColumn: `${Math.min(g.x, 23) + 1} / span ${Math.max(1, Math.min(g.w, 24 - Math.min(g.x, 23)))}`, gridRow: `${g.y - minY + 1} / span ${h}` }} className={cn('min-w-0')}>
                              <PanelView panel={p} ctx={ctx} height={h * CELL + (h - 1) * GAP} />
                            </div>
                          );
                        })}
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {querying && ctx && (
        <QueryInspector
          open={querying}
          onOpenChange={setQuerying}
          connId={connId}
          connName={conn?.name}
          scope={scope}
          title={`${t('dashboard.runQuery')} · ${dash?.dashboard.title ?? ''}`}
          from={range.from}
          to={range.to}
          vars={varMap}
          defaultDatasource={firstDatasource}
        />
      )}
    </div>
  );
}
