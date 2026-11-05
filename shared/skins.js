// Cosmetic preferences only: never change operator definitions or simulation rules.
export const SKIN_LIMITS = Object.freeze({ entries: 256, idLen: 64 });
export const isSkinId = (v) => typeof v === 'string' && v.length > 0
  && v.length <= SKIN_LIMITS.idLen && /^[A-Za-z0-9_@#+.\-]+$/.test(v);
const isChessId = (v) => /^[A-Za-z0-9_\-.:]{1,64}$/.test(v)
  && !['__proto__', 'constructor', 'prototype'].includes(v);

/** Bound and clean browser preferences / older checkpoints without trusting their shape. */
export function cleanSkins(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, skin] of Object.entries(raw)) {
    if (!isChessId(id) || !isSkinId(skin)) continue;
    out[id] = skin;
    if (Object.keys(out).length === SKIN_LIMITS.entries) break;
  }
  return out;
}

/** Normal appearances use stable operator IDs across versions; DIY slots retain their independent override. */
export function freezeSkins(raw, getChess, hasOperator = (_id) => false) {
  const out = {};
  for (const [id, skin] of Object.entries(cleanSkins(raw))) {
    if (hasOperator(id)) { out[id] = skin; continue; }
    const rec = getChess(id);
    if (!rec || rec.isGolden || (rec.visible === false && !rec.isDiy) || rec.isHidden
        || (rec.baseId && rec.baseId !== id)) continue;
    out[rec.isDiy ? id : rec.charId || id] = skin;
  }
  return Object.freeze(out);
}

/** A viewer opt-in, not the owner's preference: applies to every player's skin, including spectators. */
export function visibleSkin(skin, settings) {
  return settings?.skinsEnabled === true && isSkinId(skin) ? skin : null;
}

/** One owner / viewer rule for avatars and portraits, including independent DIY overrides.
 * @param {any} chess
 * @param {{state?:any, entries?:any, settings?:any, ownerId?:string|null, skin?:string|null}} [context]
 */
export function portraitSkin(chess, { state, entries, settings, ownerId, skin } = {}) {
  if (!chess || (chess.isDiy && !chess.diyFor) || chess.isHidden || chess.standInFor) return null;
  if (skin !== undefined) return visibleSkin(skin, settings);
  const id = chess.baseId || chess.chessId;
  const key = chess.isDiy ? id : chess.charId || id;
  const owner = ownerId === undefined ? state?.me?.playerId : ownerId;
  const player = state?.match?.public?.players?.find((p) => p.playerId === owner);
  if (player?.isBot || (owner != null && owner !== state?.me?.playerId && settings?.otherSkins === false)) return null;
  const selected = player ? player.skins?.[key] || player.skins?.[id]
    : ownerId === undefined || (owner != null && owner === state?.me?.playerId) ? entries?.[key] || entries?.[id] : null;
  return visibleSkin(selected, settings);
}
