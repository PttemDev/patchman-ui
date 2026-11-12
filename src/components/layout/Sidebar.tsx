import {
  FolderOpen,
  Clock,
  ClipboardCheck,
  Server,
  Plug,
  Cookie,
  Shield,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  UserPlus,
  FolderInput,
  Plus,
  Settings,
  Sun,
  Moon,
  Database as DBTabIcon,
  Radio,
  HardDrive,  Wrench,
  GitBranch,
  Sparkles,
  Shapes,
  NotebookText,
  LayoutDashboard,
  ChevronsRight,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { DBSidebar, DBHeaderActions } from '@/components/dbquery/DBSidebar';
import { MessagingSidebar, MessagingHeaderActions } from '@/components/messaging/MessagingSidebar';
import { DashboardsSidebar, DashboardsHeaderActions } from '@/components/observability/DashboardsSidebar';
import { S3Sidebar, S3HeaderActions } from '@/components/s3/S3Sidebar';
import { RedisSidebar, RedisHeaderActions } from '@/components/redis/RedisSidebar';
import { RedisIcon } from '@/components/icons/RedisIcon';
import { ESSidebar, ESHeaderActions } from '@/components/es/ESSidebar';
import { ESIcon } from '@/components/icons/ESIcon';
import { K8sSidebar, K8sHeaderActions } from '@/components/k8s/K8sSidebar';
import { K8sIcon } from '@/components/icons/K8sIcon';
import { GitSidebar, GitHeaderActions } from '@/components/git/GitSidebar';
import { DevToolsSidebar } from '@/components/devtools/DevToolsSidebar';
import { ExcalidrawSidebar, ExcalidrawHeaderActions } from '@/components/excalidraw/ExcalidrawSidebar';
import { NotesSidebar, NotesHeaderActions } from '@/components/notes/NotesSidebar';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { CollectionsAccordion } from '@/components/collections/CollectionsAccordion';
import { useThemeStore } from '@/stores/themeStore';
import { useSettingsUIStore } from '@/stores/settingsUIStore';
import { useProxyConfigStore } from '@/stores/proxyConfigStore';
import { HistoryList } from '@/components/history/HistoryList';
import { QADashboard, QAHeaderActions } from '@/components/qa/QADashboard';
import { MockServerList } from '@/components/mock/MockServerList';
import { WebSocketClient } from '@/components/websocket/WebSocketClient';
import { CookieManager } from '@/components/cookies/CookieManager';
import { AuditPanel } from '@/components/audit/AuditPanel';
import { LLMPanel } from '@/components/llm/LLMPanel';
import { useSidebarStore } from '@/stores/sidebarStore';
import { useAuthStore } from '@/stores/authStore';
import { Separator } from '@/components/ui/separator';
import { isDesktop } from '@/lib/platform';
import { useUpdateStore } from '@/stores/updateStore';

export type SidebarTab = 'collections' | 'history' | 'qa' | 'qa-planning' | 'mock' | 'websocket' | 'cookies' | 'audit' | 'database' | 'kafka' | 'storage' | 'redis' | 'elasticsearch' | 'kubernetes' | 'git' | 'ai' | 'devtools' | 'excalidraw' | 'notes' | 'dashboards';

// Always hidden in local mode — these features need a multi-user backend
// that the embedded desktop BE deliberately doesn't provide (audit log is
// meaningless for a single local user).
const MULTI_USER_TABS: SidebarTab[] = ['audit'];

// Hidden only in *web*-local mode. The desktop embedded BE serves these
// handlers identically to the remote BE, so desktop-local users keep them.
const REQUIRES_BACKEND_TABS: SidebarTab[] = ['qa', 'mock', 'redis', 'elasticsearch', 'kubernetes', 'git', 'ai', 'excalidraw', 'notes', 'dashboards'];

// Labels are resolved at render time via t(`tabs.${id}`) (layout namespace);
// the array carries only the stable, non-translatable structure. Exported so
// the Appearance settings can render a visibility toggle per item.
export const sidebarTabs: { id: SidebarTab; icon: React.ElementType; group?: string }[] = [
  { id: 'collections', icon: FolderOpen, group: 'main' },
  { id: 'history', icon: Clock, group: 'main' },
  { id: 'database', icon: DBTabIcon, group: 'main' },
  { id: 'kafka', icon: Radio, group: 'main' },
  { id: 'storage', icon: HardDrive, group: 'main' },
  { id: 'redis', icon: RedisIcon, group: 'main' },
  { id: 'elasticsearch', icon: ESIcon, group: 'main' },
  { id: 'kubernetes', icon: K8sIcon, group: 'main' },
  { id: 'dashboards', icon: LayoutDashboard, group: 'main' },
  { id: 'git', icon: GitBranch, group: 'main' },
  { id: 'ai', icon: Sparkles, group: 'main' },
  { id: 'excalidraw', icon: Shapes, group: 'main' },
  { id: 'notes', icon: NotebookText, group: 'main' },
  { id: 'devtools', icon: Wrench, group: 'tools' },
  { id: 'qa', icon: ClipboardCheck, group: 'main' },
  { id: 'mock', icon: Server, group: 'tools' },
  { id: 'websocket', icon: Plug, group: 'tools' },
  { id: 'cookies', icon: Cookie, group: 'tools' },
  { id: 'audit', icon: Shield, group: 'tools' },
];

// Tabs the current platform/mode hides outright, independent of user prefs —
// so the Appearance toggle list only offers items actually reachable here.
export function platformHiddenTabs(isLocal: boolean, desktop: boolean): Set<SidebarTab> {
  const hidden = new Set<SidebarTab>();
  if (isLocal) {
    MULTI_USER_TABS.forEach((tab) => hidden.add(tab));
    if (!desktop) {
      REQUIRES_BACKEND_TABS.forEach((tab) => hidden.add(tab));
    }
  }
  return hidden;
}

export function Sidebar() {
  const { t } = useTranslation(['layout', 'common']);
  const { activeTab, setActiveTab, collapsed, toggleCollapsed, setCollapsed } = useSidebarStore();
  const hiddenTabs = useSidebarStore((s) => s.hiddenTabs);
  const isLocal = useAuthStore((s) => s.mode === 'local');
  const desktop = isDesktop();
  const { theme, toggle: toggleTheme } = useThemeStore();
  const openSettings = useSettingsUIStore((s) => s.openSettings);
  const proxyEnabled = useProxyConfigStore((s) => s.enabled && !!s.endpoint);
  const updateAvailable = useUpdateStore((s) => s.available);

  const hidden = platformHiddenTabs(isLocal, desktop);
  const userHidden = new Set(hiddenTabs);
  const visibleTabs = sidebarTabs.filter((tab) => !hidden.has(tab.id) && !userHidden.has(tab.id));
  const mainTabs = visibleTabs.filter(tab => tab.group === 'main');
  const toolTabs = visibleTabs.filter(tab => tab.group === 'tools');

  const effectiveActive = visibleTabs.some((tab) => tab.id === activeTab)
    ? activeTab
    : (visibleTabs[0]?.id ?? 'collections');

  // Keep the AI panel MOUNTED once it's first opened, hiding it (not
  // unmounting) when you navigate to another tab — otherwise the embedded
  // Claude CLI PTY/WebSocket it holds is torn down and re-spawned on every
  // return. Lazy: not mounted until first opened, so launching the app doesn't
  // start a claude session no one asked for. Restart stays on-demand via the
  // terminal's own Reconnect button.
  const [aiMounted, setAiMounted] = useState(false);
  useEffect(() => {
    if (effectiveActive === 'ai') setAiMounted(true);
  }, [effectiveActive]);

  const handleIconClick = (tabId: SidebarTab) => {
    if (collapsed) {
      setCollapsed(false);
      setActiveTab(tabId);
    } else if (effectiveActive === tabId) {
      setCollapsed(true);
    } else {
      setActiveTab(tabId);
    }
  };

  return (
    <div className="flex h-full border-r">
      {/* Icon strip */}
      <TooltipProvider delayDuration={100}>
        <div className="w-12 bg-muted/30 border-r flex flex-col items-center py-2 gap-1 shrink-0">
          <RailTabs
            mainTabs={mainTabs}
            toolTabs={toolTabs}
            activeId={collapsed ? null : effectiveActive}
            onPick={handleIconClick}
            label={(id) => t(`tabs.${id}`)}
            moreLabel={t('moreTools')}
          />

          {/* Settings + theme toggle live just above the collapse button
              so they're always one click away regardless of which tab
              is active. Duplicated inside the user dropdown in TopBar
              for users who navigate via the avatar menu. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => openSettings(updateAvailable ? 'updates' : undefined)}
                className="w-9 h-9 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer relative"
              >
                <Settings className="h-4 w-4" />
                {proxyEnabled && (
                  <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-green-500" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{proxyEnabled ? t('settingsProxyOn') : t('common:settings')}</p>
            </TooltipContent>
          </Tooltip>

          {/* The update nudge now lives in the StatusBar under the main pane;
              Settings still opens on "Updates" while one is pending. */}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleTheme}
                className="w-9 h-9 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer"
              >
                {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{theme === 'light' ? t('darkMode') : t('lightMode')}</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleCollapsed}
                className="w-9 h-9 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer"
              >
                {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{collapsed ? t('expandSidebar') : t('collapseToIcons')}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>

      {/* Content panel */}
      <div className={cn('flex-1 min-w-0 flex flex-col', collapsed && 'hidden')}>
        {/* AI panel: stays mounted after first open (hidden when inactive) so its
            embedded Claude PTY survives tab switches. Renders nothing until first
            opened. When active it's the only visible panel; the branch below
            skips 'ai'. */}
        {aiMounted && (
          <div className={effectiveActive === 'ai' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
            <LLMPanel />
          </div>
        )}
        {effectiveActive === 'mock' ? (
          /* Mock panel manages its own header and scroll */
          <MockServerList />
        ) : effectiveActive === 'ai' ? null : (
          <>
            <div className="px-3 py-2 border-b flex items-center justify-between gap-2 min-h-[2.5rem]">
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                {t(`tabs.${effectiveActive}`)}
                {(effectiveActive === 'kafka' || effectiveActive === 'storage' || effectiveActive === 'redis' || effectiveActive === 'elasticsearch' || effectiveActive === 'kubernetes' || effectiveActive === 'excalidraw' || effectiveActive === 'notes' || effectiveActive === 'dashboards') && (
                  <span className="rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5">
                    {t('beta')}
                  </span>
                )}
              </h2>
              {effectiveActive === 'collections' && (
                <CollectionsHeaderActions isLocal={isLocal} />
              )}
              {effectiveActive === 'qa' && <QAHeaderActions />}
              {effectiveActive === 'git' && <GitHeaderActions />}
              {effectiveActive === 'database' && <DBHeaderActions />}
              {effectiveActive === 'kafka' && <MessagingHeaderActions />}
              {effectiveActive === 'storage' && <S3HeaderActions />}
              {effectiveActive === 'redis' && <RedisHeaderActions />}
              {effectiveActive === 'elasticsearch' && <ESHeaderActions />}
              {effectiveActive === 'kubernetes' && <K8sHeaderActions />}
              {effectiveActive === 'excalidraw' && <ExcalidrawHeaderActions />}
              {effectiveActive === 'notes' && <NotesHeaderActions />}
              {effectiveActive === 'dashboards' && <DashboardsHeaderActions />}
            </div>
            <ScrollArea className="flex-1">
              {effectiveActive === 'collections' && <CollectionsAccordion />}
              {effectiveActive === 'database' && <DBSidebar />}
              {effectiveActive === 'kafka' && <MessagingSidebar />}
              {effectiveActive === 'storage' && <S3Sidebar />}
              {effectiveActive === 'redis' && <RedisSidebar />}
              {effectiveActive === 'elasticsearch' && <ESSidebar />}
              {effectiveActive === 'kubernetes' && <K8sSidebar />}
              {effectiveActive === 'git' && <GitSidebar />}
              {effectiveActive === 'devtools' && <DevToolsSidebar />}
              {effectiveActive === 'excalidraw' && <ExcalidrawSidebar />}
              {effectiveActive === 'notes' && <NotesSidebar />}
              {effectiveActive === 'dashboards' && <DashboardsSidebar />}
              {effectiveActive === 'history' && <HistoryList />}
              {effectiveActive === 'qa' && <QADashboard />}
              {effectiveActive === 'websocket' && <WebSocketClient />}
              {effectiveActive === 'cookies' && <CookieManager />}
              {effectiveActive === 'audit' && <AuditPanel />}
            </ScrollArea>
            {/* Bottom strip — intentionally empty for now (its sync badge +
                download CTA moved to the StatusBar under the main pane).
                Same height as the StatusBar so the two form one bottom bar. */}
            <div className="h-7 shrink-0 border-t bg-muted/30" />
          </>
        )}
      </div>
    </div>
  );
}

// CollectionsHeaderActions renders the 4 top-of-tab actions (refresh,
// join shared, import, new). It used to live inside CollectionTree but
// the user wanted a single header row shared by both the Public and
// Private accordion sections. The buttons dispatch via a window
// `patchman:collections-action` event that CollectionTree listens for,
// so the existing dialog state + refresh toast logic stay co-located
// with the tree and we don't have to lift four pieces of state up.
function CollectionsHeaderActions({ isLocal }: { isLocal: boolean }) {
  const { t } = useTranslation('layout');
  const fire = (action: string) => {
    window.dispatchEvent(new CustomEvent('patchman:collections-action', { detail: action }));
  };
  return (
    <div className="flex items-center gap-0.5">
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => fire('refresh')}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>{t('actions.refreshCollections')}</p></TooltipContent>
        </Tooltip>
        {!isLocal && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => fire('join')}
              >
                <UserPlus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>{t('actions.joinShared')}</p></TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => fire('import')}
            >
              <FolderInput className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>{t('actions.importCollection')}</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => fire('create')}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>{t('actions.newCollection')}</p></TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

// ── Rail tabs: compress, then overflow ──────────────────────────────────────
// The icon rail has to fit every screen height. As space shrinks the buttons
// first tighten (40 → 34 → 30px per row); when even the tightest rows don't
// fit, the tail moves into a "»" menu that opens to the right. The active tab
// always stays on the rail. Measured live with a ResizeObserver.
type RailTab = { id: SidebarTab; icon: React.ElementType };

const DENSITIES = [
  { row: 40, btn: 'w-9 h-9', gap: 4 },
  { row: 34, btn: 'w-8 h-8', gap: 2 },
  { row: 30, btn: 'w-7 h-7', gap: 2 },
] as const;
const SEPARATOR_H = 10;

function railLayout(height: number, main: number, tools: number) {
  const sep = main > 0 && tools > 0 ? SEPARATOR_H : 0;
  const n = main + tools;
  for (let d = 0; d < DENSITIES.length; d++) {
    if (n * DENSITIES[d].row + sep <= height) return { density: d, visible: n };
  }
  const tight = DENSITIES.length - 1;
  // Reserve a row for the "»" button (and the separator, conservatively).
  const fit = Math.max(1, Math.floor((height - sep - DENSITIES[tight].row) / DENSITIES[tight].row));
  return { density: tight, visible: Math.min(n, fit) };
}

function RailTabs({ mainTabs, toolTabs, activeId, onPick, label, moreLabel }: {
  mainTabs: RailTab[];
  toolTabs: RailTab[];
  activeId: string | null;
  onPick: (id: SidebarTab) => void;
  label: (id: SidebarTab) => string;
  moreLabel: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setHeight(Math.floor(entry.contentRect.height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const all = [...mainTabs, ...toolTabs];
  // Before the first measurement render everything at full size.
  const { density, visible } = height > 0 ? railLayout(height, mainTabs.length, toolTabs.length) : { density: 0, visible: all.length };
  let shown = all.slice(0, visible);
  let overflow = all.slice(visible);
  // Keep the active tab on the rail: swap it with the last visible one.
  if (activeId && overflow.some((tb) => tb.id === activeId) && shown.length > 0) {
    const active = overflow.find((tb) => tb.id === activeId)!;
    const bumped = shown[shown.length - 1];
    shown = [...shown.slice(0, -1), active];
    overflow = [bumped, ...overflow.filter((tb) => tb.id !== activeId)];
  }
  const d = DENSITIES[density];
  const mainIds = new Set(mainTabs.map((tb) => tb.id));
  const shownMain = shown.filter((tb) => mainIds.has(tb.id));
  const shownTools = shown.filter((tb) => !mainIds.has(tb.id));

  const button = (tab: RailTab) => {
    const Icon = tab.icon;
    return (
      <Tooltip key={tab.id}>
        <TooltipTrigger asChild>
          <button
            onClick={() => onPick(tab.id)}
            aria-label={label(tab.id)}
            className={cn(
              d.btn,
              'shrink-0 rounded-md flex items-center justify-center transition-all duration-200 cursor-pointer',
              activeId === tab.id
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>{label(tab.id)}</p>
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div ref={boxRef} className="flex-1 min-h-0 w-full flex flex-col items-center overflow-hidden" style={{ rowGap: d.gap }}>
      {shownMain.map(button)}
      {shownMain.length > 0 && shownTools.length > 0 && <Separator className="my-1 w-6 shrink-0" />}
      {shownTools.map(button)}
      {overflow.length > 0 && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={moreLabel}
                  className={cn(d.btn, 'shrink-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer')}
                >
                  <ChevronsRight className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right"><p>{moreLabel}</p></TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="right" align="end" sideOffset={8} className="w-52">
            {overflow.map((tab) => {
              const Icon = tab.icon;
              return (
                <DropdownMenuItem key={tab.id} onClick={() => onPick(tab.id)} className="gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {label(tab.id)}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
