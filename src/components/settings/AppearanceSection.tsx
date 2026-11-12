import { useTranslation } from 'react-i18next';
import { Check, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useThemeStore } from '@/stores/themeStore';
import { THEME_PRESETS, type ThemeBase } from '@/lib/themes';
import { Switch } from '@/components/ui/switch';
import { useSidebarStore } from '@/stores/sidebarStore';
import { useAuthStore } from '@/stores/authStore';
import { isDesktop } from '@/lib/platform';
import { sidebarTabs, platformHiddenTabs } from '@/components/layout/Sidebar';

// Theme picker: Light presets and Dark presets, each a swatch + name. Clicking a
// card applies it live (themeStore.setPreset). The star on a card marks it the
// TOGGLE default for its base — the preset the light/dark switch lands on — so a
// user can make the switch's dark land on Ocean, its light on Paper, etc.
export function AppearanceSection() {
  const { t } = useTranslation(['settings', 'layout']);
  const preset = useThemeStore((s) => s.preset);
  const setPreset = useThemeStore((s) => s.setPreset);
  const switchDefault = useThemeStore((s) => s.switchDefault);
  const setSwitchDefault = useThemeStore((s) => s.setSwitchDefault);

  const hiddenTabs = useSidebarStore((s) => s.hiddenTabs);
  const setTabHidden = useSidebarStore((s) => s.setTabHidden);
  const isLocal = useAuthStore((s) => s.mode === 'local');
  // Only offer items reachable on this platform/mode — no point toggling one
  // the platform gating hides anyway.
  const platformHidden = platformHiddenTabs(isLocal, isDesktop());
  const availableTabs = sidebarTabs.filter((tab) => !platformHidden.has(tab.id));
  const visibleCount = availableTabs.filter((tab) => !hiddenTabs.includes(tab.id)).length;

  const groups: { base: ThemeBase; label: string }[] = [
    { base: 'light', label: t('appearance.light') },
    { base: 'dark', label: t('appearance.dark') },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">{t('appearance.heading')}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{t('appearance.description')}</p>
        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
          <Star className="h-3 w-3" />
          {t('appearance.defaultHint')}
        </p>
      </div>

      {groups.map((g) => (
        <div key={g.base} className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {THEME_PRESETS.filter((p) => p.base === g.base).map((p) => {
              const active = preset === p.id;
              const isDefault = switchDefault[p.base] === p.id;
              return (
                <div
                  key={p.id}
                  className={cn(
                    'flex items-center gap-1 rounded-lg border pr-1 transition-colors',
                    active ? 'border-primary ring-1 ring-primary' : 'border-border',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setPreset(p.id)}
                    aria-pressed={active}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-l-lg p-2 text-left hover:bg-accent"
                  >
                    <span
                      className="h-8 w-8 shrink-0 rounded-md border border-border"
                      style={{ backgroundColor: p.swatch }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{t(`appearance.presets.${p.id}`)}</span>
                    {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSwitchDefault(p.base, p.id)}
                    aria-pressed={isDefault}
                    title={isDefault ? t('appearance.isDefault') : t('appearance.setDefault')}
                    className={cn(
                      'shrink-0 rounded-md p-1.5 transition-colors',
                      isDefault ? 'text-primary' : 'text-muted-foreground/50 hover:text-foreground hover:bg-accent',
                    )}
                  >
                    <Star className={cn('h-4 w-4', isDefault && 'fill-current')} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="space-y-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('appearance.sidebarHeading')}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{t('appearance.sidebarDescription')}</p>
        </div>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {availableTabs.map((tab) => {
            const Icon = tab.icon;
            const visible = !hiddenTabs.includes(tab.id);
            // Never let the user hide the last remaining item — that would
            // leave the rail empty with nothing to click back on.
            const lockOn = visible && visibleCount <= 1;
            return (
              <label
                key={tab.id}
                className={cn(
                  'flex items-center gap-2 rounded-lg border border-border p-2',
                  lockOn ? 'opacity-60' : 'cursor-pointer hover:bg-accent',
                )}
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{t(`layout:tabs.${tab.id}`)}</span>
                <Switch
                  checked={visible}
                  disabled={lockOn}
                  onCheckedChange={(v) => setTabHidden(tab.id, !v)}
                />
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
