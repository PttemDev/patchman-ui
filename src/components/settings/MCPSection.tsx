// MCP panel — connect external MCP clients (Claude, MCP Inspector) to
// PatchMan's tools. Two DISTINCT, coexisting setups are presented:
//
//   • Remote (server) — the hosted BE's /api/mcp Streamable-HTTP endpoint,
//     authed with a user-minted `pmcp_` bearer token. Works from anywhere the
//     PatchMan server can reach. Shown on web AND desktop. Server name in the
//     client config: `patchman`.
//
//   • Local (this device) — DESKTOP ONLY. The embedded backend ships a tiny
//     stdio bridge (`patchman-mcp`) that self-discovers the running app, so the
//     client config carries NO url and NO token — just the bridge's absolute
//     path. Reaches localhost / this-machine-only resources. Server name:
//     `patchman-local`.
//
// Both expose the SAME tools and can be added to Claude simultaneously (the
// distinct names keep them from colliding).
//
// Remote tokens: the raw value is shown ONCE, right after creation — the
// backend only stores its hash. After that the list shows just the prefix.

import { useCallback, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Copy, Check, Loader2, AlertCircle, Trash2, KeyRound, ExternalLink, Terminal, FileJson, Cloud, Laptop } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { useAuthStore } from '@/stores/authStore';
import { mcpTokensAPI, mcpAPI, getRemoteMcpUrl, type MCPToken, type MCPLocalInfo } from '@/services/api';
import { isDesktop } from '@/lib/platform';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { MCPPermissionsPanel } from '@/components/settings/MCPPermissionsPanel';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// The MCP server names registered in the client's config. Distinct so a user
// can add BOTH the remote and local setups to Claude at the same time.
const SERVER_NAME = 'patchman';
const LOCAL_SERVER_NAME = 'patchman-local';

// Where Claude Desktop keeps its config (macOS). Both snippets go here.
const CLAUDE_CONFIG_PATH_MAC = '~/Library/Application Support/Claude/claude_desktop_config.json';

function errMessage(e: unknown, fallback: string): string {
  const resp = (e as { response?: { data?: { error?: string } } })?.response;
  return resp?.data?.error || fallback;
}

// --- One-click / copy-paste client setup builders -------------------------
// Cursor and VS Code expose deep-link install schemes, so those are true
// one-click. Claude has no install deep link, so we hand the user a ready
// command (Claude Code) or a config snippet (Claude Desktop).

function cursorDeeplink(endpoint: string, token: string): string {
  // cursor://anysphere.cursor-deeplink/mcp/install?name=…&config=<base64 server cfg>
  const cfg = { url: endpoint, headers: { Authorization: `Bearer ${token}` } };
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(
    SERVER_NAME,
  )}&config=${btoa(JSON.stringify(cfg))}`;
}

function vscodeDeeplink(endpoint: string, token: string): string {
  // vscode:mcp/install?<url-encoded server object>
  const obj = { name: SERVER_NAME, type: 'http', url: endpoint, headers: { Authorization: `Bearer ${token}` } };
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify(obj))}`;
}

function claudeCodeCommand(endpoint: string, token: string): string {
  return `claude mcp add --transport http ${SERVER_NAME} ${endpoint} --header "Authorization: Bearer ${token}"`;
}

// Remote (server) — HTTP connector. Carries the hosted endpoint + bearer token.
function claudeDesktopConfig(endpoint: string, token: string): string {
  return JSON.stringify(
    { mcpServers: { [SERVER_NAME]: { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${token}` } } } },
    null,
    2,
  );
}

// Local (this device) — stdio connector. Just the absolute path to the bridge
// binary; NO url and NO token (the bridge self-discovers the running app via
// its discovery file). `args: []` per the client config schema.
function claudeDesktopLocalConfig(bridgePath: string): string {
  return JSON.stringify(
    { mcpServers: { [LOCAL_SERVER_NAME]: { command: bridgePath, args: [] } } },
    null,
    2,
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — user can select manually */
        }
      }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

// A copy-paste config block: monospaced, horizontally scrollable, with the
// app's copy affordance pinned in the corner.
function ConfigSnippet({ json }: { json: string }) {
  return (
    <div className="relative rounded-md border bg-muted/40">
      <pre className="overflow-x-auto p-3 pr-12 text-xs leading-relaxed">
        <code>{json}</code>
      </pre>
      <div className="absolute right-2 top-2">
        <CopyButton value={json} />
      </div>
    </div>
  );
}

// Small status pill: pulsing green when live, amber when a live-but-not-ready
// warning, muted grey when simply idle.
function StatusPill({ tone, label }: { tone: 'ok' | 'warn' | 'idle'; label: string }) {
  const dot =
    tone === 'ok' ? (
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
    ) : (
      <span className={`inline-flex h-2 w-2 rounded-full ${tone === 'warn' ? 'bg-amber-500' : 'bg-muted-foreground/40'}`} />
    );
  const text =
    tone === 'ok'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-muted-foreground';
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${text}`}>
      {dot}
      {label}
    </span>
  );
}

export function MCPSection() {
  const { t } = useTranslation('settings');
  const isAuthed = useAuthStore((s) => s.isAuthenticated);
  const mode = useAuthStore((s) => s.mode);
  const { toast } = useToast();

  const [tokens, setTokens] = useState<MCPToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  // The freshly minted raw token, shown once until dismissed.
  const [justCreated, setJustCreated] = useState<string | null>(null);
  // Token currently pending revocation confirmation, if any.
  const [revokeTarget, setRevokeTarget] = useState<MCPToken | null>(null);

  // Local (this device) bridge info — desktop only. `null` means either "not
  // fetched yet" (while localLoading) or "unavailable" (fetch failed → hide
  // the card). A successful fetch with running:false still populates this, so
  // the card renders with an amber "app not running" status.
  const [localInfo, setLocalInfo] = useState<MCPLocalInfo | null>(null);
  const [localLoading, setLocalLoading] = useState(isDesktop());

  // The Remote setup needs an account to mint/list tokens. Local mode (no
  // account) and signed-out web both fall back to a sign-in prompt.
  const remoteAvailable = isAuthed && mode !== 'local';

  // External MCP clients connect here. Derived from the same base the API
  // client uses (VITE_API_URL or `/api`), NOT `window.location.origin` —
  // see getRemoteMcpUrl for why: Tauri builds and dev setups where the FE
  // and BE live on different origins would otherwise hand the user a URL
  // that points at the wrong host.
  const endpoint = getRemoteMcpUrl();

  const copyText = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: msg });
    } catch {
      toast({ title: t('mcp.copyFailed'), description: t('mcp.copyManually'), variant: 'destructive' });
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await mcpTokensAPI.list();
      setTokens(res.data ?? []);
    } catch (e) {
      setError(errMessage(e, t('mcp.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (remoteAvailable) load();
    // Nothing to fetch (signed out, or local mode) — resolve the initial
    // loading state so the list doesn't sit on a spinner forever.
    else setLoading(false);
  }, [remoteAvailable, load]);

  // Fetch the Local (this device) bridge info once, on desktop only. Any
  // failure (non-desktop routing, endpoint absent on this build, embedded BE
  // down) collapses to "unavailable" → the Local card is hidden entirely.
  useEffect(() => {
    if (!isDesktop()) {
      setLocalLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await mcpAPI.local();
        if (!cancelled) setLocalInfo(res.data ?? null);
      } catch {
        if (!cancelled) setLocalInfo(null); // soft-fail: hide the Local card
      } finally {
        if (!cancelled) setLocalLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await mcpTokensAPI.create(name.trim() || 'MCP token');
      setJustCreated(res.data.token);
      setName('');
      await load();
      toast({ title: t('mcp.tokenCreated'), description: t('mcp.tokenCreatedDesc') });
    } catch (e) {
      toast({ title: t('common:error'), description: errMessage(e, t('mcp.createFailed')), variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const confirmRevoke = async () => {
    const tok = revokeTarget;
    if (!tok) return;
    setRevokeTarget(null);
    try {
      await mcpTokensAPI.revoke(tok.id);
      setTokens((prev) => prev.filter((x) => x.id !== tok.id));
      toast({ title: t('mcp.tokenRevoked') });
    } catch (e) {
      toast({ title: t('common:error'), description: errMessage(e, t('mcp.revokeFailed')), variant: 'destructive' });
    }
  };

  const heading = (
    <div>
      <h2 className="text-lg font-semibold">{t('mcp.heading')}</h2>
      <p className="text-sm text-muted-foreground">
        {t('mcp.description')}
      </p>
      {isDesktop() && mode !== 'local' && (localLoading || localInfo) && (
        <p className="text-xs text-muted-foreground mt-2">
          <Trans
            t={t}
            i18nKey="mcp.twoSetups"
            values={{ remote: SERVER_NAME, local: LOCAL_SERVER_NAME }}
            components={{ code: <code /> }}
          />
        </p>
      )}
    </div>
  );

  return (
    <Tabs defaultValue="tokens" className="space-y-4">
      <TabsList>
        <TabsTrigger value="tokens">{t('mcp.tabs.tokens')}</TabsTrigger>
        <TabsTrigger value="permissions">{t('mcp.tabs.permissions')}</TabsTrigger>
      </TabsList>

      <TabsContent value="tokens" className="space-y-6">
      {heading}

      {/* ─────────────────── Remote (server) ─────────────────── */}
      {/* Hidden entirely in offline/local mode: there's no account to mint a
          remote token there, and the user asked to see only the local "app"
          MCP server when running offline. */}
      {mode !== 'local' && (
      <section className="rounded-lg border p-4 space-y-4">
        <div className="flex items-start gap-3">
          <Cloud className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{t('mcp.remoteTitle')}</span>
              {!remoteAvailable ? null : loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : (
                <StatusPill
                  tone={tokens.length > 0 ? 'ok' : 'idle'}
                  label={
                    tokens.length > 0
                      ? tokens.length === 1
                        ? t('mcp.tokenCountOne', { n: tokens.length })
                        : t('mcp.tokenCountOther', { n: tokens.length })
                      : t('mcp.noTokensYet')
                  }
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('mcp.remoteReach')}
            </p>
          </div>
        </div>

        {!remoteAvailable ? (
          <div className="rounded-md border p-3 text-sm text-muted-foreground">
            {t('mcp.remoteSignIn')}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Connection endpoint */}
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">{t('mcp.endpointLabel')}</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate rounded bg-muted px-2 py-1.5 text-xs">{endpoint}</code>
                <CopyButton value={endpoint} />
              </div>
            </div>

            {/* Create */}
            <div className="space-y-3">
              <div className="font-semibold text-sm">{t('mcp.createToken')}</div>
              <div className="flex items-center gap-2">
                <Input
                  placeholder={t('mcp.namePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !creating) handleCreate();
                  }}
                />
                <Button onClick={handleCreate} disabled={creating}>
                  {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <KeyRound className="h-4 w-4 mr-2" />}
                  {t('mcp.create')}
                </Button>
              </div>

              {justCreated && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-3">
                  <div className="text-xs font-medium text-amber-700 dark:text-amber-400">
                    {t('mcp.copyTokenNow')}
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 min-w-0 truncate rounded bg-background px-2 py-1.5 text-xs">{justCreated}</code>
                    <CopyButton value={justCreated} />
                  </div>

                  {/* One-click / copy setup for popular MCP clients. The token is
                      baked into each, which is why these only appear here, right
                      after creation. */}
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">{t('mcp.connectApp')}</div>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="outline">
                        <a href={cursorDeeplink(endpoint, justCreated)}>
                          <ExternalLink className="h-4 w-4 mr-2" />
                          {t('mcp.addToCursor')}
                        </a>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <a href={vscodeDeeplink(endpoint, justCreated)}>
                          <ExternalLink className="h-4 w-4 mr-2" />
                          {t('mcp.addToVsCode')}
                        </a>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyText(claudeCodeCommand(endpoint, justCreated), t('mcp.claudeCodeCopied'))}
                      >
                        <Terminal className="h-4 w-4 mr-2" />
                        {t('mcp.copyClaudeCode')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyText(claudeDesktopConfig(endpoint, justCreated), t('mcp.claudeDesktopCopied'))}
                      >
                        <FileJson className="h-4 w-4 mr-2" />
                        {t('mcp.copyClaudeDesktop')}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      <Trans
                        t={t}
                        i18nKey="mcp.clientHint"
                        components={{ code: <code /> }}
                      />
                    </p>
                  </div>

                  <Button variant="ghost" size="sm" onClick={() => setJustCreated(null)}>
                    {t('mcp.done')}
                  </Button>
                </div>
              )}
            </div>

            {/* List */}
            <div className="space-y-2">
              <div className="font-semibold text-sm">{t('mcp.yourTokens')}</div>
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('common:loading')}
                </div>
              ) : error ? (
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : tokens.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  {t('mcp.noTokensEmpty')}
                </div>
              ) : (
                <ul className="space-y-2">
                  {tokens.map((tok) => (
                    <li key={tok.id} className="flex items-center gap-3 rounded-lg border p-3">
                      <KeyRound className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{tok.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {tok.prefix}… · {t('mcp.createdOn', { date: new Date(tok.createdAt).toLocaleDateString() })}
                          {tok.lastUsedAt
                            ? ` · ${t('mcp.lastUsed', { date: new Date(tok.lastUsedAt).toLocaleString() })}`
                            : ` · ${t('mcp.neverUsed')}`}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setRevokeTarget(tok)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Persistent copy-paste Claude Desktop config (HTTP connector). Uses
                the just-minted token when available, otherwise a placeholder the
                user swaps for a token from the list above. */}
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">{t('mcp.claudeDesktopConfig')}</div>
              <ConfigSnippet json={claudeDesktopConfig(endpoint, justCreated ?? t('mcp.tokenPlaceholder'))} />
              <p className="text-[11px] text-muted-foreground">
                <Trans
                  t={t}
                  i18nKey="mcp.registersAs"
                  values={{ name: SERVER_NAME }}
                  components={{ code: <code /> }}
                />{' '}
                {justCreated ? t('mcp.tokenBakedIn') : t('mcp.swapPlaceholder')}
              </p>
            </div>
          </div>
        )}
      </section>
      )}

      {/* ─────────────────── Local (this device) ─────────────────── */}
      {/* Desktop only, and only once the embedded endpoint has answered. A
          fetch failure leaves localInfo null → this whole section is skipped. */}
      {isDesktop() && (localLoading || localInfo) && (
        <section className="rounded-lg border p-4 space-y-4">
          <div className="flex items-start gap-3">
            <Laptop className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm">{t('mcp.localTitle')}</span>
                {localLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : localInfo ? (
                  <StatusPill
                    tone={localInfo.running ? 'ok' : 'warn'}
                    label={localInfo.running ? t('mcp.running') : t('mcp.appNotRunning')}
                  />
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {t('mcp.localReach')}
              </p>
            </div>
          </div>

          {localLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('mcp.checkingBridge')}
            </div>
          ) : localInfo && localInfo.bridgePath ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">{t('mcp.claudeDesktopConfig')}</div>
                <ConfigSnippet json={claudeDesktopLocalConfig(localInfo.bridgePath)} />
                <p className="text-[11px] text-muted-foreground">
                  <Trans
                    t={t}
                    i18nKey="mcp.localConfigNote"
                    values={{ local: LOCAL_SERVER_NAME, remote: SERVER_NAME }}
                    components={{ code: <code /> }}
                  />
                </p>
              </div>

              {!localInfo.running && (
                <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{t('mcp.keepAppRunning')}</span>
                </div>
              )}
            </div>
          ) : (
            // Endpoint answered but no bridge path yet (e.g. first launch, copy
            // still settling). Soft message rather than a broken snippet.
            <div className="rounded-md border p-3 text-sm text-muted-foreground">
              {t('mcp.bridgeNotReady')}
            </div>
          )}
        </section>
      )}

      {/* Shared footer — both snippets edit the same Claude Desktop config. */}
      <p className="text-[11px] text-muted-foreground">
        <Trans
          t={t}
          i18nKey="mcp.configFileMac"
          values={{ path: CLAUDE_CONFIG_PATH_MAC }}
          components={{ code: <code /> }}
        />
      </p>
      </TabsContent>

      <TabsContent value="permissions">
        <MCPPermissionsPanel />
      </TabsContent>

      <AlertDialog open={revokeTarget !== null} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('mcp.revokeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget ? t('mcp.revokeConfirm', { name: revokeTarget.name }) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRevoke}>{t('mcp.revoke')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  );
}
