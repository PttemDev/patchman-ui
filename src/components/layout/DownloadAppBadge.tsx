// "Get the desktop app" CTA for the web build.
//
// Renders nothing inside the Tauri shell (would be self-referential there).
// Points at `VITE_DESKTOP_DOWNLOAD_URL` — the latest installer hosted beside
// the web app.

import type { ComponentType, ReactNode } from 'react';
import { Download, Cloud, Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isDesktop } from '@/lib/platform';
import { getDesktopDownloadUrl } from '@/lib/version';
import { getRemoteBaseUrl } from '@/stores/remoteStore';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface DownloadAppBadgeProps {
  variant?: 'compact' | 'full';
  className?: string;
}

// Deep link that points an ALREADY-INSTALLED desktop app at THIS backend, so
// a user who installed the generic app doesn't have to type the URL — one
// click hands it the backend it was downloaded beside. Resolves a relative
// "/api" against this origin so the link always carries an absolute URL.
function connectDeepLink(): string {
  let base = getRemoteBaseUrl();
  if (base.startsWith('/') && typeof window !== 'undefined' && window.location?.origin) {
    base = window.location.origin + base;
  }
  return `patchman://connect?backend=${encodeURIComponent(base)}`;
}

// One step of the "download → install → connect" desktop setup guide: a
// numbered dot joined by a connector line, an icon+title, and the step's
// action/hint.
function SetupStep({
  n,
  title,
  icon: Icon,
  last,
  children,
}: {
  n: number;
  title: string;
  icon: ComponentType<{ className?: string }>;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
          {n}
        </div>
        {!last && <div className="my-1 w-px flex-1 bg-border" />}
      </div>
      <div className={`min-w-0 flex-1 pt-0.5 ${last ? '' : 'pb-3'}`}>
        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          {title}
        </div>
        <div className="mt-1 space-y-1.5">{children}</div>
      </div>
    </div>
  );
}

const STEP_ACTION_CLASS =
  'inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10';

export function DownloadAppBadge({ variant = 'compact', className }: DownloadAppBadgeProps) {
  const { t } = useTranslation('layout');
  if (isDesktop()) return null;
  const href = getDesktopDownloadUrl();

  if (variant === 'full') {
    return (
      <div className={`w-full rounded-lg border bg-card p-4 ${className ?? ''}`}>
        <div className="mb-3 text-sm font-semibold text-foreground">{t('download.steps.heading')}</div>
        <SetupStep n={1} title={t('download.steps.step1Title')} icon={Download}>
          <a href={href} className={STEP_ACTION_CLASS}>
            <Download className="h-3.5 w-3.5" />
            {t('download.steps.step1Action')}
          </a>
        </SetupStep>
        <SetupStep n={2} title={t('download.steps.step2Title')} icon={Package}>
          <p className="text-xs text-muted-foreground">{t('download.steps.step2Desc')}</p>
        </SetupStep>
        <SetupStep n={3} title={t('download.steps.step3Title')} icon={Cloud} last>
          <p className="text-xs text-muted-foreground">{t('download.steps.step3Desc')}</p>
          <a href={connectDeepLink()} className={STEP_ACTION_CLASS}>
            <Cloud className="h-3.5 w-3.5" />
            {t('download.steps.step3Action')}
          </a>
        </SetupStep>
      </div>
    );
  }

  // Below `lg` the label drops out so the TopBar never has to collide with
  // the URL bar / workspace selector at typical browser widths. The icon
  // stays in the same border/tone container so the badge still reads as a
  // tappable CTA; the tooltip explains it.
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={href}
            className={`hidden sm:inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 ${className ?? ''}`}
          >
            <Download className="h-3 w-3" />
            <span className="hidden 2xl:inline">{t('download.getApp')}</span>
          </a>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{t('download.tooltip')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
