// Best-effort local cache of the latest match; never sent to the server.
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
export function saveCombatHistory(storage, matchKey, records) {
  if (!matchKey) return;
  try { storage?.setItem(HISTORY_KEY, JSON.stringify({ version: 1, matchKey, records: [...records].slice(-128) })); }
  catch { /* Private browsing, corrupt storage and quota limits cannot interrupt a battle. */ }
}
export function historyPage(rounds, selected) {
  const index = Math.max(0, rounds.includes(selected) ? rounds.indexOf(selected) : rounds.length - 1);
  return { round: rounds[index] ?? null, previous: rounds[index - 1] ?? null, next: rounds[index + 1] ?? null };
}
