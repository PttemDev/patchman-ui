import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  MonitorSmartphone,
  Cloud,
  HelpCircle,
} from 'lucide-react';
import { gitAPI, type DBScope } from '@/services/api';
import { useGitConnectionStore } from '@/stores/gitConnectionStore';
import { availableDBScopes } from '@/stores/dbConnectionStore';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { extractErr } from './util';
import type { GitConnection } from '@/types';

interface GitConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: GitConnection | null;
  onSaved?: () => void;
}

type AuthKind = 'oauth' | 'pat';

// GitConnectionDialog creates / edits a Git (GitLab) connection. Unlike the
// K8s dialog it does NOT re-implement dual-write inline — the git store's
// create/update already fan the FE-minted UUID out to every reachable BE and
// hand back a `{ connection, partial }` result, so we just toast `partial`
// when a backend was missed (Wave-1 deviation #3). The PAT is encrypted at
// rest and only `hasCredential` ever travels back.
// The GitLab host the token help points at: the one being connected, never a
// built-in one.
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl.trim()).host || 'gitlab.example.com';
  } catch {
    return 'gitlab.example.com';
  }
}

export function GitConnectionDialog({ open, onOpenChange, editing, onSaved }: GitConnectionDialogProps) {
  const { t } = useTranslation('git');
  const createConnection = useGitConnectionStore((s) => s.createConnection);
  const updateConnection = useGitConnectionStore((s) => s.updateConnection);
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://gitlab.com');
  const [authKind, setAuthKind] = useState<AuthKind>('oauth');
  const [credential, setCredential] = useState('');

  const scopes = availableDBScopes();
  const canPickScope = isDesktop() && scopes.length > 1;
  const [scope, setScope] = useState<DBScope>('remote');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string; detail?: string } | null>(null);
  // GitLab's own words for a rejected token, in the user's language.
  const tokenHint = (err?: string): string | undefined => {
    if (!err) return undefined;
    if (/Token is expired/i.test(err)) return t('connDialog.tokenExpired');
    if (/Token was revoked/i.test(err)) return t('connDialog.tokenRevoked');
    if (/ 401[: ]|invalid_token|Bad Access Token/i.test(err)) return t('connDialog.tokenInvalid');
    if (/ 403[: ]|insufficient_scope/i.test(err)) return t('connDialog.tokenScope');
    return undefined;
  };
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setTestResult(null);
    if (editing) {
      setName(editing.name);
      setBaseUrl(editing.baseUrl || 'https://gitlab.com');
      setAuthKind(editing.authKind === 'pat' ? 'pat' : 'oauth');
      setCredential('');
      const stored = editing.primaryScope ? (editing.primaryScope as DBScope) : undefined;
      setScope(stored ?? (scopes.includes('remote') ? 'remote' : (scopes[0] ?? 'remote')));
    } else {
      setName('');
      setBaseUrl('https://gitlab.com');
      setAuthKind('oauth');
      setCredential('');
      setScope(scopes.includes('remote') ? 'remote' : 'local');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const buildPayload = useCallback((): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      name: name.trim(),
      provider: 'gitlab',
      baseUrl: baseUrl.trim().replace(/\/+$/, ''),
      authKind,
      primaryScope: scope,
    };
    // A PAT is only sent when freshly typed; empty on edit means "keep the
    // stored credential". Switching to oauth clears any credential BE-side.
    if (authKind === 'pat' && credential.trim()) payload.credential = credential.trim();
    return payload;
  }, [name, baseUrl, authKind, credential, scope]);

  // Tests what is on screen, saved or not (see gitAPI.test).
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await gitAPI.test(editing?.id ?? null, scope, { ...buildPayload(), name: name.trim() || 'draft' });
      const d = (res.data ?? {}) as { ok?: boolean; reachable?: boolean; error?: string; message?: string };
      const ok = d.ok ?? d.reachable ?? !d.error;
      setTestResult(ok
        ? { ok, message: d.message || t('connDialog.reachedProvider') }
        : { ok, message: tokenHint(d.error) ?? d.error ?? t('connDialog.testFailed'), detail: tokenHint(d.error) ? d.error : undefined });
    } catch (err) {
      setTestResult({ ok: false, message: extractErr(err, t('connDialog.testFailed')) });
    }
    setTesting(false);
  };

  const handleSave = async () => {
    setError('');
    if (!name.trim()) { setError(t('connDialog.nameRequired')); return; }
    if (!baseUrl.trim()) { setError(t('connDialog.baseUrlRequired')); return; }
    if (authKind === 'pat' && !editing && !credential.trim()) {
      setError(t('connDialog.patRequired'));
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      const { partial } = editing
        ? await updateConnection(editing, payload, scope)
        : await createConnection(payload, scope);
      if (partial) toast(partial);
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(extractErr(err, t('errors.save')));
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t('connDialog.editTitle') : t('connDialog.newTitle')}</DialogTitle>
          <DialogDescription>
            {t('connDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t('common:name')}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('connDialog.namePlaceholder')}
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              data-bwignore="true"
            />
          </div>

          <div>
            <Label className="text-xs">{t('connDialog.provider')}</Label>
            <Select value="gitlab" disabled>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="gitlab">GitLab</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">{t('connDialog.providerNote')}</p>
          </div>

          <div>
            <Label className="text-xs">{t('connDialog.baseUrl')}</Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://gitlab.com"
              className="font-mono text-xs"
              autoComplete="off"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              <Trans t={t} i18nKey="connDialog.baseUrlNote" components={{ code: <code className="font-mono" /> }} />
            </p>
          </div>

          <div>
            <Label className="text-xs">{t('connDialog.authentication')}</Label>
            <Select value={authKind} onValueChange={(v) => setAuthKind(v as AuthKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="oauth">{t('connDialog.authOauth')}</SelectItem>
                <SelectItem value="pat">{t('connDialog.authPat')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">
              {authKind === 'oauth'
                ? t('connDialog.authOauthNote')
                : t('connDialog.authPatNote')}
            </p>
          </div>

          {authKind === 'pat' && (
            <div>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">{t('connDialog.authPat')}</Label>
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="text-muted-foreground/60 hover:text-foreground" aria-label={t('connDialog.patHelpAria')}>
                        <HelpCircle className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
                      <Trans
                        t={t}
                        i18nKey="connDialog.patHelp"
                        values={{ host: hostOf(baseUrl) }}
                        components={{ code: <code className="font-mono" />, path: <span className="font-mono break-all" /> }}
                      />
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                type="password"
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
                placeholder={editing?.hasCredential ? t('connDialog.patStored') : 'glpat-…'}
                className="font-mono text-xs"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore="true"
              />
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                <Trans t={t} i18nKey="connDialog.patScopes" components={{ code: <code className="font-mono text-foreground/80" /> }} />
              </p>
            </div>
          )}

          {canPickScope && (
            <div>
              <Label className="text-xs">{t('connDialog.defaultBackend')}</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <ScopeCard
                  icon={<MonitorSmartphone className="h-4 w-4" />}
                  title={t('connDialog.thisDevice')}
                  desc={t('connDialog.thisDeviceDesc')}
                  active={scope === 'local'}
                  onClick={() => setScope('local')}
                />
                <ScopeCard
                  icon={<Cloud className="h-4 w-4" />}
                  title={t('connDialog.patchmanServer')}
                  desc={t('connDialog.patchmanServerDesc')}
                  active={scope === 'remote'}
                  onClick={() => setScope('remote')}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {t('connDialog.bothBackendsNote')}
              </p>
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
              <span className="min-w-0 break-words">
                {testResult.message}
                {testResult.detail && <span className="block mt-0.5 opacity-70 font-mono text-[10px]">{testResult.detail}</span>}
              </span>
            </div>
          )}
          {error && <p className="text-xs text-destructive break-words">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleTest} disabled={testing || saving || !baseUrl.trim()}>
            {testing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {t('connDialog.testConnection')}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>{t('common:cancel')}</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {editing ? t('common:save') : t('connDialog.create')}
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
