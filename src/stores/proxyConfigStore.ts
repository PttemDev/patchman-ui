import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ProxyConfigState {
  endpoint: string;
  authHeaderName: string;
  authHeaderValue: string;
  enabled: boolean;
  setConfig: (cfg: Partial<Pick<ProxyConfigState, 'endpoint' | 'authHeaderName' | 'authHeaderValue' | 'enabled'>>) => void;
  clear: () => void;
}

export const useProxyConfigStore = create<ProxyConfigState>()(
  persist(
    (set) => ({
      endpoint: '',
      authHeaderName: '',
      authHeaderValue: '',
      enabled: false,
      setConfig: (cfg) => set((s) => ({ ...s, ...cfg })),
      clear: () =>
        set({ endpoint: '', authHeaderName: '', authHeaderValue: '', enabled: false }),
    }),
    { name: 'patchman-proxy-config' },
  ),
);

export function isCustomProxyReady(): boolean {
  const s = useProxyConfigStore.getState();
  return s.enabled && !!s.endpoint.trim();
}
