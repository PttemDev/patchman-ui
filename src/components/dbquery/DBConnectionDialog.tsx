import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Loader2, CheckCircle2, AlertTriangle, Eye, EyeOff, Copy, MonitorSmartphone, Cloud } from 'lucide-react';
import { dbConnectionAPI, type DBScope } from '@/services/api';
import { useDBConnectionStore, availableDBScopes, dualWrite } from '@/stores/dbConnectionStore';
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import {
  type DBConnection,
  type DBKind,
  DB_KIND_DEFAULT_PORT,
  DB_KIND_FAMILY,
  DB_KIND_LABEL,
} from '@/types';

interface DBConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: DBConnection | null;
  /** Duplicate: prefill a NEW connection from this one. Its stored
   *  password (and DSN) are copied BE-side when left blank. */
  template?: DBConnection | null;
  onSaved?: (conn: DBConnection) => void;
}

// Family groupings so the Type dropdown stays readable as new wire-
// compatible variants land. Order = visual order in the popover.
const KIND_GROUPS: Array<{ driver: string; family: boolean; kinds: DBKind[] }> = [
  { driver: 'PostgreSQL', family: true,  kinds: ['postgres', 'cockroachdb', 'yugabytedb', 'redshift'] },
  { driver: 'MySQL',      family: true,  kinds: ['mysql', 'mariadb', 'tidb'] },
  { driver: 'SQL Server', family: false, kinds: ['sqlserver'] },
  { driver: 'MongoDB',    family: false, kinds: ['mongo'] },
];

export function DBConnectionDialog({ open, onOpenChange, editing, template = null, onSaved }: DBConnectionDialogProps) {
  const { t } = useTranslation('dbquery');
  const upsertLocal = useDBConnectionStore((s) => s.upsertLocal);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<DBKind>('postgres');
  const [host, setHost] = useState('');
  const [port, setPort] = useState<number>(5432);
  const [database, setDatabase] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [optionsText, setOptionsText] = useState('{}');
  const [advanced, setAdvanced] = useState(false);
  /** Mongo "no authentication" pick — not visible in the options JSON. */
  const [noAuth, setNoAuth] = useState(false);

  // Which BE this connection lives on. The prod BE cannot reach the
  // user's 127.0.0.1 docker containers, so connections to local infra
  // must be stored on (and executed through) the embedded BE.
  const scopes = availableDBScopes();
  const canPickScope = scopes.length > 1;
  const [scope, setScope] = useState<DBScope>('remote');

  // Connection-string mode: when ON the dialog stops auto-building the
  // DSN from the form fields. The user-supplied string is sent as-is
  // and overrides Host/Port/Database/Username/Password on the BE.
  const [dsnMode, setDsnMode] = useState(false);
  const [dsn, setDsn] = useState('');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setTestResult(null);
    setShowPassword(false);
    if (editing) {
      setName(editing.name);
      setKind(editing.kind);
      setHost(editing.host);
      setPort(editing.port);
      setDatabase(editing.database ?? '');
      setUsername(editing.username);
      setPassword('');
      setOptionsText(JSON.stringify(editing.options ?? {}, null, 2));
      setNoAuth(editing.kind === 'mongo' && !editing.username && !editing.options?.authMechanism);
      setDsnMode(!!editing.hasConnectionString);
      setDsn('');
      // Prefer the BE-stored user choice (primaryScope). Fall back to
      // 'remote' for legacy rows that predate the column — matches the
      // dialog hint ("Use for prod / staging behind VPN") and avoids
      // dialing prod hostnames from the local machine.
      const stored: DBScope | undefined = editing.primaryScope
        ? (editing.primaryScope as DBScope)
        : undefined;
      setScope(stored ?? (scopes.includes('remote') ? 'remote' : (scopes[0] ?? 'remote')));
    } else if (template) {
      // Duplicate — same server/credentials, typically pointed at another
      // database. Secrets stay blank here; the BE copies them on save.
      setName(t('connection.copyName', { name: template.name }));
      setKind(template.kind);
      setHost(template.host);
      setPort(template.port);
      setDatabase(template.database ?? '');
      setUsername(template.username);
      setPassword('');
      setOptionsText(JSON.stringify(template.options ?? {}, null, 2));
      setNoAuth(template.kind === 'mongo' && !template.username && !template.options?.authMechanism);
      setDsnMode(!!template.hasConnectionString);
      setDsn('');
      const stored = template.primaryScope ? (template.primaryScope as DBScope) : undefined;
      setScope(stored ?? (scopes.includes('remote') ? 'remote' : (scopes[0] ?? 'remote')));
    } else {
      setName('');
      setKind('postgres');
      setHost('');
      setPort(DB_KIND_DEFAULT_PORT.postgres);
      setDatabase('');
      setUsername('');
      setPassword('');
      setOptionsText('{}');
      setNoAuth(false);
      // Default to remote when creating — production / staging DBs
      // (the typical case) live behind the PatchMan VPN and don't
      // resolve from 127.0.0.1. Users with 127.0.0.1 / LAN targets
      // flip to "This device" before saving.
      setScope(scopes.includes('remote') ? 'remote' : 'local');
      setDsnMode(false);
      setDsn('');
    }
    setAdvanced(false);
  }, [open, editing, template, t]);

  const handleKindChange = (k: DBKind) => {
    setKind(k);
    setPort(DB_KIND_DEFAULT_PORT[k]);
  };

  const family = DB_KIND_FAMILY[kind];
  // Postgres binds one database per connection, so it must be named. Mongo
  // and MySQL/StarRocks can leave it blank to browse every database at once
  // (introspection lists all user schemas; the sidebar groups them by DB).
  const databaseRequired = family === 'postgres' && !dsnMode;
  const allDatabasesOK = family === 'mongo' || family === 'mysql';

  const parsedOptions = useCallback(() => {
    try {
      const v = JSON.parse(optionsText || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch {
      return null;
    }
  }, [optionsText]);

  // Live DSN preview built from the form fields. Shown in dsnMode so the
  // user can see what we'd send and edit from there, AND below the form
  // (read-only) so beginners still see what's happening under the hood.
  const previewDSN = useMemo(() => {
    const safePass = password ? '••••••' : '';
    if (family === 'mongo') {
      const auth = username ? `${encodeURIComponent(username)}${safePass ? `:${safePass}` : ''}@` : '';
      const hosts = (host.trim() || 'host').split(',').map((h) => h.trim()).filter(Boolean)
        .map((h) => (hostHasPort(h) ? h : `${h}:${port}`)).join(',');
      const opts = parsedOptions() ?? {};
      const query = MONGO_URI_OPTIONS
        .filter((k) => opts[k] !== undefined && opts[k] !== null && opts[k] !== '')
        .map((k) => `${k}=${encodeURIComponent(String(opts[k]))}`).join('&');
      return `mongodb://${auth}${hosts}/${database}${query ? `?${query}` : ''}`;
    }
    if (family === 'mysql') {
      const auth = username ? `${username}${safePass ? `:${safePass}` : ''}` : '';
      return `${auth}@tcp(${host || 'host'}:${port})/${database}?parseTime=true&multiStatements=false`;
    }
    if (kind === 'sqlserver') {
      // go-mssqldb URL form — database rides in the query string, not the path.
      const up = username ? `${username}${safePass ? `:${safePass}` : ''}@` : '';
      return `sqlserver://${up}${host || 'host'}:${port}?database=${database}`;
    }
    // postgres family — including cockroach, yugabyte, redshift
    const userpart = username ? `${username}${safePass ? `:${safePass}` : ''}@` : '';
    return `postgres://${userpart}${host || 'host'}:${port}/${database}?sslmode=prefer`;
  }, [family, kind, username, password, host, port, database, parsedOptions]);

  // Duplicate: the BE fills blank secrets from the source row. The DSN only
  // rides along while the copy stays in connection-string mode — in form
  // mode it would override the edited fields.
  const copyFields = (sourceId: string) => ({
    copySecretsFrom: sourceId,
    copyConnectionString: dsnMode && !dsn.trim(),
  });

  // Mongo's auth source / replica set live in the options JSON; these
  // fields edit them in place. Disabled while the JSON does not parse.
  const optionsValid = parsedOptions() !== null;
  const optionText = (key: string): string => {
    const v = parsedOptions()?.[key];
    return typeof v === 'string' ? v : '';
  };
  // Writes options back to the JSON and, while a Mongo connection string is
  // in use, into its query too, so the fields above it never just pretend.
  const commitOptions = (next: Record<string, unknown>, keys: string[]) => {
    setOptionsText(JSON.stringify(next, null, 2));
    if (dsnMode && family === 'mongo' && /^mongodb(\+srv)?:\/\//i.test(dsn.trim())) {
      setDsn(withMongoParams(dsn, Object.fromEntries(keys.map((k) => [k, next[k] === undefined ? undefined : String(next[k])]))));
    }
  };
  const setOptionText = (key: string, value: string) => {
    const cur = parsedOptions();
    if (cur === null) return;
    const next: Record<string, unknown> = { ...cur };
    if (value) next[key] = value;
    else delete next[key];
    commitOptions(next, [key]);
  };
  /** The database MongoDB checks the user against. */
  const mongoAuthSource = optionText('authSource') || database || 'admin';

  // Mongo sign-in method, kept as authMechanism (+ authSource $external for
  // LDAP and AWS) in the options JSON. Any other mechanism set by hand under
  // Advanced shows as "custom" and is left alone.
  const mongoMech = optionText('authMechanism');
  const mongoAuth: MongoAuth = mongoMech === 'PLAIN' ? 'ldap'
    : mongoMech === 'MONGODB-AWS' ? 'aws'
      : mongoMech ? 'custom'
        : noAuth ? 'none' : 'scram';
  const pickMongoAuth = (a: MongoAuth) => {
    const cur = parsedOptions();
    if (cur === null || a === 'custom') return;
    const next: Record<string, unknown> = { ...cur };
    if (a === 'ldap') next.authMechanism = 'PLAIN';
    else if (a === 'aws') next.authMechanism = 'MONGODB-AWS';
    else delete next.authMechanism;
    if (a === 'ldap' || a === 'aws') next.authSource = '$external';
    else if (next.authSource === '$external') delete next.authSource;
    commitOptions(next, ['authMechanism', 'authSource']);
    setNoAuth(a === 'none');
    if (a === 'none') {
      setUsername('');
      setPassword('');
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const opts = parsedOptions();
      if (opts === null) {
        setTestResult({ ok: false, error: t('connection.errOptionsJson') });
        return;
      }
      const payload: Record<string, unknown> = {
        name: name || 'untitled',
        kind,
        host,
        port,
        database,
        username,
        password,
        options: opts,
      };
      if (dsnMode && dsn.trim()) payload.connectionString = dsn.trim();
      if (template) Object.assign(payload, copyFields(template.id));
      // Always dial through the scope the user has selected in the
      // dialog — the saved `editing.scope` may be stale (legacy rows
      // defaulted to local) and prod hostnames only resolve via the
      // PatchMan server.
      const res = editing && !password && !dsn
        ? await dbConnectionAPI.test(editing.id, undefined, scope)
        : await dbConnectionAPI.test(null, payload as Parameters<typeof dbConnectionAPI.test>[1], scope);
      // Record which backend actually ran the test so the result is
      // unambiguous — a connection only reachable from the remote server
      // must be tested through it, not this device.
      const r = res.data as TestResult;
      setTestResult({ ...r, via: scope });
      // Mongo only signed in through admin: save that, so the connection
      // does not try (and fail) the default auth source every time.
      if (r.ok && r.authSource && family === 'mongo') setOptionText('authSource', r.authSource);
    } catch (err) {
      setTestResult({ ok: false, error: extractErr(err, t('connection.testFailed')), via: scope });
    }
    setTesting(false);
  };

  const handleSave = async () => {
    setError('');
    const opts = parsedOptions();
    if (opts === null) {
      setError(t('connection.errOptionsJson'));
      return;
    }
    if (!name.trim()) {
      setError(t('connection.errNameRequired'));
      return;
    }
    // Host is only mandatory when no DSN is supplied — `mongodb+srv://`,
    // multi-host, and unix-socket strings don't fit the structured form
    // but they're valid to dial. Match the BE's relaxed validation.
    if (!dsnMode && !host.trim()) {
      setError(t('connection.errHostRequired'));
      return;
    }
    if (databaseRequired && !database.trim()) {
      setError(t('connection.errDatabaseRequired'));
      return;
    }
    if (dsnMode && !dsn.trim() && !editing && !template?.hasConnectionString) {
      setError(t('connection.errDsnEmpty'));
      return;
    }

    setSaving(true);
    try {
      let saved: DBConnection;
      const dsnPayload = dsnMode ? dsn.trim() : '';

      if (editing) {
        // Update path — dual-write the patch to every BE the connection
        // currently lives on. Each BE has its own encrypted password
        // copy so a password change only takes effect on backends that
        // accepted this PATCH (we surface partial failures inline).
        const writeScopes: DBScope[] = editing.availableScopes && editing.availableScopes.length > 0
          ? (editing.availableScopes as DBScope[])
          : [editing.scope ?? scope];
        const patch: Record<string, unknown> = {
          name, host, port, database, username, options: opts,
          primaryScope: scope,
        };
        if (password) patch.password = password;
        if (dsnMode) {
          patch.connectionString = dsnPayload;
        } else if (editing.hasConnectionString) {
          patch.connectionString = '';
        }
        const updates = await dualWrite(
          (s) => dbConnectionAPI.update(editing.id, patch, s).then((r) => r.data as DBConnection),
          writeScopes,
        );
        const okScopes = updates.filter((r) => r.ok).map((r) => r.scope);
        if (okScopes.length === 0) {
          const firstErr = updates.find((r) => !r.ok)?.error;
          setError(extractErr(firstErr, t('connection.errUpdateAllFailed')));
          setSaving(false);
          return;
        }
        if (okScopes.length < writeScopes.length) {
          const missed = writeScopes.filter((s) => !okScopes.includes(s));
          setError(t('connection.partialUpdate', { ok: okScopes.join(' + '), missed: missed.join(' + ') }));
        }
        const first = updates.find((r) => r.ok)!.value!;
        saved = { ...first, scope, primaryScope: scope, availableScopes: okScopes };
      } else {
        // Create path — dual-write to every reachable BE so the toolbar
        // Local/Remote toggle has both copies available from day one.
        // Same FE-generated UUID on every BE row so the merge step in
        // the connection store collapses them into one logical row.
        // A duplicate goes only where its source lives: each BE copies the
        // secret from its own row.
        const reachable = availableDBScopes();
        const writeScopes = template?.availableScopes?.length
          ? template.availableScopes.filter((s) => reachable.includes(s))
          : reachable;
        const id = crypto.randomUUID();
        const payload = {
          id, name,
          kind: kind as Parameters<typeof dbConnectionAPI.create>[0]['kind'],
          host, port, database, username, password,
          options: opts,
          primaryScope: scope,
          ...(dsnPayload ? { connectionString: dsnPayload } : {}),
          ...(template ? copyFields(template.id) : {}),
        };
        let creates = await dualWrite((s) => dbConnectionAPI.create(payload, s).then((r) => r.data as CreatedConnection), writeScopes);
        // A BE that predates copySecretsFrom ignores it and stores the blank
        // password as-is — undo that row and count the scope as failed.
        const unsupported: DBScope[] = [];
        if (template && (!password || (dsnMode && !dsnPayload && template.hasConnectionString))) {
          creates = await Promise.all(creates.map(async (r) => {
            if (!r.ok || r.value?.copiedFrom === template.id) return r;
            unsupported.push(r.scope);
            await dbConnectionAPI.delete(id, r.scope).catch(() => undefined);
            return { scope: r.scope, ok: false };
          }));
        }
        const okScopes = creates.filter((r) => r.ok).map((r) => r.scope);
        if (okScopes.length === 0) {
          const firstErr = creates.find((r) => !r.ok)?.error;
          setError(unsupported.length
            ? t('connection.errCopyUnsupported')
            : extractErr(firstErr, t('connection.errCreateAllFailed')));
          setSaving(false);
          return;
        }
        if (okScopes.length < writeScopes.length) {
          // The dialog closes on success, so a partial result is a toast.
          const missed = writeScopes.filter((s) => !okScopes.includes(s));
          const onlyUnsupported = missed.every((s) => unsupported.includes(s));
          toast({
            title: onlyUnsupported ? t('connection.duplicateTitle') : t('connection.newTitle'),
            description: onlyUnsupported
              ? t('connection.copyPartial', { ok: okScopes.join(' + '), missed: missed.join(' + ') })
              : t('connection.partialCreate', { ok: okScopes.join(' + '), missed: missed.join(' + ') }),
            variant: onlyUnsupported ? 'default' : 'destructive',
          });
        }
        const first = creates.find((r) => r.ok)!.value!;
        saved = { ...first, scope, primaryScope: scope, availableScopes: okScopes };
      }
      upsertLocal(saved);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      setError(extractErr(err, t('connection.saveFailed')));
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? t('connection.editTitle') : template ? t('connection.duplicateTitle') : t('connection.newTitle')}
          </DialogTitle>
          <DialogDescription>
            {template ? t('connection.duplicateDescription', { name: template.name }) : t('connection.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('common:name')}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('connection.namePlaceholder')}
                // Defeat the browser's contact/credential autofill — this
                // is a connection nickname, not the user's name.
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore="true"
              />
            </div>
            <div>
              <Label className="text-xs">{t('common:type')}</Label>
              <Select value={kind} onValueChange={(v) => handleKindChange(v as DBKind)} disabled={!!editing}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {KIND_GROUPS.map((g) => (
                    <SelectGroup key={g.driver}>
                      <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {g.family ? t('connection.kindFamily', { driver: g.driver }) : g.driver}
                      </SelectLabel>
                      {g.kinds.map((k) => (
                        <SelectItem key={k} value={k}>{DB_KIND_LABEL[k]}</SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {canPickScope && (
            <div>
              <Label className="text-xs">{t('connection.defaultBackend')}</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <ScopeCard
                  icon={<MonitorSmartphone className="h-4 w-4" />}
                  title={t('connection.scopeLocalTitle')}
                  desc={t('connection.scopeLocalDesc')}
                  active={scope === 'local'}
                  onClick={() => setScope('local')}
                />
                <ScopeCard
                  icon={<Cloud className="h-4 w-4" />}
                  title={t('connection.scopeRemoteTitle')}
                  desc={t('connection.scopeRemoteDesc')}
                  active={scope === 'remote'}
                  onClick={() => setScope('remote')}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {t('connection.scopeNote')}
              </p>
            </div>
          )}

          {/* Form / connection-string mode toggle */}
          <div className="flex items-center gap-1 text-xs">
            <ModeBtn active={!dsnMode} onClick={() => setDsnMode(false)} label={t('connection.modeForm')} />
            <ModeBtn active={dsnMode} onClick={() => setDsnMode(true)} label={t('connection.modeDsn')} />
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="ml-2 text-[10px] text-muted-foreground cursor-help">{t('connection.whatDoesThis')}</span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs max-w-[260px]">
                    {t('connection.dsnTooltip')}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {dsnMode ? (
            <div>
              <Label className="text-xs">
                {t('connection.connectionString')}
                {editing?.hasConnectionString && !dsn && (
                  <span className="text-muted-foreground"> {t('connection.dsnKeepStored')}</span>
                )}
                {template?.hasConnectionString && !dsn && (
                  <span className="text-muted-foreground"> {t('connection.dsnCopyStored')}</span>
                )}
              </Label>
              <Textarea
                value={dsn}
                onChange={(e) => {
                  const next = e.target.value;
                  setDsn(next);
                  // Best-effort: keep the structured fields in sync with
                  // the DSN as the user types/pastes. Failed parses leave
                  // the form fields untouched — the BE still uses the raw
                  // string at connect time.
                  const parsed = parseDSN(next);
                  if (parsed) {
                    if (parsed.host) setHost(parsed.host);
                    if (parsed.port) setPort(parsed.port);
                    if (parsed.database) setDatabase(parsed.database);
                    if (parsed.username) {
                      setUsername(parsed.username);
                      setNoAuth(false);
                    }
                    if (parsed.password) setPassword(parsed.password);
                    if (parsed.options) {
                      const cur = parsedOptions() ?? {};
                      const kept = Object.fromEntries(Object.entries(cur).filter(([k]) => !MONGO_URI_OPTIONS.includes(k)));
                      setOptionsText(JSON.stringify({ ...kept, ...parsed.options }, null, 2));
                    }
                  }
                }}
                className="font-mono text-xs min-h-[80px]"
                placeholder={previewDSN}
              />
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground">
                  {t('connection.dsnNote')}
                </p>
                <button
                  type="button"
                  onClick={() => setDsn(previewDSN.replace('••••••', password ? (family === 'mysql' ? password : encodeURIComponent(password)) : 'PASSWORD'))}
                  className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  <Copy className="h-2.5 w-2.5" /> {t('connection.useAutoDsn')}
                </button>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div>
              <Label className="text-xs">{t('connection.host')}</Label>
              <Input value={host} onChange={(e) => setHost(e.target.value)}
                placeholder={family === 'mongo' ? 'db1.example.com,db2.example.com' : t('connection.hostPlaceholder')} />
            </div>
            <div>
              <Label className="text-xs">{t('connection.port')}</Label>
              <Input
                type="number"
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value, 10) || 0)}
                className="w-24"
              />
            </div>
            {family === 'mongo' && (
              <p className="col-span-2 -mt-2 text-[10px] text-muted-foreground">{t('connection.hostsHelpMongo')}</p>
            )}
          </div>

          <div>
            <Label className="text-xs">
              {t('connection.database')}
              {!databaseRequired && (
                <span className="text-muted-foreground">
                  {' '}{allDatabasesOK ? t('connection.dbOptionalAll') : t('connection.dbOptional')}
                </span>
              )}
            </Label>
            <Input
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
              placeholder={
                family === 'mongo'
                  ? t('connection.dbPlaceholderMongo')
                  : family === 'mysql'
                    ? t('connection.dbPlaceholderMysql')
                    : t('connection.dbPlaceholderPg')
              }
            />
          </div>

          {family === 'mongo' && (
            <div>
              <Label className="text-xs">{t('connection.mongoAuth')}</Label>
              <Select value={mongoAuth} onValueChange={(v) => pickMongoAuth(v as MongoAuth)} disabled={!optionsValid}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="scram">{t('connection.mongoAuthScram')}</SelectItem>
                  <SelectItem value="ldap">{t('connection.mongoAuthLdap')}</SelectItem>
                  <SelectItem value="aws">{t('connection.mongoAuthAws')}</SelectItem>
                  <SelectItem value="none">{t('connection.mongoAuthNone')}</SelectItem>
                  {mongoAuth === 'custom' && (
                    <SelectItem value="custom">{t('connection.mongoAuthCustom', { mech: mongoMech })}</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[10px] text-muted-foreground">{t(`connection.mongoAuthHelp_${mongoAuth}`)}</p>
            </div>
          )}

          {family === 'mongo' && (
            <div className="grid grid-cols-2 gap-3">
              {mongoAuth !== 'none' && (
                <div>
                  <Label className="text-xs">{t('connection.authSource')}</Label>
                  <Input value={optionText('authSource')} onChange={(e) => setOptionText('authSource', e.target.value)}
                    disabled={!optionsValid || mongoAuth === 'ldap' || mongoAuth === 'aws'}
                    placeholder={database && database !== 'admin'
                      ? t('connection.authSourceDefaultThenAdmin', { db: database })
                      : t('connection.authSourceDefault', { db: 'admin' })} />
                  {mongoAuth !== 'ldap' && mongoAuth !== 'aws' && (
                    <p className="mt-1 text-[10px] text-muted-foreground">{t('connection.authSourceHelp')}</p>
                  )}
                </div>
              )}
              <div>
                <Label className="text-xs">{t('connection.replicaSet')}</Label>
                <Input value={optionText('replicaSet')} onChange={(e) => setOptionText('replicaSet', e.target.value)}
                  disabled={!optionsValid} placeholder={t('connection.replicaSetPlaceholder')} />
              </div>
            </div>
          )}

          {!(family === 'mongo' && mongoAuth === 'none') && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{family === 'mongo' && mongoAuth === 'aws' ? t('connection.awsAccessKey') : t('connection.username')}</Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                // These are DB credentials, not a website login —
                // surface keychain suggestions would just be wrong.
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore="true"
              />
            </div>
            <div>
              <Label className="text-xs">
                {family === 'mongo' && mongoAuth === 'aws'
                  ? t('connection.awsSecretKey')
                  : editing ? t('connection.passwordKeep') : template ? t('connection.passwordCopy') : t('connection.password')}
              </Label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-9"
                  // `new-password` is the magic value that stops Chrome/
                  // Safari from offering the keychain on a non-login form.
                  // The vendor-specific data attrs cover 1Password,
                  // LastPass and Bitwarden.
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
          )}

          {/* Read-only DSN preview when in form mode — shows what we'd send. */}
          {!dsnMode && (
            <div className="border rounded-md px-2 py-1.5 bg-muted/30 text-[10px] font-mono break-all">
              <span className="text-muted-foreground uppercase tracking-wider text-[9px] mr-1">
                {t('connection.willConnectAs')}
              </span>
              {previewDSN}
            </div>
          )}

          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {advanced ? `▼ ${t('connection.advanced')}` : `▸ ${t('connection.advanced')}`}
          </button>
          {advanced && (
            <div>
              <Label className="text-xs">{t('connection.optionsJson')}</Label>
              <Textarea
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                className="font-mono text-xs min-h-[100px]"
                placeholder='{"sslmode":"require"}'
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                <Trans t={t} i18nKey="connection.optionsHelp" components={{ code: <code /> }} />
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
                {testResult.ok ? t('connection.connectionOk') : testResult.error}
                {testResult.ok && testResult.authSource && (
                  <span className="block mt-0.5">{t('connection.authSourceFellBack', { db: testResult.authSource })}</span>
                )}
                {testResult.ok && testResult.directHost && (
                  <span className="block mt-0.5">
                    {t('connection.directFallback', { host: testResult.directHost, members: (testResult.members ?? []).join(', ') })}
                    {!testResult.directPrimary && ` ${t('connection.directFallbackSecondary', { host: testResult.directHost })}`}
                  </span>
                )}
                {!testResult.ok && family === 'mongo' && /cannot resolve|no such host/i.test(testResult.error ?? '') && (
                  <span className="block mt-1 text-foreground/80">{t('connection.mongoDnsHint')}</span>
                )}
                {!testResult.ok && family === 'mongo' && mongoAuth === 'scram' && /AuthenticationFailed|auth error/i.test(testResult.error ?? '') && (
                  <span className="block mt-1 text-foreground/80">
                    {!optionText('authSource') && database && database !== 'admin'
                      ? t('connection.mongoAuthHintBoth', { db: database })
                      : t('connection.mongoAuthHint', { db: mongoAuthSource })}
                  </span>
                )}
                {testResult.via && (
                  <span className="block mt-0.5 opacity-70">
                    {t('connection.testedVia', {
                      backend: testResult.via === 'local'
                        ? t('connection.scopeLocalTitle')
                        : t('connection.scopeRemoteTitle'),
                    })}
                  </span>
                )}
              </span>
            </div>
          )}
          {error && (
            <p className="text-xs text-destructive break-words">{error}</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleTest} disabled={testing || saving}>
            {testing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {t('connection.testConnection')}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {editing ? t('common:save') : t('connection.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScopeCard({
  icon, title, desc, active, onClick, disabled,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'text-left rounded-md border p-2.5 transition-colors',
        active && !disabled
          ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
          : 'border-border hover:bg-accent/50',
        disabled && 'opacity-60 cursor-not-allowed',
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

function ModeBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-2 py-1 rounded border text-xs transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:bg-accent/50',
      )}
    >
      {label}
    </button>
  );
}

// A create response; `copiedFrom` is echoed once the BE applied copySecretsFrom.
type CreatedConnection = DBConnection & { copiedFrom?: string };

function extractErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    return e.response?.data?.error || fallback;
  }
  return fallback;
}

interface ParsedDSN {
  host: string;
  port: number;       // 0 = unknown (mongodb+srv resolves it via SRV records)
  database: string;
  username: string;
  password: string;
  /** Connection options from the query string (Mongo only). */
  options?: Record<string, string | boolean>;
}

// Mongo URI options a form-mode connection carries in its options JSON —
// keep in step with mongoURIOptions in be/internal/dbquery/driver_mongo.go.
type MongoAuth = 'scram' | 'ldap' | 'aws' | 'none' | 'custom';

interface TestResult {
  ok: boolean;
  error?: string;
  via?: DBScope;
  /** Mongo signed in only through this auth source. */
  authSource?: string;
  /** Mongo replica set reached through one seed: its members' names do not resolve. */
  directHost?: string;
  directPrimary?: boolean;
  members?: string[];
}

const MONGO_URI_OPTIONS = [
  'authSource', 'authMechanism', 'authMechanismProperties', 'replicaSet',
  'directConnection', 'loadBalanced', 'tls', 'ssl', 'tlsInsecure',
  'tlsAllowInvalidCertificates', 'tlsAllowInvalidHostnames', 'readPreference',
  'retryWrites', 'retryReads', 'appName', 'compressors', 'maxPoolSize',
  'connectTimeoutMS', 'serverSelectionTimeoutMS', 'socketTimeoutMS',
];

/** "db1:27018" and "[::1]:27017" name a port; "db1" and a bare IPv6 do not. */
function hostHasPort(h: string): boolean {
  return h.startsWith('[') ? h.includes(']:') : (h.match(/:/g) ?? []).length === 1;
}

/** Sets (or, for undefined, removes) query options on a Mongo URI. */
function withMongoParams(uri: string, patch: Record<string, string | undefined>): string {
  const s = uri.trim();
  const q = s.indexOf('?');
  let base = q >= 0 ? s.slice(0, q) : s;
  const keys = Object.keys(patch).map((k) => k.toLowerCase());
  const kept = (q >= 0 ? s.slice(q + 1) : '').split('&').filter(Boolean)
    .filter((kv) => !keys.includes(decodePart(kv.split('=')[0]).toLowerCase()));
  for (const [k, v] of Object.entries(patch)) if (v) kept.push(`${k}=${encodeURIComponent(v)}`);
  // Options need a "/" after the hosts: mongodb://h:27017/?authSource=admin
  if (kept.length && !/^mongodb(\+srv)?:\/\/[^/]*\//i.test(base)) base += '/';
  return kept.length ? `${base}?${kept.join('&')}` : base;
}

function decodePart(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

// parseMongoDSN reads mongodb:// and mongodb+srv:// URIs by hand: the URL
// parser rejects a replica set's host list (h1:27017,h2:27017). Several
// hosts go into Host comma-separated; when they share one port it moves to
// Port. Known query options come back as connection options.
function parseMongoDSN(s: string): ParsedDSN | null {
  const m = /^mongodb(\+srv)?:\/\/([^/?#]*)(?:\/([^?#]*))?(?:\?([^#]*))?/i.exec(s);
  if (!m) return null;
  const srv = !!m[1];
  let rest = m[2];
  let username = '';
  let password = '';
  const at = rest.lastIndexOf('@');
  if (at >= 0) {
    const info = rest.slice(0, at);
    rest = rest.slice(at + 1);
    const colon = info.indexOf(':');
    username = decodePart(colon >= 0 ? info.slice(0, colon) : info);
    password = colon >= 0 ? decodePart(info.slice(colon + 1)) : '';
  }
  const hosts = rest.split(',').map((h) => h.trim()).filter(Boolean).map((h) => {
    if (!hostHasPort(h)) return { name: h, port: 0 };
    const i = h.lastIndexOf(':');
    return { name: h.slice(0, i), port: parseInt(h.slice(i + 1), 10) || 0 };
  });
  if (hosts.length === 0) return null;
  const ports = new Set(hosts.map((h) => h.port));
  const shared = ports.size === 1 ? hosts[0].port : null;
  const host = shared !== null
    ? hosts.map((h) => h.name).join(',')
    : hosts.map((h) => (h.port ? `${h.name}:${h.port}` : h.name)).join(',');
  const port = srv ? 0 : shared ?? hosts[0].port;

  const options: Record<string, string | boolean> = {};
  for (const kv of (m[4] ?? '').split('&')) {
    if (!kv) continue;
    const eq = kv.indexOf('=');
    const key = decodePart(eq >= 0 ? kv.slice(0, eq) : kv);
    const value = eq >= 0 ? decodePart(kv.slice(eq + 1)) : '';
    const known = MONGO_URI_OPTIONS.find((k) => k.toLowerCase() === key.toLowerCase());
    if (!known) continue;
    options[known] = value === 'true' ? true : value === 'false' ? false : value;
  }
  return {
    host,
    port,
    database: decodePart((m[3] ?? '').split('/')[0]),
    username,
    password,
    options,
  };
}

// parseDSN tries to extract host/port/database/credentials from a connection
// string so the structured form below the DSN textarea reflects what we'd
// actually dial. Best-effort — returns null for DSNs that don't fit the
// URL grammar (multi-host, unix-socket). The BE consumes the raw string
// either way; this is purely a UI aid.
//
// Supported schemes (matches BE drivers):
//   mongodb://, mongodb+srv://
//   postgres://, postgresql://
//   mysql://, mariadb://
//   sqlserver://
// parsePostgresURL reads postgres://, postgresql:// and jdbc:postgresql://
// by hand: the URL parser gives up on a raw password holding @ : / %, and a
// JDBC string carries user / password as query properties. Mirrors
// normalizePostgresDSN in be/internal/dbquery/driver_postgres.go.
function parsePostgresURL(s: string): ParsedDSN | null {
  const rest = s.replace(/^jdbc:/i, '').replace(/^postgres(ql)?:\/\//i, '');
  const q = rest.indexOf('?');
  const at = rest.lastIndexOf('@', q >= 0 ? q : rest.length);
  const info = at >= 0 ? rest.slice(0, at) : '';
  const m = /^([^/?#]*)(?:\/([^?#]*))?(?:\?([^#]*))?/.exec(at >= 0 ? rest.slice(at + 1) : rest);
  if (!m) return null;
  const colon = info.indexOf(':');
  const params = new URLSearchParams(m[3] ?? '');
  const hosts = m[1].split(',').map((h) => h.trim()).filter(Boolean);
  if (hosts.length === 0) return null;
  const first = /^(.*?)(?::(\d+))?$/.exec(hosts[0])!;
  return {
    host: hosts.length === 1 ? first[1] : hosts.join(','),
    port: first[2] ? parseInt(first[2], 10) : 0,
    database: decodePart((m[2] ?? '').split('/')[0]),
    username: info ? decodePart(colon >= 0 ? info.slice(0, colon) : info) : (params.get('user') ?? ''),
    password: info && colon >= 0 ? decodePart(info.slice(colon + 1)) : (params.get('password') ?? ''),
  };
}

// parseKeywordDSN reads libpq keyword/value strings: host=db1 port=5432
// dbname=wms user=app password='it\'s'.
function parseKeywordDSN(s: string): ParsedDSN | null {
  const kv: Record<string, string> = {};
  for (const m of s.matchAll(/(\w+)\s*=\s*(?:'((?:\\.|[^'\\])*)'|(\S+))/g)) {
    kv[m[1].toLowerCase()] = m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3];
  }
  if (!kv.host && !kv.dbname) return null;
  return {
    host: kv.host ?? '',
    port: kv.port ? parseInt(kv.port, 10) || 0 : 0,
    database: kv.dbname ?? '',
    username: kv.user ?? '',
    password: kv.password ?? '',
  };
}

function parseDSN(input: string): ParsedDSN | null {
  const s = input.trim();
  if (!s) return null;
  if (/^mongodb(\+srv)?:\/\//i.test(s)) return parseMongoDSN(s);
  if (/^(jdbc:)?postgres(ql)?:\/\//i.test(s)) return parsePostgresURL(s);
  if (/^\s*\w+\s*=/.test(s) && /\b(host|dbname)\s*=/i.test(s)) return parseKeywordDSN(s);
  try {
    // URL doesn't accept `mongodb+srv://`; swap to `https://` for parsing
    // and remember the original scheme was SRV (port stays 0).
    const isSrv = /^mongodb\+srv:\/\//i.test(s);
    const parseable = isSrv ? s.replace(/^mongodb\+srv:\/\//i, 'https://') : s;
    if (!/^[a-z][a-z0-9+\-.]*:\/\//i.test(parseable)) return null;
    const u = new URL(parseable);
    // u.pathname starts with '/' — strip and stop at the next '/' so we
    // only take the first path segment as the database name.
    const dbPath = u.pathname.replace(/^\/+/, '').split('/')[0] ?? '';
    // SQL Server (go-mssqldb) carries the database in `?database=`, not the
    // path — read it from the query so the form's Database field syncs.
    const isSqlServer = /^sqlserver:\/\//i.test(s);
    const database = isSqlServer
      ? (u.searchParams.get('database') ?? '')
      : decodeURIComponent(dbPath);
    return {
      host: u.hostname || '',
      port: isSrv ? 0 : (u.port ? parseInt(u.port, 10) : 0),
      database,
      username: u.username ? decodeURIComponent(u.username) : '',
      password: u.password ? decodeURIComponent(u.password) : '',
    };
  } catch {
    return null;
  }
}
