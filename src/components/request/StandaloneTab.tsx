import { useEffect } from 'react';
import { Database, Radio, HardDrive, GitBranch, Wrench, ExternalLink, LayoutDashboard, Rabbit, Waypoints, ScrollText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRequestStore } from '@/stores/requestStore';
import { useAuthStore } from '@/stores/authStore';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { RedisIcon } from '@/components/icons/RedisIcon';
import { ESIcon } from '@/components/icons/ESIcon';
import { K8sIcon } from '@/components/icons/K8sIcon';
import { toolDef } from '@/components/devtools/registry';
import { startStandaloneRuntime } from '@/lib/detach/DetachController';
import { TabBody } from './TabBody';
import type { Tab } from '@/types';

const methodColors: Record<string, string> = {
  GET: 'text-green-500',
  POST: 'text-yellow-500',
  PUT: 'text-blue-500',
  PATCH: 'text-purple-500',
  DELETE: 'text-red-500',
  HEAD: 'text-teal-500',
  OPTIONS: 'text-gray-500',
};

function TypeIcon({ tab }: { tab: Tab }) {
  switch (tab.type) {
    case 'db':
      return <Database className="h-4 w-4 text-cyan-500 shrink-0" />;
    case 'kafka':
      return <Radio className="h-4 w-4 text-orange-500 shrink-0" />;
    case 's3':
      return <HardDrive className="h-4 w-4 text-emerald-500 shrink-0" />;
    case 'redis':
      return <RedisIcon className="h-4 w-4 text-red-500 shrink-0" />;
    case 'es':
      return <ESIcon className="h-4 w-4 text-yellow-500 shrink-0" />;
    case 'k8s':
      return <K8sIcon className="h-4 w-4 text-blue-500 shrink-0" />;
    case 'git':
      return <GitBranch className="h-4 w-4 text-orange-500 shrink-0" />;
    case 'grafana':
      return <LayoutDashboard className="h-4 w-4 text-orange-500 shrink-0" />;
    case 'rabbit':
      return <Rabbit className="h-4 w-4 text-orange-500 shrink-0" />;
    case 'graylog':
      return <ScrollText className="h-4 w-4 text-rose-500 shrink-0" />;
    case 'servicemap':
      return <Waypoints className="h-4 w-4 text-violet-500 shrink-0" />;
    case 'tool': {
      const Icon = toolDef(tab.toolKind)?.icon ?? Wrench;
      return <Icon className="h-4 w-4 text-violet-400 shrink-0" />;
    }
    default:
      return (
        <span className={`text-[11px] font-bold uppercase shrink-0 ${methodColors[tab.method] || 'text-gray-500'}`}>
          {tab.method}
        </span>
      );
  }
}

/**
 * Full-window view of ONE tab, rendered instead of <App/> when the document
 * booted with `?detached=<tabId>`. No sidebar, no tab strip — just a slim
 * header + the shared <TabBody/>. Backed by the single-tab standalone store
 * (persist key `patchman-detached-<tabId>`), auto-authed via shared storage.
 * Renders nothing but a loader until it pulls its handoff over the channel or
 * rehydrates from its own key.
 */
export function StandaloneTab({ tabId }: { tabId: string }) {
  const { t } = useTranslation('request');
  const tab = useRequestStore((s) => s.tabs.find((t) => t.id === tabId) ?? s.tabs[0]);
  const hydrated = useRequestStore((s) => s._hydrated);
  const { isAuthenticated, isLoading, loadUser } = useAuthStore();

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  // Child-side protocol: announce ready, receive the handoff, flush on close.
  useEffect(() => {
    const dispose = startStandaloneRuntime({
      tabId,
      onHandoff: (t) => useRequestStore.getState().hydrateStandalone(t),
      getCurrentTab: () => {
        const s = useRequestStore.getState();
        return s.tabs.find((t) => t.id === tabId) ?? s.tabs[0] ?? null;
      },
    });
    return dispose;
  }, [tabId]);

  // Keep the OS window title in step with the tab name.
  useEffect(() => {
    if (tab?.name) document.title = `${tab.name} — PatchMan`;
  }, [tab?.name]);

  let content: React.ReactNode;
  if (isLoading) {
    content = <CenterSpinner label={t('common:loading')} />;
  } else if (!isAuthenticated) {
    content = (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center max-w-sm px-6">
          <ExternalLink className="h-8 w-8 mx-auto mb-3 opacity-60" />
          <p className="text-sm font-medium">{t('standalone.signInRequired')}</p>
          <p className="text-xs mt-1">
            {t('standalone.signInBody')}
          </p>
        </div>
      </div>
    );
  } else if (!tab) {
    // Authed, but no tab yet: either still rehydrating our own key, or waiting
    // for the main window to hand off.
    content = <CenterSpinner label={hydrated ? t('standalone.waitingForTab') : t('common:loading')} />;
  } else {
    content = (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 shrink-0">
          <TypeIcon tab={tab} />
          <span className="truncate text-sm font-medium flex-1">
            {tab.name || tab.url || t('tab.detachedTab')}
          </span>
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <TabBody tab={tab} />
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="h-screen w-screen bg-background text-foreground">{content}</div>
      <Toaster />
    </TooltipProvider>
  );
}

function CenterSpinner({ label }: { label: string }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
