import {analyticsRange} from '../../shared/adminAnalytics.js';

export const analyticsQuery = (params, now = Date.now()) => {
  const {from, to} = analyticsRange({from: params.get('from'), to: params.get('to')}, now);
  return {from, to};
};

// Cache only completed, successful aggregates; never turn storage failure into an empty report.
export function createAdminAnalytics({users, now = Date.now}) {
  const cache = new Map();
  return async input => {
    if (!users) throw Object.assign(Error('UNAVAILABLE'), {status: 503});
    const {from, to} = analyticsRange(input, now()), key = from + ':' + to;
    const old = cache.get(key);
    if (old && now() - old.at < 30000) return old.value;
    if (cache.size >= 8) cache.delete(cache.keys().next().value);
    const value = users.call('adminAnalytics', {from, to});
    const entry = {at: now(), value}; cache.set(key, entry);
    try { return await value; } catch (error) { if (cache.get(key) === entry) cache.delete(key); throw error; }
  };
}
