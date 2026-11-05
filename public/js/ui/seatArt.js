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

export function cardContext(list) {
  return {
    byChar: new Map(list.map((c) => [c.charId, c])),
    pool: list.filter((c) => (c.rarity ?? 0) >= 5).sort((a, b) => (a.charId < b.charId ? -1 : a.charId > b.charId ? 1 : 0)),
  };
}

/**
 * The operator on a seat card: the player's pick (one's own seat shows the local pick at once, the others the server's
 * seats[].card), else one of the pool chosen by the player id [ASSUMED, see the header]. null for an empty seat, a bot,
 * or before the data loads.
 * @param {any} seat room.state seat
 * @param {{ byChar: Map<string, any>, pool: any[] }} ctx cardContext()
 * @param {{ myId?: any, myCard?: string }} [own]
 * @returns {{ chess: any, picked: boolean } | null}
 */
export function seatOperator(seat, { byChar, pool }, { myId, myCard } = {}) {
  if (!seat || seat.playerId == null || seat.isBot) return null;
  const choice = (seat.playerId === myId ? myCard : seat.card);
  const pick = cardPortraitOperatorId(choice?.charId || choice || '');
  const rec = pick && byChar ? byChar.get(pick) : null;
  if (rec) return { chess: rec, picked: true };
  if (!Array.isArray(pool) || !pool.length) return null;
  return { chess: pool[hash32(seat.playerId) % pool.length], picked: false };
}

/**
 * The outfit a seat card's operator wears (docs/SKINS.md; the maintainer's decision 4 of 2026-10-21), by the rule of
 * every owner-aware card (ui/skins.js ownerSkin): one's own card wears this browser's choice at once (`localSkins`),
 * another doctor's the choice that seat published — `players` holds `{ playerId, skins }`: the room's seats
 * (room.state seats[].skins) or a match's public players — unless 「显示其他玩家的皮肤」 is off. null = the default art;
 * a skinId the local manifest does not hold (an appearance plugin this page lacks) also draws the default
 * (ui/assetUrls.js chessPortraitUrl falls back).
 * @param {any} seat a seat or player record (`playerId`, `isBot`)
 * @param {string | null | undefined} charId the operator the card shows (seatOperator)
 * @param {{ myId?: any, localSkins?: Record<string, string>, players?: any[], otherSkins?: boolean }} ctx
 * @returns {string | null}
 */
export function seatCardSkin(seat, charId, { myId = null, localSkins = {}, players = [], otherSkins = true } = {}) {
  if (!seat || seat.isBot || seat.playerId == null || !charId) return null;
  const choice = seat.card?.charId;
  return choice && cardPortraitOperatorId(choice) === charId && choice !== charId ? choice : null;
}

/**
 * The picture a seat card draws: the first of `srcs` — the outfit's portrait, then the operator's default portrait — that
 * has not failed to load in this card (`failed`); null when none is left, and the card shows its avatar frame (§35.18's
 * leftover: an outfit file that failed went straight to the frame).
 * @param {(string | null | undefined)[]} srcs in order of preference
 * @param {readonly string[]} [failed]
 * @returns {string | null}
 */
export function seatArtSrc(srcs, failed = []) {
  for (const src of Array.isArray(srcs) ? srcs : []) if (src && !failed.includes(src)) return src;
  return null;
}
