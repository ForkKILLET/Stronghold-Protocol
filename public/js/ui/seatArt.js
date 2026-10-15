import { chessPortraitUrl } from './assetUrls.js';

/** FNV-1a of a string (the portrait pick: the same operator for a player on every client). */
function hash32(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * The operators a seat card can show: one record per charId (the elite form for its E2 art), 6★ first.
 * @param {any[]} chessList chess.json records
 * @returns {any[]}
 */
export function cardOperators(chessList) {
  const by = new Map();
  for (const c of Array.isArray(chessList) ? chessList : []) {
    if (!c || c.isDiy || c.isHidden || c.visible === false || typeof c.charId !== 'string') continue;
    const prev = by.get(c.charId);
    if (!prev || (c.isGolden && !prev.isGolden)) by.set(c.charId, c);
  }
  return [...by.values()].sort((a, b) => ((b.rarity ?? 0) - (a.rarity ?? 0)) || String(a.name).localeCompare(String(b.name), 'zh'));
}

/** Every viewer uses the seat owner's server-published choice, never their own local card. */
export function seatPortrait(seat, { pool, m }) {
  if (!seat || seat.playerId == null || !Array.isArray(pool) || !pool.length) return null;
  if (seat.isBot) return null;
  const chosen = pool.find((c) => c.charId === seat.card?.charId);
  if (chosen) return chessPortraitUrl(m, chosen);
  return chessPortraitUrl(m, pool[hash32(seat.playerId) % pool.length]);
}

/** Avatars always use the base official icon; an elite portrait choice cannot change another player's avatar. */
export function cardAvatarUrl(charId, m) {
  if (!charId || typeof charId !== 'string') return null;
  return m?.chars?.[charId]?.avatar || null;
}
