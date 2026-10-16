// Pure record adapters and aggregates shared by the account store and browser history.
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const num = v => Number.isFinite(v) ? v : null;
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

/**
 * Aggregate records for the stats page — over the records that count; `total` / `excluded` say how many did not.
 * Everything is keyed by ids (bandId / titleId / difficulty); the page maps them to names and icons through the game
 * data. The combat totals read the settled records' stat blocks (a quit record has none).
 * @param {any[]} records
 * @returns {any}
 */
export function aggregateStats(records) {
  const all = Array.isArray(records) ? records : [];
  const rs = all.filter(countsTowardStats);
  const out = {
    total: all.length, count: rs.length, excluded: all.length - rs.length, wins: 0,
    rounds: { total: 0, max: 0 },
    duration: { totalMs: 0 },
    hidden: { reached: 0, cleared: 0 },
    byDifficulty: {}, byMode: { solo: 0, coop: 0 },
    titles: {}, bands: {}, sums: {},
  };
  for (const rec of rs) {
    const self = selfRowOf(rec);
    const won = selfWon(rec, self);
    if (won) out.wins++;
    const rounds = roundsOf(rec);
    out.rounds.total += rounds;
    out.rounds.max = Math.max(out.rounds.max, rounds);
    out.duration.totalMs += num(rec.durationMs) || 0;
    if (rec.hiddenReached) out.hidden.reached++;
    if (rec.hiddenCleared) out.hidden.cleared++;

    const d = rec.difficulty || 'UNKNOWN';
    const bd = (out.byDifficulty[d] ||= { games: 0, wins: 0, hiddenCleared: 0 });
    bd.games++;
    if (won) bd.wins++;
    if (rec.hiddenCleared) bd.hiddenCleared++;

    if (rec.roomMode === 'solo' || rec.roomMode === 'coop') out.byMode[rec.roomMode]++;

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

    if (rec.end !== 'quit' && self && isObj(self.stats)) {
      for (const k of SELF_STATS) {
        const v = self.stats[k];
        if (Number.isFinite(v)) out.sums[k] = (out.sums[k] || 0) + v;
      }
    }
  }
  return out;
}

/** Convert one private server settlement to the existing statistics/replay shape. */
export function accountRecord(row) {
  const {frame, ...self} = row.payload || {};
  const modeId = frame?.modeId || row.mode;
  return {...frame, id:'account.'+row.id, matchId:row.id, t:row.endedAt,
    end:'settled', selfId:row.playerId, players:[{...self,playerId:row.playerId,victory:!!row.victory,roundsPassed:row.rounds}], difficulty:row.difficulty,
    modeId, roomMode:modeId?.includes('_single_')?'solo':modeId?.includes('_multi_')?'coop':null,
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
