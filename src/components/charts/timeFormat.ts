// Axis time formatting for TimeSeriesChart: coarser labels for wider spans.
export function timeTickFormatter(span: number) {
  const day = 86_400_000;
  return (t: number) => {
    const d = new Date(t);
    if (span <= 15 * 60_000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (span <= day) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (span <= 7 * day) return `${d.toLocaleDateString([], { month: '2-digit', day: '2-digit' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    return d.toLocaleDateString([], { month: '2-digit', day: '2-digit' });
  };
}

const NICE_STEPS = [
  1_000, 5_000, 10_000, 15_000, 30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000,
  3_600_000, 2 * 3_600_000, 3 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000, 86_400_000, 2 * 86_400_000, 7 * 86_400_000,
  30 * 86_400_000,
];

/** Evenly spaced, round time ticks (aligned to local time) across [from, to]. */
export function timeTicks(from: number, to: number, target = 6): number[] {
  const span = to - from;
  if (!(span > 0)) return [];
  const step = NICE_STEPS.find((s) => span / s <= target) ?? NICE_STEPS[NICE_STEPS.length - 1];
  const tz = new Date(from).getTimezoneOffset() * 60_000; // align hour/day steps to local time
  let t = Math.ceil((from - tz) / step) * step + tz;
  const out: number[] = [];
  while (t <= to && out.length < 50) {
    out.push(t);
    t += step;
  }
  return out;
}
