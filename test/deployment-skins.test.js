import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDeploymentSkins } from '../tools/assets/deployment-skins.mjs';
import { cardPortraitSkins, seatPortrait } from '../public/js/ui/seatArt.js';

test('deployment restores portrait choices without regressing current models, sound mappings or explicit skins', () => {
  const charId = 'char_103_angel', skinId = `${charId}@wild#1`, custom = `${charId}@custom#1`;
  const base = { hash: 'base', chars: { [charId]: { portrait: '/assets/current.png', spine: { current: true },
    skins: { [custom]: { portrait: '/assets/custom.png' } } }, char_new: { portrait: '/assets/new.png' } },
    audio: { attacks: { skill: '/assets/new-skill.mp3' } } };
  const installed = { chars: { [charId]: { portrait: '/assets/old.png', spine: { obsolete: true }, skins: {
    [skinId]: { portrait: '/assets/skin.png', avatar: '/assets/skin-avatar.png' },
    [custom]: { portrait: '/assets/obsolete.png' },
    'char_foreign@wild#1': { portrait: '/assets/wrong-owner.png' },
  } }, char_removed: { skins: { 'char_removed@wild#1': { portrait: '/assets/removed.png' } } } },
    audio: { attacks: { skill: '/assets/obsolete.mp3' } } };
  const before = structuredClone({ base, installed });
  const merged = withDeploymentSkins(base, installed);
  assert.deepEqual({ base, installed }, before, 'composition cannot mutate the tested source or pinned metadata');
  assert.deepEqual(merged.audio, base.audio);
  assert.deepEqual(merged.chars[charId].spine, base.chars[charId].spine);
  assert.equal(merged.chars[charId].portrait, base.chars[charId].portrait);
  assert.deepEqual(merged.chars.char_new, base.chars.char_new);
  assert.equal(merged.chars.char_removed, undefined);
  assert.equal(merged.chars[charId].skins[custom].portrait, '/assets/custom.png');
  assert.equal(merged.chars[charId].skins['char_foreign@wild#1'], undefined);
  assert.notEqual(merged.hash, base.hash);
  assert.deepEqual(withDeploymentSkins(merged, installed), merged, 'rebuilds are idempotent');
  const catalogue = { chars: { [charId]: [{ id: skinId, name: '野地秘行', group: '生命之地/I' }] } };
  assert.deepEqual(cardPortraitSkins(charId, base, catalogue), [], 'reproduces a base-only deployment');
  assert.equal(cardPortraitSkins(charId, merged, catalogue)[0].id, skinId);
  assert.equal(seatPortrait({ playerId: 'one', card: { charId: skinId } }, { m: merged, pool: [{ charId }] }), '/assets/skin.png');
  assert.deepEqual(withDeploymentSkins(base, null), base);
});
