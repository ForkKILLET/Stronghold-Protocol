// Upstream statistics model shared by browser records and the private account store.
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const num = v => Number.isFinite(v) ? v : null;
const MAX_BONDS = 24;
export const isModdedRecord = rec => !!(isObj(rec) && rec.content);

const SELF_STATS = ['dmgDealt', 'kills', 'bossDamage', 'activatedLayers', 'merges', 'itemsEquipped', 'gold', 'perfectRounds', 'refreshes', 'leaks', 'lpLost'];

/**
 * The row that "is me" in a record: selfId, else the only human, else seat 0 — records written by
 * recordResult always have selfId; the fallbacks only serve imported / hand-made data.
 * @param {any} rec
 * @returns {any|null}
 */
export function selfRowOf(rec) {
  const ps = Array.isArray(rec?.players) ? rec.players : [];
  return ps.find((p) => p.playerId && p.playerId === rec.selfId)
    || ps.find((p) => !p.isBot)
    || ps[0]
    || null;
}

/** Whether this record counts as a win for its self player (per-row victory = team won AND still in). */
const selfWon = (rec, self) => (self ? !!self.victory : !!rec.victory);

/**
 * The rounds the player passed in a record: its own row's (the table the settlement prints per player), else the
 * team's; 0 when the record does not know.
 * @param {any} rec
 */
export function roundsOf(rec) {
  const self = selfRowOf(rec);
  const v = self && Number.isFinite(self.roundsPassed) ? self.roundsPassed : rec?.roundsPassed;
  return Number.isFinite(v) ? v : 0;
}

/**
 * Whether a record enters the aggregates (see the header). A settled record always does. A quit record does once the
 * player had finished at least one battle: cleared a round, or was already eliminated; a match given up before that —
 * entered and left right away — is history only.
 * @param {any} rec a normalized record
 * @returns {boolean}
 */
export function countsTowardStats(rec) {
  if (!isObj(rec)) return false;
  if (rec.end !== 'quit') return true;
  const self = selfRowOf(rec);
  if (!self) return false;
  return self.alive === false || (Number.isFinite(self.roundsPassed) && self.roundsPassed >= 1);
}

/** Active settlement bonds, deduplicated per player and bounded like imported bond rows. */
export function usedBondIdsOf(player) {
  const ids = Array.isArray(player?.usedBondIds) ? player.usedBondIds
    : (Array.isArray(player?.bonds) ? player.bonds : []).filter((b) => b?.active === true).map((b) => b.bondId);
  return [...new Set(ids.filter((id) => typeof id === 'string' && id.length).map((id) => id.slice(0, 64)))].slice(0, MAX_BONDS);
}

/** Strategy corner badges use official band victorCount thresholds; training awards no progress. */
export function strategyBadgeIds(records, bands) {
  const clears = new Map();
  for (const rec of Array.isArray(records) ? records : []) {
    if (!rec || rec.end === 'quit' || rec.difficulty === 'TRAINING' || rec.modeId === 'mode_training_1') continue;
    const self = selfRowOf(rec);
    if (!self?.bandId || !selfWon(rec, self)) continue;
    clears.set(self.bandId, (clears.get(self.bandId) || 0) + 1);
  }
  return Object.values(bands || {}).filter((band) => Number.isInteger(band.victorCount) && band.victorCount > 0
    && (clears.get(band.bandId) || 0) >= band.victorCount)
    .sort((a, b) => (a.sortId || 0) - (b.sortId || 0) || a.bandId.localeCompare(b.bandId))
    .map((band) => band.bandId);
}

/**
 * Aggregate records for the stats page — over the records that count; `total` / `excluded` say how many did not.
 * Everything is keyed by ids (bandId / titleId / difficulty); the page maps them to names and icons through the game
 * data. The combat totals read the settled records' stat blocks (a quit record has none). A match with gameplay plugins
 * is left out (`modded`: how many) unless `opts.modded` takes it in (see the header).
 * @param {any[]} records
 * @param {{ modded?: boolean }} [opts]
 * @returns {any}
 */
export function aggregateStats(records, { modded: withModded = false } = {}) {
  const all = Array.isArray(records) ? records : [];
  const official = withModded ? all : all.filter((r) => !isModdedRecord(r));
  const rs = official.filter(countsTowardStats);
  const out = {
    total: all.length, count: rs.length, excluded: official.length - rs.length, modded: all.length - official.length, wins: 0,
    rounds: { total: 0, max: 0 },
    duration: { totalMs: 0 },
    hidden: { reached: 0, cleared: 0 },
    trophies: 0,
    byDifficulty: {},
    byMode: { solo: { games: 0, wins: 0, hiddenCleared: 0 }, coop: { games: 0, wins: 0, hiddenCleared: 0 } },
    titles: {}, bands: {}, sums: {},
    bonds: Object.create(null),
    maxima: { gold: null, merges: null, kills: null },
  };
  for (const rec of rs) {
    const self = selfRowOf(rec);
    // Single-match records only use settled totals, never a partial quit or a teammate's row.
    if (rec.end !== 'quit' && self) {
      const values = { gold: self.stats?.gold, merges: self.stats?.merges, kills: self.creditedKills };
      for (const [key, value] of Object.entries(values)) {
        if (Number.isFinite(value) && value >= 0) out.maxima[key] = Math.max(out.maxima[key] ?? 0, value);
      }
    }
    const won = selfWon(rec, self);
    if (won) out.wins++;
    const rounds = roundsOf(rec);
    out.rounds.total += rounds;
    out.rounds.max = Math.max(out.rounds.max, rounds);
    out.duration.totalMs += num(rec.durationMs) || 0;
    if (rec.hiddenReached) out.hidden.reached++;
    if (rec.hiddenCleared) out.hidden.cleared++;
    // Sum the actual settlement award, including defeats, rather than teammates' or solo-mode trophies.
    if (rec.end !== 'quit' && rec.roomMode === 'coop' && Number.isFinite(self?.trophies)) out.trophies += Math.max(0, self.trophies);

    const d = rec.difficulty || 'UNKNOWN';
    const bd = (out.byDifficulty[d] ||= { games: 0, wins: 0, hiddenCleared: 0 });
    bd.games++;
    if (won) bd.wins++;
    if (rec.hiddenCleared) bd.hiddenCleared++;

    if (rec.roomMode === 'solo' || rec.roomMode === 'coop') {
      const mode = out.byMode[rec.roomMode];
      mode.games++;
      if (won) mode.wins++;
      if (won && rec.hiddenCleared) mode.hiddenCleared++;
    }

    const titleId = self?.title?.id;
    if (titleId) {
      const t = (out.titles[titleId] ||= { count: 0 });
      t.count++;
    }

    const bandId = self?.bandId;
    if (bandId) {
      const b = (out.bands[bandId] ||= { games: 0, wins: 0 });
      b.games++;
      if (won) b.wins++;
    }

    // [ASSUMED] Usage means active in the self player's settlement; once per match, irrespective of layers.
    if (rec.end !== 'quit') {
      for (const id of usedBondIdsOf(self)) {
        const bond = (out.bonds[id] ||= { games: 0 });
        bond.games++;
      }
    }

    if (rec.end !== 'quit' && self && isObj(self.stats)) {
      for (const k of SELF_STATS) {
        const v = self.stats[k];
        if (Number.isFinite(v)) out.sums[k] = (out.sums[k] || 0) + v;
      }
    }
  }
  return out;
}

/** Highest earned trophy tier from the official config, independent of the order of its medal rows. */
export function trophyMedalOf(total, medals) {
  const count = Number.isFinite(total) ? Math.max(0, total) : 0;
  return (Array.isArray(medals) ? medals : []).reduce((best, medal) =>
    Number.isFinite(medal?.count) && medal.count >= 0 && medal.count <= count && (!best || medal.count > best.count) ? medal : best, null);
}

/** All season members of TOP1, independent of the player's recruitment history. */
export function bondMemberChess(chess, bondId) {
  if (!bondId) return [];
  const seen = new Set();
  return (Array.isArray(chess) ? chess : []).filter((c) => {
    if (!c || c.isGolden || c.isHidden || c.isDiy || c.visible === false || !c.bonds?.includes(bondId)) return false;
    const key = `${c.charId}#${c.tier}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.tier - b.tier || (a.shopSortId || 0) - (b.shopSortId || 0) || a.chessId.localeCompare(b.chessId));
}

/** Convert one private server settlement to the existing statistics/replay shape. */
export function accountRecord(row) {
  const {frame, ...self} = row.payload || {};
  const modeId = frame?.modeId || row.mode;
  return {...frame, id:'account.'+row.id, matchId:row.id, t:row.endedAt,
    end:'settled', selfId:row.playerId, players:[{...self,playerId:row.playerId,victory:!!row.victory,roundsPassed:row.rounds}], difficulty:row.difficulty,
    modeId, roomMode:frame?.roomMode || (modeId?.includes('_single_')?'solo':modeId?.includes('_multi_')?'coop':null),
    roundsPassed:row.rounds, victory:row.victory, account:true, missingFrame:!frame};
}

/** Same-match local detail supplements the server's authoritative own-player result. */
export function mergeAccountHistory(local, remote, matchIds=[]) {
  const ids=new Set(matchIds);
  const locals=new Map(local.filter(r=>r.matchId).map(r=>[r.matchId,r]));
  const records=remote.map(row=>{
    const authoritative=accountRecord(row);const detail=locals.get(row.id);
    ids.add(row.id);
    if(!detail)return authoritative;
    return {...detail,...authoritative, players:[...detail.players.filter(p=>p.playerId!==row.playerId),authoritative.players[0]], compact:false};
  });
  for(const rec of local)if(!rec.matchId || !ids.has(rec.matchId))records.push({...rec,deviceOnly:true});
  return records.sort((a,b)=>b.t-a.t || a.id.localeCompare(b.id));
}
