import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, CheckCircle2, AlertTriangle, Eye, EyeOff, MonitorSmartphone, Cloud, Info, KeyRound, UserRound } from 'lucide-react';
import { graylogConnectionAPI, type DBScope } from '@/services/api';
import { useGraylogConnectionStore } from '@/stores/graylogConnectionStore';
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
import type { GraylogConnection } from '@/types';
import { graylogErr } from './graylogUtil';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: GraylogConnection | null;
  onSaved?: () => void;
}

interface TestResult {
  ok: boolean;
  error?: string;
  code?: string;
  version?: string;
  username?: string;
  streams?: number;
  resolvedUrl?: string;
}

type Kind = 'token' | 'basic';

// GraylogConnectionDialog — create / edit a Graylog connection: the server's
// web address plus either an access token (Graylog → profile → Edit tokens)
// or a username and password. The secret is sent only when typed; on edit an
// empty field keeps the stored one.
export function GraylogConnectionDialog({ open, onOpenChange, editing, onSaved }: Props) {
  const { t } = useTranslation('graylog');
  const upsertLocal = useGraylogConnectionStore((s) => s.upsertLocal);
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<Kind>('token');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
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
    setSecret('');
    const o = editing?.options ?? {};
    setName(editing?.name ?? '');
    setUrl(editing?.url ?? '');
    setKind(editing?.authKind ?? 'token');
    setUsername(editing?.username ?? '');
    setInsecure(Boolean(o.insecureSkipVerify));
    setCaCert(String(o.caCert ?? ''));
    setAdvanced(Boolean(o.insecureSkipVerify || o.caCert));
    const stored = editing?.primaryScope ? (editing.primaryScope as DBScope) : undefined;
    setScope(stored ?? editing?.scope ?? (scopes.includes('remote') ? 'remote' : (scopes[0] ?? 'local')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  // Switching the sign-in kind needs the new secret (a token isn't a password).
  const kindChanged = !!editing && editing.authKind !== kind;

  const buildPayload = (): Record<string, unknown> => {
    const options: Record<string, unknown> = {};
    if (insecure) options.insecureSkipVerify = true;
    if (caCert.trim()) options.caCert = caCert.trim();
    const payload: Record<string, unknown> = {
      name: name.trim(), url: url.trim(), authKind: kind, username: kind === 'basic' ? username.trim() : '', options, primaryScope: scope,
    };
    if (secret.trim()) payload.secret = secret.trim();
    return payload;
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // A saved connection tests the on-screen values; its stored secret is
      // used only for the stored URL and sign-in kind.
      const res = editing
        ? await graylogConnectionAPI.test(editing.id, buildPayload(), editing.scope ?? scope)
        : await graylogConnectionAPI.test(null, buildPayload(), scope);
      const r = res.data as TestResult;
      setTestResult(r);
      if (r.ok && r.resolvedUrl && r.resolvedUrl !== url.trim()) setUrl(r.resolvedUrl);
    } catch (err) {
      setTestResult({ ok: false, error: graylogErr(err, t('dialog.testFailed')) });
    }
    setTesting(false);
  };

  const handleSave = async () => {
    setError('');
    if (!name.trim()) return setError(t('dialog.errName'));
    if (!url.trim()) return setError(t('dialog.errUrl'));
    if (kind === 'basic' && !username.trim()) return setError(t('dialog.errUser'));
    if ((!editing || kindChanged) && !secret.trim()) return setError(kind === 'token' ? t('dialog.errToken') : t('dialog.errPassword'));
    setSaving(true);
    try {
      const payload = buildPayload();
      let saved: GraylogConnection;
      if (editing) {
        const writeScopes: DBScope[] = editing.availableScopes?.length ? (editing.availableScopes as DBScope[]) : [editing.scope ?? scope];
        const updates = await dualWrite((s) => graylogConnectionAPI.update(editing.id, payload, s).then((r) => r.data as GraylogConnection), writeScopes);
        const ok = updates.filter((r) => r.ok).map((r) => r.scope);
        if (ok.length === 0) {
          setError(graylogErr(updates.find((r) => !r.ok)?.error, t('dialog.saveFailed')));
          setSaving(false);
          return;
        }
        const partial = describePartialWrite(updates, writeScopes, 'Updated');
        if (partial) toast(partial);
        saved = { ...updates.find((r) => r.ok)!.value!, scope: ok.includes(scope) ? scope : ok[0], primaryScope: scope, availableScopes: editing.availableScopes ?? ok };
      } else {
        const writeScopes = availableDBScopes();
        const id = crypto.randomUUID();
        const creates = await dualWrite((s) => graylogConnectionAPI.create({ id, ...payload }, s).then((r) => r.data as GraylogConnection), writeScopes);
        const ok = creates.filter((r) => r.ok).map((r) => r.scope);
        if (ok.length === 0) {
          setError(graylogErr(creates.find((r) => !r.ok)?.error, t('dialog.saveFailed')));
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
      setError(graylogErr(err, t('dialog.saveFailed')));
    }
    setSaving(false);
  };

  const keepStored = editing?.hasSecret && !kindChanged ? t('dialog.keepStored') : '';

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
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="prod-graylog" />
            </div>
            <div>
              <Label className="text-xs">{t('dialog.url')}</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://graylog.example.com" className="font-mono text-xs" autoComplete="off" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground -mt-2">{t('dialog.urlHelp')}</p>

          <div>
            <Label className="text-xs">{t('dialog.signIn')}</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <KindCard icon={<KeyRound className="h-4 w-4" />} title={t('dialog.kindToken')} desc={t('dialog.kindTokenDesc')} active={kind === 'token'} onClick={() => setKind('token')} />
              <KindCard icon={<UserRound className="h-4 w-4" />} title={t('dialog.kindBasic')} desc={t('dialog.kindBasicDesc')} active={kind === 'basic'} onClick={() => setKind('basic')} />
            </div>
          </div>

          {kind === 'basic' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t('dialog.username')}</Label>
                <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
              </div>
              <div>
                <Label className="text-xs">{t('dialog.password')}</Label>
                <SecretInput value={secret} onChange={setSecret} show={showSecret} onToggle={() => setShowSecret((v) => !v)} placeholder={keepStored} />
              </div>
            </div>
          ) : (
            <div>
              <Label className="text-xs">{t('dialog.token')}</Label>
              <SecretInput value={secret} onChange={setSecret} show={showSecret} onToggle={() => setShowSecret((v) => !v)} placeholder={keepStored} />
            </div>
          )}
          <div className="flex gap-1.5 rounded bg-muted/50 p-2 text-[10px] text-muted-foreground -mt-1">
            <Info className="h-3 w-3 shrink-0 mt-px" />
            <span>{kind === 'token' ? t('dialog.tokenHelp') : t('dialog.basicHelp')}</span>
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
            <div className={cn('rounded p-2 text-xs', testResult.ok ? 'bg-green-500/10 text-green-700 dark:text-green-300' : 'bg-destructive/10 text-destructive')}>
              <div className="flex items-start gap-2">
                {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
                <span className="min-w-0 break-words">
                  {testResult.ok
                    ? t('dialog.testOk', { version: testResult.version, user: testResult.username || '—', count: testResult.streams ?? 0 })
                    : testResult.error}
                </span>
              </div>
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

function SecretInput({ value, onChange, show, onToggle, placeholder }: {
  value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void; placeholder: string;
}) {
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-8 font-mono text-xs"
        autoComplete="new-password"
      />
      <button type="button" onClick={onToggle} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
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
