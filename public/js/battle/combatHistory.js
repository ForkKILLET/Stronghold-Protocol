// Best-effort local cache of the latest match; never sent to the server.
import {combineCombat} from './metrics.js';
export const HISTORY_KEY = 'sp.combat-history.v1';
export function loadCombatHistory(storage, matchKey) {
  try {
    const data = JSON.parse(storage?.getItem(HISTORY_KEY) || 'null');
    if (data?.version !== 1 || data.matchKey !== matchKey || !Array.isArray(data.records)) return new Map();
    return new Map(data.records.slice(-128).filter((entry) => Array.isArray(entry) && typeof entry[0] === 'string'
      && Number.isInteger(entry[1]?.round) && Array.isArray(entry[1]?.rows) && Array.isArray(entry[1]?.owners)
      && entry[1].rows.every(row => row && typeof row.ownerId === 'string' && typeof row.defId === 'string'
        && row.types && Number.isFinite(row.damage) && Number.isFinite(row.healing))
      && Number.isFinite(entry[1]?.seconds) && entry[1].seconds >= 0));
  } catch { return new Map(); }
}
export function saveCombatHistory(storage, matchKey, records, {matchId = null} = {}) {
  if (!matchKey) return;
  try { storage?.setItem(HISTORY_KEY, JSON.stringify({ version: 1, matchKey, ...(matchId?{matchId}:{}), records: [...records].slice(-128) })); }
  catch { /* Private browsing, corrupt storage and quota limits cannot interrupt a battle. */ }
}
/** A frozen, match-scoped reader for history views; never consult the live runner or adopt another match's cache. */
export function archivedCombatReader(storage, {matchId, matchKey = null} = {}) {
  let cache;
  try { cache = JSON.parse(storage?.getItem(HISTORY_KEY) || 'null'); } catch { /* unavailable */ }
  const saved = cache?.version === 1 ? loadCombatHistory(storage, cache.matchKey) : new Map();
  const matched = !!(matchId && cache?.matchId === matchId)
    || !!(!cache?.matchId && matchKey && cache?.matchKey === matchKey);
  const records = matched ? [...saved.values()] : [];
  return {
    legacy: !cache?.matchId && saved.size > 0,
    combatRounds({ownerId = null} = {}) {
      return [...new Set(records.filter(r=>ownerId == null || r.owners.includes(ownerId)).map(r=>r.round))].sort((a,b)=>a-b);
    },
    combatMetrics({scope = 'match', ownerId = null, round = null} = {}) {
      return combineCombat(records.filter(r=>scope !== 'round' || r.round === round), ownerId);
    },
  };
}
export function historyPage(rounds, selected) {
  const index = Math.max(0, rounds.includes(selected) ? rounds.indexOf(selected) : rounds.length - 1);
  return { round: rounds[index] ?? null, previous: rounds[index - 1] ?? null, next: rounds[index + 1] ?? null };
}
