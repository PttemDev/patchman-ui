import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, CloudCog, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { openGCP, useGCPStore } from '@/stores/gcpStore';
import { useSettingsUIStore } from '@/stores/settingsUIStore';
import type { Tab } from '@/types';

const OPEN_KEY = 'patchman.gcp.sidebar.open.v1';

function readOpen(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') as Record<string, boolean>; } catch { return {}; }
}

const openGCPSettings = () => useSettingsUIStore.getState().openSettings('gcp');

// "Google Cloud" group in a rail's sidebar (Storage → Cloud Storage,
// Messaging → Pub/Sub, Dashboards → Cloud Logging, Kubernetes → GKE): one row
// per credential, opening the Google Cloud tab on that service.
export function GcpSidebarGroup({ service }: { service: NonNullable<Tab['gcpService']> }) {
  const { t } = useTranslation('gcp');
  const { credentials, fetch } = useGCPStore();
  const [open, setOpen] = useState(() => readOpen()[service] ?? true);
  useEffect(() => { void fetch(); }, [fetch]);
  const toggle = () => setOpen((v) => {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify({ ...readOpen(), [service]: !v })); } catch { /* private mode */ }
    return !v;
  });
  return (
    <div>
      <div className="group flex items-center gap-1 px-2 pt-2 pb-1">
        <button type="button" onClick={toggle} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          <CloudCog className="h-3.5 w-3.5 text-sky-500" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t(`sidebar.${service}`)}</span>
          <span className="text-[10px] text-muted-foreground/60">{credentials.length}</span>
        </button>
        <Button size="icon" variant="ghost" className="h-5 w-5 opacity-0 group-hover:opacity-100" onClick={openGCPSettings} title={t('addCredential')}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      {open && (
        <div className="pb-1">
          {credentials.length === 0 ? (
            <button type="button" onClick={openGCPSettings} className="w-full px-7 py-1 text-left text-[11px] text-muted-foreground hover:text-foreground">{t('sidebar.connect')}</button>
          ) : credentials.map((c) => (
            <button key={c.id} type="button" onClick={() => openGCP(c, service, `${c.name} · ${t(`service.${service}`)}`)}
              className="flex w-full items-center gap-1.5 px-7 py-1 text-left text-xs hover:bg-accent/50" title={c.account}>
              <span className="truncate">{c.name}</span>
              {c.projectId && <span className="truncate font-mono text-[10px] text-muted-foreground">{c.projectId}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
