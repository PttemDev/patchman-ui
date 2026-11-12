import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff,
  MonitorSmartphone,
  Cloud,
} from 'lucide-react';
import { s3ConnectionAPI, type DBScope } from '@/services/api';
import { useS3ConnectionStore } from '@/stores/s3ConnectionStore';
import { availableDBScopes, dualWrite, describePartialWrite } from '@/stores/dbConnectionStore';
import { isDesktop } from '@/lib/platform';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import type { S3Connection, S3Provider } from '@/types';

interface S3ConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: S3Connection | null;
  onSaved?: () => void;
}

const PROVIDER_LABEL: Record<S3Provider, string> = {
  aws: 'Amazon S3',
  minio: 'MinIO',
  ceph: 'Ceph (RadosGW)',
  wasabi: 'Wasabi',
  r2: 'Cloudflare R2',
  b2: 'Backblaze B2',
  spaces: 'DigitalOcean Spaces',
  gcs: 'Google Cloud Storage',
  oracle: 'Oracle Cloud (OCI)',
  huawei: 'Huawei Cloud OBS',
  custom: 'Custom / S3-compatible',
};

const PROVIDER_ORDER: S3Provider[] = [
  'aws', 'minio', 'ceph', 'wasabi', 'r2', 'b2', 'spaces', 'gcs', 'oracle', 'huawei', 'custom',
];

interface ProviderPreset {
  endpoint: string;          // template value pre-filled into the endpoint field
  endpointPlaceholder?: string;
  region?: string;           // forced region default (e.g. r2 → 'auto')
  forcePathStyle: boolean;
  hintKey?: string;          // i18n key for the small helper shown under endpoint
}

const PROVIDER_PRESETS: Record<S3Provider, ProviderPreset> = {
  aws: { endpoint: '', forcePathStyle: false },
  minio: {
    endpoint: '',
    endpointPlaceholder: 'http://localhost:9000',
    forcePathStyle: true,
    hintKey: 'dialog.hintMinio',
  },
  ceph: {
    endpoint: '',
    endpointPlaceholder: 'https://rgw.internal:7480',
    forcePathStyle: true,
    hintKey: 'dialog.hintCeph',
  },
  wasabi: { endpoint: 'https://s3.<region>.wasabisys.com', forcePathStyle: false },
  r2: { endpoint: 'https://<accountid>.r2.cloudflarestorage.com', region: 'auto', forcePathStyle: false },
  b2: { endpoint: 'https://s3.<region>.backblazeb2.com', forcePathStyle: false },
  spaces: { endpoint: 'https://<region>.digitaloceanspaces.com', forcePathStyle: false },
  gcs: { endpoint: 'https://storage.googleapis.com', forcePathStyle: true },
  oracle: {
    endpoint: 'https://<namespace>.compat.objectstorage.<region>.oraclecloud.com',
    forcePathStyle: true,
  },
  huawei: {
    // Huawei Cloud OBS S3-compatible endpoint. OBS is virtual-hosted-style
    // by default (bucket.<endpoint>), so path-style stays off. SigV4 signing
    // requires the Region to match the OBS region embedded in the endpoint.
    endpoint: 'https://obs.<region>.myhuaweicloud.com',
    region: 'cn-north-4',
    forcePathStyle: false,
    hintKey: 'dialog.hintHuawei',
  },
  custom: {
    endpoint: '',
    endpointPlaceholder: 'https://s3.example.com',
    forcePathStyle: false,
    hintKey: 'dialog.hintCustom',
  },
};

// Known preset endpoint templates — used to decide whether the endpoint
// field still holds an auto-filled value (safe to replace on provider
// change) versus something the user typed (leave alone).
const PRESET_ENDPOINTS = new Set(
  Object.values(PROVIDER_PRESETS).map((p) => p.endpoint).filter(Boolean),
);

export function S3ConnectionDialog({ open, onOpenChange, editing, onSaved }: S3ConnectionDialogProps) {
  const { t } = useTranslation('s3');
  const upsertLocal = useS3ConnectionStore((s) => s.upsertLocal);
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [provider, setProvider] = useState<S3Provider>('aws');
  const [endpoint, setEndpoint] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [forcePathStyle, setForcePathStyle] = useState(false);
  const [insecureSkipVerify, setInsecureSkipVerify] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const scopes = availableDBScopes();
  const canPickScope = isDesktop() && scopes.length > 1;
  const [scope, setScope] = useState<DBScope>('remote');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setTestResult(null);
    setShowSecret(false);
    setShowToken(false);
    setSecretKey('');
    setSessionToken('');
    setAdvanced(false);
    if (editing) {
      setName(editing.name);
      setProvider(editing.provider);
      setEndpoint(editing.endpoint ?? '');
      setRegion(editing.region || 'us-east-1');
      setAccessKeyId(editing.accessKeyId ?? '');
      setForcePathStyle(editing.forcePathStyle);
      setInsecureSkipVerify(editing.insecureSkipVerify);
      const stored = editing.primaryScope
        ? (editing.primaryScope as DBScope)
        : undefined;
      setScope(stored ?? (scopes.includes('remote') ? 'remote' : (scopes[0] ?? 'remote')));
    } else {
      setName('');
      setProvider('aws');
      setEndpoint('');
      setRegion('us-east-1');
      setAccessKeyId('');
      setForcePathStyle(false);
      setInsecureSkipVerify(false);
      setScope(scopes.includes('remote') ? 'remote' : 'local');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const handleProviderChange = (p: S3Provider) => {
    const preset = PROVIDER_PRESETS[p];
    setProvider(p);
    // Sensible default toggle for the provider — the user can still flip it.
    setForcePathStyle(preset.forcePathStyle);
    // Only overwrite the endpoint when it's empty or still holds a preset
    // template (i.e. not something the user typed by hand).
    setEndpoint((cur) => (cur.trim() === '' || PRESET_ENDPOINTS.has(cur) ? preset.endpoint : cur));
    if (preset.region) {
      setRegion((cur) => (cur.trim() === '' || cur === 'us-east-1' ? preset.region! : cur));
    }
  };

  const preset = PROVIDER_PRESETS[provider];
  const endpointShown = provider !== 'aws';

  const buildPayload = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      name: name.trim() || 'untitled',
      provider,
      endpoint: endpointShown ? endpoint.trim() : '',
      region: region.trim(),
      accessKeyId: accessKeyId.trim(),
      forcePathStyle,
      insecureSkipVerify,
      primaryScope: scope,
    };
    // Secret only travels when freshly typed — on edit a blank field means
    // "keep the stored one".
    if (secretKey) payload.secretKey = secretKey;
    if (sessionToken) payload.sessionToken = sessionToken;
    return payload;
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload = buildPayload();
      // Reuse the stored secret when editing and nothing new was typed.
      const res = editing && !secretKey
        ? await s3ConnectionAPI.test(editing.id, undefined, scope)
        : await s3ConnectionAPI.test(null, payload, scope);
      setTestResult(res.data as { ok: boolean; error?: string });
    } catch (err) {
      setTestResult({ ok: false, error: extractErr(err, t('dialog.testFailed')) });
    }
    setTesting(false);
  };

  const handleSave = async () => {
    setError('');
    if (!name.trim()) {
      setError(t('dialog.errNameRequired'));
      return;
    }
    if (endpointShown && !endpoint.trim()) {
      // Endpoint is optional only for AWS; every other provider needs one.
      setError(t('dialog.errEndpointRequired'));
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      if (editing) {
        const writeScopes: DBScope[] = editing.availableScopes && editing.availableScopes.length > 0
          ? (editing.availableScopes as DBScope[])
          : [editing.scope ?? scope];
        const updates = await dualWrite(
          (s) => s3ConnectionAPI.update(editing.id, payload, s).then((r) => r.data as S3Connection),
          writeScopes,
        );
        const okScopes = updates.filter((r) => r.ok).map((r) => r.scope);
        if (okScopes.length === 0) {
          setError(extractErr(updates.find((r) => !r.ok)?.error, t('dialog.updateFailedAll')));
          setSaving(false);
          return;
        }
        const partial = describePartialWrite(updates, writeScopes, 'Updated');
        if (partial) toast(partial);
        const first = updates.find((r) => r.ok)!.value!;
        upsertLocal({ ...first, scope, primaryScope: scope, availableScopes: okScopes });
      } else {
        const id = crypto.randomUUID();
        const writeScopes = availableDBScopes();
        const creates = await dualWrite(
          (s) => s3ConnectionAPI.create({ id, ...payload }, s).then((r) => r.data as S3Connection),
          writeScopes,
        );
        const okScopes = creates.filter((r) => r.ok).map((r) => r.scope);
        if (okScopes.length === 0) {
          setError(extractErr(creates.find((r) => !r.ok)?.error, t('dialog.createFailedAll')));
          setSaving(false);
          return;
        }
        const partial = describePartialWrite(creates, writeScopes, 'Saved');
        if (partial) toast(partial);
        const first = creates.find((r) => r.ok)!.value!;
        upsertLocal({ ...first, scope, primaryScope: scope, availableScopes: okScopes });
      }
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(extractErr(err, t('dialog.saveFailed')));
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{editing ? t('dialog.titleEdit') : t('dialog.titleNew')}</DialogTitle>
          <DialogDescription>
            {t('dialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('common:name')}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('dialog.namePlaceholder')}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore="true"
              />
            </div>
            <div>
              <Label className="text-xs">{t('dialog.provider')}</Label>
              <Select value={provider} onValueChange={(v) => handleProviderChange(v as S3Provider)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROVIDER_ORDER.map((p) => (
                    <SelectItem key={p} value={p}>{p === 'custom' ? t('dialog.providerCustom') : PROVIDER_LABEL[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {canPickScope && (
            <div>
              <Label className="text-xs">{t('dialog.backend')}</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <ScopeCard
                  icon={<MonitorSmartphone className="h-4 w-4" />}
                  title={t('dialog.backendLocal')}
                  desc={t('dialog.backendLocalDesc')}
                  active={scope === 'local'}
                  onClick={() => setScope('local')}
                />
                <ScopeCard
                  icon={<Cloud className="h-4 w-4" />}
                  title={t('dialog.backendRemote')}
                  desc={t('dialog.backendRemoteDesc')}
                  active={scope === 'remote'}
                  onClick={() => setScope('remote')}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {t('dialog.backendNote')}
              </p>
            </div>
          )}

          {endpointShown && (
            <div>
              <Label className="text-xs">{t('dialog.endpoint')}</Label>
              <Input
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder={preset.endpointPlaceholder ?? 'https://s3.example.com'}
                autoComplete="off"
                data-1p-ignore
              />
              {preset.hintKey && (
                <p className="text-[10px] text-muted-foreground mt-1">{t(preset.hintKey)}</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('dialog.region')}</Label>
              <Input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder={t('dialog.regionPlaceholder')}
                autoComplete="off"
                data-1p-ignore
              />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch checked={forcePathStyle} onCheckedChange={setForcePathStyle} />
                <span className="text-xs">{t('dialog.forcePathStyle')}</span>
              </label>
            </div>
          </div>

          <div>
            <Label className="text-xs">{t('dialog.accessKeyId')}</Label>
            <Input
              value={accessKeyId}
              onChange={(e) => setAccessKeyId(e.target.value)}
              placeholder={t('dialog.accessKeyPlaceholder')}
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              data-bwignore="true"
            />
          </div>

          <div>
            <Label className="text-xs">
              {t('dialog.secretKey')}{editing ? t('dialog.leaveBlankToKeep') : ''}
            </Label>
            <div className="relative">
              <Input
                type={showSecret ? 'text' : 'password'}
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                placeholder={editing && editing.hasSecretKey ? t('dialog.passwordUnchanged') : ''}
                className="pr-9"
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore="true"
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {(advanced ? '▼ ' : '▸ ') + t('dialog.advanced')}
          </button>
          {advanced && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">
                  {t('dialog.sessionToken')}{editing ? t('dialog.leaveBlankToKeep') : ''}
                </Label>
                <div className="relative">
                  <Input
                    type={showToken ? 'text' : 'password'}
                    value={sessionToken}
                    onChange={(e) => setSessionToken(e.target.value)}
                    placeholder={editing && editing.hasSessionToken ? t('dialog.passwordUnchanged') : t('dialog.sessionTokenPlaceholder')}
                    className="pr-9"
                    autoComplete="new-password"
                    data-1p-ignore
                    data-lpignore="true"
                    data-bwignore="true"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch checked={insecureSkipVerify} onCheckedChange={setInsecureSkipVerify} />
                <span className="text-xs">{t('dialog.acceptSelfSigned')}</span>
              </label>
            </div>
          )}

          {testResult && (
            <div
              className={cn(
                'flex items-start gap-2 p-2 rounded text-xs',
                testResult.ok
                  ? 'bg-green-500/10 text-green-700 dark:text-green-300'
                  : 'bg-destructive/10 text-destructive',
              )}
            >
              {testResult.ok
                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                : <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
              <span className="min-w-0 break-words">{testResult.ok ? t('dialog.connectionOk') : testResult.error}</span>
            </div>
          )}
          {error && <p className="text-xs text-destructive break-words">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleTest} disabled={testing || saving}>
            {testing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {t('dialog.testConnection')}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {editing ? t('common:save') : t('dialog.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScopeCard({
  icon, title, desc, active, onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-left rounded-md border p-2.5 transition-colors',
        active
          ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
          : 'border-border hover:bg-accent/50',
      )}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        {icon}
        {title}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{desc}</p>
    </button>
  );
}

function extractErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    return e.response?.data?.error || fallback;
  }
  return fallback;
}
