// Per-operator leader-pool rows carried on b.progress `ops` (DESIGN §14). The sim stays free of this module.

/** At most this many rows on one field's report. A field's global top 3 cannot fall past the cut. */
export const LEADER_OPS_MAX = 48;

const ID_RE = /^[A-Za-z0-9_\-.:]+$/;
const UID_MAX = 2 ** 31;
const BIG = 1e13;

function okId(v) {
  return typeof v === 'string' && v.length >= 1 && v.length <= 64 && ID_RE.test(v);
}

/**
 * Protocol-safe cumulative rows. Drops a bad id, sorts by damage then uid, and keeps {@link LEADER_OPS_MAX}.
 * Duplicate uids stay — the server keeps the larger one. `null` when nothing remains.
 * @param {unknown} ops
 * @returns {Array<{ uid: number, pid: string, chess: string, tier: number, dmg: number }>|null}
 */
export function leaderOpsRows(ops) {
  if (!Array.isArray(ops) || ops.length === 0) return null;
  const rows = [];
  for (const row of ops) {
    if (!row || typeof row !== 'object') continue;
    const uid = row.uid;
    const dmg = Number(row.dmg);
    if (!Number.isInteger(uid) || uid < 1 || uid > UID_MAX) continue;
    if (!okId(row.pid) || !okId(row.chess)) continue;
    if (!Number.isFinite(dmg) || dmg < 0 || dmg > BIG) continue;
    const tier = Number.isInteger(row.tier) ? Math.max(0, Math.min(10, row.tier)) : 0;
    rows.push({ uid, pid: row.pid, chess: row.chess, tier, dmg });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => (b.dmg - a.dmg) || (a.uid - b.uid));
  return rows.length > LEADER_OPS_MAX ? rows.slice(0, LEADER_OPS_MAX) : rows;
}

/**
 * Rows to put on b.progress. A function (the in-page battle) or the array the worker already copied.
 * Sends nothing when the list is empty, so a message without `ops` stays valid.
 * @param {object|null|undefined} battle
 */
export function leaderOpsFromBattle(battle) {
  if (!battle) return null;
  const raw = battle.leaderHits;
  const hits = typeof raw === 'function' ? raw.call(battle) : (Array.isArray(raw) ? raw : null);
  return leaderOpsRows(hits);
}

/** Bounded, optional settlement charts. Older records have no charts; do not guess them from total damage. */
export function leaderHistoryRows(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const kind of ['boss', 'hidden']) {
    const r = value.find(r => r?.kind === kind);
    if (!r || !Number.isFinite(r.maxHp) || r.maxHp <= 0) continue;
    const players = (Array.isArray(r.players) ? r.players : []).slice(0, 4)
      .filter(p => p && okId(p.playerId)).map(p => ({ playerId: p.playerId,
        name: typeof p.name === 'string' ? p.name.slice(0, 64) : p.playerId,
        ...(okId(p.avatarId) ? { avatarId: p.avatarId } : {}) }));
    const rows = (leaderOpsRows(Array.isArray(r.rows) ? r.rows.slice(0, 3) : null) || []);
    const entry = { kind, bossId: okId(r.bossId) ? r.bossId : null, maxHp: r.maxHp, rows, players };
    const playerRows = Array.isArray(r.playerRows) ? r.playerRows.slice(0, 4)
      .filter(p => p && okId(p.pid) && Number.isFinite(p.dmg) && p.dmg >= 0)
      .map(p => ({ pid: p.pid, dmg: p.dmg, ...(leaderOpsRows([p])?.[0] || {}) })) : null;
    out.push({ ...entry, ...(playerRows ? { playerRows } : {}) });
  }
  return out;
}
