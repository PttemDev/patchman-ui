import { useTranslation } from 'react-i18next';
import { CHANGELOG } from '@/data/changelog';

export function ChangelogSection() {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-4 h-full flex flex-col min-h-0 min-w-0">
      <div className="shrink-0">
        <h2 className="text-lg font-semibold">{t('changelog.heading')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('changelog.description')}
        </p>
      </div>

      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto pr-2">
        <ol className="space-y-4">
          {CHANGELOG.map((entry) => (
            <li key={entry.version} className="rounded-lg border p-4 min-w-0">
              <div className="flex items-baseline justify-between gap-2 min-w-0">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="font-mono font-semibold shrink-0">v{entry.version}</span>
                  {entry.title && (
                    <span className="text-sm text-muted-foreground truncate">
                      {entry.title}
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{entry.date}</span>
              </div>
              <ul className="mt-2 space-y-1 text-sm list-disc pl-5 marker:text-muted-foreground">
                {entry.changes.map((change, i) => (
                  <li key={i} className="break-words">{change}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
