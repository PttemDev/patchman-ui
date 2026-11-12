// Day-first date formatting (DD/MM/YYYY, DD/MM/YYYY HH:mm) in the viewer's
// local time zone, independent of the browser locale — the admin screen
// wants one unambiguous order for every language. Not applied app-wide.

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "11/11/2026"; '' for a missing or invalid value. */
export function formatDate(value: DateInput): string {
  const d = toDate(value);
  if (!d) return '';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "11/11/2026 14:05" (24-hour); '' for a missing or invalid value. */
export function formatDateTime(value: DateInput): string {
  const d = toDate(value);
  if (!d) return '';
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * "5 minutes ago" / "yesterday" in the UI language for the last 30 days,
 * then the DD/MM/YYYY date. '' for a missing or invalid value.
 */
export function formatRelative(value: DateInput, lang: string, now: number = Date.now()): string {
  const d = toDate(value);
  if (!d) return '';
  const diff = (d.getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs >= 30 * 86400) return formatDate(d);
  let rtf: Intl.RelativeTimeFormat;
  try {
    rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  } catch {
    rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  }
  if (abs < 45) return rtf.format(Math.round(diff), 'second');
  if (abs < 45 * 60) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 22 * 3600) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

/** The later of two ISO timestamps (either may be missing). */
export function latestIso(a?: string | null, b?: string | null): string | undefined {
  const da = toDate(a);
  const db = toDate(b);
  if (!da) return db ? (b as string) : undefined;
  if (!db) return a as string;
  return db.getTime() > da.getTime() ? (b as string) : (a as string);
}
