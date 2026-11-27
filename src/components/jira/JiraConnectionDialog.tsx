import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, CheckCircle2, AlertTriangle, Eye, EyeOff, MonitorSmartphone, Cloud, Server, Info, Search, X } from 'lucide-react';
import { jiraAPI, type DBScope } from '@/services/api';
import { useJiraConnectionStore } from '@/stores/jiraConnectionStore';
import { availableDBScopes, dualWrite, describePartialWrite } from '@/stores/dbConnectionStore';
import { isDesktop } from '@/lib/platform';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { emailPlaceholder } from '@/lib/tenant';
import type { JiraConnection, JiraField } from '@/types';
import { jiraErr } from './jiraUtil';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: JiraConnection | null;
  onSaved?: () => void;
}

interface TestResult {
  ok: boolean;
  error?: string;
  code?: string;
  displayName?: string;
  version?: string;
  deploymentType?: string;
  warning?: string;
  resolvedUrl?: string;
  fields?: JiraField[];
  fieldsError?: string;
}

type Flavor = 'cloud' | 'datacenter';

// JiraConnectionDialog — create / edit a Jira connection (CR_QA_P0_PLAN.md
// P0.b): the site URL, Cloud (email + API token) or Data Center (personal
// access token), then — after a successful Test — the acceptance-criteria
// field picked from the site's custom fields. The token is sent only when
// typed; on edit an empty field keeps the stored one.
export function JiraConnectionDialog({ open, onOpenChange, editing, onSaved }: Props) {
  const { t } = useTranslation('jira');
  const upsertLocal = useJiraConnectionStore((s) => s.upsertLocal);
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [flavor, setFlavor] = useState<Flavor>('cloud');
  const [email, setEmail] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [acFieldId, setAcFieldId] = useState('');
  const [defaultJql, setDefaultJql] = useState('');
  const [fields, setFields] = useState<JiraField[] | null>(null);
  const [fieldFilter, setFieldFilter] = useState('');
  const [loadingFields, setLoadingFields] = useState(false);

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
    setFields(null);
    setFieldFilter('');
    setName(editing?.name ?? '');
    setBaseUrl(editing?.baseUrl ?? '');
    setFlavor(editing?.flavor ?? 'cloud');
    setEmail(editing?.email ?? '');
    setAcFieldId(editing?.options?.acFieldId ?? '');
    setDefaultJql(editing?.options?.defaultJql ?? '');
    const stored = editing?.primaryScope ? (editing.primaryScope as DBScope) : undefined;
    setScope(stored ?? editing?.scope ?? (scopes.includes('remote') ? 'remote' : (scopes[0] ?? 'local')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  // An API token is not a PAT: switching the flavor needs the new token.
  const flavorChanged = !!editing && editing.flavor !== flavor;

  const buildPayload = (): Record<string, unknown> => {
    const options: Record<string, unknown> = {};
    if (acFieldId.trim()) options.acFieldId = acFieldId.trim();
    if (defaultJql.trim()) options.defaultJql = defaultJql.trim();
    const payload: Record<string, unknown> = {
      name: name.trim(), baseUrl: baseUrl.trim(), flavor, email: flavor === 'cloud' ? email.trim() : '', options, primaryScope: scope,
    };
    if (secret.trim()) payload.secret = secret.trim();
    return payload;
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // A saved connection tests the on-screen values; its stored token is
      // used only for the stored URL, flavor and email.
      const res = editing
        ? await jiraAPI.test(editing.id, buildPayload(), editing.scope ?? scope)
        : await jiraAPI.test(null, buildPayload(), scope);
      const r = res.data as TestResult;
      setTestResult(r);
      if (r.ok) {
        if (r.resolvedUrl && r.resolvedUrl !== baseUrl.trim()) setBaseUrl(r.resolvedUrl);
        setFields(r.fields ?? []);
      }
    } catch (err) {
      setTestResult({ ok: false, error: jiraErr(err, t('dialog.testFailed')) });
    }
    setTesting(false);
  };

  // A saved connection can load its fields without a Test.
  const loadFields = async () => {
    if (!editing) return;
    setLoadingFields(true);
    try {
      const res = await jiraAPI.fields(editing.id, editing.scope ?? scope);
      setFields(((res.data as JiraField[]) ?? []).filter((f) => f.custom));
    } catch (err) {
      setError(jiraErr(err, t('dialog.fieldsFailed')));
    }
    setLoadingFields(false);
  };

  const shownFields = useMemo(() => {
    const q = fieldFilter.trim().toLowerCase();
    const list = fields ?? [];
    // Text-like fields first: the AC field is almost always a paragraph.
    const textLike = (f: JiraField) => (f.schemaCustom ?? '').endsWith(':textarea') || f.schemaType === 'string';
    return list
      .filter((f) => !q || f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q))
      .sort((a, b) => Number(textLike(b)) - Number(textLike(a)) || a.name.localeCompare(b.name));
  }, [fields, fieldFilter]);

  const acFieldName = (fields ?? []).find((f) => f.id === acFieldId)?.name;

  const handleSave = async () => {
    setError('');
    if (!name.trim()) return setError(t('dialog.errName'));
    if (!baseUrl.trim()) return setError(t('dialog.errUrl'));
    if (flavor === 'cloud' && !email.trim()) return setError(t('dialog.errEmail'));
    if ((!editing || flavorChanged) && !secret.trim()) return setError(flavor === 'cloud' ? t('dialog.errToken') : t('dialog.errPat'));
    setSaving(true);
    try {
      const payload = buildPayload();
      let saved: JiraConnection;
      if (editing) {
        const writeScopes: DBScope[] = editing.availableScopes?.length ? (editing.availableScopes as DBScope[]) : [editing.scope ?? scope];
        const updates = await dualWrite((s) => jiraAPI.update(editing.id, payload, s).then((r) => r.data as JiraConnection), writeScopes);
        const ok = updates.filter((r) => r.ok).map((r) => r.scope);
        if (ok.length === 0) {
          setError(jiraErr(updates.find((r) => !r.ok)?.error, t('dialog.saveFailed')));
          setSaving(false);
          return;
        }
        const partial = describePartialWrite(updates, writeScopes, 'Updated');
        if (partial) toast(partial);
        saved = { ...updates.find((r) => r.ok)!.value!, scope: ok.includes(scope) ? scope : ok[0], primaryScope: scope, availableScopes: editing.availableScopes ?? ok };
      } else {
        const writeScopes = availableDBScopes();
        const id = crypto.randomUUID();
        const creates = await dualWrite((s) => jiraAPI.create({ id, ...payload }, s).then((r) => r.data as JiraConnection), writeScopes);
        const ok = creates.filter((r) => r.ok).map((r) => r.scope);
        if (ok.length === 0) {
          setError(jiraErr(creates.find((r) => !r.ok)?.error, t('dialog.saveFailed')));
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
      setError(jiraErr(err, t('dialog.saveFailed')));
    }
    setSaving(false);
  };

  const keepStored = editing?.hasSecret && !flavorChanged ? t('dialog.keepStored') : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[580px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t('dialog.titleEdit') : t('dialog.titleNew')}</DialogTitle>
          <DialogDescription>{t('dialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('dialog.name')}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('dialog.namePlaceholder')} />
            </div>
            <div>
              <Label className="text-xs">{t('dialog.url')}</Label>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-site.atlassian.net" className="font-mono text-xs" autoComplete="off" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground -mt-2">{t('dialog.urlHelp')}</p>

          <div>
            <Label className="text-xs">{t('dialog.flavor')}</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <KindCard icon={<Cloud className="h-4 w-4" />} title={t('dialog.cloud')} desc={t('dialog.cloudDesc')} active={flavor === 'cloud'} onClick={() => setFlavor('cloud')} />
              <KindCard icon={<Server className="h-4 w-4" />} title={t('dialog.datacenter')} desc={t('dialog.datacenterDesc')} active={flavor === 'datacenter'} onClick={() => setFlavor('datacenter')} />
            </div>
          </div>

          {flavor === 'cloud' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t('dialog.email')}</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={emailPlaceholder()} autoComplete="off" />
              </div>
              <div>
                <Label className="text-xs">{t('dialog.apiToken')}</Label>
                <SecretInput value={secret} onChange={setSecret} show={showSecret} onToggle={() => setShowSecret((v) => !v)} placeholder={keepStored} toggleLabel={t('dialog.toggleSecret')} />
              </div>
            </div>
          ) : (
            <div>
              <Label className="text-xs">{t('dialog.pat')}</Label>
              <SecretInput value={secret} onChange={setSecret} show={showSecret} onToggle={() => setShowSecret((v) => !v)} placeholder={keepStored} toggleLabel={t('dialog.toggleSecret')} />
            </div>
          )}
          <div className="flex gap-1.5 rounded bg-muted/50 p-2 text-[10px] text-muted-foreground -mt-1">
            <Info className="h-3 w-3 shrink-0 mt-px" />
            <span>{flavor === 'cloud' ? t('dialog.cloudHelp') : t('dialog.patHelp')}</span>
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

          {testResult && (
            <div className={cn('rounded p-2 text-xs', testResult.ok ? 'bg-green-500/10 text-green-700 dark:text-green-300' : 'bg-destructive/10 text-destructive')}>
              <div className="flex items-start gap-2">
                {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
                <span className="min-w-0 break-words">
                  {testResult.ok
                    ? t('dialog.testOk', { name: testResult.displayName || '—' }) + (testResult.version ? ` · ${t('dialog.testVersion', { version: testResult.version })}` : '')
                    : testResult.error}
                </span>
              </div>
              {testResult.ok && testResult.warning && (
                <p className="mt-1 text-amber-700 dark:text-amber-300">{t('dialog.flavorWarning', { type: testResult.deploymentType ?? '' })}</p>
              )}
              {testResult.ok && testResult.fieldsError && <p className="mt-1 text-amber-700 dark:text-amber-300">{t('dialog.fieldsFailed')}</p>}
            </div>
          )}

          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <Label className="text-xs">{t('dialog.acField')}</Label>
                <p className="text-[10px] text-muted-foreground">{t('dialog.acFieldHelp')}</p>
              </div>
              {editing && fields === null && (
                <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={() => void loadFields()} disabled={loadingFields}>
                  {loadingFields && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}{t('dialog.loadFields')}
                </Button>
              )}
            </div>
            {acFieldId ? (
              <div className="flex items-center gap-2 rounded bg-primary/5 px-2 py-1 text-xs">
                <span className="truncate font-medium">{acFieldName ?? acFieldId}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{acFieldId}</span>
                <button type="button" className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setAcFieldId('')} aria-label={t('dialog.clearAcField')}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <p className="text-[11px] italic text-muted-foreground">{t('dialog.acFieldNone')}</p>
            )}
            {fields === null ? (
              !editing && <p className="text-[10px] text-muted-foreground">{t('dialog.acFieldAfterTest')}</p>
            ) : fields.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">{t('dialog.noCustomFields')}</p>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input value={fieldFilter} onChange={(e) => setFieldFilter(e.target.value)} placeholder={t('dialog.filterFields')} className="h-7 pl-7 text-xs" />
                </div>
                <div className="max-h-[150px] overflow-y-auto rounded border">
                  {shownFields.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setAcFieldId(f.id)}
                      className={cn('flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-accent', f.id === acFieldId && 'bg-primary/10')}
                    >
                      <span className="truncate">{f.name}</span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">{f.id}</span>
                    </button>
                  ))}
                  {shownFields.length === 0 && <p className="px-2 py-1 text-[11px] text-muted-foreground">{t('dialog.noMatch')}</p>}
                </div>
                <p className="text-[10px] text-muted-foreground">{t('dialog.fieldCount', { shown: shownFields.length, total: fields.length })}</p>
              </>
            )}
          </div>

          <div>
            <Label className="text-xs">{t('dialog.defaultJql')}</Label>
            <Input value={defaultJql} onChange={(e) => setDefaultJql(e.target.value)} placeholder={t('dialog.defaultJqlPlaceholder')} className="font-mono text-xs" autoComplete="off" />
            <p className="text-[10px] text-muted-foreground mt-1">{t('dialog.defaultJqlHelp')}</p>
          </div>

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

function SecretInput({ value, onChange, show, onToggle, placeholder, toggleLabel }: {
  value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void; placeholder: string; toggleLabel: string;
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
      <button type="button" onClick={onToggle} aria-label={toggleLabel} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
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
