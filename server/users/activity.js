// A successful game hello and subsequent live frames/pongs record a real account once per Beijing day.
// Never count profile HTTP reads, administrator reads, unauthenticated sockets, bots, or retained offline sessions.
import {analyticsDay} from '../../shared/adminAnalytics.js';

export function createDailyActivity({users, log = console}) {
  const recorded = new Map(), pending = new Map();
  let currentDay = null, timer = null, inflight = null, closed = false;
  function schedule(delay = 250) {
    if (!closed && !timer) { timer = setTimeout(() => { timer = null; void flush(); }, delay); timer.unref?.(); }
  }
  async function flush() {
    clearTimeout(timer); timer = null;
    if (inflight) { await inflight; if (pending.size && !closed) schedule(); return; }
    inflight = (async () => {
      while (pending.size) {
        const entries = [...pending.entries()].slice(0, 256);
        try { await users.call('activity', {entries: entries.map(([, value]) => value)}); }
        catch { log.warn?.('[analytics] daily activity save deferred'); schedule(5000); return; }
        for (const [key, value] of entries) if (pending.get(key) === value) pending.delete(key);
      }
    })();
    try { await inflight; } finally { inflight = null; }
  }
  return {
    record(id, at, played = false) {
      if (closed || !users || !id || !Number.isSafeInteger(at)) return;
      const day = analyticsDay(at);
      if (currentDay !== day) { recorded.clear(); currentDay = day; }
      const previous = recorded.get(id);
      if (previous === true || (previous === false && !played)) return;
      if (pending.size >= 8192 || recorded.size >= 65536) { log.warn?.('[analytics] daily activity capacity reached'); return; }
      recorded.set(id, !!played); pending.set(day + ':' + id, {day, id, played: !!played}); schedule();
    },
    flush,
    async close() { closed = true; clearTimeout(timer); timer = null; await flush(); if (pending.size) await flush(); },
  };
}
