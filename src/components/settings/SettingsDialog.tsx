import { Globe, Info, ScrollText, Download, GitBranch, Database, Bot, Keyboard, Languages, Cloud, Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { isDesktop } from '@/lib/platform';
import { useSettingsUIStore, type SettingsSection } from '@/stores/settingsUIStore';
import { useUpdateStore } from '@/stores/updateStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ProxySection } from './ProxySection';
import { IntegrationsSection } from './IntegrationsSection';
import { MCPSection } from './MCPSection';
import { DataSection } from './DataSection';
import { AboutSection } from './AboutSection';
import { ChangelogSection } from './ChangelogSection';
import { UpdatesSection } from './UpdatesSection';
import { KeymapSection } from './KeymapSection';
import { LanguageSection } from './LanguageSection';
import { RemoteSection } from './RemoteSection';
import { AppearanceSection } from './AppearanceSection';

interface SectionDef {
  id: SettingsSection;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  render: () => React.ReactNode;
}

const ALL_SECTIONS: SectionDef[] = [
  { id: 'keymap', labelKey: 'settings:nav.shortcuts', icon: Keyboard, render: () => <KeymapSection /> },
  { id: 'appearance', labelKey: 'settings:nav.appearance', icon: Palette, render: () => <AppearanceSection /> },
  { id: 'language', labelKey: 'common:language', icon: Languages, render: () => <LanguageSection /> },
  { id: 'remote', labelKey: 'settings:nav.remote', icon: Cloud, render: () => <RemoteSection /> },
  { id: 'proxy', labelKey: 'settings:nav.proxy', icon: Globe, render: () => <ProxySection /> },
  { id: 'integrations', labelKey: 'settings:nav.integrations', icon: GitBranch, render: () => <IntegrationsSection /> },
  { id: 'mcp', labelKey: 'settings:nav.mcp', icon: Bot, render: () => <MCPSection /> },
  { id: 'data', labelKey: 'settings:nav.data', icon: Database, render: () => <DataSection /> },
  { id: 'updates', labelKey: 'settings:nav.updates', icon: Download, render: () => <UpdatesSection /> },
  { id: 'about', labelKey: 'settings:nav.about', icon: Info, render: () => <AboutSection /> },
  { id: 'changelog', labelKey: 'settings:nav.changelog', icon: ScrollText, render: () => <ChangelogSection /> },
];

// Updates is desktop-only; Data is shown everywhere but its content adapts
// (web build explains there's nothing to switch since there's no embedded BE).
const SECTIONS: SectionDef[] = ALL_SECTIONS.filter(
  (s) => s.id !== 'updates' || isDesktop(),
);

export function SettingsDialog() {
  const { t } = useTranslation('settings');
  const open = useSettingsUIStore((s) => s.open);
  const section = useSettingsUIStore((s) => s.section);
  const closeSettings = useSettingsUIStore((s) => s.closeSettings);
  const setSection = useSettingsUIStore((s) => s.setSection);

  const updateAvailable = useUpdateStore((s) => s.available);

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? null : closeSettings())}>
      <DialogContent className="max-w-3xl w-[min(48rem,calc(100vw-2rem))] p-0 gap-0 overflow-hidden grid-cols-[minmax(0,1fr)]">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('common:settings')}</DialogTitle>
        </DialogHeader>
        <div className="flex h-[min(85vh,660px)] min-h-[420px] min-w-0 w-full">
          {/* Sidebar */}
          <nav className="w-48 border-r bg-muted/30 p-2 shrink-0">
            <div className="px-2 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {t('common:settings')}
            </div>
            <ul className="space-y-0.5">
              {SECTIONS.map((s) => {
                const Icon = s.icon;
                const isActive = s.id === section;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSection(s.id)}
                      className={cn(
                        'w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors',
                        isActive
                          ? 'bg-background text-foreground font-medium shadow-sm'
                          : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {t(s.labelKey)}
                      {s.id === 'updates' && updateAvailable && (
                        <span className="ml-auto h-2 w-2 rounded-full bg-amber-500" title={t('nav.updateAvailable')} />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Content */}
          <div className="flex-1 min-w-0 overflow-y-auto p-6">{active.render()}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
