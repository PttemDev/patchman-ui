// About panel inside the Settings dialog. Shows the current app version,
// a pointer to the internal support channel, and (on the web build) a
// link to the desktop installer.

import { Trans, useTranslation } from 'react-i18next';
import { Zap, LifeBuoy } from 'lucide-react';
import { getAppVersion } from '@/lib/version';
import { isDesktop } from '@/lib/platform';
import { DownloadAppBadge } from '@/components/layout/DownloadAppBadge';

export function AboutSection() {
  const { t } = useTranslation('settings');
  const version = getAppVersion();
  const platform = isDesktop() ? t('about.desktop') : t('about.web');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t('about.heading')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('about.description')}
        </p>
      </div>

      <div className="rounded-lg border p-4 flex items-start gap-3">
        <Zap className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        <div className="space-y-1 flex-1">
          <div className="font-semibold">PatchMan</div>
          <div className="text-xs text-muted-foreground">
            {t('about.tagline')}
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">{t('about.versionLabel')}</dt>
            <dd className="font-mono">{version}</dd>
            <dt className="text-muted-foreground">{t('about.platformLabel')}</dt>
            <dd>{platform}</dd>
          </dl>
        </div>
      </div>

      {/* Internal support pointer. Surfacing the channel here means a
          user hitting a snag in QA or production has an obvious next
          step from inside the app instead of guessing where to ask. */}
      <div className="rounded-lg border p-4 flex items-start gap-3">
        <LifeBuoy className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        <div className="space-y-1 flex-1">
          <div className="font-semibold text-sm">{t('about.needHelp')}</div>
          <p className="text-sm text-muted-foreground">
            <Trans
              t={t}
              i18nKey="about.supportBody"
              components={{
                chan: <span className="font-mono px-1.5 py-0.5 rounded bg-muted text-foreground" />,
              }}
            />
          </p>
        </div>
      </div>

      {!isDesktop() && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {t('about.desktopPitch')}
          </p>
          <DownloadAppBadge variant="full" />
        </div>
      )}
    </div>
  );
}
