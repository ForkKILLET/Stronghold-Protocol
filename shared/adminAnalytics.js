// Operations reports use Beijing calendar days, independently of host/browser time zones.
export const ANALYTICS_DAY_MS = 86400000;
const OFFSET = 8 * 3600000;
export const analyticsDay = at => Math.floor((at + OFFSET) / ANALYTICS_DAY_MS);
export const analyticsDate = day => new Date(day * ANALYTICS_DAY_MS).toISOString().slice(0, 10);

/** @param {{from?: string|null, to?: string|null}} [input] @param {number} [now] */
export function analyticsRange({from, to} = {}, now = Date.now()) {
  const today = analyticsDay(now);
  if (from == null && to == null) { from = analyticsDate(today - 29); to = analyticsDate(today); }
  const parse = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const day = Date.parse(value + 'T00:00:00Z') / ANALYTICS_DAY_MS;
    return Number.isInteger(day) && analyticsDate(day) === value ? day : NaN;
  };
  const first = parse(from), last = parse(to);
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last > today || last - first >= 366)
    throw Object.assign(Error('INPUT'), {status: 400});
  return {from, to, first, last, start: first * ANALYTICS_DAY_MS - OFFSET, end: (last + 1) * ANALYTICS_DAY_MS - OFFSET};
}
