import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, ClipboardCheck, PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QADashboard } from '@/components/qa/QADashboard';
import { QA_SECTIONS } from './sections';
import { openQAHub } from './openQAHub';

const CLASSIC_KEY = 'patchman.qa.classicSidebar';

// The QA sidebar rail (CR_QA_P0_PLAN.md P0.a): a launcher into the CR + QA Hub
// tab. The old in-sidebar dashboard stays one click away for one release.
export function QALauncher() {
  const { t } = useTranslation('qa');
  const [classic, setClassic] = useState(() => {
    try { return localStorage.getItem(CLASSIC_KEY) === '1'; } catch { return false; }
  });
  const toggle = (v: boolean) => {
    setClassic(v);
    try { localStorage.setItem(CLASSIC_KEY, v ? '1' : '0'); } catch { /* private mode */ }
  };

  if (classic) {
    return (
      <div>
        <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
          <span className="text-[11px] text-muted-foreground">{t('hub.classicNote')}</span>
          <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[11px]" onClick={() => toggle(false)}>
            <ArrowUpRight className="h-3 w-3" /> {t('hub.backToHub')}
          </Button>
        </div>
        <QADashboard />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-3">
      <button
        type="button"
        onClick={() => openQAHub()}
        className="group w-full rounded-lg border-2 border-primary/30 bg-primary/5 p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/10"
      >
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 group-hover:bg-primary/20">
            <ClipboardCheck className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-primary">{t('hub.open')}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t('hub.openHint')}</p>
          </div>
          <ArrowUpRight className="h-4 w-4 text-primary opacity-60 group-hover:opacity-100" />
        </div>
      </button>

      <div>
        <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t('hub.jumpTo')}</div>
        <ul className="space-y-0.5">
          {QA_SECTIONS.map((d) => {
            const Icon = d.icon;
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => openQAHub(d.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t(`hub.section.${d.id}`)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <Button variant="ghost" size="sm" className="h-7 w-full justify-start gap-1.5 text-[11px] text-muted-foreground" onClick={() => toggle(true)}>
        <PanelLeft className="h-3.5 w-3.5" /> {t('hub.classicView')}
      </Button>
    </div>
  );
}
