import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandDisplayEffects, commandDisplayText } from '../../shared/commandDisplay.js';
import { bondEffectRecord } from '../../public/js/ui/bondEffect.js';
import { formatBondEffect, richTextPlain } from '../../public/js/ui/richText.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (file) => JSON.parse(readFileSync(path.join(ROOT, 'data/versions/act3autochess-v3_1', file), 'utf8'));
const values = {
  bands: load('bands.json'),
  bonds: load('bonds.json'),
  effects: load('effects.json'),
  assets: JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8')),
};
const { data } = await import('../../public/js/data.js');
data.setContent({ id: 'command-descriptions-test', values });
const { spectateEffects } = await import('../../public/js/battle/observe.js');
const { effectDesc, EffectsList } = await import('../../public/js/ui/effectsList.js');
const { BondStrip } = await import('../../public/js/ui/bondStrip.js');

test('command and actual replacement descriptions are shared by own and combat-spectator effects rows', () => {
  const bands = values.bands, bonds = values.bonds, effects = values.effects;
  const originalBand = bands.band_random;
  const skills = Object.values(bands).flatMap((band) => (band.skills || []).map((skill) => ({ band, skill })));
  const replacement = skills.find(({ band, skill }) => band.bandId !== originalBand.bandId
    && skill.buffs?.some((buff) => buff.key === 'auto_chess_effect_replace'));
  assert.ok(replacement, 'a different strategy can provide the selected command');
  const { band: commandBand, skill } = replacement;
  const replace = skill.buffs.find((buff) => buff.key === 'auto_chess_effect_replace');
  const overrides = { ...replace.bb, ...replace.bbStr };
  const pair = Object.entries(overrides).find(([baseId, effectId]) => {
    const bond = Object.values(bonds).find((candidate) => candidate.effectId === baseId);
    return bond && effects[effectId]?.effectType === 'BOND';
  });
  assert.ok(pair, 'the selected skill replaces an actual bond effect');
  const [baseId, effectId] = pair;
  const bond = Object.values(bonds).find((candidate) => candidate.effectId === baseId);
  const states = { [bond.bondId]: { count: 3, active: true, tier: 1, layers: 5 } };
  const zeroPair = Object.entries(overrides).find(([id]) => id !== baseId);
  if (zeroPair) {
    const zeroBond = Object.values(bonds).find((candidate) => candidate.effectId === zeroPair[0]);
    if (zeroBond) states[zeroBond.bondId] = { count: 0, active: false, tier: 0, layers: 0 };
  }
  const spec = { players: [{
    playerId: 'owner', bandId: originalBand.bandId, commandEffectId: skill.effectId,
    bondEffectOverrides: overrides, bonds: states,
    playerEffects: [{ id: originalBand.effectId, source: 'band' }],
  }] };
  const expected = commandDisplayEffects({
    bands, originalBandId: originalBand.bandId, commandEffectId: skill.effectId,
    effectOf: (id) => effects[id], bonds, bondStates: states, effectOverrides: overrides,
  });
  const watched = spectateEffects(spec, ['owner']);
  assert.deepEqual(watched, expected, 'spectator resolves the same viewed player rows as the own effects model');
  const command = watched.find((row) => row.command);
  assert.equal(command.id, skill.effectId);
  assert.equal(command.iconId, commandBand.iconId || commandBand.bandId);
  assert.equal(effectDesc(command), commandDisplayText(skill.descRaw || skill.desc));
  const button = { type: () => null, props: { command: { effectId: skill.effectId } } };
  const tree = EffectsList({ effects: watched, command: button });
  const countVNode = (node) => node === button ? 1
    : Array.isArray(node) ? node.reduce((sum, child) => sum + countVNode(child), 0)
      : node && typeof node === 'object' ? countVNode(node.props?.children) : 0;
  assert.equal(countVNode(tree), 1, 'FK command control replaces only the current command row icon');
  assert.ok(!watched.some((row) => row.id === originalBand.effectId && !row.descRef), 'the stale starting strategy row is removed');
  const mapped = watched.find((row) => row.descRef?.kind === 'bondEffect' && row.descRef.effectId === effectId);
  assert.ok(mapped, 'the nonzero replacement has its own row');
  assert.doesNotMatch(richTextPlain(effectDesc(mapped)), /\{\d+(?::[^}]+)?\}|NaN|undefined|—/);
  if (zeroPair) assert.ok(!watched.some((row) => row.descRef?.kind === 'bondEffect' && row.descRef.effectId === zeroPair[1]), 'zero-state metadata makes no effects icon row');
  assert.ok(watched.some((row) => row.descRef?.kind === 'effect' && row.id === originalBand.effectId), 'the original retained passive is independent');
});

test('replacement bond records use their own parameters and official count thresholds without mutating source data', () => {
  const bands = values.bands, bonds = values.bonds, effects = values.effects;
  const mappings = Object.values(bands).flatMap((band) => band.skills || [])
    .flatMap((skill) => (skill.buffs || []).filter((buff) => buff.key === 'auto_chess_effect_replace')
      .map((buff) => ({ ...buff.bb, ...buff.bbStr })));
  const before = JSON.stringify(bonds);
  let checked = 0;
  let yan = null;
  for (const mapping of mappings) for (const [baseId, effectId] of Object.entries(mapping)) {
    const bond = Object.values(bonds).find((candidate) => candidate.effectId === baseId);
    const effect = effects[effectId];
    if (!bond || effect?.effectType !== 'BOND') continue;
    assert.ok(Array.isArray(effect.effectDescParams), `${effectId} carries generated positional bindings`);
    for (const layers of [0, 40, 999]) {
      const record = bondEffectRecord(bond, effect, layers);
      const text = richTextPlain(formatBondEffect(record, layers));
      assert.equal(record.effectId, effectId);
      assert.doesNotMatch(text, /\{\d+(?::[^}]+)?\}|NaN|undefined|—/, `${effectId} at ${layers}`);
    }
    if (bond.bondId === 'yanShip') yan = bondEffectRecord(bond, effect, 40);
    checked++;
  }
  assert.ok(checked >= 7, `checked ${checked} replacement records`);
  assert.ok(yan, 'the Yan replacement is represented');
  assert.deepEqual(yan.thresholds, [3, 6, 9], 'the popup uses the replacement effect’s official nine-person tier');
  assert.equal(JSON.stringify(bonds), before, 'formatting does not mutate shared records');
});

test('zero-count and zero-layer identity metadata does not render a bond-strip icon', () => {
  const bonds = values.bonds;
  const bond = bonds.yanShip;
  const strip = BondStrip({ bonds: [{ bondId: bond.bondId, count: 0, active: false, tier: 0, layers: 0, effectId: 'bondeffect_yan' }], onOpen() {} });
  assert.match(strip.props.class, /bstrip--empty/);
});
