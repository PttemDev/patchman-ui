// Expanded row of the admin users table: one user's usage — last activity,
// per-area counts, per-tool use (items / actions / operations / last used),
// MCP clients and memory cards by agent. Metadata only; fetched on the first
// expand by AdminDashboard and cached while the page is open.

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, AlertCircle, Bot, Loader2, Plug, RefreshCw } from 'lucide-react';
import type { AdminUserRow, AdminUserUsage } from '@/services/api';
import { Button } from '@/components/ui/button';
import { formatDate, formatDateTime, formatRelative, latestIso } from '@/lib/dateFormat';

export interface UsageState {
  data?: AdminUserUsage;
  loading: boolean;
  error?: string;
}

// English fallbacks for the tool keys the BE emits (admin_usage.go
// usageRoutes / usageSources). Unknown keys fall back to the key itself.
const TOOL_LABELS: Record<string, string> = {
  requests: 'Collections & requests',
  history: 'Sent requests',
  environments: 'Environments',
  mocks: 'Mock servers',
  notes: 'Notes',
  memory: 'Agent memory',
  whiteboards: 'Whiteboards',
  qa: 'Test management',
  loadtests: 'Load tests',
  db: 'Databases',
  kafka: 'Kafka',
  s3: 'S3',
  redis: 'Redis',
  es: 'Elasticsearch',
  k8s: 'Kubernetes',
  grafana: 'Grafana',
  rabbitmq: 'RabbitMQ',
  observability: 'Observability',
  git: 'Git / CI',
  ai: 'AI / LLM',
  mcp: 'MCP',
  collab: 'Workspaces & teams',
  devtools: 'Dev tools',
  sync: 'Desktop sync',
  other: 'Other',
};

export function UserUsagePanel({
  user,
  state,
  onRefresh,
}: {
  user: AdminUserRow;
  state: UsageState | undefined;
  onRefresh: () => void;
}) {
  const { t, i18n } = useTranslation('admin');
  const lang = i18n.language;
  const data = state?.data;
  const loading = !state || state.loading;
  const lastActivity = latestIso(user.lastActivityAt, data?.lastActivityAt);

  const when = (iso?: string) =>
    iso ? (
      <span title={formatDateTime(iso)} className="whitespace-nowrap">
        {formatRelative(iso, lang)}
      </span>
    ) : (
      <span className="text-muted-foreground">{t('usersTable.never')}</span>
    );

  return (
    <div className="space-y-4 border-t bg-muted/10 px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <Activity className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-muted-foreground">{t('usage.lastActivity', { defaultValue: 'Last activity' })}:</span>
          {lastActivity ? (
            <>
              <span className="font-medium">{formatRelative(lastActivity, lang)}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{formatDateTime(lastActivity)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">{t('usersTable.never')}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {data && (
            <span title={formatDateTime(data.generatedAt)}>
              {t('usage.updated', { defaultValue: 'Updated {{when}}', when: formatRelative(data.generatedAt, lang) })}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={onRefresh}
            disabled={loading}
            title={t('usage.refresh', { defaultValue: 'Refresh usage' })}
            aria-label={t('usage.refresh', { defaultValue: 'Refresh usage' })}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Row facts that are hidden as table columns at narrow widths. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <Fact label={t('usersTable.colLastLogin')}>{when(user.lastLoginAt)}</Fact>
        <Fact label={t('usage.lastSeen', { defaultValue: 'Last seen' })}>
          {when(user.lastSeenAt)}
          {user.lastSeenVersion && <span className="ml-1 font-mono text-muted-foreground">{user.lastSeenVersion}</span>}
        </Fact>
        <Fact label={t('usersTable.colJoined')}>
          <span className="tabular-nums" title={formatDateTime(user.createdAt)}>
            {formatDate(user.createdAt)}
          </span>
        </Fact>
        <Fact label={t('usersTable.colIntegrations')}>
          {[user.hasGitlab && t('integrations.gitlab'), user.mcpTokenCount > 0 && t('integrations.mcp')]
            .filter(Boolean)
            .join(' · ') || '—'}
        </Fact>
      </dl>

      {state?.error && !data && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">
            {t('usage.loadFailed', { defaultValue: 'Could not load usage' })}: {state.error}
          </span>
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={onRefresh}>
            {t('common:retry')}
          </Button>
        </div>
      )}

      {!data && loading && (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('usage.loading', { defaultValue: 'Loading usage…' })}
        </div>
      )}

      {data && <UsageBody data={data} />}
    </div>
  );
}

function UsageBody({ data }: { data: AdminUserUsage }) {
  const { t, i18n } = useTranslation('admin');
  const lang = i18n.language;
  const c = data.counts;
  const counts: { label: string; value: number; sub?: string }[] = [
    { label: t('stats.collections'), value: c.collections },
    { label: t('stats.requests'), value: c.requests },
    {
      label: t('stats.mockServers'),
      value: c.mockServers,
      sub: c.mockRoutes ? t(c.mockRoutes === 1 ? 'stats.routesOne' : 'stats.routesOther', { n: c.mockRoutes }) : undefined,
    },
    { label: t('usage.counts.environments', { defaultValue: 'Environments' }), value: c.environments },
    { label: t('usage.counts.history', { defaultValue: 'Sent requests' }), value: c.history },
    { label: t('usage.counts.notes', { defaultValue: 'Notes' }), value: c.notes },
    { label: t('usage.counts.cards', { defaultValue: 'Memory cards' }), value: c.cards },
    { label: t('usage.counts.whiteboards', { defaultValue: 'Whiteboards' }), value: c.whiteboards },
    { label: t('stats.testCases'), value: c.testCases },
    { label: t('stats.workspaces'), value: c.workspaces },
    { label: t('usage.counts.teams', { defaultValue: 'Teams' }), value: c.teams },
    { label: t('usage.counts.mcpTokens', { defaultValue: 'MCP tokens' }), value: c.mcpTokens },
  ];

  const lastUsed = (iso?: string) =>
    iso ? (
      <span title={formatDateTime(iso)} className="whitespace-nowrap">
        {formatRelative(iso, lang)}
      </span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );
  const num = (n: number) => (n ? n.toLocaleString(lang) : <span className="text-muted-foreground">—</span>);
  const colItems = t('usage.tools.colItems', { defaultValue: 'Items' });
  const colActions = t('usage.tools.colActions', { defaultValue: 'Actions' });
  const colOps = t('usage.tools.colOps', { defaultValue: 'Ops' });
  const itemsTitle = t('usage.tools.itemsTitle', { defaultValue: 'Things the user owns here: connections, boards, test cases…' });
  const actionsTitle = t('usage.tools.actionsTitle', {
    defaultValue: 'Changes and operations recorded in the audit log (from the app and MCP)',
  });
  const opsTitle = t('usage.tools.opsTitle', {
    defaultValue: "Entries in the tool's own history: queries, consumes, sent requests (reads included)",
  });

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {counts.map((x) => (
          <div key={x.label} className="min-w-0 rounded-md border bg-card px-2.5 py-1.5">
            <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground" title={x.label}>
              {x.label}
            </div>
            <div className="text-base font-semibold tabular-nums">{x.value.toLocaleString(lang)}</div>
            {x.sub && <div className="text-[10px] text-muted-foreground">{x.sub}</div>}
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="min-w-0 space-y-1.5 lg:col-span-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('usage.tools.heading', { defaultValue: 'Tools' })}
          </h4>
          {data.tools.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('usage.noActivity', { defaultValue: 'No recorded activity yet.' })}
            </p>
          ) : (
            <div className="rounded-md border bg-card">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-full px-2 py-1.5 text-left font-medium">{t('usage.tools.colTool', { defaultValue: 'Tool' })}</th>
                    <th className="hidden whitespace-nowrap px-2 py-1.5 text-right font-medium sm:table-cell" title={itemsTitle}>
                      {colItems}
                    </th>
                    <th className="hidden whitespace-nowrap px-2 py-1.5 text-right font-medium sm:table-cell" title={actionsTitle}>
                      {colActions}
                    </th>
                    <th className="hidden whitespace-nowrap px-2 py-1.5 text-right font-medium sm:table-cell" title={opsTitle}>
                      {colOps}
                    </th>
                    <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">
                      {t('usage.tools.colLastUsed', { defaultValue: 'Last used' })}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.tools.map((tu) => {
                    const label = t(`usage.tool.${tu.tool}`, { defaultValue: TOOL_LABELS[tu.tool] ?? tu.tool });
                    return (
                      <tr key={tu.tool} className="border-t">
                        <td className="max-w-0 px-2 py-1.5">
                          <div className="truncate" title={label}>
                            {label}
                          </div>
                          {/* Narrow screens: the count columns fold into one line. */}
                          <div className="truncate text-[11px] text-muted-foreground tabular-nums sm:hidden">
                            {colItems} {tu.items} · {colActions} {tu.actions} · {colOps} {tu.operations}
                          </div>
                        </td>
                        <td className="hidden px-2 py-1.5 text-right tabular-nums sm:table-cell">{num(tu.items)}</td>
                        <td className="hidden px-2 py-1.5 text-right tabular-nums sm:table-cell">{num(tu.actions)}</td>
                        <td className="hidden px-2 py-1.5 text-right tabular-nums sm:table-cell">{num(tu.operations)}</td>
                        <td className="px-2 py-1.5 text-right align-top">{lastUsed(tu.lastUsedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="min-w-0 space-y-4">
          <section className="space-y-1.5">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Plug className="h-3.5 w-3.5" />
              {t('usage.mcp.heading', { defaultValue: 'MCP clients' })}
            </h4>
            {data.mcpClients.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('usage.mcp.none', { defaultValue: 'No MCP tokens.' })}</p>
            ) : (
              <ul className="divide-y rounded-md border bg-card text-xs">
                {data.mcpClients.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-2 px-2 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate font-medium" title={m.clientName || undefined}>
                        {m.clientName || (
                          <span className="font-normal text-muted-foreground">
                            {t('usage.mcp.noClient', { defaultValue: 'No client connected yet' })}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground" title={m.name}>
                        {t('usage.mcp.token', {
                          defaultValue: 'Token “{{name}}” · created {{date}}',
                          name: m.name || '—',
                          date: formatDate(m.createdAt) || '—',
                        })}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {m.lastUsedAt ? (
                        lastUsed(m.lastUsedAt)
                      ) : (
                        <span className="text-muted-foreground">{t('usage.mcp.neverUsed', { defaultValue: 'Never used' })}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.agents.length > 0 && (
            <section className="space-y-1.5">
              <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Bot className="h-3.5 w-3.5" />
                {t('usage.agents.heading', { defaultValue: 'Memory cards by agent' })}
              </h4>
              <ul className="divide-y rounded-md border bg-card text-xs">
                {data.agents.map((a) => (
                  <li key={a.agent || '_'} className="flex items-center justify-between gap-2 px-2 py-1.5">
                    <span className="min-w-0 truncate" title={a.agent || undefined}>
                      {a.agent || (
                        <span className="text-muted-foreground">{t('usage.agents.byHand', { defaultValue: 'Written by hand' })}</span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums">{a.cards.toLocaleString(lang)}</span>
                      <span className="text-muted-foreground">{lastUsed(a.lastAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}
