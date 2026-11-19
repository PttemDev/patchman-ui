// BigQuery part of the DB connection dialog: project, location, how to sign
// in (service account key / gcloud on this computer / a shared Google Cloud
// credential) and the connection's own scan limits (GOOGLE_CLOUD_RFC.md
// ADR-3). Host, port, user and DSN don't apply to BigQuery.

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, KeyRound, Laptop, Plus, Upload, UserRound } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { isDesktop } from '@/lib/platform';
import { useGCPStore } from '@/stores/gcpStore';
import { useSettingsUIStore } from '@/stores/settingsUIStore';
import type { GCPCredential } from '@/types';

export type BigQueryAuth = 'service_account' | 'adc' | 'credential';

export interface BigQueryFieldsState {
  auth: BigQueryAuth;
  /** auth 'credential': the shared Google Cloud credential (gcp_credentials id). */
  credentialId: string;
  location: string;
  /** GB; '' = use the user's Settings value. */
  maxGB: string;
  askGB: string;
}

export const GIB = 1024 ** 3;

/** Options sent to the BE for a BigQuery connection. */
export function bigQueryOptions(base: Record<string, unknown>, s: BigQueryFieldsState): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base, auth: s.auth };
  delete out.location; delete out.maxBytesBilled; delete out.askBytes; delete out.gcpCredentialId;
  if (s.auth === 'credential') out.gcpCredentialId = s.credentialId;
  if (s.location.trim()) out.location = s.location.trim();
  const max = parseFloat(s.maxGB);
  const ask = parseFloat(s.askGB);
  if (max > 0) out.maxBytesBilled = Math.round(max * GIB);
  if (ask > 0) out.askBytes = Math.round(ask * GIB);
  return out;
}

export function bigQueryStateFrom(opts: Record<string, unknown> | undefined): BigQueryFieldsState {
  const n = (v: unknown) => (typeof v === 'number' && v > 0 ? String(+(v / GIB).toFixed(2)) : '');
  return {
    auth: opts?.auth === 'adc' || opts?.auth === 'credential' ? opts.auth : 'service_account',
    credentialId: typeof opts?.gcpCredentialId === 'string' ? opts.gcpCredentialId : '',
    location: typeof opts?.location === 'string' ? opts.location : '',
    maxGB: n(opts?.maxBytesBilled),
    askGB: n(opts?.askBytes),
  };
}

export function BigQueryConnectionFields({ state, onChange, project, onProject, keyJSON, onKey, keyStored, ownerAccount }: {
  state: BigQueryFieldsState;
  onChange: (s: BigQueryFieldsState) => void;
  project: string;
  onProject: (v: string) => void;
  keyJSON: string;
  onKey: (v: string) => void;
  /** Editing / duplicating: a key is already stored (leave blank to keep). */
  keyStored: boolean;
  /** Editing someone else's shared connection: the account its owner's
   *  credential signs in as (the picker only lists the viewer's own). */
  ownerAccount?: string;
}) {
  const { t } = useTranslation('dbquery');
  const file = useRef<HTMLInputElement>(null);
  const desktop = isDesktop();
  const set = (patch: Partial<BigQueryFieldsState>) => onChange({ ...state, ...patch });
  const credentials = useGCPStore((s) => s.credentials);
  const fetchCredentials = useGCPStore((s) => s.fetch);
  const loadingCredentials = useGCPStore((s) => s.loading);
  const credential = credentials.find((c) => c.id === state.credentialId);
  useEffect(() => { if (state.auth === 'credential') void fetchCredentials(); }, [state.auth, fetchCredentials]);

  const readKey = async (f: File | undefined) => {
    if (!f) return;
    const text = await f.text();
    onKey(text);
    try {
      const k = JSON.parse(text) as { project_id?: string };
      if (k.project_id && !project) onProject(k.project_id);
    } catch { /* the BE reports a bad key */ }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_160px] gap-3">
        <div>
          <Label className="text-xs">{t('bigquery.project')}</Label>
          <Input value={project} onChange={(e) => onProject(e.target.value)} placeholder="my-gcp-project" className="font-mono" />
        </div>
        <div>
          <Label className="text-xs">{t('bigquery.location')} <span className="text-muted-foreground">{t('bigquery.optional')}</span></Label>
          <Input value={state.location} onChange={(e) => set({ location: e.target.value })} placeholder="EU / US / europe-west3" className="font-mono" />
        </div>
      </div>

      <div>
        <Label className="text-xs">{t('bigquery.auth')}</Label>
        <div className="mt-1 grid grid-cols-1 gap-1.5">
          <AuthCard active={state.auth === 'service_account'} onClick={() => set({ auth: 'service_account' })}
            icon={<KeyRound className="h-4 w-4" />} title={t('bigquery.authKey')} desc={t('bigquery.authKeyDesc')} />
          <AuthCard active={state.auth === 'adc'} onClick={() => desktop && set({ auth: 'adc' })} disabled={!desktop}
            icon={<Laptop className="h-4 w-4" />} title={t('bigquery.authGcloud')} desc={desktop ? t('bigquery.authGcloudDesc') : t('bigquery.authGcloudDesktopOnly')} />
          <AuthCard active={state.auth === 'credential'} onClick={() => set({ auth: 'credential' })}
            icon={<UserRound className="h-4 w-4" />} title={t('bigquery.authCredential')} desc={t('bigquery.authCredentialDesc')} />
        </div>
      </div>

      {state.auth === 'service_account' ? (
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">
              {t('bigquery.key')}
              {keyStored && !keyJSON && <span className="text-muted-foreground"> {t('bigquery.keyKeep')}</span>}
            </Label>
            <button type="button" onClick={() => file.current?.click()} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              <Upload className="h-3 w-3" /> {t('bigquery.keyUpload')}
            </button>
            <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void readKey(e.target.files?.[0])} />
          </div>
          <Textarea value={keyJSON} onChange={(e) => onKey(e.target.value)} className="min-h-[90px] font-mono text-[11px]"
            placeholder='{"type": "service_account", "project_id": "…", "client_email": "…", "private_key": "…"}'
            autoComplete="off" data-1p-ignore data-lpignore="true" />
          <p className="mt-1 text-[10px] text-muted-foreground">{t('bigquery.keyNote')}</p>
        </div>
      ) : state.auth === 'credential' ? (
        <CredentialPicker credentials={credentials} credential={credential} value={state.credentialId}
          loading={loadingCredentials} ownerAccount={ownerAccount}
          onPick={(id) => set({ credentialId: id })} onOpen={() => void fetchCredentials()} />
      ) : (
        <p className="rounded-md border bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
          {t('bigquery.gcloudNote')} <code className="font-mono">gcloud auth application-default login</code>
        </p>
      )}

      <div>
        <Label className="text-xs">{t('bigquery.limits')}</Label>
        <div className="mt-1 grid grid-cols-2 gap-3">
          <div>
            <span className="text-[11px] text-muted-foreground">{t('bigquery.maxScan')}</span>
            <div className="flex items-center gap-1">
              <Input type="number" min={0} step="0.1" value={state.maxGB} onChange={(e) => set({ maxGB: e.target.value })} placeholder={t('bigquery.fromSettings')} />
              <span className="text-xs text-muted-foreground">GB</span>
            </div>
          </div>
          <div>
            <span className="text-[11px] text-muted-foreground">{t('bigquery.askAbove')}</span>
            <div className="flex items-center gap-1">
              <Input type="number" min={0} step="0.1" value={state.askGB} onChange={(e) => set({ askGB: e.target.value })} placeholder={t('bigquery.fromSettings')} />
              <span className="text-xs text-muted-foreground">GB</span>
            </div>
          </div>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">{t('bigquery.limitsNote')}</p>
      </div>
    </div>
  );
}

/** Label of a credential in the picker: account (or name) + kind. */
function gcpCredentialLabel(c: GCPCredential): string {
  return c.account && c.account !== c.name ? `${c.name} — ${c.account}` : c.name;
}

function CredentialPicker({ credentials, credential, value, loading, ownerAccount, onPick, onOpen }: {
  credentials: GCPCredential[];
  credential?: GCPCredential;
  value: string;
  loading: boolean;
  ownerAccount?: string;
  onPick: (id: string) => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation(['dbquery', 'gcp']);
  const openSettings = useSettingsUIStore((s) => s.openSettings);
  // Someone else's connection keeps its owner's credential (not in this
  // user's list): show whose account it runs as instead of "gone".
  const foreign = !!ownerAccount && !!value && !credential;
  const account = credential?.account || credential?.name || (foreign ? ownerAccount : '');
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{t('bigquery.credential')}</Label>
        <button type="button" onClick={() => openSettings('gcp')} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          <Plus className="h-3 w-3" /> {t('bigquery.credentialAdd')}
        </button>
      </div>
      <Select value={value || undefined} onValueChange={onPick} onOpenChange={(o) => { if (o) onOpen(); }}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder={credentials.length ? t('bigquery.credentialPick') : t('bigquery.credentialNone')} />
        </SelectTrigger>
        <SelectContent>
          {credentials.map((c) => (
            <SelectItem key={c.id} value={c.id} className="text-xs">
              {gcpCredentialLabel(c)} <span className="text-muted-foreground">· {t(`gcp:kind.${c.kind}`)}</span>
            </SelectItem>
          ))}
          {value && !credential && !loading && <SelectItem value={value} className="text-xs" disabled>{foreign ? ownerAccount : t('bigquery.credentialMissing')}</SelectItem>}
        </SelectContent>
      </Select>
      {credential?.bigQuery === false && (
        <p className="flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {t('bigquery.credentialNoScope')}
        </p>
      )}
      {account && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[11px] text-muted-foreground">
          {t('bigquery.credentialShared', { account })}
        </p>
      )}
      <p className="text-[10px] text-muted-foreground">{t('bigquery.credentialNote')}</p>
    </div>
  );
}

function AuthCard({ active, onClick, icon, title, desc, disabled }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; title: string; desc: string; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cn('flex items-start gap-2 rounded-md border p-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent/40')}>
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium">{title}</span>
        <span className="block text-[10px] text-muted-foreground">{desc}</span>
      </span>
    </button>
  );
}
