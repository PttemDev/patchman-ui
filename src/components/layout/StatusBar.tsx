import { useTranslation } from 'react-i18next';
import { ArrowUpCircle, Cloud, Database, Laptop } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isDesktop } from '@/lib/platform';
import { getAppVersion } from '@/lib/version';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsUIStore } from '@/stores/settingsUIStore';
import { useUpdateStore } from '@/stores/updateStore';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DownloadAppBadge } from './DownloadAppBadge';

// StatusBar — the thin always-visible strip under the main pane (VS Code
// style). Holds global status that used to crowd the left sidebar: the sync /
// data-source badge, the "get the desktop app" CTA (web only), the update
// nudge and the app version (click → changelog). Same height as the sidebar's
// bottom strip so the two read as one continuous bar.
export function StatusBar() {
  const { t } = useTranslation('layout');
  const isLocal = useAuthStore((s) => s.mode === 'local');
  const dataSource = useAuthStore((s) => s.dataSource);
  const openSettings = useSettingsUIStore((s) => s.openSettings);
  const updateAvailable = useUpdateStore((s) => s.available);
  const updateVersion = useUpdateStore((s) => s.info?.version);
  const desktop = isDesktop();

  // Three meaningful sync states (was SidebarFooter's badge).
  const badge = isLocal
    ? { label: t('syncBadge.localLabel'), sub: t('syncBadge.localSub'), tip: t('syncBadge.localTooltip'), icon: Laptop, tone: 'text-muted-foreground' }
    : dataSource === 'local'
      ? { label: t('syncBadge.localDbLabel'), sub: t('syncBadge.localDbSub'), tip: t('syncBadge.localDbTooltip'), icon: Database, tone: 'text-amber-600 dark:text-amber-400' }
      : { label: t('syncBadge.syncedLabel'), sub: t('syncBadge.syncedSub'), tip: t('syncBadge.syncedTooltip'), icon: Cloud, tone: 'text-green-600 dark:text-green-400' };
  const BadgeIcon = badge.icon;
  const item = 'h-full flex items-center gap-1 px-2 rounded-sm hover:bg-accent transition-colors cursor-pointer';

  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-7 shrink-0 border-t bg-muted/30 flex items-center justify-between px-1 py-0.5 text-[11px] text-muted-foreground select-none">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => {
                if (desktop) openSettings('data');
                else if (isLocal) window.location.href = '/login';
              }}
              className={cn(item, badge.tone)}
            >
              <BadgeIcon className="h-3 w-3 shrink-0" />
              <span className="font-medium">{badge.label}</span>
              <span className="text-muted-foreground/60">·</span>
              <span className="text-muted-foreground truncate">{badge.sub}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top"><p className="text-xs">{badge.tip}</p></TooltipContent>
        </Tooltip>

        <div className="h-full flex items-center gap-1">
          {/* Renders nothing inside the desktop shell. */}
          <DownloadAppBadge />
          {updateAvailable && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => openSettings('updates')}
                  className={cn(item, 'font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/10')}
                >
                  <ArrowUpCircle className="h-3 w-3 shrink-0" />
                  {t('statusBar.updateAvailable')}
                  {updateVersion && <span className="font-mono">v{updateVersion}</span>}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top"><p className="text-xs">{t('updateTooltip')}</p></TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => openSettings('changelog')} className={cn(item, 'font-mono')}>
                v{getAppVersion()}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top"><p className="text-xs">{t('statusBar.changelogTooltip')}</p></TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
