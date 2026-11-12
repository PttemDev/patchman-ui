import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, LayoutDashboard, Plus, Radar, RefreshCw, ScrollText } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useGrafanaConnectionStore } from '@/stores/grafanaConnectionStore';
import { useObservabilityConnectionStore } from '@/stores/observabilityConnectionStore';
import { GrafanaSidebar } from '@/components/grafana/GrafanaSidebar';
import { useGrafanaSidebarUI } from '@/components/grafana/grafanaSidebarUI';
import { ObservabilitySidebar } from './ObservabilitySidebar';
import { useGraylogConnectionStore } from '@/stores/graylogConnectionStore';
import { GraylogSidebar } from '@/components/graylog/GraylogSidebar';
import { useGraylogSidebarUI } from '@/components/graylog/graylogSidebarUI';
import { useObservabilitySidebarUI } from './obsSidebarUI';

// Dashboards rail: Grafana dashboards, Graylog log search and the APM /
// observability connections the live service map reads, in collapsible
// groups (the Messaging rail's layout).

const OPEN_KEY = 'patchman_dashboards_groups';

function readOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function DashboardsHeaderActions() {
  const { t } = useTranslation('servicemap');
  const fetchGrafana = useGrafanaConnectionStore((s) => s.fetchConnections);
  const fetchObs = useObservabilityConnectionStore((s) => s.fetchConnections);
  const fetchGraylog = useGraylogConnectionStore((s) => s.fetchConnections);
  const addGrafana = useGrafanaSidebarUI((s) => s.openAdd);
  const addObs = useObservabilitySidebarUI((s) => s.openAdd);
  const addGraylog = useGraylogSidebarUI((s) => s.openAdd);
  return (
    <div className="flex items-center gap-0.5">
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { void fetchGrafana(); void fetchObs(); void fetchGraylog(); }} title={t('common:refresh')}>
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-6 w-6" title={t('rail.newConnection')}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={addGrafana}><LayoutDashboard className="h-3.5 w-3.5 mr-2" /> {t('rail.newGrafana')}</DropdownMenuItem>
          <DropdownMenuItem onClick={addGraylog}><ScrollText className="h-3.5 w-3.5 mr-2" /> {t('rail.newGraylog')}</DropdownMenuItem>
          <DropdownMenuItem onClick={addObs}><Radar className="h-3.5 w-3.5 mr-2" /> {t('rail.newObservability')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function DashboardsSidebar() {
  const { t } = useTranslation('servicemap');
  const grafanaCount = useGrafanaConnectionStore((s) => s.connections.length);
  const obsCount = useObservabilityConnectionStore((s) => s.connections.length);
  const graylogCount = useGraylogConnectionStore((s) => s.connections.length);
  const addGrafana = useGrafanaSidebarUI((s) => s.openAdd);
  const addObs = useObservabilitySidebarUI((s) => s.openAdd);
  const addGraylog = useGraylogSidebarUI((s) => s.openAdd);
  const [open, setOpen] = useState<Record<string, boolean>>(readOpen);
  const toggle = (k: string) => setOpen((m) => {
    const next = { ...m, [k]: !(m[k] ?? true) };
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });
  const grafanaOpen = open.grafana ?? true;
  const obsOpen = open.observability ?? true;
  const graylogOpen = open.graylog ?? true;
  return (
    <div className="py-1">
      <GroupHeader icon={<LayoutDashboard className="h-3.5 w-3.5 text-orange-500" />} label="Grafana" count={grafanaCount} open={grafanaOpen} onToggle={() => toggle('grafana')} onAdd={addGrafana} addTitle={t('rail.newGrafana')} />
      {/* Kept mounted (hidden) so its dialogs work from the header menu. */}
      <div className={grafanaOpen ? undefined : 'hidden'}><GrafanaSidebar embedded /></div>
      <GroupHeader icon={<ScrollText className="h-3.5 w-3.5 text-rose-500" />} label="Graylog" count={graylogCount} open={graylogOpen} onToggle={() => toggle('graylog')} onAdd={addGraylog} addTitle={t('rail.newGraylog')} />
      <div className={graylogOpen ? undefined : 'hidden'}><GraylogSidebar /></div>
      <GroupHeader icon={<Radar className="h-3.5 w-3.5 text-emerald-500" />} label={t('rail.observability')} count={obsCount} open={obsOpen} onToggle={() => toggle('observability')} onAdd={addObs} addTitle={t('rail.newObservability')} />
      <div className={obsOpen ? undefined : 'hidden'}><ObservabilitySidebar /></div>
    </div>
  );
}

function GroupHeader({ icon, label, count, open, onToggle, onAdd, addTitle }: {
  icon: React.ReactNode; label: string; count: number; open: boolean; onToggle: () => void; onAdd: () => void; addTitle: string;
}) {
  return (
    <div className="group flex items-center gap-1 px-2 pt-2 pb-1">
      <button type="button" onClick={onToggle} className="flex-1 min-w-0 flex items-center gap-1.5 text-left">
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-[10px] text-muted-foreground/60">{count}</span>
      </button>
      <Button size="icon" variant="ghost" className="h-5 w-5 opacity-0 group-hover:opacity-100" onClick={onAdd} title={addTitle}>
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}
