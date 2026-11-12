// Display-only rows for the current 规程 command and explicitly retained original-band effects.
// Rules stay in the match/sim code; this helper only points each row at the record that owns its text.

const RETAINED_BUFFS = new Set(['gain_band_skill_from_pool_in_prep']);

const rowsOf = (bands) => Array.isArray(bands) ? bands : Object.values(bands || {});
const record = (v) => (v && typeof v === 'object' ? v : null);

/**
 * Build the strategy rows shown in the effects column for a player with the 规程 command chain.
 * The selected command can come from any strategy (追随者's draft draws from all ACTIVE skill rows), while the
 * original band is kept separately so only a buff whose runtime is still tied to that band can add a second row.
 * @param {{ bands?: object|object[], originalBandId?: string, commandEffectId?: string, effectOf?: (id: string) => any,
 *   commandType?: string, bonds?: object, bondStates?: object, effectOverrides?: Record<string, string> }} opts
 * @returns {any[]|null} null when the input is not a valid command-chain view; an empty list is never returned.
 */
export function commandDisplayEffects({ bands, originalBandId, commandEffectId, effectOf = null, commandType = null,
  bonds = {}, bondStates = {}, effectOverrides = {} } = {}) {
  if (typeof originalBandId !== 'string' || typeof commandEffectId !== 'string') return null;
  const allBands = rowsOf(bands).filter(record);
  const originalBand = allBands.find((b) => b.bandId === originalBandId) || null;
  if (!Array.isArray(originalBand?.skills) || !originalBand.skills.length) return null;
  const commandBand = allBands.find((b) => Array.isArray(b.skills) && b.skills.some((s) => s?.effectId === commandEffectId)) || null;
  const skill = commandBand?.skills?.find((s) => s?.effectId === commandEffectId) || null;
  if (!commandBand || !skill) return null;

  const getEffect = typeof effectOf === 'function' ? effectOf : () => null;
  const commandEffect = record(getEffect(commandEffectId));
  const bandId = commandBand.bandId || commandEffectId;
  const current = {
    viewKey: `command:${commandEffectId}`,
    id: commandEffectId,
    name: commandEffect?.name || commandBand.effectName || commandBand.name || commandEffectId,
    desc: skill.descRaw || skill.desc || commandEffect?.descRaw || commandEffect?.desc || '',
    descRef: { kind: 'bandSkill', bandId, effectId: commandEffectId },
    iconKind: 'band',
    iconId: commandBand.iconId || bandId,
    command: true,
    commandType: commandType || skill.type || null,
  };
  /** @type {any[]} */
  const out = [current];

  for (const [baseEffectId, effectId] of Object.entries(effectOverrides || {})) {
    if (typeof effectId !== 'string' || !effectId) continue;
    const entry = Object.entries(bonds || {}).find(([, bond]) => bond?.effectId === baseEffectId);
    if (!entry) continue;
    const [key, baseBond] = entry;
    const bondId = baseBond.bondId || key;
    const state = bondStates?.[bondId] || {};
    const layers = Number.isFinite(state.layers) ? Math.max(0, Math.trunc(state.layers)) : 0;
    const count = Number.isFinite(state.count) ? Math.max(0, Math.trunc(state.count)) : 0;
    // The owner view retains the effect id for a zero-state popup, but the effects column has no empty bond icon.
    if (!(state.active || count > 0 || layers > 0)) continue;
    const effect = record(getEffect(effectId));
    if (!effect || effect.effectType !== 'BOND') continue;
    out.push({
      viewKey: `bond:${bondId}:${effectId}`,
      id: effectId,
      name: baseBond.name || effect.name || effectId,
      desc: effect.desc || effect.descRaw || '',
      descRef: { kind: 'bondEffect', bondId, effectId, layers },
      iconKind: 'band',
      iconId: originalBand.iconId || originalBandId,
      command: false,
      count,
      layers,
    });
  }

  const keepsPrepDraft = (originalBand.buffs || []).some((b) => RETAINED_BUFFS.has(b?.key));
  const retainedId = originalBand.effectId;
  // Before the first draft the retained passive is itself the current row, so do not render it twice.
  if (keepsPrepDraft && typeof retainedId === 'string' && retainedId !== commandEffectId) {
    const retained = record(getEffect(retainedId));
    if (retained) out.push({
      viewKey: `retained:${originalBandId}:${retainedId}`,
      id: retainedId,
      name: retained.name || originalBand.effectName || originalBand.name || retainedId,
      desc: retained.descRaw || retained.desc || '',
      descRef: { kind: 'effect', effectId: retainedId },
      iconKind: 'band',
      iconId: originalBand.iconId || originalBandId,
      command: false,
    });
  }
  return out;
}

/** Remove command-only placeholders that the command HUD expands through its existing flow. */
export function commandDisplayText(desc) {
  return typeof desc === 'string' ? desc.replaceAll('{@tag}', '').replaceAll('{@unlock}', '') : '';
}
