// MCP "Permissions" tab — per-token tool-group access.
//
// Each MCP token may be restricted to a subset of tool GROUPS (collections,
// db, kafka, …). All groups are ON by default (a token with no restriction);
// unchecking a group hides its tools from that token — enforced server-side,
// the tools aren't just hidden, they're not registered (see internal/mcp).
//
// Tokens come from two backends: the hosted BE ("remote") when signed in, and
// the embedded desktop BE ("local"/app bridge) on desktop. Each token's edits
// are saved back to its own backend via the matching execution pin.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldCheck, RotateCcw, Cloud, Laptop, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { useAuthStore } from '@/stores/authStore';
import { isDesktop } from '@/lib/platform';
import { mcpTokensAPI, type MCPToken, type McpPin } from '@/services/api';

// Tool-group keys — MUST match internal/mcpscope.AllGroups on the BE.
const GROUPS = [
  'collections', 'requests', 'environments', 'testcases', 'mocks',
  'connections', 'http', 'db', 'es', 'redis', 'kafka', 's3', 'k8s', 'git', 'devtools', 'whiteboards', 'notes', 'grafana', 'rabbitmq', 'observability', 'graylog',
] as const;

type PanelToken = MCPToken & { source: McpPin };

// null / undefined scopes → all groups enabled (the default). A CSV string →
// exactly those groups (empty string → none).
function scopesToSet(scopes: string | null | undefined): Set<string> {
  if (scopes == null) return new Set(GROUPS);
  return new Set(scopes.split(',').map((s) => s.trim()).filter(Boolean));
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function errMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const r = (e as { response?: { data?: { error?: string } } }).response;
    if (r?.data?.error) return r.data.error;
  }
  return fallback;
}

export function MCPPermissionsPanel() {
  const { t } = useTranslation('settings');
  const { toast } = useToast();
  const mode = useAuthStore((s) => s.mode);
  const isAuthed = useAuthStore((s) => s.isAuthenticated);
  const remoteAvailable = isAuthed && mode !== 'local';

  const [tokens, setTokens] = useState<PanelToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Draft enabled-group set per token id (what the toggles currently show).
  const [drafts, setDrafts] = useState<Record<string, Set<string>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  // Which token card is expanded (composite `${source}:${id}` key). Only one at
  // a time; the first token is open by default.
  const [openKey, setOpenKey] = useState<string | null>(null);

  const cardKey = (tok: PanelToken) => `${tok.source}:${tok.id}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const collected: PanelToken[] = [];
    let anyFailed = false;
    // Remote tokens (hosted BE) — only when signed in on a real remote.
    if (remoteAvailable) {
      try {
        const res = await mcpTokensAPI.list('remote');
        for (const tok of res.data ?? []) collected.push({ ...tok, source: 'remote' });
      } catch {
        anyFailed = true;
      }
    }
    // Local/app bridge token(s) — desktop only (the 'local' pin only resolves
    // on the embedded BE; on web it would fall through to remote, so gate it).
    // Best-effort: the embedded BE may be down — that shouldn't blank the panel.
    if (isDesktop()) {
      try {
        const res = await mcpTokensAPI.list('local');
        for (const tok of res.data ?? []) collected.push({ ...tok, source: 'local' });
      } catch {
        anyFailed = true;
      }
    }
    setTokens(collected);
    const nextDrafts: Record<string, Set<string>> = {};
    for (const tok of collected) nextDrafts[tok.id] = scopesToSet(tok.scopes);
    setDrafts(nextDrafts);
    // First token open by default.
    setOpenKey(collected.length ? `${collected[0].source}:${collected[0].id}` : null);
    // Only surface an error if we got nothing at all — otherwise show what we have.
    setError(collected.length === 0 && anyFailed ? t('mcp.perms.loadFailed') : null);
    setLoading(false);
  }, [remoteAvailable, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string, group: string) => {
    setDrafts((prev) => {
      const cur = new Set(prev[id] ?? []);
      if (cur.has(group)) cur.delete(group);
      else cur.add(group);
      return { ...prev, [id]: cur };
    });
  };

  const resetAll = (id: string) => {
    setDrafts((prev) => ({ ...prev, [id]: new Set(GROUPS) }));
  };

  const save = async (tok: PanelToken) => {
    const draft = drafts[tok.id] ?? new Set(GROUPS);
    // Every group on → send null (canonical "all"); otherwise the explicit list.
    const payload = draft.size === GROUPS.length ? null : [...draft];
    setSavingId(tok.id);
    try {
      const res = await mcpTokensAPI.updateScopes(tok.id, payload, tok.source);
      const updated = res.data;
      setTokens((prev) => prev.map((x) => (x.id === tok.id ? { ...x, scopes: updated?.scopes ?? null, source: x.source } : x)));
      toast({ title: t('mcp.perms.saved') });
    } catch (e) {
      toast({ title: t('common:error'), description: errMessage(e, t('mcp.perms.saveFailed')), variant: 'destructive' });
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('common:loading')}
      </div>
    );
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;

  if (tokens.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('mcp.perms.empty')}</p>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">{t('mcp.perms.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('mcp.perms.description')}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{t('mcp.perms.connectionsNote')}</p>
      </div>

      {tokens.map((tok) => {
        const key = cardKey(tok);
        return (
          <TokenPermCard
            key={key}
            tok={tok}
            open={openKey === key}
            onToggleOpen={() => setOpenKey((prev) => (prev === key ? null : key))}
            draft={drafts[tok.id] ?? new Set(GROUPS)}
            original={scopesToSet(tok.scopes)}
            saving={savingId === tok.id}
            onToggle={(g) => toggle(tok.id, g)}
            onReset={() => resetAll(tok.id)}
            onSave={() => save(tok)}
          />
        );
      })}
    </div>
  );
}

function TokenPermCard({
  tok,
  open,
  onToggleOpen,
  draft,
  original,
  saving,
  onToggle,
  onReset,
  onSave,
}: {
  tok: PanelToken;
  open: boolean;
  onToggleOpen: () => void;
  draft: Set<string>;
  original: Set<string>;
  saving: boolean;
  onToggle: (group: string) => void;
  onReset: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation('settings');
  const dirty = useMemo(() => !setsEqual(draft, original), [draft, original]);
  const allOn = draft.size === GROUPS.length;

  return (
    <div className="rounded-lg border">
      {/* Collapsible header — click to expand/collapse this token's toggles. */}
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        className="flex w-full items-center gap-2 flex-wrap p-4 text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        {tok.source === 'local' ? (
          <Laptop className="h-4 w-4 text-primary shrink-0" />
        ) : (
          <Cloud className="h-4 w-4 text-primary shrink-0" />
        )}
        <span className="text-sm font-medium">{tok.name}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {tok.source === 'local' ? t('mcp.perms.localSource') : t('mcp.perms.remoteSource')}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">{tok.prefix}…</span>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          {allOn ? (
            <>
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              {t('mcp.perms.allTools')}
            </>
          ) : (
            t('mcp.perms.restricted', { count: draft.size })
          )}
        </span>
      </button>

      {open && (
        <div className="space-y-3 px-4 pb-4">
          <div className="grid grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-2">
            {GROUPS.map((g) => (
              <label key={g} className="flex items-center gap-2 text-sm">
                <Switch checked={draft.has(g)} onCheckedChange={() => onToggle(g)} />
                <span className="truncate">{t(`mcp.perms.groups.${g}`)}</span>
              </label>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={onSave} disabled={!dirty || saving}>
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {saving ? t('mcp.perms.saving') : t('mcp.perms.save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={onReset} disabled={allOn || saving} className="text-muted-foreground">
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              {t('mcp.perms.resetAll')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
