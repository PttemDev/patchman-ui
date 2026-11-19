import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Play, ShieldAlert, PenLine, Puzzle, AppWindow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { confirmDialog } from '@/components/ui/confirm';
import { pluginAPI } from '@/lib/plugins/pluginApi';
import { usePluginStore } from '@/stores/pluginStore';
import { useRequestStore } from '@/stores/requestStore';
import type { Tab } from '@/types';
import { SchemaForm } from './SchemaForm';
import { schemaDefaults, schemaValues } from './schema';
import { PluginResult } from './PluginResult';
import { PluginFrame } from './PluginFrame';
import { errorLogs, errorMessage, pluginViews } from './util';

// PluginPanel is the `type: 'plugin'` tab: the declarative surface of a
// plugin (RFC §16 P4b). The op list comes from ui.views (or every op), the
// form from the op's input schema, the result view from the view's
// `result`. Nothing the plugin sends is rendered as HTML.
// Form values and the last result per tab, kept outside React so they survive
// a plugin refetch (new objects) and the tab being switched away (unmount).
// Not persisted: results are third-party data and can be large.
const tabState = new Map<string, { key: string; values: Record<string, unknown>; result: { data?: unknown; error?: string } | null }>();

const UI_VIEW = '__ui';

export function PluginPanel({ tab }: { tab: Tab }) {
  const { t } = useTranslation('plugins');
  const updateTab = useRequestStore((s) => s.updateTab);
  const plugins = usePluginStore((s) => s.plugins);
  const loaded = usePluginStore((s) => s.loaded);
  const fetchPlugins = usePluginStore((s) => s.fetchPlugins);
  const conns = usePluginStore((s) => (tab.pluginId ? s.connections[tab.pluginId] : undefined));
  const fetchConnections = usePluginStore((s) => s.fetchConnections);

  useEffect(() => {
    if (!loaded) void fetchPlugins();
  }, [loaded, fetchPlugins]);
  useEffect(() => {
    if (tab.pluginId && !conns) void fetchConnections(tab.pluginId);
  }, [tab.pluginId, conns, fetchConnections]);

  const plugin = plugins.find((p) => p.id === tab.pluginId);
  const conn = conns?.find((c) => c.id === tab.pluginConnectionId);
  const views = useMemo(() => (plugin ? pluginViews(plugin) : []), [plugin]);
  const hasUI = Boolean(plugin?.ui?.entry && plugin.uiRev);
  const showUI = hasUI && (tab.pluginOp === UI_VIEW || !tab.pluginOp);
  const view = views.find((v) => v.op === tab.pluginOp) ?? views[0];
  const op = view && plugin ? plugin.ops[view.op] : undefined;

  // Reset only when the plugin build or the op changes — not when the
  // store hands us fresh objects for the same plugin.
  const stateKey = `${plugin?.id}:${plugin?.wasmSha256}:${view?.op}`;
  const saved = tabState.get(tab.id);
  const [values, setValues] = useState<Record<string, unknown>>(saved?.values ?? {});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ data?: unknown; error?: string } | null>(saved?.result ?? null);
  const inputSchema = useRef(op?.input);
  inputSchema.current = op?.input;

  useEffect(() => {
    if (!plugin || !view) return;
    if (tabState.get(tab.id)?.key === stateKey) return;
    const fresh = schemaDefaults(inputSchema.current);
    setValues(fresh);
    setResult(null);
    tabState.set(tab.id, { key: stateKey, values: fresh, result: null });
  }, [tab.id, stateKey, plugin, view]);

  useEffect(() => {
    const cur = tabState.get(tab.id);
    if (cur && cur.key === stateKey) tabState.set(tab.id, { ...cur, values, result });
  }, [tab.id, stateKey, values, result]);

  if (loaded && !plugin) {
    return <Empty text={t('panel.notInstalled', { id: tab.pluginId ?? '' })} />;
  }
  if (!plugin || !view || !op) {
    return <Empty text={t('panel.loading')} />;
  }
  if (!plugin.enabled) {
    return <Empty text={t('panel.disabled', { name: plugin.name })} />;
  }

  const run = async () => {
    if (!conn) return;
    const input = schemaValues(op.input, values);
    if (input.error) {
      setResult({ error: t('form.badValue', { field: input.error }) });
      return;
    }
    if (op.write) {
      const ok = await confirmDialog({
        title: t('panel.confirmWriteTitle', { op: view.title || view.op }),
        description: t('panel.confirmWriteBody', { conn: conn.name, plugin: plugin.name }),
        confirmLabel: t('panel.run'),
        destructive: true,
      });
      if (!ok) return;
    }
    setRunning(true);
    setResult(null);
    try {
      const r = await pluginAPI.callOp(plugin.id, conn.id, view.op, input.value);
      setResult({ data: r.data });
    } catch (err) {
      const logs = errorLogs(err);
      setResult({ error: logs.length > 0 ? `${errorMessage(err)}\n\n${logs.join('\n')}` : errorMessage(err) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Puzzle className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{plugin.name}</span>
        <select
          aria-label={t('panel.connection')}
          className="h-7 rounded-md border bg-background px-2 text-xs"
          value={tab.pluginConnectionId ?? ''}
          onChange={(e) => updateTab(tab.id, { pluginConnectionId: e.target.value })}
        >
          <option value="">{t('panel.pickConnection')}</option>
          {(conns ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <Badge variant="outline" className="text-[10px]">{t('panel.thirdParty', { publisher: plugin.publisher })}</Badge>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="w-48 shrink-0 overflow-y-auto border-r p-1" aria-label={t('panel.ops')}>
          {hasUI && (
            <button
              type="button"
              onClick={() => updateTab(tab.id, { pluginOp: UI_VIEW })}
              className={`flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs ${showUI ? 'bg-accent' : 'hover:bg-accent/50'}`}
            >
              <AppWindow className="h-3 w-3 shrink-0" />
              <span className="truncate">{t('frame.nav')}</span>
            </button>
          )}
          {views.map((v) => {
            const o = plugin.ops[v.op];
            return (
              <button
                key={v.op}
                type="button"
                onClick={() => updateTab(tab.id, { pluginOp: v.op })}
                className={`flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs ${!showUI && v.op === view.op ? 'bg-accent' : 'hover:bg-accent/50'}`}
              >
                <span className="truncate">{v.title || v.op}</span>
                {o?.write && <PenLine className="h-3 w-3 shrink-0 text-amber-500" aria-label={t('panel.write')} />}
                {o?.sensitive && <ShieldAlert className="h-3 w-3 shrink-0 text-destructive" aria-label={t('panel.sensitive')} />}
              </button>
            );
          })}
        </nav>
        {showUI ? (
          <div className="min-w-0 flex-1">
            <PluginFrame tabId={tab.id} plugin={plugin} conn={conn} />
          </div>
        ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="space-y-3 border-b p-3">
            {op.description && <p className="text-xs text-muted-foreground">{op.description}</p>}
            <SchemaForm schema={op.input} values={values} onChange={setValues} disabled={running} />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={run} disabled={running || !conn}>
                {running ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                {t('panel.run')}
              </Button>
              {!conn && <span className="text-xs text-muted-foreground">{t('panel.pickConnection')}</span>}
              {op.write && conn && !conn.allowWrite && (
                <span className="text-xs text-amber-600">{t('panel.readOnlyConn')}</span>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {result?.error && <pre className="whitespace-pre-wrap break-all text-xs text-destructive">{result.error}</pre>}
            {result && !result.error && (
              <>
                <p className="mb-2 text-[11px] text-muted-foreground">{t('panel.untrusted')}</p>
                <PluginResult data={result.data} mode={view.result ?? 'json'} />
              </>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">{text}</div>;
}
