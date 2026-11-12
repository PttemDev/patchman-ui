import { Server, Globe, ShieldOff, Save as SaveIcon, Code, Cookie, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useState, useCallback, useEffect, useRef, Suspense } from 'react';
import { cn } from '@/lib/utils';
import { lazyWithReload } from '@/lib/lazyWithReload';
import { useRequestStore } from '@/stores/requestStore';
import { useAuthStore } from '@/stores/authStore';
import { useProxyConfigStore } from '@/stores/proxyConfigStore';
import { useCookieConfigStore } from '@/stores/cookieConfigStore';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useToast } from '@/components/ui/use-toast';
import { useEnvironmentStore } from '@/stores/environmentStore';
import { codeFromTab } from '@/components/codegen/CodeGenDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { UrlBar } from './UrlBar';
import { EntityNotes } from '@/components/notes/EntityNotes';
import { requestUri } from '@/lib/entityUri';
import { DBQueryPanel } from '@/components/dbquery/DBQueryPanel';
import { KafkaTopicPanel } from '@/components/kafka/KafkaTopicPanel';
import { S3BrowserPanel } from '@/components/s3/S3BrowserPanel';
import { RedisKeyPanel } from '@/components/redis/RedisKeyPanel';
import { ESConsolePanel } from '@/components/es/ESConsolePanel';
import { K8sExplorerPanel } from '@/components/k8s/K8sExplorerPanel';
import { GitPanel } from '@/components/git/GitPanel';
import { DevToolsPanel } from '@/components/devtools/DevToolsPanel';
// Excalidraw pulls in a large editor (+ mermaid/katex); lazy-load it so cold
// start is unchanged for everyone who never opens a whiteboard.
// Notes pull in react-markdown + highlight.js; loaded with the first note tab.
const NoteView = lazyWithReload(() => import('@/components/notes/NoteView').then((m) => ({ default: m.NoteView })));
const GrafanaTab = lazyWithReload(() => import('@/components/grafana/GrafanaTab'));
const RabbitTab = lazyWithReload(() => import('@/components/rabbit/RabbitTab'));
const GraylogTab = lazyWithReload(() => import('@/components/graylog/GraylogTab'));
const ServiceMapTab = lazyWithReload(() => import('@/components/servicemap/ServiceMapTab'));
const ExcalidrawCanvas = lazyWithReload(() =>
  import('@/components/excalidraw/ExcalidrawCanvas').then((m) => ({ default: m.ExcalidrawCanvas })),
);
import { ParamsEditor } from './ParamsEditor';
import { HeadersEditor } from './HeadersEditor';
import { BodyEditor } from './BodyEditor';
import { AuthEditor } from './AuthEditor';
import { PreRequestScript } from './PreRequestScript';
import { TestScript } from './TestScript';
import { RequestSettingsTab } from './RequestSettingsTab';
import { ResponsePanel } from '@/components/response/ResponsePanel';
import { CodeGenDialog } from '@/components/codegen/CodeGenDialog';
import { SaveToCollectionDialog } from './SaveToCollectionDialog';
import type { Tab } from '@/types';

interface TabBodyProps {
  tab: Tab;
}

/**
 * The full editor surface for a single tab: the typed-panel switch (DB /
 * Kafka / S3 / Redis / ES / K8s / Git / Dev Tools) plus the default API
 * request UI (URL bar + config tabs + ResponsePanel).
 *
 * Extracted verbatim from RequestPanel so the SAME body renders both in the
 * main window (for the active tab) and in a detached standalone window (for
 * its one owned tab). All state here is per-tab/self-contained; every child
 * mutates through `useRequestStore`, so in a detached window — a separate
 * webview with its own store instance — it "just works" against that
 * window's single-tab store.
 */
export function TabBody({ tab }: TabBodyProps) {
  const { t } = useTranslation('request');
  const updateTab = useRequestStore((s) => s.updateTab);
  const isLocal = useAuthStore((s) => s.mode === 'local');
  const customProxyEnabled = useProxyConfigStore((s) => s.enabled && !!s.endpoint);
  const autoSaveCookies = useCookieConfigStore((s) => s.autoSave);
  const setAutoSaveCookies = useCookieConfigStore((s) => s.setAutoSave);

  // Resizable split - persist to localStorage
  const [splitRatio, setSplitRatio] = useState(() => {
    try {
      const saved = localStorage.getItem('patchman_split_ratio');
      if (saved) {
        const val = parseFloat(saved);
        if (!isNaN(val) && val >= 15 && val <= 85) return val;
      }
    } catch { /* ignore */ }
    return 50;
  });
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Dialogs
  const [codegenOpen, setCodegenOpen] = useState(false);
  const { toast } = useToast();
  const activeEnv = useEnvironmentStore((s) => s.activeEnvironment);
  // Right-click the code-snippet button → quick "Copy as cURL" without opening
  // the full generator dialog.
  const copyCurl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(codeFromTab(tab, 'curl', activeEnv));
      toast({ title: t('toolbar.curlCopied') });
    } catch {
      toast({ title: t('toolbar.copyFailed'), variant: 'destructive' });
    }
  }, [tab, activeEnv, toast, t]);
  const [saveOpen, setSaveOpen] = useState(false);

  // Cmd/Ctrl+S → open save dialog for this API tab. DB tabs are handled by
  // DBQueryPanel's own listener, so skip when this tab is a DB query.
  useEffect(() => {
    const onSave = () => {
      if (tab.type === 'db') return;
      setSaveOpen(true);
    };
    window.addEventListener('patchman:save-to-collection', onSave);
    return () => window.removeEventListener('patchman:save-to-collection', onSave);
  }, [tab.type]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const y = ev.clientY - rect.top;
      const pct = Math.min(Math.max((y / rect.height) * 100, 15), 85);
      setSplitRatio(pct);
      try { localStorage.setItem('patchman_split_ratio', String(Math.round(pct))); } catch { /* ignore */ }
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  // DB tabs render a totally different body (connection picker + Monaco
  // editor + result table) — branch here so the API config UI never tries to
  // read `db_query` / `db_result` off the tab. See DBQueryPanel for the DB
  // surface.
  if (tab.type === 'db') return <DBQueryPanel tab={tab} />;
  if (tab.type === 'kafka') return <KafkaTopicPanel key={tab.id} tab={tab} />;
  if (tab.type === 's3') return <S3BrowserPanel tab={tab} />;
  if (tab.type === 'redis') return <RedisKeyPanel tab={tab} />;
  if (tab.type === 'es') return <ESConsolePanel tab={tab} />;
  if (tab.type === 'k8s') return <K8sExplorerPanel tab={tab} />;
  if (tab.type === 'git') return <GitPanel tab={tab} />;
  if (tab.type === 'tool') return <DevToolsPanel tab={tab} />;
  if (tab.type === 'note') {
    return (
      <Suspense fallback={<div className="flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground">…</div>}>
        <NoteView key={tab.id} tab={tab} />
      </Suspense>
    );
  }
  if (tab.type === 'grafana') {
    return (
      <Suspense fallback={<div className="flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground">…</div>}>
        <GrafanaTab key={tab.id} tab={tab} />
      </Suspense>
    );
  }
  if (tab.type === 'rabbit') {
    return (
      <Suspense fallback={<div className="flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground">…</div>}>
        <RabbitTab key={tab.id} tab={tab} />
      </Suspense>
    );
  }
  if (tab.type === 'graylog') {
    return (
      <Suspense fallback={<div className="flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground">…</div>}>
        <GraylogTab key={tab.id} tab={tab} />
      </Suspense>
    );
  }
  if (tab.type === 'servicemap') {
    return (
      <Suspense fallback={<div className="flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground">…</div>}>
        <ServiceMapTab key={tab.id} tab={tab} />
      </Suspense>
    );
  }
  if (tab.type === 'excalidraw') {
    return (
      <Suspense fallback={<div className="flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground">…</div>}>
        <ExcalidrawCanvas key={tab.id} tab={tab} />
      </Suspense>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-4 shrink-0">
        <UrlBar tab={tab} />
        {tab.requestId && <EntityNotes uri={requestUri(tab.requestId)} className="mt-2" />}
      </div>

      <div
        ref={containerRef}
        className="flex-1 flex flex-col overflow-hidden min-h-0"
      >
        {/* Request config area */}
        <div
          className="flex flex-col overflow-hidden"
          style={{ flex: `0 0 ${splitRatio}%` }}
        >
          <div className="px-4 pb-4 flex-1 flex flex-col min-h-0">
            <Tabs
              value={tab.requestSubTab ?? 'params'}
              onValueChange={(v) => updateTab(tab.id, { requestSubTab: v })}
              className="flex-1 flex flex-col min-h-0"
            >
              <div className="flex items-center justify-between gap-2 shrink-0">
                <TabsList className="h-8">
                  <TabsTrigger value="params" className="text-xs h-6 px-3">
                    {t('subTabs.params')}
                    {((Array.isArray(tab.params) ? tab.params : []).filter((p) => p.key).length + (tab.pathParams?.length || 0)) > 0 && (
                      <span className="ml-1 text-[10px] bg-primary/10 text-primary px-1 rounded">
                        {(Array.isArray(tab.params) ? tab.params : []).filter((p) => p.key).length + (tab.pathParams?.length || 0)}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="headers" className="text-xs h-6 px-3">
                    {t('subTabs.headers')}
                    {(Array.isArray(tab.headers) ? tab.headers : []).filter((h) => h.key).length > 0 && (
                      <span className="ml-1 text-[10px] bg-primary/10 text-primary px-1 rounded">
                        {(Array.isArray(tab.headers) ? tab.headers : []).filter((h) => h.key).length}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="body" className="text-xs h-6 px-3">
                    {t('subTabs.body')}
                  </TabsTrigger>
                  <TabsTrigger value="auth" className="text-xs h-6 px-3">
                    {t('subTabs.auth')}
                  </TabsTrigger>
                  <TabsTrigger value="pre-request" className="text-xs h-6 px-3">
                    {t('subTabs.preRequest')}
                  </TabsTrigger>
                  <TabsTrigger value="tests" className="text-xs h-6 px-3">
                    {t('subTabs.tests')}
                  </TabsTrigger>
                  <TabsTrigger value="settings" className="text-xs h-6 px-3">
                    {t('common:settings')}
                  </TabsTrigger>
                </TabsList>

                {/* Right-aligned toolbar: send mode, CORS badge, save, codegen */}
                <div className="flex items-center gap-1 shrink-0">
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            'h-7 text-xs gap-1.5 px-2',
                            tab.sendMode === 'direct' && 'text-yellow-500'
                          )}
                          onClick={() =>
                            updateTab(tab.id, {
                              sendMode: tab.sendMode === 'proxy' ? 'direct' : 'proxy',
                            })
                          }
                        >
                          {tab.sendMode === 'proxy' ? (
                            <>
                              <Server className="h-3.5 w-3.5" />
                              <span>{t('toolbar.proxy')}</span>
                            </>
                          ) : (
                            <>
                              <Globe className="h-3.5 w-3.5" />
                              <span>{t('toolbar.direct')}</span>
                            </>
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          {tab.sendMode === 'proxy'
                            ? isLocal
                              ? customProxyEnabled
                                ? t('toolbar.proxyViaCustom')
                                : t('toolbar.proxyViaBuiltin')
                              : t('toolbar.proxyViaBackend')
                            : t('toolbar.directMode')}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  {/* Auto-save cookies — global, persisted preference so
                      it's decided up front (no need to send first) and
                      every tab, including newly opened ones, inherits it. */}
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            'h-7 text-xs gap-1.5 px-2',
                            autoSaveCookies && 'text-green-500',
                          )}
                          onClick={() => setAutoSaveCookies(!autoSaveCookies)}
                        >
                          <Cookie className="h-3.5 w-3.5" />
                          <span>{autoSaveCookies ? t('toolbar.cookiesAuto') : t('toolbar.cookies')}</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-[240px]">
                          {autoSaveCookies
                            ? t('toolbar.cookiesAutoTip')
                            : t('toolbar.cookiesManualTip')}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  {tab.sendMode === 'direct' && (
                    <TooltipProvider delayDuration={100}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                              'h-7 text-xs gap-1.5 px-2',
                              tab.corsBypass ? 'text-green-500' : 'text-yellow-500'
                            )}
                            onClick={() =>
                              updateTab(tab.id, {
                                corsBypass: !tab.corsBypass,
                              })
                            }
                          >
                            <ShieldOff className="h-3.5 w-3.5" />
                            <span>{tab.corsBypass ? t('toolbar.noCors') : t('toolbar.cors')}</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{tab.corsBypass
                            ? t('toolbar.corsBypassTip')
                            : t('toolbar.corsActiveTip')}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}

                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() => setSaveOpen(true)}
                        >
                          <SaveIcon className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t('toolbar.saveToCollection')}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <ContextMenu>
                    <TooltipProvider delayDuration={100}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <ContextMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              onClick={() => setCodegenOpen(true)}
                            >
                              <Code className="h-3.5 w-3.5" />
                            </Button>
                          </ContextMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t('toolbar.generateCode')}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <ContextMenuContent>
                      <ContextMenuItem onClick={copyCurl}>
                        <Copy className="h-3.5 w-3.5 mr-2" />
                        {t('toolbar.copyCurl')}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                </div>
              </div>

              <TabsContent value="params" className="overflow-auto flex-1">
                <ParamsEditor tab={tab} />
              </TabsContent>
              <TabsContent value="headers" className="overflow-auto flex-1">
                <HeadersEditor tab={tab} />
              </TabsContent>
              <TabsContent value="body" className="flex-1 flex flex-col min-h-0">
                <BodyEditor tab={tab} />
              </TabsContent>
              <TabsContent value="auth" className="overflow-auto flex-1">
                <AuthEditor tab={tab} />
              </TabsContent>
              <TabsContent value="pre-request" className="flex-1 flex flex-col min-h-0">
                <PreRequestScript tab={tab} />
              </TabsContent>
              <TabsContent value="tests" className="flex-1 flex flex-col min-h-0">
                <TestScript tab={tab} />
              </TabsContent>
              <TabsContent value="settings" className="flex-1 flex flex-col min-h-0">
                <RequestSettingsTab />
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Resize handle */}
        <div
          className="h-1 bg-border hover:bg-primary/40 cursor-row-resize shrink-0 transition-colors"
          onMouseDown={handleMouseDown}
        />

        {/* Response area */}
        <div className="flex-1 min-h-[100px] flex flex-col overflow-hidden">
          <ResponsePanel tab={tab} />
        </div>
      </div>

      <CodeGenDialog open={codegenOpen} onOpenChange={setCodegenOpen} tab={tab} />
      <SaveToCollectionDialog open={saveOpen} onOpenChange={setSaveOpen} tab={tab} />
    </div>
  );
}
