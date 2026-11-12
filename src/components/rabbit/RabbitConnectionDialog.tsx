import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, CheckCircle2, AlertTriangle, Eye, EyeOff, MonitorSmartphone, Cloud, Info } from 'lucide-react';
import { rabbitConnectionAPI, type DBScope } from '@/services/api';
import { useRabbitConnectionStore } from '@/stores/rabbitConnectionStore';
import { availableDBScopes, dualWrite, describePartialWrite } from '@/stores/dbConnectionStore';
import { isDesktop } from '@/lib/platform';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import type { RabbitConnection } from '@/types';
import { extractErr } from './rabbitUtil';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: RabbitConnection | null;
  onSaved?: () => void;
}

interface TestResult {
  ok: boolean;
  error?: string;
  code?: string;
  version?: string;
  clusterName?: string;
  user?: string;
  tags?: string[];
  vhosts?: string[];
  amqpOk?: boolean;
  amqpError?: string;
}

// RabbitConnectionDialog — create / edit a RabbitMQ connection: the
// management API address + a RabbitMQ user. AMQP (live tail, stream reads,
// moving messages) uses the same user on the management host's port 5672
// unless the advanced options say otherwise. The password is sent only when
// typed; on edit an empty field keeps the stored one.
export function RabbitConnectionDialog({ open, onOpenChange, editing, onSaved }: Props) {
  const { t } = useTranslation('rabbit');
  const upsertLocal = useRabbitConnectionStore((s) => s.upsertLocal);
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [defaultVhost, setDefaultVhost] = useState('');
  const [amqpHost, setAmqpHost] = useState('');
  const [amqpPort, setAmqpPort] = useState('');
  const [amqpTLS, setAmqpTLS] = useState(false);
  const [insecure, setInsecure] = useState(false);
  const [caCert, setCaCert] = useState('');
  const [advanced, setAdvanced] = useState(false);

  const scopes = availableDBScopes();
  const canPickScope = isDesktop() && scopes.length > 1;
  const [scope, setScope] = useState<DBScope>('remote');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setTestResult(null);
    setShowSecret(false);
    setPassword('');
    const o = editing?.options ?? {};
    setName(editing?.name ?? '');
    setUrl(editing?.url ?? '');
    setUsername(editing?.username ?? '');
    setDefaultVhost(String(o.defaultVhost ?? ''));
    setAmqpHost(String(o.amqpHost ?? ''));
    setAmqpPort(o.amqpPort != null ? String(o.amqpPort) : '');
    setAmqpTLS(Boolean(o.amqpTLS));
    setInsecure(Boolean(o.insecureSkipVerify));
    setCaCert(String(o.caCert ?? ''));
    setAdvanced(Boolean(o.amqpHost || o.amqpPort || o.amqpTLS || o.insecureSkipVerify || o.caCert || o.defaultVhost));
    const stored = editing?.primaryScope ? (editing.primaryScope as DBScope) : undefined;
    setScope(stored ?? editing?.scope ?? (scopes.includes('remote') ? 'remote' : (scopes[0] ?? 'local')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const buildPayload = (): Record<string, unknown> => {
    const options: Record<string, unknown> = {};
    if (defaultVhost.trim()) options.defaultVhost = defaultVhost.trim();
    if (amqpHost.trim()) options.amqpHost = amqpHost.trim();
    if (amqpPort.trim()) options.amqpPort = Number(amqpPort.trim()) || amqpPort.trim();
    if (amqpTLS) options.amqpTLS = true;
    if (insecure) options.insecureSkipVerify = true;
    if (caCert.trim()) options.caCert = caCert.trim();
    const payload: Record<string, unknown> = { name: name.trim(), url: url.trim(), username: username.trim(), options, primaryScope: scope };
    if (password) payload.password = password;
    return payload;
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const sameAsStored = editing && !password && editing.url === url.trim() && editing.username === username.trim();
      const res = sameAsStored
        ? await rabbitConnectionAPI.test(editing.id, undefined, scope)
        : await rabbitConnectionAPI.test(null, buildPayload(), scope);
      setTestResult(res.data as TestResult);
    } catch (err) {
      setTestResult({ ok: false, error: extractErr(err, t('dialog.testFailed')) });
    }
    setTesting(false);
  };

  const handleSave = async () => {
    setError('');
    if (!name.trim()) return setError(t('dialog.errName'));
    if (!url.trim()) return setError(t('dialog.errUrl'));
    if (!username.trim()) return setError(t('dialog.errUser'));
    if (!editing && !password) return setError(t('dialog.errPassword'));
    setSaving(true);
    try {
      const payload = buildPayload();
      let saved: RabbitConnection;
      if (editing) {
        const writeScopes: DBScope[] = editing.availableScopes?.length ? (editing.availableScopes as DBScope[]) : [editing.scope ?? scope];
        const updates = await dualWrite((s) => rabbitConnectionAPI.update(editing.id, payload, s).then((r) => r.data as RabbitConnection), writeScopes);
        const ok = updates.filter((r) => r.ok).map((r) => r.scope);
        if (ok.length === 0) {
          setError(extractErr(updates.find((r) => !r.ok)?.error, t('dialog.saveFailed')));
          setSaving(false);
          return;
        }
        const partial = describePartialWrite(updates, writeScopes, 'Updated');
        if (partial) toast(partial);
        saved = { ...updates.find((r) => r.ok)!.value!, scope: ok.includes(scope) ? scope : ok[0], primaryScope: scope, availableScopes: editing.availableScopes ?? ok };
      } else {
        const writeScopes = availableDBScopes();
        const id = crypto.randomUUID();
        const creates = await dualWrite((s) => rabbitConnectionAPI.create({ id, ...payload }, s).then((r) => r.data as RabbitConnection), writeScopes);
        const ok = creates.filter((r) => r.ok).map((r) => r.scope);
        if (ok.length === 0) {
          setError(extractErr(creates.find((r) => !r.ok)?.error, t('dialog.saveFailed')));
          setSaving(false);
          return;
        }
        const partial = describePartialWrite(creates, writeScopes, 'Saved');
        if (partial) toast(partial);
        saved = { ...creates.find((r) => r.ok)!.value!, scope: ok.includes(scope) ? scope : ok[0], primaryScope: scope, availableScopes: ok };
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
      <DialogContent className="sm:max-w-[560px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t('dialog.titleEdit') : t('dialog.titleNew')}</DialogTitle>
          <DialogDescription>{t('dialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('dialog.name')}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="prod-rabbit" />
            </div>
            <div>
              <Label className="text-xs">{t('dialog.url')}</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://rabbit.example.com:15672" className="font-mono text-xs" autoComplete="off" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground -mt-2">{t('dialog.urlHelp')}</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('dialog.username')}</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <Label className="text-xs">{t('dialog.password')}</Label>
              <div className="relative">
                <Input
                  type={showSecret ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={editing?.hasPassword ? t('dialog.keepStored') : ''}
                  className="pr-8 font-mono text-xs"
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShowSecret((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>
          <div className="flex gap-1.5 rounded bg-muted/50 p-2 text-[10px] text-muted-foreground -mt-1">
            <Info className="h-3 w-3 shrink-0 mt-px" />
            <span>{t('dialog.userHelp')}</span>
          </div>

          {canPickScope && (
            <div>
              <Label className="text-xs">{t('dialog.backend')}</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <KindCard icon={<MonitorSmartphone className="h-4 w-4" />} title={t('dialog.backendLocal')} desc={t('dialog.backendLocalDesc')} active={scope === 'local'} onClick={() => setScope('local')} />
                <KindCard icon={<Cloud className="h-4 w-4" />} title={t('dialog.backendRemote')} desc={t('dialog.backendRemoteDesc')} active={scope === 'remote'} onClick={() => setScope('remote')} />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">{t('dialog.backendNote')}</p>
            </div>
          )}

          <button type="button" onClick={() => setAdvanced((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground">
            {advanced ? '▼ ' : '▸ '}{t('dialog.advanced')}
          </button>
          {advanced && (
            <div className="space-y-3 rounded-md border p-3">
              <div>
                <Label className="text-xs">{t('dialog.defaultVhost')}</Label>
                <Input value={defaultVhost} onChange={(e) => setDefaultVhost(e.target.value)} placeholder="/" className="font-mono text-xs" />
              </div>
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <div>
                  <Label className="text-xs">{t('dialog.amqpHost')}</Label>
                  <Input value={amqpHost} onChange={(e) => setAmqpHost(e.target.value)} placeholder={t('dialog.amqpHostPlaceholder')} className="font-mono text-xs" />
                </div>
                <div>
                  <Label className="text-xs">{t('dialog.amqpPort')}</Label>
                  <Input value={amqpPort} onChange={(e) => setAmqpPort(e.target.value)} placeholder={amqpTLS ? '5671' : '5672'} className="font-mono text-xs" />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground -mt-1">{t('dialog.amqpHelp')}</p>
              <div className="flex items-center justify-between">
                <Label className="text-xs">{t('dialog.amqpTLS')}</Label>
                <Switch checked={amqpTLS} onCheckedChange={setAmqpTLS} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">{t('dialog.insecure')}</Label>
                  <p className="text-[10px] text-muted-foreground">{t('dialog.insecureHelp')}</p>
                </div>
                <Switch checked={insecure} onCheckedChange={setInsecure} />
              </div>
              <div>
                <Label className="text-xs">{t('dialog.caCert')}</Label>
                <Textarea value={caCert} onChange={(e) => setCaCert(e.target.value)} className="font-mono text-xs min-h-[70px]" placeholder={'-----BEGIN CERTIFICATE-----\n…'} />
              </div>
            </div>
          )}

          {testResult && (
            <div className={cn('rounded p-2 text-xs space-y-1', testResult.ok ? 'bg-green-500/10 text-green-700 dark:text-green-300' : 'bg-destructive/10 text-destructive')}>
              <div className="flex items-start gap-2">
                {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
                <span className="min-w-0 break-words">
                  {testResult.ok
                    ? t('dialog.testOk', { version: testResult.version, cluster: testResult.clusterName || '—', user: testResult.user || username, tags: (testResult.tags ?? []).join(', ') || '—', count: testResult.vhosts?.length ?? 0 })
                    : testResult.error}
                </span>
              </div>
              {testResult.ok && (
                testResult.amqpOk
                  ? <div className="pl-5 text-[11px] opacity-90">{t('dialog.amqpOk')}</div>
                  : <div className="pl-5 text-[11px] text-amber-700 dark:text-amber-300 break-words">{t('dialog.amqpFailed', { error: testResult.amqpError })}</div>
              )}
            </div>
          )}
          {error && <p className="text-xs text-destructive break-words">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleTest} disabled={testing || saving}>
            {testing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {t('dialog.test')}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>{t('common:cancel')}</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {editing ? t('common:save') : t('dialog.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KindCard({ icon, title, desc, active, onClick }: { icon: ReactNode; title: string; desc: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('text-left rounded-md border p-2.5 transition-colors', active ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : 'border-border hover:bg-accent/50')}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold">{icon}{title}</div>
      <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{desc}</p>
    </button>
  );
}
