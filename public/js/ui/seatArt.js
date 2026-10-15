import { chessPortraitUrl } from './assetUrls.js';
import { cardAvatarOperatorId, cardPortraitOperatorId } from '../../../shared/playerCard.js';

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
  const chosen = pool.find((c) => c.charId === cardPortraitOperatorId(seat.card?.charId));
  if (chosen) return cardPortraitUrl(seat.card.charId, m, chosen);
  return chessPortraitUrl(m, pool[hash32(seat.playerId) % pool.length]);
}

/** Explicit profile portraits are independent of battle skins and avatars, just like profile avatars. */
export function cardPortraitUrl(choice, m, operator = null) {
  const charId = cardPortraitOperatorId(choice);
  if (!charId) return null;
  return chessPortraitUrl(m, operator || { charId, isGolden: true }, { skin: choice !== charId ? choice : null });
}

export function cardPortraitSkins(charId, m, catalogue) {
  const list = catalogue?.chars?.[charId];
  return Array.isArray(list) ? list.filter((s) => cardPortraitOperatorId(s?.id) === charId && s.id !== charId
    && typeof m?.chars?.[charId]?.skins?.[s.id]?.portrait === 'string' && m.chars[charId].skins[s.id].portrait)
    .map((s) => ({ id: s.id, name: s.name, group: s.group || '' })) : [];
}

/** Resolve only manifest-listed avatars; a missing skin falls back to its operator's base icon. */
export function cardAvatarUrl(avatar, m) {
  const charId = cardAvatarOperatorId(avatar);
  if (!charId) return null;
  const rec = m?.chars?.[charId];
  return (avatar !== charId ? rec?.skins?.[avatar]?.avatar : null) || rec?.avatar || null;
}

/** Avatar files alone suffice: choosing a profile image never downloads or enables a battle skin model. */
export function cardAvatarSkins(charId, m, catalogue) {
  const list = catalogue?.chars?.[charId];
  if (!Array.isArray(list)) return [];
  return list.filter((skin) => cardAvatarOperatorId(skin?.id) === charId && skin.id !== charId
    && typeof m?.chars?.[charId]?.skins?.[skin.id]?.avatar === 'string' && m.chars[charId].skins[skin.id].avatar)
    .map((skin) => ({ id: skin.id, name: skin.name, group: skin.group || '' }));
}
