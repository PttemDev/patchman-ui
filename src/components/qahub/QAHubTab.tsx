import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck, Upload, Wand2 } from 'lucide-react';
import type { Tab } from '@/types';
import { useRequestStore } from '@/stores/requestStore';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { OverviewSection, TestCasesSection } from '@/components/qa/QADashboard';
import { TestPlanList } from '@/components/qa/TestPlanList';
import { TestRunView } from '@/components/qa/TestRunView';
import { LoadTestPanel } from '@/components/qa/LoadTestPanel';
import { DefectList } from '@/components/qa/DefectList';
import { RequirementsList } from '@/components/qa/RequirementsList';
import { SharedStepsList } from '@/components/qa/SharedStepsList';
import { TestCaseWizard } from '@/components/qa/TestCaseWizard';
import { JUnitImportDialog } from '@/components/qa/JUnitImportDialog';
import { QA_SECTIONS, isQASection, type QASection } from './sections';
import { QAScopeSelect } from './QAScope';
import { QASettingsSection } from './QASettingsSection';
import { InboxSection } from './InboxSection';
import { RadarSection } from './RadarSection';
import { ReviewsSection } from './ReviewsSection';
import { ReportsSection } from './ReportsSection';
import { AutomationSection } from './AutomationSection';
import { useQAInboxStore } from '@/stores/qaInboxStore';
import { useQAScopeStore } from '@/stores/qaScopeStore';

// CR + QA Hub (CR_QA_RFC.md, P0.a): QA as a main-area tab. A section nav on
// the left, the section on the right with room to breathe. The sections are
// the existing QA screens plus the review sections (Inbox, MR Radar, P0.c).
export default function QAHubTab({ tab }: { tab: Tab }) {
  const { t } = useTranslation('qa');
  const updateTab = useRequestStore((s) => s.updateTab);
  const section: QASection = isQASection(tab.qaSection) ? tab.qaSection : 'inbox';
  const setSection = (s: QASection) => updateTab(tab.id, { qaSection: s });
  const [wizardOpen, setWizardOpen] = useState(false);
  const [junitOpen, setJunitOpen] = useState(false);
  const [casesKey, setCasesKey] = useState(0);
  const current = QA_SECTIONS.find((d) => d.id === section)!;
  // Every section reloads when the QA space changes.
  const scope = useQAScopeStore((s) => s.workspaceId) ?? 'personal';
  const inboxCount = useQAInboxStore((s) => s.inbox?.items.length ?? 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b px-5 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ClipboardCheck className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{t('hub.title')}</h1>
          <p className="truncate text-xs text-muted-foreground">{t('hub.subtitle')}</p>
        </div>
        <QAScopeSelect />
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setJunitOpen(true)}>
          <Upload className="h-3.5 w-3.5" /> {t('dashboard.importJunit')}
        </Button>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setWizardOpen(true)}>
          <Wand2 className="h-3.5 w-3.5" /> {t('hub.newTestCase')}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <nav className="flex w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r bg-muted/20 p-3" aria-label={t('hub.title')}>
          {(['review', 'test', 'track', 'setup'] as const).map((group) => (
            <div key={group}>
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`hub.group.${group}`)}
              </div>
              <ul className="space-y-0.5">
                {QA_SECTIONS.filter((d) => d.group === group).map((d) => {
                  const Icon = d.icon;
                  const active = d.id === section;
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => setSection(d.id)}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                          active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{t(`hub.section.${d.id}`)}</span>
                        {d.id === 'inbox' && inboxCount > 0 && (
                          <span className="ml-auto rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">{inboxCount}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <main className="@container min-w-0 flex-1 overflow-y-auto">
          <div key={scope} className="mx-auto w-full max-w-[1400px] px-6 py-5">
            <div className="mb-4 flex items-center gap-2">
              <current.icon className="h-4 w-4 text-muted-foreground" />
              <h2 className="whitespace-nowrap text-sm font-semibold">{t(`hub.section.${section}`)}</h2>
              <span className="hidden min-w-0 truncate text-xs text-muted-foreground @xl:inline">· {t(`hub.sectionHint.${section}`)}</span>
            </div>
            {section === 'inbox' && <InboxSection onNavigate={setSection} />}
            {section === 'radar' && <RadarSection onNavigate={setSection} />}
            {section === 'reviews' && <ReviewsSection />}
            {section === 'overview' && <OverviewSection />}
            {section === 'cases' && <TestCasesSection key={casesKey} wide />}
            {section === 'plans' && <TestPlanList />}
            {section === 'runs' && <TestRunView />}
            {section === 'load' && <LoadTestPanel />}
            {section === 'defects' && <DefectList />}
            {section === 'requirements' && <RequirementsList />}
            {section === 'steps' && <SharedStepsList />}
            {section === 'reports' && <ReportsSection />}
            {section === 'automation' && <AutomationSection />}
            {section === 'settings' && <QASettingsSection />}
          </div>
        </main>
      </div>

      <TestCaseWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onSaved={() => { setCasesKey((k) => k + 1); setSection('cases'); }}
      />
      <JUnitImportDialog open={junitOpen} onOpenChange={setJunitOpen} />
    </div>
  );
}
