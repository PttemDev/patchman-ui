// Plugin backbone client (PLUGIN_MARKETPLACE_RFC §15–16). Plugins install
// only on the desktop's embedded BE (P3/P4), so every call is pinned there on
// desktop; the web build talks to its own BE, which lists none until P5.

import api from '@/services/api';
import { isDesktop } from '@/lib/platform';

export interface PluginNetRule {
  host?: string;
  from?: string;
  ports?: number[];
  portsFrom?: string;
  private?: boolean;
}

export interface PluginOp {
  description?: string;
  input?: JSONSchema;
  output?: JSONSchema;
  write?: boolean;
  sensitive?: boolean;
}

export interface PluginView {
  op: string;
  title?: string;
  result?: 'json' | 'table' | 'text';
}

export interface PluginInfo {
  id: string;
  version: string;
  name: string;
  publisher: string;
  description?: string;
  source: string;
  enabled: boolean;
  wasmSha256: string;
  connection: { schema?: JSONSchema; secretFields?: string[] };
  permissions: { net?: PluginNetRule[] };
  limits: { memoryMB: number; timeoutSeconds: number; concurrency: number };
  ops: Record<string, PluginOp>;
  mcpTools?: string[];
  ui?: { views?: PluginView[]; entry?: string };
  /** Cache key of the custom UI bundle (present when ui.entry is). */
  uiRev?: string;
  /** Signed installs: the link or path it came from and the signer's key id. */
  sourcePath?: string;
  signer?: string;
  updatedAt: string;
}

export interface PluginConnection {
  id: string;
  pluginId: string;
  userId: string;
  name: string;
  config: Record<string, unknown>;
  secretsSet: string[];
  allowWrite: boolean;
  ownerName?: string;
  shared: boolean;
  grantRole?: 'owner' | 'read' | 'write';
  createdAt: string;
  updatedAt: string;
}

/** The subset of JSON Schema the generated forms understand. */
export interface JSONSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  enum?: unknown[];
  default?: unknown;
  items?: JSONSchema;
  format?: string;
}

export interface OpResult {
  data: unknown;
  source?: { plugin: string; version: string; untrusted: boolean };
}

const pin = () => (isDesktop() ? { _executionPin: 'local' as const } : {});
const enc = encodeURIComponent;

export const pluginAPI = {
  list: async (): Promise<{ plugins: PluginInfo[]; devInstall: boolean; manage: boolean }> => {
    const res = await api.get('/plugins', pin());
    const body = res.data as { data?: PluginInfo[]; devInstall?: boolean; manage?: boolean } | PluginInfo[];
    if (Array.isArray(body)) return { plugins: body, devInstall: false, manage: false };
    return { plugins: body.data ?? [], devInstall: Boolean(body.devInstall), manage: Boolean(body.manage) };
  },
  /** What a signed package is and would add, without installing it. */
  preview: async (source: string, token?: string): Promise<InstallPreview> =>
    (await api.post('/plugins/install/preview', { source, token: token || undefined }, { ...pin(), timeout: 200000 })).data as InstallPreview,
  /** Installs or updates a signed package (asks for step-up). */
  install: async (source: string, token?: string) => {
    const res = await api.post('/plugins/install', { source, token: token || undefined }, { ...pin(), timeout: 200000 });
    return res.data as { data: PluginInfo; addedPermissions: string[] | null; reinstall: boolean };
  },
  trustedKeys: async (): Promise<TrustedKey[]> => ((await api.get('/plugins/trusted-keys', pin())).data as TrustedKey[]) ?? [],
  addTrustedKey: async (name: string, publicKey: string): Promise<TrustedKey> =>
    (await api.post('/plugins/trusted-keys', { name, publicKey }, pin())).data as TrustedKey,
  deleteTrustedKey: (keyId: string) => api.delete(`/plugins/trusted-keys/${enc(keyId)}`, pin()),
  devInstall: async (path: string) => {
    const res = await api.post('/plugins/dev-install', { path }, pin());
    return res.data as { data: PluginInfo; addedPermissions: string[] | null; reinstall: boolean };
  },
  setEnabled: (id: string, enabled: boolean) => api.patch(`/plugins/${enc(id)}`, { enabled }, pin()),
  uninstall: (id: string) => api.delete(`/plugins/${enc(id)}`, pin()),

  listConnections: async (pluginId: string): Promise<PluginConnection[]> =>
    ((await api.get(`/plugin-connections/${enc(pluginId)}`, pin())).data as PluginConnection[]) ?? [],
  createConnection: async (pluginId: string, body: ConnectionBody): Promise<PluginConnection> =>
    (await api.post(`/plugin-connections/${enc(pluginId)}`, body, pin())).data as PluginConnection,
  updateConnection: async (pluginId: string, id: string, body: Partial<ConnectionBody>): Promise<PluginConnection> =>
    (await api.patch(`/plugin-connections/${enc(pluginId)}/${enc(id)}`, body, pin())).data as PluginConnection,
  deleteConnection: (pluginId: string, id: string) => api.delete(`/plugin-connections/${enc(pluginId)}/${enc(id)}`, pin()),
  testConnection: async (pluginId: string, id: string | null, body?: Partial<ConnectionBody>) => {
    const url = id ? `/plugin-connections/${enc(pluginId)}/${enc(id)}/test` : `/plugin-connections/${enc(pluginId)}/test`;
    return (await api.post(url, body, { ...pin(), timeout: 60000 })).data as { ok: boolean; error?: string; result?: unknown };
  },
  revealSecret: async (pluginId: string, id: string, which: string): Promise<string> =>
    ((await api.post(`/plugin-connections/${enc(pluginId)}/${enc(id)}/reveal-secret`, { which }, pin())).data as { value: string }).value,

  callOp: async (pluginId: string, connId: string, op: string, input: unknown): Promise<OpResult> => {
    const res = await api.post(`/plugins/${enc(pluginId)}/${enc(connId)}/ops/${enc(op)}`, input ?? {}, pin());
    return res.data as OpResult;
  },
};

export interface InstallPreview extends PluginInfo {
  signerName: string;
  installedVersion?: string;
  addedPermissions: string[];
  downgrade: boolean;
  hasUI: boolean;
}

export interface TrustedKey {
  keyId: string;
  name: string;
  publicKey: string;
  fromEnv: boolean;
  createdAt?: string;
}

export interface ConnectionBody {
  id?: string;
  name: string;
  config: Record<string, unknown>;
  secrets?: Record<string, string>;
  allowWrite?: boolean;
}
