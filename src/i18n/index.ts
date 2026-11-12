import i18n, { type Resource, type ResourceLanguage } from 'i18next';
import { initReactI18next } from 'react-i18next';

// Supported languages. Add a new one here + drop its locale JSONs under
// src/i18n/locales/<lng>/<namespace>.json and it's picked up automatically.
export const SUPPORTED_LANGUAGES = ['en', 'tr', 'es', 'zh'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

// Native display names for the language picker.
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  tr: 'Türkçe',
  es: 'Español',
  zh: '中文',
};

export const LANGUAGE_STORAGE_KEY = 'patchman_lang';

// Auto-assemble the resource tree from every locale JSON. Each area/agent just
// drops src/i18n/locales/<lng>/<ns>.json files — no central registry to edit,
// so translation work parallelizes without touching a shared index.
const modules = import.meta.glob('./locales/*/*.json', { eager: true });
const resources: Resource = {};
const namespaceSet = new Set<string>();
for (const path in modules) {
  const m = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!m) continue;
  const [, lng, ns] = m;
  const bundle = (modules[path] as { default: ResourceLanguage[string] }).default;
  (resources[lng] ??= {})[ns] = bundle;
  namespaceSet.add(ns);
}
const namespaces = Array.from(namespaceSet);

function isSupported(lng: string | null | undefined): lng is Language {
  return !!lng && (SUPPORTED_LANGUAGES as readonly string[]).includes(lng);
}

/**
 * Resolve the language to boot with:
 *  1. An explicit choice the user saved before wins.
 *  2. Otherwise, if this looks like a RETURNING install (any prior PatchMan
 *     state in localStorage) but no language was ever set, stay on English —
 *     an update must not silently switch an existing user's UI language.
 *  3. Only a genuinely FRESH install (no prior state) follows the OS/browser
 *     language, mapped to one of the supported languages.
 *
 * Runs before any store hydrates (i18n is imported first in main.tsx), so on a
 * fresh install localStorage is still empty here.
 */
export function resolveInitialLanguage(): Language {
  try {
    const explicit = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isSupported(explicit)) return explicit;

    const hasPriorState = Object.keys(localStorage).some(
      (k) => k !== LANGUAGE_STORAGE_KEY && (k.startsWith('patchman') || k.startsWith('patchman-')),
    );
    if (hasPriorState) return 'en';

    const nav = (navigator.language || 'en').toLowerCase();
    const base = nav.split('-')[0];
    return isSupported(base) ? base : 'en';
  } catch {
    return 'en';
  }
}

i18n.use(initReactI18next).init({
  resources,
  lng: resolveInitialLanguage(),
  fallbackLng: 'en',
  ns: namespaces,
  defaultNS: 'common',
  fallbackNS: 'common',
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
});

/** Change the active language and persist the choice. */
export function setLanguage(lng: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch {
    /* ignore */
  }
  void i18n.changeLanguage(lng);
}

export default i18n;
