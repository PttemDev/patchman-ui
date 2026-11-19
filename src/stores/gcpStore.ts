import { create } from 'zustand';
import { gcpAPI, type DBScope } from '@/services/api';
import { availableDBScopes, dualWrite } from '@/stores/dbConnectionStore';
import { useRequestStore } from '@/stores/requestStore';
import type { GCPCredential, Tab } from '@/types';

// Google Cloud credentials across the reachable backends. A service account
// is dual-written (same FE-generated id on every backend, like DB
// connections); gcloud credentials live only on the desktop backend; a linked
// Google account lives where it was linked.

interface GCPState {
  credentials: GCPCredential[];
  oauthAvailable: boolean;
  adcAllowed: boolean;
  loading: boolean;
  error: string;
  fetch: () => Promise<void>;
  addServiceAccount: (key: string, name: string, projectId: string, readWrite: boolean) => Promise<GCPCredential>;
  addADC: (name: string, projectId: string, readWrite: boolean) => Promise<GCPCredential>;
  update: (c: GCPCredential, body: { name?: string; projectId?: string; readWrite?: boolean }) => Promise<void>;
  remove: (c: GCPCredential, confirm: boolean) => Promise<{ usedBy?: string[] }>;
}

/** The backend a credential's calls go to (remote preferred when it has a copy there). */
export function gcpScope(c?: GCPCredential): DBScope | undefined {
  return c?.scope;
}

/** Body of a backend answer: the axios interceptor already strips a lone
 *  {"data": …} wrapper, but not one with siblings (meta, warning). */
export function gcpData<T>(r: { data: unknown }): T {
  const d = r.data as { data?: unknown } | null;
  return (d && typeof d === 'object' && !Array.isArray(d) && 'data' in d ? d.data : d) as T;
}

export const useGCPStore = create<GCPState>((set, get) => ({
  credentials: [],
  oauthAvailable: false,
  adcAllowed: false,
  loading: false,
  error: '',
  fetch: async () => {
    set({ loading: true, error: '' });
    const scopes = availableDBScopes();
    const results = await Promise.allSettled(scopes.map((s) => gcpAPI.list(s)));
    const byId = new Map<string, GCPCredential>();
    let oauth = false;
    let adc = false;
    let err = '';
    // Remote first so a dual-written credential is used remotely, local
    // only for what exists nowhere else (gcloud on this computer).
    const order = scopes.map((s, i) => ({ s, r: results[i] })).sort((a, b) => (a.s === 'remote' ? 0 : 1) - (b.s === 'remote' ? 0 : 1));
    for (const { s, r } of order) {
      if (r.status !== 'fulfilled') { err = String((r.reason as Error)?.message ?? r.reason); continue; }
      const body = r.value.data as { data: GCPCredential[]; meta?: { oauthAvailable?: boolean; adcAllowed?: boolean } };
      oauth ||= !!body.meta?.oauthAvailable;
      adc ||= !!body.meta?.adcAllowed;
      for (const c of body.data ?? []) {
        if (c.kind === 'adc' && s !== 'local') continue;
        if (!byId.has(c.id)) byId.set(c.id, { ...c, scope: s });
      }
    }
    set({ credentials: Array.from(byId.values()), oauthAvailable: oauth, adcAllowed: adc, loading: false, error: byId.size ? '' : err });
  },
  addServiceAccount: async (key, name, projectId, readWrite) => {
    const id = crypto.randomUUID();
    const res = await dualWrite((s) => gcpAPI.create({ id, kind: 'service_account', key, name, projectId, readWrite }, s));
    const ok = res.find((r) => r.ok);
    if (!ok) throw res[0]?.error;
    await get().fetch();
    return gcpData<GCPCredential>(ok.value!);
  },
  addADC: async (name, projectId, readWrite) => {
    const res = await gcpAPI.create({ id: crypto.randomUUID(), kind: 'adc', name, projectId, readWrite }, 'local');
    await get().fetch();
    return gcpData<GCPCredential>(res);
  },
  update: async (c, body) => {
    const scopes: DBScope[] = c.kind === 'service_account' ? availableDBScopes() : [c.scope ?? 'remote'];
    const res = await dualWrite((s) => gcpAPI.update(c.id, body, s), scopes);
    if (!res.some((r) => r.ok)) throw res[0]?.error;
    await get().fetch();
  },
  remove: async (c, confirm) => {
    const scopes: DBScope[] = c.kind === 'service_account' ? availableDBScopes() : [c.scope ?? 'remote'];
    const res = await dualWrite((s) => gcpAPI.remove(c.id, confirm, s), scopes);
    const conflict = res.find((r) => !r.ok && (r.error as { response?: { status?: number } })?.response?.status === 409);
    if (conflict) {
      const d = (conflict.error as { response?: { data?: { usedBy?: string[] } } }).response?.data;
      return { usedBy: d?.usedBy ?? [] };
    }
    await get().fetch();
    return {};
  },
}));

/** Opens (or focuses) the Google Cloud tab of a credential on a service. */
export function openGCP(c: GCPCredential, service: NonNullable<Tab['gcpService']>, name?: string) {
  const rs = useRequestStore.getState();
  const existing = rs.tabs.find((t) => t.type === 'gcp' && t.gcpCredentialId === c.id && t.gcpService === service);
  if (existing) { rs.setActiveTab(existing.id); return; }
  rs.addTab({ type: 'gcp', method: 'GET', url: '', name: name ?? c.name, gcpCredentialId: c.id, gcpService: service, gcpProject: c.projectId } as Tab, true);
}
