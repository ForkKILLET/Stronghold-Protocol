// Best-effort local cache of the latest match; own-player accounting can be synced separately.
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
  const records = matched ? [...saved].map(([battleId,record])=>({...record,battleId})) : [];
  return combatRecordReader(records,{legacy:!cache?.matchId && saved.size>0,source:'local'});
}
export function combatRecordReader(records,metadata={}) {
  return {
    ...metadata,records,
    combatRounds({ownerId = null} = {}) {
      const expected=ownerId==null || ownerId===metadata.playerId?(metadata.fields || []).map(f=>f.round):[];
      return [...new Set([...expected,...records.filter(r=>ownerId == null || r.owners.includes(ownerId)).map(r=>r.round)])].sort((a,b)=>a-b);
    },
    combatMetrics({scope = 'match', ownerId = null, round = null} = {}) {
      return combineCombat(records.filter(r=>scope !== 'round' || r.round === round), ownerId);
    },
  };
}
/** Server snapshots win by battle ID, with local records filling gaps or a shorter partial collection. */
export function mergeCombatReader(local,server) {
  const ownerId=server.playerId,records=new Map();
  for(const record of local.records || []) if(record.owners.includes(ownerId)) records.set(record.battleId,record);
  for(const record of server.records) {
    const old=records.get(record.battleId);
    if(!old || record.complete || (!old.complete && record.seconds>=old.seconds)) records.set(record.battleId,record);
  }
  return combatRecordReader([...records.values()],{source:server.records.length?'server':'local',coverage:server.coverage,fields:server.fields,playerId:ownerId});
}
export function historyPage(rounds, selected) {
  const index = Math.max(0, rounds.includes(selected) ? rounds.indexOf(selected) : rounds.length - 1);
  return { round: rounds[index] ?? null, previous: rounds[index - 1] ?? null, next: rounds[index + 1] ?? null };
}
