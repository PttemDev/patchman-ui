import type { TFunction } from 'i18next';

// cronText describes the common 5-field cron shapes in words ("Every day at
// 03:00", "Every 15 minutes", "Mon–Fri at 09:30"); anything else returns ''
// and the raw expression is shown alone. Weekday names come from Intl, so
// they follow the UI language. Keys: git:ci.cron.*.
export function cronText(expr: string, t: TFunction, lang: string): string {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return '';
  const [min, hour, dom, mon, dow] = f;
  const num = (s: string) => /^\d+$/.test(s);
  const at = () => `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  const day = (d: number) =>
    new Intl.DateTimeFormat(lang, { weekday: 'short' }).format(new Date(Date.UTC(2024, 0, 7 + (d % 7), 12)));
  const days = (s: string): string => {
    const parts = s.split(',');
    const out: string[] = [];
    for (const p of parts) {
      const r = p.match(/^(\d)-(\d)$/);
      if (r) out.push(`${day(+r[1])}–${day(+r[2])}`);
      else if (num(p)) out.push(day(+p));
      else return '';
    }
    return out.join(', ');
  };
  if (mon !== '*') return '';
  if (min === '*' && hour === '*' && dom === '*' && dow === '*') return t('ci.cron.everyMinute');
  const everyMin = min.match(/^\*\/(\d+)$/);
  if (everyMin && hour === '*' && dom === '*' && dow === '*') return t('ci.cron.everyNMinutes', { count: +everyMin[1] });
  const everyHour = hour.match(/^\*\/(\d+)$/);
  if (num(min) && everyHour && dom === '*' && dow === '*') return t('ci.cron.everyNHours', { count: +everyHour[1], minute: min.padStart(2, '0') });
  if (num(min) && hour === '*' && dom === '*' && dow === '*') return t('ci.cron.everyHour', { minute: min.padStart(2, '0') });
  if (!num(min) || !num(hour)) return '';
  if (dom === '*' && dow === '*') return t('ci.cron.daily', { time: at() });
  if (dom === '*') {
    const d = days(dow);
    return d ? t('ci.cron.weekly', { days: d, time: at() }) : '';
  }
  if (num(dom) && dow === '*') return t('ci.cron.monthly', { day: dom, time: at() });
  return '';
}
