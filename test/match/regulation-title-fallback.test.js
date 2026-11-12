import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GameData } from '../../server/match/gamedata.js';
import { assignTitles } from '../../server/match/results.js';

const read = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const legacy = read('../../data/config.json');
const config = read('../../data/versions/act3autochess-v3_1/config.json');
const tuning = read('../../data/versions/act3autochess-v3_1/tuning.json');

test('regulation temporarily uses the complete six-title covenant catalog, without changing its game version', () => {
  assert.equal(config.titles.length, 6);
  assert.deepEqual(config.titles, legacy.titles, 'names, art, descriptions and rules all come from covenant');
  assert.deepEqual(tuning.titles, read('../../data/tuning.json').titles);
  assert.equal(config.version.id, 'act3autochess@V3_1');
  assert.deepEqual(config.titles.map(title => title.name), ['卫戍之星', '不朽盟约', '坚若磐石', '精英云集', '万事俱备', '挥金如土']);
});

test('temporary titles are awarded again, including the existing least-LP-lost rule', () => {
  const gd = new GameData({ config, tuning }, 'mode_multi_hard');
  assert.equal(gd.titles.find(title => title.id === 'comment_3').stat, 'lpLost');
  const players = [{ playerId: 'me', seat: 0, alive: true, lp: 10,
    stats: { bossDamage: 0, lpLost: 0, merges: 0, itemsEquipped: 0, gold: 0 }, activatedLayers: () => 0 }];
  assert.deepEqual([...assignTitles(gd, players, false).values()], [
    { id: 'comment_3', name: '坚若磐石', picId: 'comment_icon_3', text: '目标生命值损失最少' },
  ]);
});
