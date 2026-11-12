import { Plus, X, Code, Copy as CopyIcon, Pencil, Files, XCircle, ArrowRightFromLine, Database, Radio, HardDrive, GitBranch, Wrench, ExternalLink, Shapes, NotebookText, LayoutDashboard, Rabbit, Waypoints, ScrollText } from 'lucide-react';
import { toolDef } from '@/components/devtools/registry';
import { useTranslation } from 'react-i18next';
import { useState, useCallback, useEffect, useRef, Fragment } from 'react';
import { cn } from '@/lib/utils';
import { useRequestStore } from '@/stores/requestStore';
import { useWhiteboardStore } from '@/stores/whiteboardStore';
import { useNotesStore } from '@/stores/notesStore';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RedisIcon } from '@/components/icons/RedisIcon';
import { ESIcon } from '@/components/icons/ESIcon';
import { K8sIcon } from '@/components/icons/K8sIcon';
import { TabBody } from './TabBody';
import { detachTab, focusDetachedWindow } from '@/lib/detach/DetachController';
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

/** The small type glyph shown in a (live or detached-placeholder) tab slot. */
function tabGlyph(tab: Pick<Tab, 'type' | 'toolKind' | 'method'>) {
  switch (tab.type) {
    case 'db':
      return <Database className="h-3 w-3 text-cyan-500 shrink-0" />;
    case 'kafka':
      return <Radio className="h-3 w-3 text-orange-500 shrink-0" />;
    case 's3':
      return <HardDrive className="h-3 w-3 text-emerald-500 shrink-0" />;
    case 'redis':
      return <RedisIcon className="h-3 w-3 text-red-500 shrink-0" />;
    case 'es':
      return <ESIcon className="h-3 w-3 text-yellow-500 shrink-0" />;
    case 'k8s':
      return <K8sIcon className="h-3 w-3 text-blue-500 shrink-0" />;
    case 'git':
      return <GitBranch className="h-3 w-3 text-orange-500 shrink-0" />;
    case 'excalidraw':
      return <Shapes className="h-3 w-3 text-violet-400 shrink-0" />;
    case 'note':
      return <NotebookText className="h-3 w-3 text-sky-500 shrink-0" />;
    case 'grafana':
      return <LayoutDashboard className="h-3 w-3 text-orange-500 shrink-0" />;
    case 'rabbit':
      return <Rabbit className="h-3 w-3 text-orange-500 shrink-0" />;
    case 'graylog':
      return <ScrollText className="h-3 w-3 text-rose-500 shrink-0" />;
    case 'servicemap':
      return <Waypoints className="h-3 w-3 text-violet-500 shrink-0" />;
    case 'tool': {
      const ToolIcon = toolDef(tab.toolKind)?.icon ?? Wrench;
      return <ToolIcon className="h-3 w-3 text-violet-400 shrink-0" />;
    }
    default:
      return (
        <span className={cn('text-[10px] font-bold uppercase shrink-0', methodColors[tab.method] || 'text-gray-500')}>
          {tab.method}
        </span>
      );
  }
}

// Split a URL into its base (scheme+host+path) and decoded query params for the
// structured tab tooltip.
function parseTabUrl(raw: string): { base: string; params: [string, string][] } {
  if (!raw) return { base: '', params: [] };
  const q = raw.indexOf('?');
  if (q === -1) return { base: raw, params: [] };
  const dec = (s: string) => {
    try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
  };
  const params: [string, string][] = [];
  for (const pair of raw.slice(q + 1).split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    params.push(eq === -1 ? [dec(pair), ''] : [dec(pair.slice(0, eq)), dec(pair.slice(eq + 1))]);
  }
  return { base: raw.slice(0, q), params };
}

// RequestTabTooltip renders a structured hover card for an HTTP request tab:
// method + leaf name, the collection breadcrumb, the base URL, and each query
// param on its own row — instead of one long wrapped line.
function RequestTabTooltip({ tab }: { tab: Tab }) {
  const { t } = useTranslation('request');
  const method = tab.method || 'GET';
  const segs = (tab.name || '').split('→').map((s) => s.trim()).filter(Boolean);
  let leaf = segs.length ? segs[segs.length - 1] : (tab.name || '');
  const crumb = segs.slice(0, -1).join('  ›  ');
  if (leaf.toUpperCase().startsWith(method.toUpperCase() + ' ')) leaf = leaf.slice(method.length + 1).trim();
  const { base, params } = parseTabUrl(tab.url || '');
  const shown = params.slice(0, 10);
  return (
    <div className="space-y-1.5 text-xs max-w-[22rem]">
      <div className="flex items-baseline gap-1.5">
        <span className={cn('font-bold uppercase text-[10px] shrink-0', methodColors[method] || 'text-gray-400')}>{method}</span>
        <span className="font-medium break-all">{leaf || tab.url || t('tab.newRequest')}</span>
      </div>
      {crumb && <div className="text-[11px] text-primary-foreground/60 break-words">{crumb}</div>}
      {base && (
        <div className="pt-1 border-t border-primary-foreground/15 font-mono text-[11px] text-primary-foreground/85 break-all">{base}</div>
      )}
      {shown.length > 0 && (
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 pt-0.5">
          {shown.map(([k, v], i) => (
            <Fragment key={i}>
              <span className="font-mono text-primary-foreground/55 break-all">{k}</span>
              <span className="text-primary-foreground/90 break-all">{v || '—'}</span>
            </Fragment>
          ))}
          {params.length > shown.length && (
            <span className="col-span-2 text-primary-foreground/50">+{params.length - shown.length} {t('tab.moreParams')}</span>
          )}
        </div>
      )}
    </div>
  );
}

/** The greyed, non-interactive stand-in a tab shows while it lives in a
 *  detached window. Rendered IN PLACE of the normal tab (same array slot →
 *  same strip position). Clicking focuses the detached window. */
function DetachedTabChip({ tab }: { tab: Tab }) {
  const { t } = useTranslation('request');
  const label = tab.name || tab.url || t('tab.detachedTab');
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => focusDetachedWindow(tab.id)}
            className="group flex items-center gap-1.5 px-3 py-2 text-xs border-r cursor-pointer transition-colors duration-200 min-w-[120px] max-w-[200px] text-muted-foreground/60 hover:bg-background/40"
          >
            <span className="opacity-70 shrink-0 inline-flex">{tabGlyph(tab)}</span>
            <span className="truncate flex-1 text-left italic">{label}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-md">
          <p className="font-medium text-xs">{label}</p>
          <p className="text-[11px] text-primary-foreground/70 mt-0.5">
            {t('tab.detachedFocusHint')}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function RequestPanel() {
  const {
    tabs,
    activeTabId,
    detached,
    addTab,
    removeTab,
    cloneTab,
    closeOtherTabs,
    closeTabsToRight,
    closeAllTabs,
    reorderTabs,
    setActiveTab,
    updateTab,
  } = useRequestStore();
  const { toast } = useToast();
  const { t } = useTranslation('request');

  // A tab renders as a greyed "Detached ↗" placeholder for the WHOLE time it's
  // on loan — DETACHING through DETACHED — so it greys the instant you detach
  // and there's no flicker at the handoff. The tab stays in `tabs` at its slot
  // (approach b), so the placeholder holds the tab's original position and the
  // body never renders a detached tab's (frozen) content.
  const detachedIds = new Set(detached.map((l) => l.tabId));
  const activeTab = tabs.find((t) => t.id === activeTabId && !detachedIds.has(t.id));

  // Tab renaming
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // Tab drag-and-drop reordering (native HTML5 DnD, no extra deps)
  const dragIndexRef = useRef<number | null>(null);
  // `dropGap` is the gap index (0..tabs.length) where the dragged tab would
  // land — a bar is drawn there. `draggingIdx` dims the source.
  const [dropGap, setDropGap] = useState<number | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  // Move the dragged tab into gap `gap` (0..tabs.length). reorderTabs takes the
  // FINAL index, so shift left by one when the item moves rightward.
  const commitTabDrop = useCallback(
    (gap: number | null) => {
      const from = dragIndexRef.current;
      if (from != null && gap != null) {
        const to = from < gap ? gap - 1 : gap;
        if (to !== from && to >= 0) reorderTabs(from, to);
      }
      dragIndexRef.current = null;
      setDropGap(null);
      setDraggingIdx(null);
    },
    [reorderTabs],
  );

  // Keep the active tab visible: a newly-opened tab is appended at the end, so
  // scroll the strip toward it whenever the active tab (or tab count) changes.
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [activeTabId, tabs.length]);

  const handleDoubleClick = (tabId: string, currentName: string) => {
    setEditingTabId(tabId);
    setEditingName(currentName || t('tab.newRequest'));
  };

  const commitRename = () => {
    const name = editingName.trim();
    if (editingTabId && name) {
      updateTab(editingTabId, { name });
      // Renaming a whiteboard tab renames the board itself (which in turn
      // re-syncs the tab title) — keeps the two names in lockstep.
      const tab = tabs.find((t) => t.id === editingTabId);
      if (tab?.type === 'excalidraw' && tab.whiteboardId) {
        void useWhiteboardStore.getState().renameBoard(tab.whiteboardId, name);
      }
      if (tab?.type === 'note' && tab.noteId) {
        void useNotesStore.getState().renameNote(tab.noteId, name);
      }
    }
    setEditingTabId(null);
    setEditingName('');
  };

  const handleCopyUrl = useCallback(async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const proto = tab.protocol ?? '';
    const url = tab.url ? `${proto}${tab.url}` : '';
    if (!url) {
      toast({ title: t('tab.noUrlToCopy'), variant: 'destructive' });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: t('tab.urlCopied') });
    } catch {
      toast({ title: t('tab.failedCopyUrl'), variant: 'destructive' });
    }
  }, [tabs, toast, t]);

  return (
    <div className="h-full flex flex-col">
      {/* Browser-like tab bar */}
      <div className="flex items-center border-b bg-muted/30 shrink-0">
        <div className="flex-1 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <div
            className="flex items-center min-w-full"
            onDoubleClick={(e) => {
              // Double-click the empty strip to the right of the tabs opens a
              // new tab (browser-like). The guard fires only when the click
              // lands on this row itself (the empty area) — double-clicking a
              // tab hits the tab element instead, so it renames, not spawns.
              if (e.target === e.currentTarget) addTab();
            }}
            onDragOver={(e) => {
              // Hovering the empty area past the last tab → drop at the end.
              if (dragIndexRef.current != null && e.target === e.currentTarget) {
                e.preventDefault();
                setDropGap(tabs.length);
              }
            }}
            onDrop={(e) => {
              if (dragIndexRef.current != null) {
                e.preventDefault();
                commitTabDrop(dropGap);
              }
            }}
          >
            {tabs.map((tab, idx) => {
              // Detached tabs occupy their slot as a greyed placeholder (kept
              // in-place so the strip never reorders on detach/return).
              if (detachedIds.has(tab.id)) {
                return <DetachedTabChip key={tab.id} tab={tab} />;
              }
              const isOnlyTab = tabs.length === 1;
              const isLastTab = idx === tabs.length - 1;
              // Suppress the placeholder for no-op gaps (either side of the source).
              const realDrop =
                draggingIdx !== null && dropGap !== null && dropGap !== draggingIdx && dropGap !== draggingIdx + 1;
              const detail =
                tab.type === 'db'
                  ? t('tab.detail.dbQuery')
                  : tab.type === 'kafka'
                    ? `Kafka${tab.kafkaTopic ? ' · ' + tab.kafkaTopic : ''}`
                    : tab.type === 's3'
                      ? `S3${tab.s3Bucket ? ' · ' + tab.s3Bucket : ''}`
                      : tab.type === 'redis'
                        ? t('tab.detail.redis')
                        : tab.type === 'es'
                          ? t('tab.detail.es')
                          : tab.type === 'k8s'
                          ? `Kubernetes${tab.k8sContext ? ' · ' + tab.k8sContext : ''}`
                          : tab.type === 'git'
                          ? `Git${tab.gitRepoName ? ' · ' + tab.gitRepoName : ''}`
                          : tab.type === 'tool'
                          ? t('tab.detail.tool')
                          : tab.type === 'excalidraw'
                          ? 'Excalidraw'
                          : tab.type === 'note'
                          ? t('tab.detail.note')
                          : tab.type === 'grafana'
                          ? t('tab.detail.grafana')
                          : tab.type === 'rabbit'
                          ? t('tab.detail.rabbit')
                          : tab.type === 'graylog'
                          ? t('tab.detail.graylog')
                          : tab.type === 'servicemap'
                          ? t('tab.detail.servicemap')
                          : `${tab.method} ${tab.url || t('tab.detail.noUrl')}`;
              return (
                <ContextMenu key={tab.id}>
                  <ContextMenuTrigger asChild>
                    <div
                      ref={activeTabId === tab.id ? activeTabRef : undefined}
                      draggable={editingTabId !== tab.id}
                      onDragStart={(e) => {
                        dragIndexRef.current = idx;
                        setDraggingIdx(idx);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(e) => {
                        if (dragIndexRef.current == null) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        // Left half → drop before this tab; right half → after it.
                        const rect = e.currentTarget.getBoundingClientRect();
                        const gap = e.clientX < rect.left + rect.width / 2 ? idx : idx + 1;
                        if (dropGap !== gap) setDropGap(gap);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        commitTabDrop(dropGap);
                      }}
                      onDragEnd={() => commitTabDrop(null)}
                      className={cn(
                        'group flex items-center gap-1.5 px-3 py-2 text-xs border-r cursor-pointer transition-colors duration-200 min-w-[120px] max-w-[200px]',
                        activeTabId === tab.id
                          ? 'bg-background text-foreground border-b-2 border-b-primary'
                          : 'text-muted-foreground hover:bg-background/50',
                        draggingIdx === idx && 'opacity-40',
                        realDrop && dropGap === idx && 'border-l-2 border-l-primary',
                        realDrop && dropGap === tabs.length && isLastTab && 'border-r-2 border-r-primary'
                      )}
                      onClick={() => setActiveTab(tab.id)}
                      onAuxClick={(e) => {
                        // Middle-click closes, matching browser tab UX.
                        if (e.button === 1) {
                          e.preventDefault();
                          removeTab(tab.id);
                        }
                      }}
                      onContextMenu={() => setActiveTab(tab.id)}
                      onDoubleClick={() =>
                        handleDoubleClick(tab.id, tab.name || tab.url || t('tab.newRequest'))
                      }
                    >
                      {tabGlyph(tab)}
                      {editingTabId === tab.id ? (
                        <input
                          autoFocus
                          className="flex-1 min-w-0 bg-transparent border-b border-primary outline-none text-xs px-0.5"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename();
                            if (e.key === 'Escape') {
                              setEditingTabId(null);
                              setEditingName('');
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <TooltipProvider delayDuration={400}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="truncate flex-1">
                                {tab.name || tab.url || t('tab.newRequest')}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-md">
                              {(tab.type == null || tab.type === 'api') ? (
                                <RequestTabTooltip tab={tab} />
                              ) : (
                                <>
                                  <p className="font-medium text-xs">{tab.name || tab.url || t('tab.newRequest')}</p>
                                  <p className="text-[11px] text-primary-foreground/70 break-all mt-0.5">{detail}</p>
                                </>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      {tab.loading && (
                        <div className="h-3 w-3 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
                      )}
                      <TooltipProvider delayDuration={100}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                removeTab(tab.id);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity shrink-0 cursor-pointer"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t('tab.closeTab')}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-56">
                    <ContextMenuItem onSelect={() => addTab()}>
                      <Plus className="h-3.5 w-3.5 mr-2" />
                      {t('tab.newTab')}
                      <ContextMenuShortcut>⌘T</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => cloneTab(tab.id)}>
                      <Files className="h-3.5 w-3.5 mr-2" />
                      {t('tab.cloneTab')}
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => detachTab(tab.id)}>
                      <ExternalLink className="h-3.5 w-3.5 mr-2" />
                      {t('tab.detachTab')}
                      <ContextMenuShortcut>⌘D</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onSelect={() =>
                        handleDoubleClick(tab.id, tab.name || tab.url || t('tab.newRequest'))
                      }
                    >
                      <Pencil className="h-3.5 w-3.5 mr-2" />
                      {t('tab.rename')}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => handleCopyUrl(tab.id)}
                      disabled={!tab.url}
                    >
                      <CopyIcon className="h-3.5 w-3.5 mr-2" />
                      {t('tab.copyUrl')}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => removeTab(tab.id)}>
                      <X className="h-3.5 w-3.5 mr-2" />
                      {t('tab.closeTabItem')}
                      <ContextMenuShortcut>⌘W</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => closeOtherTabs(tab.id)}
                      disabled={isOnlyTab}
                    >
                      <XCircle className="h-3.5 w-3.5 mr-2" />
                      {t('tab.closeOtherTabs')}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => closeTabsToRight(tab.id)}
                      disabled={isLastTab}
                    >
                      <ArrowRightFromLine className="h-3.5 w-3.5 mr-2" />
                      {t('tab.closeTabsToRight')}
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => closeAllTabs()}>
                      <X className="h-3.5 w-3.5 mr-2" />
                      {t('tab.closeAllTabs')}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 mx-1" title={t('tab.newTabTitle')}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={() => addTab()}>
              <Code className="h-3.5 w-3.5 mr-2" />
              {t('tab.newApiRequest')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                addTab({ type: 'db', name: t('tab.newDbQuery'), method: 'GET', url: '', dbQuery: '' }, true)
              }
            >
              <Database className="h-3.5 w-3.5 mr-2" />
              {t('tab.newDbQuery')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                addTab({ type: 'kafka', name: t('tab.newKafkaTopic'), method: 'GET', url: '' }, true)
              }
            >
              <Radio className="h-3.5 w-3.5 mr-2" />
              {t('tab.newKafkaTopic')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                addTab({ type: 's3', name: t('tab.newS3Browser'), method: 'GET', url: '' }, true)
              }
            >
              <HardDrive className="h-3.5 w-3.5 mr-2" />
              {t('tab.newS3Browser')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                addTab({ type: 'redis', name: t('tab.newRedis'), method: 'GET', url: '' }, true)
              }
            >
              <RedisIcon className="h-3.5 w-3.5 mr-2 text-red-500" />
              {t('tab.newRedis')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                addTab({ type: 'es', name: t('tab.newElasticsearch'), method: 'GET', url: '' }, true)
              }
            >
              <ESIcon className="h-3.5 w-3.5 mr-2 text-yellow-500" />
              {t('tab.newElasticsearch')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                addTab({ type: 'k8s', name: t('tab.newKubernetes'), method: 'GET', url: '' }, true)
              }
            >
              <K8sIcon className="h-3.5 w-3.5 mr-2 text-blue-500" />
              {t('tab.newKubernetes')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Active tab content lives in the shared <TabBody/> (the same body a
          detached window renders). When every tab is detached (or closed),
          `tabs` can be empty — show the browser-like empty state. */}
      {activeTab ? (
        <TabBody tab={activeTab} />
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <p className="text-lg font-medium">{t('empty.title')}</p>
            <p className="text-sm mt-1">{t('empty.subtitle')}</p>
            <Button variant="outline" className="mt-4" onClick={() => addTab()}>
              <Plus className="h-4 w-4 mr-2" />
              {t('tab.newRequest')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
