import { create } from 'zustand';
import { pluginAPI, type PluginConnection, type PluginInfo } from '@/lib/plugins/pluginApi';
import { registerSensitiveMatcher } from '@/lib/securityClient';

// pluginStore: installed plugins and their connections (RFC §16 P4b). The
// step-up mirror reads `plugins` to know which plugin ops are sensitive.

interface PluginState {
  plugins: PluginInfo[];
  devInstall: boolean;
  /** Signed installs, enable/disable and uninstall are available. */
  manage: boolean;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  connections: Record<string, PluginConnection[]>;
  fetchPlugins: () => Promise<void>;
  fetchConnections: (pluginId: string) => Promise<void>;
  upsertConnection: (c: PluginConnection) => void;
  removeConnection: (pluginId: string, id: string) => void;
}

export const usePluginStore = create<PluginState>((set, get) => ({
  plugins: [],
  devInstall: false,
  manage: false,
  loaded: false,
  loading: false,
  error: null,
  connections: {},

  fetchPlugins: async () => {
    set({ loading: true });
    try {
      const { plugins, devInstall, manage } = await pluginAPI.list();
      set({ plugins, devInstall, manage, loaded: true, loading: false, error: null });
    } catch (err) {
      set({ loading: false, loaded: true, error: err instanceof Error ? err.message : String(err) });
    }
  },

  fetchConnections: async (pluginId) => {
    try {
      const rows = await pluginAPI.listConnections(pluginId);
      set({ connections: { ...get().connections, [pluginId]: rows } });
    } catch {
      set({ connections: { ...get().connections, [pluginId]: [] } });
    }
  },

  upsertConnection: (c) => {
    const list = get().connections[c.pluginId] ?? [];
    const next = list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [c, ...list];
    set({ connections: { ...get().connections, [c.pluginId]: next } });
  },

  removeConnection: (pluginId, id) => {
    const list = get().connections[pluginId] ?? [];
    set({ connections: { ...get().connections, [pluginId]: list.filter((x) => x.id !== id) } });
  },
}));

/** Is this POST a sensitive op of an installed plugin? (step-up mirror) */
export function isSensitivePluginOp(path: string): boolean {
  const m = path.match(/\/api\/plugins\/([^/]+)\/[^/]+\/ops\/([^/?]+)$/);
  if (!m) return false;
  const [, pid, op] = m.map((s) => decodeURIComponent(s));
  const p = usePluginStore.getState().plugins.find((x) => x.id === pid);
  return Boolean(p?.ops[op]?.sensitive);
}

registerSensitiveMatcher((method, path) => method === 'POST' && isSensitivePluginOp(path));
