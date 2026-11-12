// Admin-only dashboard at /admin.
//
// Renders three things:
//   1. Aggregate stats (user count, collection count, etc.)
//   2. User roster with search, role toggle and last activity; a row
//      expands into that user's usage (per-tool counts + last use), fetched
//      on first open and cached while the page is open
//   3. "Manage as user" — installs an X-Act-As-User header globally so
//      every regular CRUD endpoint operates on the target user's data
//
// Non-admins land on a clear "access denied" view rather than a 404 or
// silent redirect, so an admin who toggles roles on themselves doesn't
// get a confusing experience.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Search,
  Shield,
  ShieldOff,
  ArrowLeft,
  Loader2,
  AlertCircle,
  RefreshCw,
  KeyRound,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  UserCog,
  Copy,
  Eye,
  EyeOff,
  Wand2,
  Check,
} from 'lucide-react';
import { adminAPI, type AdminUserRow, type AdminStats } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { CrashReportingCard } from '@/components/admin/CrashReportingCard';
import { UserUsagePanel, type UsageState } from '@/components/admin/UserUsagePanel';
import { formatDate, formatDateTime, formatRelative, latestIso } from '@/lib/dateFormat';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import type { AxiosError } from 'axios';

const ACT_AS_KEY = 'patchman_act_as_user';
const ACT_AS_NAME_KEY = 'patchman_act_as_user_name';
// Users table column count (some hide at narrow widths); the expanded usage
// row and the loading/empty rows span all of them.
const USER_COLS = 8;

export function AdminDashboard() {
  const { t, i18n } = useTranslation('admin');
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.user);
  const isAdmin = me?.role === 'admin';

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [resetTarget, setResetTarget] = useState<AdminUserRow | null>(null);
  // Expanded rows + per-user usage cache (kept while the page is open).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [usage, setUsage] = useState<Record<string, UsageState>>({});

  const loadUsage = useCallback(async (id: string) => {
    setUsage((prev) => ({ ...prev, [id]: { ...prev[id], loading: true, error: undefined } }));
    try {
      const res = await adminAPI.userUsage(id);
      setUsage((prev) => ({ ...prev, [id]: { data: res.data, loading: false } }));
    } catch (err) {
      const ax = err as AxiosError<{ error?: string }>;
      setUsage((prev) => ({
        ...prev,
        [id]: { ...prev[id], loading: false, error: ax.response?.data?.error || ax.message },
      }));
    }
  }, []);

  // Fetch usage for every expanded row that has nothing cached yet (first
  // open, or after the page-level refresh cleared the cache).
  useEffect(() => {
    expanded.forEach((id) => {
      if (!usage[id]) void loadUsage(id);
    });
  }, [expanded, usage, loadUsage]);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setUsage({});
    try {
      const [usersRes, statsRes] = await Promise.all([adminAPI.listUsers(), adminAPI.stats()]);
      setUsers(usersRes.data);
      setStats(statsRes.data);
    } catch (err) {
      const ax = err as AxiosError<{ error?: string }>;
      setError(ax.response?.data?.error || ax.message || t('errors.loadFailed'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    refresh();
  }, [isAdmin, refresh]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q),
    );
  }, [users, search]);

  // Reset to page 1 whenever the filter or page size shrinks the visible
  // set — otherwise an admin could land on an empty page after typing
  // into the search box.
  useEffect(() => {
    setPage(1);
  }, [search, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedUsers = useMemo(
    () => filteredUsers.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredUsers, safePage, pageSize],
  );

  const setRole = async (u: AdminUserRow, role: 'user' | 'admin') => {
    try {
      await adminAPI.setRole(u.id, role);
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, role } : x)));
      toast({
        title:
          role === 'admin'
            ? t('toasts.nowAdmin', { user: u.name || u.email })
            : t('toasts.demotedToUser', { user: u.name || u.email }),
      });
    } catch (err) {
      const ax = err as AxiosError<{ error?: string }>;
      toast({
        title: t('toasts.updateRoleFailed'),
        description: ax.response?.data?.error || ax.message,
        variant: 'destructive',
      });
    }
  };

  const startImpersonation = (u: AdminUserRow) => {
    if (u.id === me?.id) {
      toast({ title: t('toasts.alreadyThisUser'), variant: 'destructive' });
      return;
    }
    localStorage.setItem(ACT_AS_KEY, u.id);
    localStorage.setItem(ACT_AS_NAME_KEY, u.name || u.email);
    // Notify the same-tab listener (the impersonation banner) so it
    // appears immediately without waiting for a navigation.
    window.dispatchEvent(new Event('patchman:act-as-changed'));
    toast({
      title: t('toasts.nowManaging', { user: u.name || u.email }),
      description: t('toasts.nowManagingDesc'),
    });
    // Hard reload so every store refetches under the new identity. Soft
    // navigate would leave cached lists from the admin's own data.
    window.location.assign('/');
  };

  if (!isAdmin) {
    return (
      <div className="h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-sm text-center space-y-3">
          <Shield className="h-8 w-8 mx-auto text-destructive" />
          <p className="text-base font-medium">{t('accessDenied.title')}</p>
          <p className="text-sm text-muted-foreground">
            {t('accessDenied.description')}
          </p>
          <Button onClick={() => navigate('/', { replace: true })} variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t('accessDenied.back')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Shield className="h-6 w-6 text-primary" />
              {t('title')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('/')}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              {t('backToApp')}
            </Button>
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
              {t('common:refresh')}
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Stats grid */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label={t('stats.users')} value={stats?.userCount} sub={t('stats.newThisWeek', { n: stats?.newUsers7d ?? 0 })} />
          <StatCard label={t('stats.collections')} value={stats?.collectionCount} />
          <StatCard label={t('stats.requests')} value={stats?.requestCount} />
          <StatCard label={t('stats.workspaces')} value={stats?.workspaceCount} />
          <StatCard
            label={t('stats.mockServers')}
            value={stats?.mockServerCount}
            sub={t((stats?.mockRouteCount ?? 0) === 1 ? 'stats.routesOne' : 'stats.routesOther', {
              n: stats?.mockRouteCount ?? 0,
            })}
          />
          <StatCard label={t('stats.historyItems')} value={stats?.historyCount} />
          <StatCard label={t('stats.testCases')} value={stats?.testCaseCount} />
          <StatCard label={t('stats.gitlabLinks')} value={stats?.gitIntegrationCount} />
        </section>

        {/* Users table */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Users className="h-4 w-4" />
              {t('usersTable.heading')} <span className="text-xs text-muted-foreground font-normal">{t('usersTable.countOfTotal', { shown: filteredUsers.length, total: users.length })}</span>
            </h2>
            <div className="relative w-full sm:w-72">
              <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('usersTable.searchPlaceholder')}
                className="pl-7 h-8"
              />
            </div>
          </div>

          <div className="rounded-md border bg-card overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">{t('usersTable.colUser')}</th>
                  <th className="hidden sm:table-cell text-left px-3 py-2 font-medium">{t('usersTable.colRole')}</th>
                  <th
                    className="text-right px-3 py-2 font-medium sm:whitespace-nowrap"
                    title={t('usersTable.lastActivityTitle', {
                      defaultValue: 'Latest of: app open, login, changes, sent requests, MCP use. Expand a row for every tool.',
                    })}
                  >
                    {t('usersTable.colLastActivity', { defaultValue: 'Last activity' })}
                  </th>
                  <th className="hidden lg:table-cell text-left px-3 py-2 font-medium">{t('usersTable.colIntegrations')}</th>
                  <th className="hidden md:table-cell text-right px-3 py-2 font-medium">{t('usersTable.colLastLogin')}</th>
                  <th className="hidden lg:table-cell text-right px-3 py-2 font-medium" title={t('usersTable.versionTitle')}>{t('usersTable.colVersion')}</th>
                  <th className="hidden xl:table-cell text-right px-3 py-2 font-medium">{t('usersTable.colJoined')}</th>
                  <th className="text-right px-3 py-2 font-medium">{t('common:actions')}</th>
                </tr>
              </thead>
              <tbody>
                {loading && users.length === 0 ? (
                  <tr>
                    <td colSpan={USER_COLS} className="px-3 py-6 text-center text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                      {t('usersTable.loading')}
                    </td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={USER_COLS} className="px-3 py-6 text-center text-muted-foreground">
                      {t('usersTable.noMatch')}
                    </td>
                  </tr>
                ) : (
                  pagedUsers.map((u) => {
                    const open = expanded.has(u.id);
                    const panelId = `admin-usage-${u.id}`;
                    const lastActivity = latestIso(u.lastActivityAt, usage[u.id]?.data?.lastActivityAt);
                    return (
                    <Fragment key={u.id}>
                    <tr
                      className={`border-t cursor-pointer hover:bg-muted/20 ${open ? 'bg-muted/20' : ''}`}
                      onClick={() => {
                        // Selecting text (e.g. copying an email) is not a toggle.
                        if (window.getSelection()?.toString()) return;
                        toggleExpanded(u.id);
                      }}
                    >
                      <td className="px-3 py-2 max-w-0 w-full sm:w-auto sm:max-w-none">
                        <button
                          type="button"
                          className="flex w-full min-w-0 items-start gap-1.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-expanded={open}
                          aria-controls={panelId}
                          title={t('usersTable.toggleUsage', { defaultValue: 'Show or hide usage' })}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpanded(u.id);
                          }}
                        >
                          {open ? (
                            <ChevronDown className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="min-w-0">
                            <span className="block font-medium break-words">{u.name || '—'}</span>
                            <span className="block text-xs text-muted-foreground break-all sm:break-normal">{u.email}</span>
                            {u.role === 'admin' && (
                              <Badge variant="default" className="sm:hidden mt-0.5 text-[10px]">{t('roles.admin')}</Badge>
                            )}
                          </span>
                        </button>
                      </td>
                      <td className="hidden sm:table-cell px-3 py-2">
                        {u.role === 'admin' ? (
                          <Badge variant="default" className="text-[10px]">{t('roles.admin')}</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">{t('roles.user')}</Badge>
                        )}
                      </td>
                      <td
                        className="px-3 py-2 text-right text-xs whitespace-nowrap"
                        title={lastActivity ? formatDateTime(lastActivity) : t('usersTable.never')}
                      >
                        {lastActivity ? formatRelative(lastActivity, i18n.language) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="hidden lg:table-cell px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {u.hasGitlab && <Badge variant="secondary" className="text-[10px]">{t('integrations.gitlab')}</Badge>}
                          {u.mcpTokenCount > 0 && (
                            <Badge variant="secondary" className="text-[10px]">
                              {u.mcpTokenCount > 1 ? t('integrations.mcpCount', { n: u.mcpTokenCount }) : t('integrations.mcp')}
                            </Badge>
                          )}
                          {!u.hasGitlab && u.mcpTokenCount === 0 && <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </td>
                      <td
                        className="hidden md:table-cell px-3 py-2 text-right text-xs text-muted-foreground whitespace-nowrap tabular-nums"
                        title={u.lastLoginAt ? formatDateTime(u.lastLoginAt) : t('usersTable.never')}
                      >
                        {u.lastLoginAt ? formatDate(u.lastLoginAt) : '—'}
                      </td>
                      <td className="hidden lg:table-cell px-3 py-2 text-right text-xs whitespace-nowrap" title={u.lastSeenAt ? t('usersTable.lastSeen', { date: formatDateTime(u.lastSeenAt) }) : undefined}>
                        {u.lastSeenVersion ? <span className="font-mono">{u.lastSeenVersion}</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="hidden xl:table-cell px-3 py-2 text-right text-xs text-muted-foreground tabular-nums" title={formatDateTime(u.createdAt)}>
                        {formatDate(u.createdAt)}
                      </td>
                      <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex gap-1">
                          {u.role === 'admin' ? (
                            <Button size="sm" variant="ghost" className="px-2 xl:px-3" onClick={() => setRole(u, 'user')} title={t('userActions.demoteTitle')} aria-label={t('userActions.demoteTitle')}>
                              <ShieldOff className="h-3.5 w-3.5 xl:mr-1" />
                              <span className="hidden xl:inline">{t('userActions.demote')}</span>
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" className="px-2 xl:px-3" onClick={() => setRole(u, 'admin')} title={t('userActions.promoteTitle')} aria-label={t('userActions.promoteTitle')}>
                              <Shield className="h-3.5 w-3.5 xl:mr-1" />
                              <span className="hidden xl:inline">{t('userActions.makeAdmin')}</span>
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="px-2 xl:px-3" onClick={() => setResetTarget(u)} title={t('userActions.resetPasswordTitle')} aria-label={t('userActions.resetPasswordTitle')}>
                            <KeyRound className="h-3.5 w-3.5 xl:mr-1" />
                            <span className="hidden xl:inline">{t('userActions.password')}</span>
                          </Button>
                          {u.id !== me?.id && (
                            <Button size="sm" variant="outline" className="px-2 xl:px-3" onClick={() => startImpersonation(u)} title={t('userActions.manage')} aria-label={t('userActions.manage')}>
                              <UserCog className="h-3.5 w-3.5 xl:hidden" />
                              <span className="hidden xl:inline">{t('userActions.manage')}</span>
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr id={panelId}>
                        <td colSpan={USER_COLS} className="p-0">
                          <UserUsagePanel user={u} state={usage[u.id]} onRefresh={() => void loadUsage(u.id)} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
            </div>
            {filteredUsers.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span>{t('pagination.rowsPerPage')}</span>
                  <select
                    className="h-7 rounded border bg-background px-1 text-xs"
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                  >
                    {[10, 25, 50, 100].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span>
                    {t('pagination.range', {
                      from: (safePage - 1) * pageSize + 1,
                      to: Math.min(safePage * pageSize, filteredUsers.length),
                      total: filteredUsers.length,
                    })}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="tabular-nums">
                    {safePage} / {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </section>

        <CrashReportingCard />
      </div>

      <PasswordResetDialog
        target={resetTarget}
        onClose={() => setResetTarget(null)}
      />
    </div>
  );
}

// Password reset dialog. Admin types a custom password OR clicks
// "Generate" to fill a strong random one. After save, the field stays
// readable with a copy button so the admin can hand the new password
// off — we never store it again, so this is the only chance to grab it.
function PasswordResetDialog({
  target,
  onClose,
}: {
  target: AdminUserRow | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // Reset internal state every time a new user is targeted (or dialog
  // closes). Otherwise a previously saved password would flash for the
  // next user the admin opens.
  useEffect(() => {
    setPassword('');
    setShowPassword(true);
    setSubmitting(false);
    setSaved(false);
    setCopied(false);
  }, [target?.id]);

  const generate = () => {
    // 16 chars from a 72-char alphabet ≈ 99 bits of entropy. Excludes
    // visually ambiguous chars (0/O, 1/l/I) so an admin can dictate the
    // password over the phone without re-asking.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
    const buf = new Uint32Array(16);
    crypto.getRandomValues(buf);
    let out = '';
    for (let i = 0; i < buf.length; i++) out += alphabet[buf[i] % alphabet.length];
    setPassword(out);
    setShowPassword(true);
    setSaved(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: t('passwordReset.copyFailed'), variant: 'destructive' });
    }
  };

  const submit = async () => {
    if (!target) return;
    if (password.length < 6) {
      toast({ title: t('passwordReset.minLengthError'), variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      await adminAPI.resetPassword(target.id, password);
      setSaved(true);
      toast({
        title: t('passwordReset.successTitle'),
        description: t('passwordReset.successDesc', { user: target.name || target.email }),
      });
    } catch (err) {
      const ax = err as AxiosError<{ error?: string }>;
      toast({
        title: t('passwordReset.resetFailed'),
        description: ax.response?.data?.error || ax.message,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            {t('passwordReset.title')}
          </DialogTitle>
          <DialogDescription>
            {target ? (
              <Trans
                t={t}
                i18nKey="passwordReset.description"
                values={{ user: target.name || target.email }}
                components={{ strong: <span className="font-medium" /> }}
              />
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-password" className="text-xs">
              {t('passwordReset.newPasswordLabel')}
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setSaved(false);
                  }}
                  placeholder={t('passwordReset.passwordPlaceholder')}
                  className="pr-9 font-mono"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  title={showPassword ? t('passwordReset.hide') : t('passwordReset.show')}
                >
                  {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={generate} title={t('passwordReset.generateTitle')}>
                <Wand2 className="h-3.5 w-3.5 mr-1" />
                {t('passwordReset.generate')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copy}
                disabled={!password}
                title={t('passwordReset.copyTitle')}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t('passwordReset.hint')}
            </p>
          </div>

          {saved && (
            <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-700 dark:text-green-400">
              {t('passwordReset.savedNote')}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {saved ? t('common:close') : t('common:cancel')}
          </Button>
          <Button onClick={submit} disabled={submitting || password.length < 6}>
            {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            {saved ? t('passwordReset.saveAgain') : t('passwordReset.savePassword')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ label, value, sub }: { label: string; value?: number; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3 space-y-0.5">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value ?? '—'}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
