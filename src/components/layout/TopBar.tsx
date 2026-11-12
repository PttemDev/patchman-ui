import { Sun, Moon, LogOut, Settings, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PatchmanLogo } from '@/components/PatchmanLogo';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '@/stores/themeStore';
import { useAuthStore } from '@/stores/authStore';
import { useProxyConfigStore } from '@/stores/proxyConfigStore';
import { useSettingsUIStore } from '@/stores/settingsUIStore';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EnvSelector } from '@/components/environment/EnvSelector';
import { Separator } from '@/components/ui/separator';
import { GlobalSearch } from '@/components/search/GlobalSearch';
import { WorkspaceSelector } from '@/components/workspace/WorkspaceSelector';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { SavedResponsesDialog } from '@/components/collections/SavedResponsesDialog';
import { ImportCurlDialog } from '@/components/request/ImportCurlDialog';
import { cn } from '@/lib/utils';
import { isDesktop } from '@/lib/platform';

export function TopBar() {
  const { t } = useTranslation(['layout', 'common']);
  const navigate = useNavigate();
  const { theme, toggle } = useThemeStore();
  const { user, logout } = useAuthStore();
  const proxyEnabled = useProxyConfigStore((s) => s.enabled && !!s.endpoint);
  const openSettings = useSettingsUIStore((s) => s.openSettings);
  const desktop = isDesktop();

  return (
    // Two explicit rows instead of flex-wrap acrobatics — at xl+ the
    // middle group (Import / Search / Workspace) sits on row 1 between
    // brand and right cluster; below xl it renders again as its own row
    // 2 with the row-1 copy hidden. Slight DOM duplication (two
    // ImportCurlDialog + two WorkspaceSelector instances live in the
    // tree at all times, only one is visible per media-query) is the
    // cost of avoiding the order/basis-full flex-wrap edge cases that
    // bled the right cluster onto the tab strip below TopBar.
    <div className="border-b bg-background shrink-0">
      {/* Row 1 — always present. Three logical sections at xl+:
            (1) Brand + Env on the left
            (2) Import + Search in the middle (flex-1, fills the gap)
            (3) Workspace on the right
          Vertical separators between groups make the structure read
          like a toolbar instead of one busy strip. */}
      {/* On the desktop shell the OS title bar is merged into this row
          (transparent overlay, see src-tauri): reserve space on the left for
          the traffic-light buttons and make the bar a drag region so the window
          can be moved by its empty areas (there's no separate title bar). */}
      <div
        data-tauri-drag-region={desktop ? true : undefined}
        className={cn('h-12 flex items-center gap-3 pr-4', desktop ? 'pl-[76px]' : 'pl-4')}
      >
        <div className="flex items-center gap-3 shrink-0" data-tauri-drag-region={desktop ? true : undefined}>
          {/* Brand doubles as the window drag handle on desktop — a grab cursor
              makes that discoverable. */}
          <div
            className={cn('flex items-center gap-2', desktop && 'cursor-grab select-none active:cursor-grabbing')}
            data-tauri-drag-region={desktop ? true : undefined}
          >
            <PatchmanLogo size={22} />
            <span className="font-bold text-lg tracking-tight" data-tauri-drag-region={desktop ? true : undefined}>PatchMan</span>
          </div>
          <Separator orientation="vertical" className="h-6" />
          <EnvSelector />
        </div>

        <Separator orientation="vertical" className="h-6 hidden xl:block shrink-0" />

        <div className="hidden xl:flex items-center gap-2 flex-1 min-w-0">
          <ImportCurlDialog />
          <div className="flex-1 min-w-0">
            <GlobalSearch />
          </div>
        </div>

        <Separator orientation="vertical" className="h-6 hidden xl:block shrink-0" />

        <div className="hidden xl:flex items-center gap-2 shrink-0">
          <WorkspaceSelector />
        </div>

        <Separator orientation="vertical" className="h-6 shrink-0" />

        <div className="flex items-center gap-2 shrink-0 xl:ml-0 ml-auto">
        {/* DownloadAppBadge + sync/data-source badge → Sidebar bottom dock.
            Settings + theme-toggle → Sidebar icon strip (with duplicated
            entries inside the user dropdown below for accessibility).
            TopBar now keeps only workspace + per-request controls +
            user menu. */}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <span className="text-sm">{user?.name || t('userMenu.userFallback')}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{user?.name}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {user?.role === 'admin' && (
              // Inline navigation rather than `window.open(..., '_blank')`
              // because the Tauri webview can't open a new tab — clicking
              // would silently no-op on desktop. Same behavior on web
              // keeps the two builds consistent; users who want a
              // separate tab can middle-click or open /admin manually.
              <DropdownMenuItem onClick={() => navigate('/admin')}>
                <Shield className="mr-2 h-4 w-4" />
                <span>{t('userMenu.adminPanel')}</span>
              </DropdownMenuItem>
            )}
            {/* Settings + theme are duplicated here (also in the
                Sidebar icon strip) so users who navigate via the user
                menu don't have to reach for the sidebar. */}
            <DropdownMenuItem onClick={() => openSettings()}>
              <Settings className="mr-2 h-4 w-4" />
              <span>{proxyEnabled ? t('settingsProxyOnShort') : t('common:settings')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={toggle}>
              {theme === 'light' ? (
                <Moon className="mr-2 h-4 w-4" />
              ) : (
                <Sun className="mr-2 h-4 w-4" />
              )}
              <span>{theme === 'light' ? t('darkMode') : t('lightMode')}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              <span>{t('userMenu.logout')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </div>

      {/* Row 2 — only when the viewport can't fit middle on row 1 (xl
          breakpoint = 1280px). Re-renders the Import / Search /
          Workspace trio as its own row so they get full width and don't
          fight the right cluster. */}
      <div className="xl:hidden flex items-center gap-2 px-4 pb-2">
        <ImportCurlDialog />
        <div className="flex-1 min-w-0">
          <GlobalSearch />
        </div>
        <WorkspaceSelector />
      </div>

      <SettingsDialog />
      <SavedResponsesDialog />
    </div>
  );
}
