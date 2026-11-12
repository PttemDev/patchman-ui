import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Server,
  Trash2,
  Copy,
  Check,
  ArrowLeft,
  Pencil,
  Power,
  PowerOff,
  Globe,
  MoreHorizontal,
  ExternalLink,
} from 'lucide-react';
import { mockAPI, getRemoteMockBaseUrl } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useRequestStore } from '@/stores/requestStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import type { MockServer, MockRoute } from '@/types';

type View =
  | { type: 'list' }
  | { type: 'create-server'; step: number }
  | { type: 'server-detail'; serverId: string }
  | { type: 'create-route'; serverId: string }
  | { type: 'edit-route'; serverId: string; route: MockRoute }
  | { type: 'edit-server'; server: MockServer };

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

const methodColors: Record<string, string> = {
  GET: 'bg-green-500/15 text-green-400 border-green-500/30',
  POST: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  PUT: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  PATCH: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  DELETE: 'bg-red-500/15 text-red-400 border-red-500/30',
};

/**
 * Derive the user's mandatory mock-prefix namespace from their email.
 * Mirrors the BE's sanitizeMockSlug — both must agree, otherwise the
 * preview URL on the FE wouldn't match what the BE stores.
 */
function userMockNamespace(email: string | undefined): string {
  if (!email) return '';
  const at = email.indexOf('@');
  const local = at > 0 ? email.slice(0, at) : email;
  const cleaned = local
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned;
}

function cleanPrefix(p: string) {
  return p.replace(/^\/+|\/+$/g, '');
}

export function MockServerList() {
  const [view, setView] = useState<View>({ type: 'list' });
  const [servers, setServers] = useState<MockServer[]>([]);
  const [routes, setRoutes] = useState<Record<string, MockRoute[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'server' | 'route'; id: string; serverId?: string; label: string } | null>(null);
  const { toast } = useToast();
  const { t } = useTranslation('mock');

  const addTab = useRequestStore((s) => s.addTab);

  // The mandatory user namespace prefix. Server-side enforces this regardless,
  // but pre-displaying it in the form makes it obvious WHY the user can't
  // collide with someone else's mock. Empty in local-mode (single user → no
  // collisions to worry about).
  const userEmail = useAuthStore((s) => s.user?.email);
  const userNamespace = userMockNamespace(userEmail);

  // Server create form
  const [serverName, setServerName] = useState('');
  const [serverPrefix, setServerPrefix] = useState('');

  // Route form
  const [routeMethod, setRouteMethod] = useState('GET');
  const [routePath, setRoutePath] = useState('/');
  const [routeStatus, setRouteStatus] = useState('200');
  const [routeBody, setRouteBody] = useState('{"message": "OK"}');
  const [routeDelay, setRouteDelay] = useState('0');
  const [routeHeaders, setRouteHeaders] = useState('{"Content-Type": "application/json"}');
  const [saving, setSaving] = useState(false);

  const fetchServers = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await mockAPI.listServers();
      setServers(response.data || []);
    } catch {
      /* ignore */
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const fetchRoutes = useCallback(async (serverId: string) => {
    try {
      const response = await mockAPI.listRoutes(serverId);
      setRoutes((prev) => ({ ...prev, [serverId]: response.data || [] }));
    } catch {
      /* ignore */
    }
  }, []);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const getBaseUrl = (prefix: string) =>
    `${getRemoteMockBaseUrl()}/${cleanPrefix(prefix)}`;

  const resetServerForm = () => {
    setServerName('');
    setServerPrefix('');
  };

  const resetRouteForm = (route?: MockRoute) => {
    setRouteMethod(route?.method || 'GET');
    setRoutePath(route?.path || '/');
    setRouteStatus(route?.statusCode?.toString() || '200');
    setRouteBody(route?.responseBody || '{"message": "OK"}');
    setRouteDelay(route?.delay?.toString() || '0');
    try {
      const h = route?.responseHeaders ? (typeof route.responseHeaders === 'string' ? route.responseHeaders : JSON.stringify(route.responseHeaders)) : '{"Content-Type": "application/json"}';
      setRouteHeaders(h);
    } catch {
      setRouteHeaders('{"Content-Type": "application/json"}');
    }
  };

  // ── Create Server ──
  const handleCreateServer = async () => {
    if (!serverName.trim()) return;
    const prefix = serverPrefix.trim().replace(/^\/+|\/+$/g, '') || serverName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    setSaving(true);
    try {
      const res = await mockAPI.createServer({ name: serverName.trim(), prefix, isActive: true });
      await fetchServers();
      resetServerForm();
      setView({ type: 'server-detail', serverId: (res.data as MockServer).id });
      toast({ title: t('toast.serverCreated'), description: t('toast.serverCreatedDesc', { name: serverName.trim() }) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('toast.createServerFailed');
      toast({ title: t('common:error'), description: msg, variant: 'destructive' });
    }
    setSaving(false);
  };

  // ── Update Server ──
  const handleUpdateServer = async (server: MockServer) => {
    if (!serverName.trim()) return;
    const prefix = serverPrefix.trim().replace(/^\/+|\/+$/g, '') || undefined;
    setSaving(true);
    try {
      await mockAPI.updateServer(server.id, { name: serverName.trim(), prefix });
      await fetchServers();
      setView({ type: 'server-detail', serverId: server.id });
      toast({ title: t('toast.serverUpdated') });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('toast.updateServerFailed');
      toast({ title: t('common:error'), description: msg, variant: 'destructive' });
    }
    setSaving(false);
  };

  // ── Toggle Server ──
  const handleToggle = async (server: MockServer) => {
    try {
      await mockAPI.updateServer(server.id, { isActive: !server.isActive });
      await fetchServers();
    } catch {
      /* ignore */
    }
  };

  // ── Delete ──
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === 'server') {
        await mockAPI.deleteServer(deleteTarget.id);
        await fetchServers();
        setView({ type: 'list' });
      } else {
        await mockAPI.deleteRoute(deleteTarget.serverId!, deleteTarget.id);
        if (deleteTarget.serverId) {
          await Promise.all([fetchRoutes(deleteTarget.serverId), fetchServers()]);
        }
      }
      toast({ title: deleteTarget.type === 'server' ? t('toast.serverDeleted') : t('toast.routeDeleted') });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('toast.deleteFailed');
      toast({ title: t('common:error'), description: msg, variant: 'destructive' });
    }
    setDeleteTarget(null);
  };

  // ── Save Route ──
  const handleSaveRoute = async (serverId: string, existingRoute?: MockRoute) => {
    setSaving(true);
    try {
      const data = {
        method: routeMethod,
        path: routePath.startsWith('/') ? routePath : `/${routePath}`,
        statusCode: parseInt(routeStatus, 10) || 200,
        responseHeaders: routeHeaders,
        responseBody: routeBody,
        delay: parseInt(routeDelay, 10) || 0,
        isActive: true,
      };

      if (existingRoute) {
        await mockAPI.updateRoute(serverId, existingRoute.id, data);
      } else {
        await mockAPI.createRoute(serverId, data);
      }

      // Refresh routes for the inner view AND the servers list so the
      // outer "N routes" badge reflects the latest count instead of the
      // stale value preloaded at last `fetchServers()`.
      await Promise.all([fetchRoutes(serverId), fetchServers()]);
      setView({ type: 'server-detail', serverId });
      toast({ title: existingRoute ? t('toast.routeUpdated') : t('toast.routeCreated') });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('toast.saveRouteFailed');
      toast({ title: t('common:error'), description: msg, variant: 'destructive' });
    }
    setSaving(false);
  };

  // ── Render helpers ──
  const findServer = (id: string) => servers.find((s) => s.id === id);

  const renderHeader = (title: string, onBack: () => void, actions?: React.ReactNode) => (
    <div className="flex items-center gap-2 px-3 py-2 border-b">
      <button onClick={onBack} className="p-0.5 rounded hover:bg-accent cursor-pointer shrink-0">
        <ArrowLeft className="h-4 w-4" />
      </button>
      <span className="text-sm font-semibold flex-1 truncate">{title}</span>
      {actions}
    </div>
  );

  // ═══════════════════════════════════
  // VIEW: Server List
  // ═══════════════════════════════════
  if (view.type === 'list') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-semibold">{t('list.title')}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              resetServerForm();
              setView({ type: 'create-server', step: 1 });
            }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : servers.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
              <Server className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium mb-1">{t('list.emptyTitle')}</p>
            <p className="text-xs text-muted-foreground mb-4">
              {t('list.emptyDescription')}
            </p>
            <Button
              size="sm"
              onClick={() => {
                resetServerForm();
                setView({ type: 'create-server', step: 1 });
              }}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              {t('list.createServer')}
            </Button>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <div className="p-2 space-y-1">
              {servers.map((server) => {
                const prefix = cleanPrefix(server.prefix);
                return (
                  <button
                    key={server.id}
                    onClick={() => {
                      setView({ type: 'server-detail', serverId: server.id });
                      fetchRoutes(server.id);
                    }}
                    className="w-full text-left p-2.5 rounded-lg border hover:bg-accent/50 transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center gap-2">
                      <div className={cn('w-2 h-2 rounded-full shrink-0', server.isActive ? 'bg-green-500' : 'bg-muted-foreground/40')} />
                      <span className="text-sm font-medium flex-1 truncate">{server.name}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {t(((server as MockServer & { routes?: MockRoute[] }).routes?.length || 0) === 1 ? 'list.routeCountOne' : 'list.routeCountOther', { count: (server as MockServer & { routes?: MockRoute[] }).routes?.length || 0 })}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1 mt-1 ml-4">
                      <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-[11px] text-muted-foreground font-mono truncate">
                        /mock/{prefix}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Delete confirmation */}
        <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{deleteTarget?.type === 'server' ? t('delete.serverTitle') : t('delete.routeTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('delete.description', { label: deleteTarget?.label })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {t('common:delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // ═══════════════════════════════════
  // VIEW: Create Server Wizard
  // ═══════════════════════════════════
  if (view.type === 'create-server') {
    const suffix =
      serverPrefix.trim().replace(/^\/+|\/+$/g, '') ||
      serverName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const derivedPrefix = suffix ? (userNamespace ? `${userNamespace}/${suffix}` : suffix) : '';

    return (
      <div className="flex flex-col h-full">
        {renderHeader(t('header.newServer'), () => setView({ type: 'list' }))}

        <div className="flex-1 overflow-auto p-3 space-y-5">
          {/* Step indicator */}
          <div className="flex items-center gap-2 justify-center">
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">1</div>
              <span className="text-xs font-medium">{t('wizard.setup')}</span>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">{t('form.serverName')}</Label>
              <Input
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                placeholder={t('form.serverNamePlaceholder')}
                className="h-8 text-sm"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">{t('form.urlPrefix')}</Label>
              <div className="flex items-stretch h-8 rounded-md border bg-background overflow-hidden focus-within:ring-1 focus-within:ring-ring">
                {userNamespace && (
                  <span
                    className="inline-flex items-center px-2 text-xs font-mono text-muted-foreground bg-muted/50 border-r select-none"
                    title={t('form.namespaceTitle')}
                  >
                    {userNamespace}/
                  </span>
                )}
                <Input
                  value={serverPrefix}
                  onChange={(e) => setServerPrefix(e.target.value)}
                  placeholder={serverName ? serverName.toLowerCase().replace(/[^a-z0-9-]/g, '-') : t('form.prefixPlaceholder')}
                  className="h-full border-0 rounded-none focus-visible:ring-0 text-sm font-mono px-2"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                {userNamespace
                  ? t('form.prefixHintNs', { namespace: userNamespace })
                  : t('form.prefixHint')}
              </p>
            </div>

            {/* URL Preview */}
            {(serverName || serverPrefix) && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{t('form.baseUrl')}</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-primary flex-1 break-all">
                    {getRemoteMockBaseUrl()}/{derivedPrefix || '...'}
                  </code>
                  {derivedPrefix && (
                    <button
                      onClick={() => handleCopy(`${getRemoteMockBaseUrl()}/${derivedPrefix}`)}
                      className="p-1 rounded hover:bg-accent cursor-pointer shrink-0"
                    >
                      {copiedText === `${getRemoteMockBaseUrl()}/${derivedPrefix}` ? (
                        <Check className="h-3 w-3 text-green-500" />
                      ) : (
                        <Copy className="h-3 w-3 text-muted-foreground" />
                      )}
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {t('form.baseUrlHint')}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="p-3 border-t">
          <Button
            className="w-full"
            disabled={!serverName.trim() || saving}
            onClick={handleCreateServer}
          >
            {saving ? t('form.creating') : t('form.createServer')}
          </Button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════
  // VIEW: Edit Server
  // ═══════════════════════════════════
  if (view.type === 'edit-server') {
    const server = view.server;
    return (
      <div className="flex flex-col h-full">
        {renderHeader(t('header.editServer'), () => setView({ type: 'server-detail', serverId: server.id }))}
        <div className="flex-1 overflow-auto p-3 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">{t('form.serverName')}</Label>
            <Input
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              className="h-8 text-sm"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">{t('form.urlPrefix')}</Label>
            <div className="flex items-stretch h-8 rounded-md border bg-background overflow-hidden focus-within:ring-1 focus-within:ring-ring">
              {userNamespace && (
                <span className="inline-flex items-center px-2 text-xs font-mono text-muted-foreground bg-muted/50 border-r select-none">
                  {userNamespace}/
                </span>
              )}
              <Input
                value={serverPrefix}
                onChange={(e) => setServerPrefix(e.target.value)}
                className="h-full border-0 rounded-none focus-visible:ring-0 text-sm font-mono px-2"
              />
            </div>
          </div>
        </div>
        <div className="p-3 border-t">
          <Button
            className="w-full"
            disabled={!serverName.trim() || saving}
            onClick={() => handleUpdateServer(server)}
          >
            {saving ? t('saving') : t('form.saveChanges')}
          </Button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════
  // VIEW: Server Detail
  // ═══════════════════════════════════
  if (view.type === 'server-detail') {
    const server = findServer(view.serverId);
    if (!server) {
      return (
        <div className="p-4 text-center">
          <p className="text-sm text-muted-foreground">{t('detail.notFound')}</p>
          <Button variant="link" size="sm" onClick={() => setView({ type: 'list' })}>
            {t('detail.backToList')}
          </Button>
        </div>
      );
    }

    const prefix = cleanPrefix(server.prefix);
    const serverRoutes = routes[server.id] || [];
    const baseUrl = getBaseUrl(server.prefix);

    return (
      <div className="flex flex-col h-full">
        {renderHeader(
          server.name,
          () => setView({ type: 'list' }),
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => {
                setServerName(server.name);
                // Strip the user namespace so the input shows only the
                // editable suffix; BE re-applies it on Save.
                const stored = cleanPrefix(server.prefix);
                const ns = userNamespace ? userNamespace + '/' : '';
                setServerPrefix(ns && stored.startsWith(ns) ? stored.slice(ns.length) : stored);
                setView({ type: 'edit-server', server });
              }}>
                <Pencil className="h-3.5 w-3.5 mr-2" />
                {t('detail.editServer')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleToggle(server)}>
                {server.isActive ? (
                  <><PowerOff className="h-3.5 w-3.5 mr-2" /> {t('detail.disable')}</>
                ) : (
                  <><Power className="h-3.5 w-3.5 mr-2" /> {t('detail.enable')}</>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setDeleteTarget({ type: 'server', id: server.id, label: server.name })}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                {t('detail.deleteServer')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <div className="flex-1 overflow-auto">
          {/* Server info card */}
          <div className="p-3 border-b space-y-2">
            <div className="flex items-center gap-2">
              <div className={cn('w-2 h-2 rounded-full', server.isActive ? 'bg-green-500' : 'bg-muted-foreground/40')} />
              <span className="text-xs text-muted-foreground">{server.isActive ? t('detail.active') : t('detail.disabled')}</span>
            </div>
            <div className="rounded-md border bg-muted/30 px-2.5 py-2 flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <code className="text-[11px] font-mono text-primary flex-1 truncate">{baseUrl}</code>
              <button
                onClick={() => handleCopy(baseUrl)}
                className="p-0.5 rounded hover:bg-accent cursor-pointer shrink-0"
                title={t('detail.copyBaseUrl')}
              >
                {copiedText === baseUrl ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3 text-muted-foreground" />
                )}
              </button>
            </div>
          </div>

          {/* Routes */}
          <div className="p-2">
            <div className="flex items-center justify-between px-1 mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t('detail.routesCount', { count: serverRoutes.length })}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  resetRouteForm();
                  setView({ type: 'create-route', serverId: server.id });
                }}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>

            {serverRoutes.length === 0 ? (
              <div className="text-center py-8 px-4">
                <p className="text-xs text-muted-foreground mb-3">
                  {t('detail.noRoutes')}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    resetRouteForm();
                    setView({ type: 'create-route', serverId: server.id });
                  }}
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  {t('detail.addRoute')}
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                {serverRoutes.map((route) => {
                  const routeUrl = `${baseUrl}${route.path.startsWith('/') ? route.path : '/' + route.path}`;
                  return (
                    <div
                      key={route.id}
                      className="rounded-lg border p-2.5 hover:bg-accent/30 transition-colors group"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={cn('text-[10px] font-bold px-1.5 shrink-0', methodColors[route.method])}>
                          {route.method}
                        </Badge>
                        <span className="font-mono text-xs truncate flex-1">{route.path}</span>
                        <Badge variant="outline" className="text-[10px] px-1 shrink-0">
                          {route.statusCode}
                        </Badge>
                      </div>

                      {/* Full URL */}
                      <div className="flex items-center gap-1 mt-1.5 ml-0.5">
                        <code className="text-[10px] text-muted-foreground font-mono truncate flex-1">
                          /mock/{prefix}{route.path.startsWith('/') ? route.path : '/' + route.path}
                        </code>
                        <button
                          onClick={() => handleCopy(routeUrl)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-accent cursor-pointer shrink-0"
                          title={t('detail.copyFullUrl')}
                        >
                          {copiedText === routeUrl ? (
                            <Check className="h-2.5 w-2.5 text-green-500" />
                          ) : (
                            <Copy className="h-2.5 w-2.5 text-muted-foreground" />
                          )}
                        </button>
                      </div>

                      {/* Route info */}
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                        {route.delay > 0 && <span>{t('route.delayLabel')} {route.delay}ms</span>}
                        {route.responseBody && (
                          <span className="truncate max-w-[150px]">
                            {t('route.bodyLabel')} {route.responseBody.substring(0, 30)}{route.responseBody.length > 30 ? '...' : ''}
                          </span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] px-2"
                          onClick={() => {
                            resetRouteForm(route);
                            setView({ type: 'edit-route', serverId: server.id, route });
                          }}
                        >
                          <Pencil className="h-2.5 w-2.5 mr-1" />
                          {t('common:edit')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] px-2"
                          onClick={() => handleCopy(routeUrl)}
                        >
                          <Copy className="h-2.5 w-2.5 mr-1" />
                          {t('detail.copyUrl')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] px-2"
                          onClick={() => {
                            // Open the mock route as a request in
                            // PatchMan's URL bar — split off the scheme
                            // so the protocol selector and the URL input
                            // stay in sync. The sidebar stays on Mock
                            // (the request panel above is shared with
                            // every sidebar section) so the user
                            // doesn't lose their place.
                            let url = routeUrl;
                            let protocol: 'https://' | 'http://' = 'https://';
                            if (url.startsWith('https://')) {
                              protocol = 'https://';
                              url = url.slice('https://'.length);
                            } else if (url.startsWith('http://')) {
                              protocol = 'http://';
                              url = url.slice('http://'.length);
                            }
                            addTab({
                              name: t('detail.openTabName', { name: server.name, method: route.method, path: route.path }),
                              method: route.method,
                              url,
                              protocol,
                            }, true);
                          }}
                          title={t('detail.openAsRequest')}
                        >
                          <ExternalLink className="h-2.5 w-2.5 mr-1" />
                          {t('detail.open')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] px-2 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget({ type: 'route', id: route.id, serverId: server.id, label: `${route.method} ${route.path}` })}
                        >
                          <Trash2 className="h-2.5 w-2.5 mr-1" />
                          {t('common:delete')}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Delete confirmation */}
        <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{deleteTarget?.type === 'server' ? t('delete.serverTitle') : t('delete.routeTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('delete.description', { label: deleteTarget?.label })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {t('common:delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // ═══════════════════════════════════
  // VIEW: Create / Edit Route
  // ═══════════════════════════════════
  if (view.type === 'create-route' || view.type === 'edit-route') {
    const isEdit = view.type === 'edit-route';
    const serverId = view.serverId;
    const server = findServer(serverId);
    const existingRoute = isEdit ? view.route : undefined;
    const prefix = server ? cleanPrefix(server.prefix) : '';

    return (
      <div className="flex flex-col h-full">
        {renderHeader(
          isEdit ? t('editor.editRoute') : t('editor.newRoute'),
          () => setView({ type: 'server-detail', serverId })
        )}

        <div className="flex-1 overflow-auto p-3 space-y-4">
          {/* Method + Path */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">{t('routeForm.endpoint')}</Label>
            <div className="flex gap-2">
              <Select value={routeMethod} onValueChange={setRouteMethod}>
                <SelectTrigger className="w-[100px] h-8 text-xs font-bold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={routePath}
                onChange={(e) => setRoutePath(e.target.value)}
                placeholder="/users, /api/data"
                className="h-8 text-xs font-mono flex-1"
              />
            </div>
            {prefix && (
              <p className="text-[10px] text-muted-foreground font-mono px-0.5">
                {t('routeForm.fullUrlLabel')} /mock/{prefix}{routePath.startsWith('/') ? routePath : '/' + routePath}
              </p>
            )}
          </div>

          {/* Status Code + Delay */}
          <div className="flex gap-3">
            <div className="space-y-1.5 flex-1">
              <Label className="text-xs font-medium">{t('route.statusCode')}</Label>
              <Select value={routeStatus} onValueChange={setRouteStatus}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    { value: '200', label: '200 OK' },
                    { value: '201', label: '201 Created' },
                    { value: '204', label: '204 No Content' },
                    { value: '400', label: '400 Bad Request' },
                    { value: '401', label: '401 Unauthorized' },
                    { value: '403', label: '403 Forbidden' },
                    { value: '404', label: '404 Not Found' },
                    { value: '500', label: '500 Server Error' },
                  ].map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 w-24">
              <Label className="text-xs font-medium">{t('route.delay')}</Label>
              <Input
                value={routeDelay}
                onChange={(e) => setRouteDelay(e.target.value)}
                className="h-8 text-xs"
                type="number"
                min="0"
              />
            </div>
          </div>

          {/* Response Headers */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">{t('routeForm.responseHeaders')}</Label>
            <Textarea
              value={routeHeaders}
              onChange={(e) => setRouteHeaders(e.target.value)}
              rows={2}
              className="font-mono text-xs resize-none"
              placeholder='{"Content-Type": "application/json"}'
            />
          </div>

          {/* Response Body */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">{t('route.responseBody')}</Label>
            <Textarea
              value={routeBody}
              onChange={(e) => setRouteBody(e.target.value)}
              rows={8}
              className="font-mono text-xs"
              placeholder='{"message": "Hello"}'
            />
          </div>
        </div>

        <div className="p-3 border-t flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => setView({ type: 'server-detail', serverId })}
          >
            {t('common:cancel')}
          </Button>
          <Button
            className="flex-1"
            disabled={!routePath.trim() || saving}
            onClick={() => handleSaveRoute(serverId, existingRoute)}
          >
            {saving ? t('saving') : isEdit ? t('routeForm.updateRoute') : t('detail.addRoute')}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
