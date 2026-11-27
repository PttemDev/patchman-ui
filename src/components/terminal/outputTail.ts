/**
 * Appends to a capped raw-output tail. Over `max`, keeps the last `max` chars
 * from the first line start, so a replay doesn't begin mid-line / mid-escape.
 */
export function appendTail(tail: string, data: string, max: number): string {
  const all = tail + data;
  if (all.length <= max) return all;
  const cut = all.slice(-max);
  const nl = cut.indexOf('\n');
  return nl === -1 ? cut : cut.slice(nl + 1);
}
