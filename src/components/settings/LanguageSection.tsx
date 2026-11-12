import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SUPPORTED_LANGUAGES, LANGUAGE_NAMES, setLanguage, type Language } from '@/i18n';

// A flag glyph per language for a bit of visual weight. Flag↔language is
// imperfect (English isn't the UK) but it's the common language-picker cue.
const FLAGS: Record<Language, string> = {
  en: '🇬🇧',
  tr: '🇹🇷',
  es: '🇪🇸',
  zh: '🇨🇳',
};

// Language picker. Changing the language calls i18next's changeLanguage, which
// re-renders every component using useTranslation, and persists the choice.
export function LanguageSection() {
  const { t, i18n } = useTranslation('common');
  const current = (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0];

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t('language')}</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 max-w-xl">
        {SUPPORTED_LANGUAGES.map((lng: Language) => {
          const active = current === lng;
          return (
            <button
              key={lng}
              type="button"
              onClick={() => setLanguage(lng)}
              aria-pressed={active}
              className={cn(
                'group relative flex items-center gap-3 rounded-lg border p-3 text-left transition-all',
                active
                  ? 'border-primary bg-primary/5 ring-1 ring-primary shadow-sm'
                  : 'border-border hover:border-primary/40 hover:bg-accent/40',
              )}
            >
              <span className="text-2xl leading-none select-none">{FLAGS[lng]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {LANGUAGE_NAMES[lng]}
                </span>
                <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {lng}
                </span>
              </span>
              {active && (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
