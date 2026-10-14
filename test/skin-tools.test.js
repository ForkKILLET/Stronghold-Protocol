import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPlan, fexliModelDef } from '../tools/assets/plan.mjs';
import { indexAudio } from '../tools/assets/audio.mjs';
import { collectLeaves } from '../tools/assets/manifest.mjs';
import { isSkinId } from '../shared/skins.js';
import { resourceGroup } from '../public/js/resources/common.js';
import { RUNTIME_RESEARCH, PLAYER_TOOLS } from '../tools/package.mjs';
const json = name => JSON.parse(readFileSync(new URL('../' + name, import.meta.url), 'utf8'));
const research = json('docs/research/08-skins.json');
const catalogue = json('data/skins.json');

test('generated catalogue matches adopted research, has valid ids and contains no URLs', () => {
  let count = 0;
  for (const [id, skins] of Object.entries(research.skins)) {
    assert.deepEqual(catalogue.chars[id], skins.map(s => ({ id: s.skinId, name: s.name, group: s.group || '' })));
    assert.ok(skins.every(s => isSkinId(s.skinId))); count += skins.length;
  }
  assert.deepEqual(catalogue.counts, { chars: Object.keys(research.skins).length, skins: count });
  assert.doesNotMatch(JSON.stringify(catalogue), /https?:\/\//);
  assert.ok(RUNTIME_RESEARCH.includes('docs/research/08-skins.json'));
  assert.ok(PLAYER_TOOLS.includes('tools/install-skins.mjs'));
});

test('skin models are opt-in and use the same animation-role plan with a separate preload category', () => {
  const args = { assets07: json('docs/research/07-assets.json'), ops03: json('docs/research/03-operators.json'),
    enemies05: json('docs/research/05-enemies.json'), maps05: json('docs/research/05-maps.json'),
    skins08: research, audio: indexAudio({}), modelsData: {} };
  const plain = buildPlan(args);
  assert.ok(Object.values(plain.template.chars).every(c => !c.skins));
  const charId = Object.keys(research.skins).find(id => plain.template.chars[id]);
  const skin = research.skins[charId][0];
  const selected = buildPlan({ ...args, skinsInstalled: new Set([skin.skinId]) });
  assert.equal(Object.values(selected.template.chars).reduce((n, c) => n + Object.keys(c.skins || {}).length, 0), 1);
  const model = selected.models.get(`skin:${skin.stem}:front`);
  assert.ok(model && model.skillIndices.length);
  assert.deepEqual(model, fexliModelDef(model.key, 'op', model.dir, skin.battleSpine.front, model.skillIndices));
  assert.ok(model.skel.rel.includes(skin.stem));
  assert.ok(selected.template.chars[charId].skins[skin.skinId].spine.front.model);
  for (const leaf of collectLeaves(selected.template.chars[charId].skins)) {
    assert.equal(resourceGroup({ tier: 2, url: 'https://cdn.example/prefix/assets/' + leaf.leaf.alts[0].rel }), 'skins');
  }
  assert.equal(fexliModelDef('bad', 'op', 'bad/', {}, []), null);
});
