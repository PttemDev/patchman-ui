import { useCallback, useRef, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, PanelTop, Rows2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DBScope } from '@/services/api';
import { KafkaLagPanel, type Interval } from './KafkaLagPanel';
import { KafkaTopicsPanel } from './KafkaTopicsPanel';

type BottomTab = 'lag' | 'topics';
/** 'tabs' = one panel at a time; 'stacked' = Consumer Lag above Topics, both live. */
export type BottomLayout = 'tabs' | 'stacked';

const STACK_RATIO_KEY = 'patchman_kafka_bottom_stack_ratio';

interface KafkaBottomPanelProps {
  connId: string | undefined;
  scope: DBScope;
  topic?: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectTopic?: (topic: string) => void;
  // activeTab + lagInterval are owned by KafkaTopicPanel (persisted on the
  // tab) so each Kafka tab keeps its own selection / refresh rate and they
  // survive switching tabs. Controlled here rather than local/localStorage.
  activeTab: BottomTab;
  onActiveTabChange: (t: BottomTab) => void;
  lagInterval: Interval;
  onLagIntervalChange: (i: Interval) => void;
  // A per-user preference (owned by KafkaTopicPanel, kept in localStorage).
  layout: BottomLayout;
  onLayoutChange: (l: BottomLayout) => void;
}

// KafkaBottomPanel is the collapsible bottom pane of the Kafka tab: Consumer
// Lag and Topics, either as two tabs or stacked (both visible, resizable
// split). BOTH bodies stay mounted at all times and keep their tree position
// in either layout — the inactive tab is hidden via `display:none`, never
// unmounted — so switching tabs, layout or collapsing doesn't reset a
// panel's expand / detail state. Each panel gates its own fetching on the
// `active` prop.
export function KafkaBottomPanel({
  connId,
  scope,
  topic,
  collapsed,
  onToggleCollapse,
  onSelectTopic,
  activeTab,
  onActiveTabChange,
  lagInterval,
  onLagIntervalChange,
  layout,
  onLayoutChange,
}: KafkaBottomPanelProps) {
  const { t } = useTranslation('kafka');
  const stacked = layout === 'stacked';
  const selectTab = (next: BottomTab) => {
    onActiveTabChange(next);
    // Clicking a tab while collapsed expands the pane onto that tab.
    if (collapsed) onToggleCollapse();
  };
  const selectLayout = (next: BottomLayout) => {
    onLayoutChange(next);
    if (collapsed) onToggleCollapse();
  };

  const lagActive = !collapsed && (stacked || activeTab === 'lag');
  const topicsActive = !collapsed && (stacked || activeTab === 'topics');

  // Stacked split: Consumer Lag's share of the body height, in %.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [stackRatio, setStackRatio] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem(STACK_RATIO_KEY) || '');
      return !isNaN(v) && v >= 20 && v <= 80 ? v : 50;
    } catch { return 50; }
  });
  const onStackSplitDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const move = (ev: MouseEvent) => {
      const rect = bodyRef.current?.getBoundingClientRect();
      if (!rect || rect.height === 0) return;
      const pct = Math.min(Math.max(((ev.clientY - rect.top) / rect.height) * 100, 20), 80);
      setStackRatio(pct);
      try { localStorage.setItem(STACK_RATIO_KEY, String(Math.round(pct))); } catch { /* ignore */ }
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header strip: collapse chevron + tab pills (or stacked titles) + layout switch */}
      <div className="flex items-center gap-1 px-2 h-8 shrink-0 border-b bg-muted/30">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-1 text-muted-foreground hover:text-foreground"
          title={collapsed ? t('bottom.expand') : t('bottom.collapse')}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {stacked ? (
          <button
            type="button"
            onClick={collapsed ? onToggleCollapse : undefined}
            className={cn('text-xs px-2 py-0.5 text-muted-foreground', collapsed ? 'hover:text-foreground' : 'cursor-default')}
          >
            {t('bottom.tabConsumerLag')} · {t('bottom.tabTopics')}
          </button>
        ) : (
          <>
            <TabButton label={t('bottom.tabConsumerLag')} active={activeTab === 'lag'} onClick={() => selectTab('lag')} />
            <TabButton label={t('bottom.tabTopics')} active={activeTab === 'topics'} onClick={() => selectTab('topics')} />
          </>
        )}
        <div className="ml-auto flex items-center gap-0.5 rounded border bg-background/50 p-0.5">
          <LayoutButton icon={PanelTop} label={t('bottom.layoutTabs')} active={!stacked} onClick={() => selectLayout('tabs')} />
          <LayoutButton icon={Rows2} label={t('bottom.layoutStacked')} active={stacked} onClick={() => selectLayout('stacked')} />
        </div>
      </div>

      {/* Body — both panels always mounted, in the same tree positions in
          either layout; tabs hide the inactive one via `hidden`. */}
      <div ref={bodyRef} className={cn('flex-1 min-h-0 relative', stacked && 'flex flex-col', collapsed && 'hidden')}>
        <div
          className={cn(
            'flex flex-col min-h-0',
            stacked ? 'overflow-hidden' : 'absolute inset-0',
            !stacked && activeTab !== 'lag' && 'hidden',
          )}
          style={stacked ? { flex: `0 0 ${stackRatio}%` } : undefined}
        >
          {stacked && <SectionLabel label={t('bottom.tabConsumerLag')} />}
          <div className="flex-1 min-h-0 flex flex-col">
            <KafkaLagPanel
              connId={connId}
              scope={scope}
              topic={topic}
              active={lagActive}
              interval={lagInterval}
              onIntervalChange={onLagIntervalChange}
            />
          </div>
        </div>
        {stacked && (
          <div
            onMouseDown={onStackSplitDown}
            className="h-1 cursor-row-resize bg-border hover:bg-primary/40 shrink-0"
          />
        )}
        <div
          className={cn(
            'flex flex-col min-h-0',
            stacked ? 'flex-1 overflow-hidden' : 'absolute inset-0',
            !stacked && activeTab !== 'topics' && 'hidden',
          )}
        >
          {stacked && <SectionLabel label={t('bottom.tabTopics')} />}
          <div className="flex-1 min-h-0 flex flex-col">
            <KafkaTopicsPanel
              connId={connId}
              scope={scope}
              active={topicsActive}
              onSelectTopic={onSelectTopic}
              selectedTopic={topic}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-xs px-2 py-0.5 rounded transition-colors',
        active ? 'bg-background text-foreground border' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function LayoutButton({ icon: Icon, label, active, onClick }: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'p-0.5 rounded transition-colors',
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="shrink-0 px-3 h-6 flex items-center border-b bg-muted/20 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
  );
}
