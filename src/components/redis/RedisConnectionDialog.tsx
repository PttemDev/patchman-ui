import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff,
  MonitorSmartphone,
  Cloud,
  Plus,
  X,
} from 'lucide-react';
import { redisConnectionAPI, type DBScope } from '@/services/api';
import { useRedisConnectionStore } from '@/stores/redisConnectionStore';
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
import { Textarea } from '@/components/ui/textarea';
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
import type { RedisConnection, RedisMode } from '@/types';

interface RedisConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: RedisConnection | null;
  onSaved?: () => void;
}

const MODES: { value: RedisMode; labelKey: string }[] = [
  { value: 'standalone', labelKey: 'dialog.modeStandalone' },
  { value: 'sentinel', labelKey: 'dialog.modeSentinel' },
  { value: 'cluster', labelKey: 'dialog.modeCluster' },
];

// Split a comma-joined address into a seed list (always ≥1 entry so the
// editor renders a row). Trims blanks on read.
function splitSeeds(address: string): string[] {
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [''];
}

// RedisConnectionDialog mirrors KafkaConnectionDialog: create / edit a Redis
// connection with a Test button and the same dual-write scope model.
// Passwords are only sent when freshly typed; on edit an empty field means
// "keep the stored secret". Sentinel fields appear only in sentinel mode;
// the DB index is hidden for cluster (Redis Cluster is single-keyspace).
export function RedisConnectionDialog({ open, onOpenChange, editing, onSaved }: RedisConnectionDialogProps) {
  const { t } = useTranslation('redis');
  const upsertLocal = useRedisConnectionStore((s) => s.upsertLocal);
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [mode, setMode] = useState<RedisMode>('standalone');
  const [seeds, setSeeds] = useState<string[]>(['']);
  const [sentinelMaster, setSentinelMaster] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [sentinelPassword, setSentinelPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showSentinelPassword, setShowSentinelPassword] = useState(false);
  const [dbIndex, setDbIndex] = useState('0');
  const [tls, setTls] = useState(false);

  // Advanced options → assembled into the `options` blob.
  const [caCert, setCaCert] = useState('');
  const [insecureSkipVerify, setInsecureSkipVerify] = useState(false);
  const [clientName, setClientName] = useState('');
  const [advanced, setAdvanced] = useState(false);

  const scopes = availableDBScopes();
  const canPickScope = isDesktop() && scopes.length > 1;
  const [scope, setScope] = useState<DBScope>('remote');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isSentinel = mode === 'sentinel';
  const isCluster = mode === 'cluster';

  useEffect(() => {
    if (!open) return;
    setError('');
    setTestResult(null);
    setShowPassword(false);
    setShowSentinelPassword(false);
    if (editing) {
      setName(editing.name);
      setMode(editing.mode);
      setSeeds(splitSeeds(editing.address));
      setSentinelMaster(editing.sentinelMaster ?? '');
      setUsername(editing.username ?? '');
      setPassword('');
      setSentinelPassword('');
      setDbIndex(String(editing.dbIndex ?? 0));
      setTls(Boolean(editing.tls));
      setCaCert(String(editing.options?.caCert ?? ''));
      setInsecureSkipVerify(Boolean(editing.options?.insecureSkipVerify));
      setClientName(String(editing.options?.clientName ?? ''));
      const stored = editing.primaryScope ? (editing.primaryScope as DBScope) : undefined;
      setScope(stored ?? (scopes.includes('remote') ? 'remote' : (scopes[0] ?? 'remote')));
    } else {
      setName('');
      setMode('standalone');
      setSeeds(['']);
      setSentinelMaster('');
      setUsername('');
      setPassword('');
      setSentinelPassword('');
      setDbIndex('0');
      setTls(false);
      setCaCert('');
      setInsecureSkipVerify(false);
      setClientName('');
      setScope(scopes.includes('remote') ? 'remote' : 'local');
    }
    setAdvanced(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const buildOptions = useCallback((): Record<string, unknown> => {
    const options: Record<string, unknown> = {};
    if (caCert.trim()) options.caCert = caCert.trim();
    if (insecureSkipVerify) options.insecureSkipVerify = true;
    if (clientName.trim()) options.clientName = clientName.trim();
    return options;
  }, [caCert, insecureSkipVerify, clientName]);

  const buildPayload = useCallback((): Record<string, unknown> => {
    const address = seeds.map((s) => s.trim()).filter(Boolean).join(',');
    const payload: Record<string, unknown> = {
      name: name.trim(),
      address,
      mode,
      username,
      dbIndex: isCluster ? 0 : (parseInt(dbIndex, 10) || 0),
      tls,
      options: buildOptions(),
      primaryScope: scope,
    };
    payload.sentinelMaster = isSentinel ? sentinelMaster.trim() : '';
    if (password) payload.password = password;
    if (isSentinel && sentinelPassword) payload.sentinelPassword = sentinelPassword;
    return payload;
  }, [seeds, name, mode, username, isCluster, dbIndex, tls, buildOptions, scope, isSentinel, sentinelMaster, password, sentinelPassword]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload = buildPayload();
      // When editing with no freshly-typed password, test by id so the BE
      // reuses the stored secret; otherwise send the full payload.
      const res = editing && editing.hasPassword && !password
        ? await redisConnectionAPI.test(editing.id, undefined, scope)
        : await redisConnectionAPI.test(null, payload, scope);
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
    if (seeds.every((s) => !s.trim())) {
      setError(t('dialog.errAddressRequired'));
      return;
    }
    if (isSentinel && !sentinelMaster.trim()) {
      setError(t('dialog.errSentinelMasterRequired'));
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload();
      let saved: RedisConnection;

      if (editing) {
        const writeScopes: DBScope[] = editing.availableScopes && editing.availableScopes.length > 0
          ? (editing.availableScopes as DBScope[])
          : [editing.scope ?? scope];
        const updates = await dualWrite(
          (s) => redisConnectionAPI.update(editing.id, payload, s).then((r) => r.data as RedisConnection),
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
        saved = { ...first, scope, primaryScope: scope, availableScopes: okScopes };
      } else {
        const writeScopes = availableDBScopes();
        const id = crypto.randomUUID();
        const creates = await dualWrite(
          (s) => redisConnectionAPI.create({ id, ...payload }, s).then((r) => r.data as RedisConnection),
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
        saved = { ...first, scope, primaryScope: scope, availableScopes: okScopes };
      }
      upsertLocal(saved);
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(extractErr(err, t('dialog.saveFailed')));
    }
    setSaving(false);
  };

  const seedLabel = isSentinel ? t('dialog.seedsSentinel') : isCluster ? t('dialog.seedsCluster') : t('dialog.address');
  const seedPlaceholder = isSentinel || isCluster ? t('dialog.seedPlaceholderCluster') : t('dialog.seedPlaceholderStandalone');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t('dialog.titleEdit') : t('dialog.titleNew')}</DialogTitle>
          <DialogDescription>
            {t('dialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
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
            <Label className="text-xs">{t('dialog.mode')}</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as RedisMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{t(m.labelKey)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">{seedLabel}</Label>
            <div className="space-y-1.5">
              {seeds.map((seed, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input
                    value={seed}
                    onChange={(e) => setSeeds((arr) => arr.map((s, j) => (j === i ? e.target.value : s)))}
                    placeholder={seedPlaceholder}
                    className="font-mono text-xs"
                    autoComplete="off"
                  />
                  {seeds.length > 1 && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setSeeds((arr) => arr.filter((_, j) => j !== i))}
                      title={t('common:remove')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {(isSentinel || isCluster) && (
              <button
                type="button"
                onClick={() => setSeeds((arr) => [...arr, ''])}
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3 w-3" /> {t('dialog.addSeed')}
              </button>
            )}
          </div>

          {isSentinel && (
            <div>
              <Label className="text-xs">{t('dialog.sentinelMaster')}</Label>
              <Input
                value={sentinelMaster}
                onChange={(e) => setSentinelMaster(e.target.value)}
                placeholder={t('dialog.sentinelMasterPlaceholder')}
                className="font-mono text-xs"
                autoComplete="off"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('dialog.username')}</Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t('dialog.usernamePlaceholder')}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore="true"
              />
            </div>
            {!isCluster && (
              <div>
                <Label className="text-xs">{t('dialog.dbIndex')}</Label>
                <Input
                  type="number"
                  min={0}
                  value={dbIndex}
                  onChange={(e) => setDbIndex(e.target.value)}
                  onBlur={() => { if (dbIndex.trim() === '') setDbIndex('0'); }}
                  className="font-mono text-xs"
                />
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs">{t('dialog.password')}</Label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={editing?.hasPassword ? t('dialog.passwordUnchanged') : ''}
                className="pr-9"
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore="true"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {isSentinel && (
            <div>
              <Label className="text-xs">{t('dialog.sentinelPassword')}</Label>
              <div className="relative">
                <Input
                  type={showSentinelPassword ? 'text' : 'password'}
                  value={sentinelPassword}
                  onChange={(e) => setSentinelPassword(e.target.value)}
                  placeholder={editing?.hasSentinelPassword ? t('dialog.passwordUnchanged') : ''}
                  className="pr-9"
                  autoComplete="new-password"
                  data-1p-ignore
                  data-lpignore="true"
                  data-bwignore="true"
                />
                <button
                  type="button"
                  onClick={() => setShowSentinelPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showSentinelPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label className="text-xs">{t('dialog.tls')}</Label>
              <p className="text-[10px] text-muted-foreground">
                {t('dialog.tlsHelp')}
              </p>
            </div>
            <Switch checked={tls} onCheckedChange={setTls} />
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

          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {(advanced ? '▼ ' : '▸ ') + t('dialog.advanced')}
          </button>
          {advanced && (
            <div className="space-y-3 rounded-md border p-3">
              <div>
                <Label className="text-xs">{t('dialog.caCert')}</Label>
                <Textarea
                  value={caCert}
                  onChange={(e) => setCaCert(e.target.value)}
                  className="font-mono text-xs min-h-[80px]"
                  placeholder={'-----BEGIN CERTIFICATE-----\n…'}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {t('dialog.caCertHelp')}
                </p>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">{t('dialog.skipTls')}</Label>
                  <p className="text-[10px] text-muted-foreground">
                    {t('dialog.skipTlsHelp')}
                  </p>
                </div>
                <Switch checked={insecureSkipVerify} onCheckedChange={setInsecureSkipVerify} />
              </div>
              <div>
                <Label className="text-xs">{t('dialog.clientName')}</Label>
                <Input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder={t('dialog.clientNamePlaceholder')}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
              </div>
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
  icon: ReactNode;
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
