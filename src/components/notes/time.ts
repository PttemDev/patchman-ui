/** "11 Nov 2026, 14:05" in the UI language — for tooltips beside formatWhen. */
export function formatExact(iso: string | undefined, lang: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

/** Both times of a note for a tooltip: "Updated … · Created …". */
export function noteTimesTitle(n: { createdAt?: string; updatedAt?: string }, lang: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  return [n.updatedAt && t('times.updated', { when: formatExact(n.updatedAt, lang) }), n.createdAt && t('times.created', { when: formatExact(n.createdAt, lang) })]
    .filter(Boolean).join(' · ');
}

// "5 minutes ago" in the UI language (falls back to a date for old entries).
export function formatWhen(iso: string | undefined, lang: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = (t - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (abs < 45) return rtf.format(Math.round(diff), 'second');
  if (abs < 45 * 60) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 22 * 3600) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 7 * 86400) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(t).toLocaleDateString(lang, { year: 'numeric', month: 'short', day: 'numeric' });
}
