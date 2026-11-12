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
} from 'lucide-react';
import { kafkaConnectionAPI, type DBScope } from '@/services/api';
import { useKafkaConnectionStore } from '@/stores/kafkaConnectionStore';
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
import type { KafkaConnection, KafkaSASLMechanism, KafkaSecurityProtocol } from '@/types';

interface KafkaConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: KafkaConnection | null;
  onSaved?: () => void;
}

const PROTOCOLS: KafkaSecurityProtocol[] = ['PLAINTEXT', 'SSL', 'SASL_PLAINTEXT', 'SASL_SSL'];
const MECHANISMS: KafkaSASLMechanism[] = ['PLAIN', 'SCRAM-SHA-256', 'SCRAM-SHA-512'];

// KafkaConnectionDialog mirrors DBConnectionDialog: create / edit a Kafka
// connection with a Test button and the same dual-write scope model. SASL
// credentials are only sent when the protocol needs them; on edit the
// password is never prefilled — an empty field means "keep the stored one".
export function KafkaConnectionDialog({ open, onOpenChange, editing, onSaved }: KafkaConnectionDialogProps) {
  const { t } = useTranslation('kafka');
  const upsertLocal = useKafkaConnectionStore((s) => s.upsertLocal);
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [bootstrapServers, setBootstrapServers] = useState('');
  const [securityProtocol, setSecurityProtocol] = useState<KafkaSecurityProtocol>('PLAINTEXT');
  const [saslMechanism, setSaslMechanism] = useState<KafkaSASLMechanism>('PLAIN');
  const [saslUsername, setSaslUsername] = useState('');
  const [saslPassword, setSaslPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Advanced options → assembled into the `options` blob.
  const [caCert, setCaCert] = useState('');
  const [insecureSkipVerify, setInsecureSkipVerify] = useState(false);
  const [clientId, setClientId] = useState('');
  const [advanced, setAdvanced] = useState(false);

  const scopes = availableDBScopes();
  const canPickScope = isDesktop() && scopes.length > 1;
  const [scope, setScope] = useState<DBScope>('remote');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isSasl = securityProtocol.startsWith('SASL_');

  useEffect(() => {
    if (!open) return;
    setError('');
    setTestResult(null);
    setShowPassword(false);
    if (editing) {
      setName(editing.name);
      setBootstrapServers(editing.bootstrapServers);
      setSecurityProtocol(editing.securityProtocol);
      setSaslMechanism((editing.saslMechanism || 'PLAIN') as KafkaSASLMechanism);
      setSaslUsername(editing.saslUsername ?? '');
      setSaslPassword('');
      setCaCert(String(editing.options?.caCert ?? ''));
      setInsecureSkipVerify(Boolean(editing.options?.insecureSkipVerify));
      setClientId(String(editing.options?.clientId ?? ''));
      const stored = editing.primaryScope ? (editing.primaryScope as DBScope) : undefined;
      setScope(stored ?? (scopes.includes('remote') ? 'remote' : (scopes[0] ?? 'remote')));
    } else {
      setName('');
      setBootstrapServers('');
      setSecurityProtocol('PLAINTEXT');
      setSaslMechanism('PLAIN');
      setSaslUsername('');
      setSaslPassword('');
      setCaCert('');
      setInsecureSkipVerify(false);
      setClientId('');
      setScope(scopes.includes('remote') ? 'remote' : 'local');
    }
    setAdvanced(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const buildOptions = useCallback((): Record<string, unknown> => {
    const options: Record<string, unknown> = {};
    if (caCert.trim()) options.caCert = caCert.trim();
    if (insecureSkipVerify) options.insecureSkipVerify = true;
    if (clientId.trim()) options.clientId = clientId.trim();
    return options;
  }, [caCert, insecureSkipVerify, clientId]);

  const buildPayload = useCallback((): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      name: name.trim(),
      bootstrapServers: bootstrapServers.trim(),
      securityProtocol,
      options: buildOptions(),
      primaryScope: scope,
    };
    if (isSasl) {
      payload.saslMechanism = saslMechanism;
      payload.saslUsername = saslUsername;
      if (saslPassword) payload.saslPassword = saslPassword;
    } else {
      payload.saslMechanism = '';
      payload.saslUsername = '';
    }
    return payload;
  }, [name, bootstrapServers, securityProtocol, buildOptions, scope, isSasl, saslMechanism, saslUsername, saslPassword]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload = buildPayload();
      // When editing SASL with no freshly-typed password, test by id so the
      // BE reuses the stored secret; otherwise send the full payload.
      const res = editing && isSasl && !saslPassword
        ? await kafkaConnectionAPI.test(editing.id, undefined, scope)
        : await kafkaConnectionAPI.test(null, payload, scope);
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
    if (!bootstrapServers.trim()) {
      setError(t('dialog.errBootstrapRequired'));
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload();
      let saved: KafkaConnection;

      if (editing) {
        const writeScopes: DBScope[] = editing.availableScopes && editing.availableScopes.length > 0
          ? (editing.availableScopes as DBScope[])
          : [editing.scope ?? scope];
        const updates = await dualWrite(
          (s) => kafkaConnectionAPI.update(editing.id, payload, s).then((r) => r.data as KafkaConnection),
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
          (s) => kafkaConnectionAPI.create({ id, ...payload }, s).then((r) => r.data as KafkaConnection),
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
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
            <Label className="text-xs">{t('dialog.bootstrapServers')}</Label>
            <Input
              value={bootstrapServers}
              onChange={(e) => setBootstrapServers(e.target.value)}
              placeholder={t('dialog.bootstrapPlaceholder')}
              className="font-mono text-xs"
              autoComplete="off"
            />
          </div>

          <div>
            <Label className="text-xs">{t('dialog.securityProtocol')}</Label>
            <Select value={securityProtocol} onValueChange={(v) => setSecurityProtocol(v as KafkaSecurityProtocol)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROTOCOLS.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isSasl && (
            <div className="space-y-3 rounded-md border p-3 bg-muted/20">
              <div>
                <Label className="text-xs">{t('dialog.saslMechanism')}</Label>
                <Select value={saslMechanism} onValueChange={(v) => setSaslMechanism(v as KafkaSASLMechanism)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MECHANISMS.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{t('dialog.saslUsername')}</Label>
                  <Input
                    value={saslUsername}
                    onChange={(e) => setSaslUsername(e.target.value)}
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                    data-bwignore="true"
                  />
                </div>
                <div>
                  <Label className="text-xs">{t('dialog.saslPassword')}</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={saslPassword}
                      onChange={(e) => setSaslPassword(e.target.value)}
                      placeholder={editing ? t('dialog.passwordUnchanged') : ''}
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
              </div>
            </div>
          )}

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
            {advanced ? '▼' : '▸'} {t('dialog.advanced')}
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
                <Label className="text-xs">{t('dialog.clientId')}</Label>
                <Input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder={t('dialog.clientIdPlaceholder')}
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
