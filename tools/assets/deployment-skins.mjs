import { contentHash } from './manifest.mjs';
import { cardPortraitOperatorId } from '../../shared/playerCard.js';

/** Add deployment-selected outfits without replacing the revision's base art, sounds or explicit outfit entries. */
export function withDeploymentSkins(base, installed) {
  const result = structuredClone(base);
  let added = 0;
  for (const [charId, operator] of Object.entries(result.chars || {})) {
    for (const [skinId, skin] of Object.entries(installed?.chars?.[charId]?.skins || {})) {
      if (skinId === charId || cardPortraitOperatorId(skinId) !== charId || !skin || typeof skin !== 'object') continue;
      if (Object.hasOwn(operator.skins || {}, skinId)) continue;
      (operator.skins ||= {})[skinId] = structuredClone(skin);
      added++;
    }
  }
  if (added) {
    const { version, hash, generator, stats, ...body } = result;
    result.hash = contentHash(body);
  }
  return result;
}
