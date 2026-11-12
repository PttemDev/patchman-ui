import { useEffect, useState, type ReactNode } from 'react';
import type { AxiosResponse } from 'axios';
import { useTranslation } from 'react-i18next';
import { Loader2, CheckCircle2, XCircle, MonitorSmartphone, Cloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import {
  llmProviderAPI,
  type LLMProvider,
  type LLMKind,
  type LLMProviderInput,
  type DBScope,
} from '@/services/api';
import { availableDBScopes, dualWrite, describePartialWrite } from '@/stores/dbConnectionStore';
import { useLLMProviderStore } from '@/stores/llmProviderStore';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: LLMProvider | null;
}

const PLACEHOLDERS: Record<LLMKind, { base: string; model: string }> = {
  openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { base: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest' },
};

// A base URL that points at loopback / a private LAN range / an mDNS name is
// typically reachable only from the user's own machine, so we surface a hint
// steering toward the local backend. It's only a HINT now (not a lock) — a LAN
// IP may still be reachable from a same-network remote backend, so the user
// keeps the choice; only loopback (isLoopbackHostUrl) disables Remote outright.
function isPrivateHostUrl(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  let host = '';
  try {
    host = new URL(s.includes('://') ? s : `http://${s}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '::1' || host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home')) return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

// Loopback is a stricter case than "private": 127.0.0.1 / localhost / ::1 mean
// "this very machine", so a REMOTE backend can NEVER reach them (its loopback is
// the server, not the user's Mac). A private LAN IP (192.168.x, 10.x, …) can be
// picked either way — a same-LAN remote backend might still reach it — so only
// loopback disables the "Remote" choice outright.
function isLoopbackHostUrl(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  let host = '';
  try {
    host = new URL(s.includes('://') ? s : `http://${s}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '::1') return true;
  const m = host.match(/^(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
  return !!m && Number(m[1]) === 127;
}

// One Local/Remote card in the "run on" picker (mirrors DBConnectionDialog).
function ScopeCard({
  icon, title, desc, active, disabled, onClick,
}: {
  icon: ReactNode; title: string; desc: string;
  active: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex flex-col items-start gap-0.5 rounded-md border-2 p-2.5 text-left transition-colors',
        disabled
          ? 'cursor-not-allowed border-border opacity-45'
          : active
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/50',
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">{icon}{title}</span>
      <span className="text-[11px] text-muted-foreground">{desc}</span>
    </button>
  );
}

// LLMProviderDialog creates/edits a provider. The "run on" choice (scope) is
// both the execution target AND the key-storage boundary: 'local' runs on this
// device's embedded backend and keeps the key on this machine only; 'remote'
// runs on the synced account backend and stores the key there (encrypted). The
// scope is fixed on edit (moving a key between backends is a later concern).
export function LLMProviderDialog({ open, onOpenChange, editing }: Props) {
  const { t } = useTranslation('ai');
  const { toast } = useToast();
  const fetchProviders = useLLMProviderStore((s) => s.fetchProviders);

  const scopes = availableDBScopes();
  const canPickScope = scopes.includes('local') && scopes.includes('remote');

  const [name, setName] = useState('');
  const [kind, setKind] = useState<LLMKind>('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [scope, setScope] = useState<DBScope>('remote');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setKeyTouched(false);
    setApiKey('');
    setTestResult(null);
    if (editing) {
      setName(editing.name);
      setKind(editing.kind);
      setBaseUrl(editing.baseUrl);
      setModel(editing.model ?? '');
      const stored = (editing.primaryScope as DBScope | undefined)
        ?? ((editing.availableScopes ?? []).length === 1 && editing.availableScopes?.[0] === 'local' ? 'local' : undefined);
      setScope(stored ?? (scopes.includes('remote') ? 'remote' : 'local'));
    } else {
      setName('');
      setKind('openai');
      setBaseUrl('');
      setModel('');
      // Default: remote (synced) when available, else local.
      setScope(scopes.includes('remote') ? 'remote' : 'local');
    }
    // Reset only on open (false→true). Depending on `editing` too would wipe a
    // freshly-typed key whenever the store refreshes the provider's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A LAN base URL hints (but no longer forces) local; a LOOPBACK url makes the
  // remote choice impossible — a remote backend can't reach this machine's
  // loopback — so its card is disabled and we snap the selection to local.
  const lanHint = isPrivateHostUrl(baseUrl) && scopes.includes('local');
  const remoteUnreachable = isLoopbackHostUrl(baseUrl);
  useEffect(() => {
    if (!editing && remoteUnreachable && scope === 'remote') setScope('local');
  }, [remoteUnreachable, editing, scope]);

  const writeScopesFor = (s: DBScope): DBScope[] => {
    if (editing) return (editing.availableScopes as DBScope[] | undefined) ?? [editing.scope ?? 'remote'];
    // 'local' keeps the key on this device only; 'remote' syncs to every
    // reachable backend so it follows the account.
    return s === 'local' ? ['local'] : scopes;
  };

  const buildPayload = (includeKey: boolean): LLMProviderInput => ({
    ...(editing ? { id: editing.id } : { id: crypto.randomUUID() }),
    name: name.trim(),
    kind,
    baseUrl: baseUrl.trim(),
    model: model.trim(),
    // Keep the stored default-backend preference on edit; a fresh create uses
    // the picked scope.
    primaryScope: editing ? (editing.primaryScope ?? scope) : scope,
    ...(includeKey ? { apiKey } : {}),
  });

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Probe through the backend the user picked (edit keeps its stored scope).
      const testScope = editing?.scope ?? scope;
      // For a saved provider without a freshly-typed key, test the stored key
      // via its id; otherwise test the inline payload (kind/baseUrl/apiKey).
      const useInline = !editing || keyTouched;
      const res = useInline
        ? await llmProviderAPI.test(null, { kind, baseUrl: baseUrl.trim(), apiKey }, testScope)
        : await llmProviderAPI.test(editing!.id, undefined, testScope);
      const data = (res.data as { data?: { ok: boolean; error?: string } }).data ?? { ok: false };
      setTestResult(data);
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !baseUrl.trim()) {
      toast({ title: t('dialog.missingFields'), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      // Only send apiKey when the user typed one (create with a value, or an
      // edit that touched the field) — an untouched edit keeps the stored key.
      const includeKey = keyTouched || (!editing && apiKey.trim() !== '');
      const payload = buildPayload(includeKey);
      const targets = writeScopesFor(scope);
      const verb = editing ? t('dialog.updated') : t('dialog.created');
      const results = await dualWrite(
        (s): Promise<AxiosResponse> =>
          editing
            ? llmProviderAPI.update(payload.id!, payload, s)
            : llmProviderAPI.create(payload, s),
        targets,
      );
      const okCount = results.filter((r) => r.ok).length;
      if (okCount === 0) {
        const first = results.find((r) => !r.ok)?.error;
        const msg = (first as { response?: { data?: { error?: string } } })?.response?.data?.error;
        throw new Error(msg || t('dialog.saveFailed'));
      }
      const partial = describePartialWrite(results, targets, verb);
      if (partial) {
        toast({ title: partial.title, description: partial.description, variant: partial.variant });
      } else {
        toast({ title: verb });
      }
      await fetchProviders();
      onOpenChange(false);
    } catch (e) {
      toast({
        title: t('dialog.saveFailed'),
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t('dialog.editTitle') : t('dialog.addTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="llm-name">{t('dialog.name')}</Label>
            <Input id="llm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('dialog.namePlaceholder')} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('dialog.kind')}</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as LLMKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">{t('dialog.kindOpenAI')}</SelectItem>
                  <SelectItem value="anthropic">{t('dialog.kindAnthropic')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llm-model">{t('dialog.model')}</Label>
              <Input id="llm-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder={PLACEHOLDERS[kind].model} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="llm-base">{t('dialog.baseUrl')}</Label>
            <Input id="llm-base" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={PLACEHOLDERS[kind].base} />
            <p className="text-xs text-muted-foreground">{t(`dialog.baseHint.${kind}`)}</p>
            {lanHint && !remoteUnreachable && <p className="text-xs text-amber-600 dark:text-amber-500">{t('dialog.lanHint')}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="llm-key">{t('dialog.apiKey')}</Label>
            <Input
              id="llm-key"
              type="password"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setKeyTouched(true); }}
              placeholder={editing?.hasApiKey && !keyTouched ? t('dialog.keyStored') : t('dialog.keyPlaceholder')}
              autoComplete="off"
            />
          </div>

          {canPickScope && !editing && (
            <div className="space-y-1.5">
              <Label>{t('dialog.backend')}</Label>
              <div className="grid grid-cols-2 gap-2">
                <ScopeCard
                  icon={<MonitorSmartphone className="h-4 w-4" />}
                  title={t('dialog.scopeLocalTitle')}
                  desc={t('dialog.scopeLocalDesc')}
                  active={scope === 'local'}
                  onClick={() => setScope('local')}
                />
                <ScopeCard
                  icon={<Cloud className="h-4 w-4" />}
                  title={t('dialog.scopeRemoteTitle')}
                  desc={remoteUnreachable ? t('dialog.scopeRemoteUnreachable') : t('dialog.scopeRemoteDesc')}
                  active={scope === 'remote'}
                  disabled={remoteUnreachable}
                  onClick={() => setScope('remote')}
                />
              </div>
            </div>
          )}

          {testResult && (
            <div className={`flex items-center gap-2 text-sm ${testResult.ok ? 'text-emerald-600' : 'text-destructive'}`}>
              {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              <span className="min-w-0 break-words">{testResult.ok ? t('dialog.testOk') : (testResult.error || t('dialog.testFailed'))}</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={handleTest} disabled={testing || !baseUrl.trim()}>
            {testing && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('dialog.test')}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('dialog.cancel')}</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('dialog.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
