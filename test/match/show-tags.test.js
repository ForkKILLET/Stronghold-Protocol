import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { VERSIONS } from '../../shared/versions.js';
import { formatShowTags, garrisonShowTags, garrisonUpgradeKey, itemShowTags, nextGarrisonUpgrade } from '../../shared/showTags.js';
import { pieceGarrisonTags } from '../../server/match/showTags.js';
import { makeMatch, give, giveItem } from './harness.js';
import { snapshotMatch, restoreMatch } from '../../server/match/snapshot.js';
import { createRngFromState } from '../../server/sim/rng.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { registerBuiltins } from '../../server/match/builtinMeta.js';
import { renderInfo } from '../../public/js/render/app/info.js';

const version = 'act3autochess@V3_1', raw = getVersionData(version);
const registry = createRegistry({ builtins: false });
registerBuiltins(registry, raw);
function fixture(t, options = {}) {
  const h = makeMatch({ data: raw, version, registry, mode: 'solo', modeId: 'mode_single_12', fake: true, seed: 41, ...options }).start();
  h.toPrep(1, { band: 'band_sarkazb' });
  t.after(() => h.m.dispose());
  return h;
}

test('all official dynamic trait slots have an initial value; unresolved future slots show unavailable', () => {
  let covered = 0;
  for (const v of VERSIONS) {
    const data = getVersionData(v.id);
    for (const g of Object.values(data.garrisons)) {
      const text = g.descRaw || g.desc || '';
      if (!text.includes('{showtag_')) continue;
      const values = garrisonShowTags(g);
      assert.ok(Number.isFinite(values?.showtag_value_1), `${v.id} ${g.garrisonId}`);
      assert.doesNotMatch(formatShowTags(text, values), /\{showtag_|—/);
      covered++;
    }
    for (const it of Object.values(data.items)) {
      const text = it.descRaw || it.desc || '';
      if (text.includes('{showtag_')) {
        assert.equal(itemShowTags(it)?.showtag_value_1, 0);
        assert.doesNotMatch(formatShowTags(text, itemShowTags(it)), /\{showtag_|—/);
      }
    }
  }
  assert.equal(covered, 16);
  assert.equal(formatShowTags('<@ba.vup>{showtag_value_1}</> / {showtag_value_2} {0:0%}', { showtag_value_1: 0 }),
    '<@ba.vup>0</> / — {0:0%}');
  assert.equal(formatShowTags('{showtag_value_1}', { showtag_value_1: Infinity }), '—');
});

test('owned traits show next payout and real round counts, without mutating counters or sharing owners', t => {
  const h = fixture(t, { mode: 'coop', modeId: 'mode_multi_normal', humans: 2 }), ps = h.ps('p_0'), other = h.ps('p_1');
  const aurora = give(h.m, ps, 'chess_char_3_07_a', 'board', [10, 4]);
  ps.counters[garrisonUpgradeKey(raw.garrisons.garrison_50_a, aurora.id)] = 2;
  const canto = give(h.m, ps, 'chess_char_3_13_a', 'hand');
  const closure = give(h.m, ps, 'chess_char_5_21_a', 'hand');
  const compare = give(h.m, other, 'chess_char_5_21_a', 'hand');
  Object.assign(ps.round, { gainedChess: 9, spent: 19, refreshes: 7 });
  Object.assign(other.round, { gainedChess: 2 });
  const before = JSON.stringify([ps.round, ps.counters, aurora.meta, canto.meta]);
  assert.equal(ps.pieceView(aurora).garrisonTags.garrison_50_a.showtag_value_1, 3);
  assert.equal(ps.pieceView(canto).garrisonTags.garrison_74_a.showtag_value_1, 1);
  assert.equal(ps.pieceView(closure).garrisonTags.garrison_125_a.showtag_value_1, 9);
  assert.equal(other.pieceView(compare).garrisonTags.garrison_125_a.showtag_value_1, 2);
  for (const [gid, expected] of [['garrison_36_a', 9], ['garrison_91_a', 7], ['garrison_121_a', 19], ['garrison_128_b', 9], ['garrison_236_b', 7]]) {
    assert.equal(garrisonShowTags(raw.garrisons[gid], { round: ps.round }).showtag_value_1, expected);
  }
  const scouted = h.m._prepBoardUnits(ps).find(u => u.uid === aurora.uid);
  assert.deepEqual(scouted.garrisonTags, ps.pieceView(aurora).garrisonTags);
  assert.deepEqual(renderInfo(scouted).garrisonTags, scouted.garrisonTags);
  assert.deepEqual(ps.battleInput().units.find(u => u.uid === aurora.uid).garrisonTags, ps.pieceView(aurora).garrisonTags);
  assert.equal(JSON.stringify([ps.round, ps.counters, aurora.meta, canto.meta]), before);
  ps.round.gainedChess = 0;
  assert.equal(pieceGarrisonTags(ps, closure).garrison_125_a.showtag_value_1, 0);
});

test('upgrade preview follows actual handler payouts, caps, repeated triggers and restored state', t => {
  const h = fixture(t), ps = h.ps('p_0');
  const p = ps.acquireChess('chess_char_3_07_a', { source: 'test' });
  assert.ok(p);
  const gid = 'garrison_50_a', bb = raw.garrisons[gid].bb;
  const key = garrisonUpgradeKey(raw.garrisons[gid], p.id);
  for (let i = 0; i < 6; i++) {
    const expected = nextGarrisonUpgrade(bb, { fired: ps.counters[key] });
    assert.equal(ps.pieceView(p).garrisonTags[gid].showtag_value_1, expected);
    const old = ps.layers.kjeragShip;
    h.m.dispatch(ps, 'onGain', { piece: p, kind: 'chess', source: 'test' });
    assert.equal(ps.layers.kjeragShip - old, expected);
  }
  const doc = snapshotMatch(h.m), next = fixture(t);
  assert.equal(restoreMatch(next.m, doc, { createRngFromState }), true);
  const restored = next.ps('p_0').find(p.uid).piece;
  assert.deepEqual(next.ps('p_0').pieceView(restored).garrisonTags, ps.pieceView(p).garrisonTags);
});

test('passbook text follows held growth and actual funds granted on use', t => {
  const h = fixture(t), ps = h.ps('p_0');
  const book = giveItem(h.m, ps, 'chess_item_3_15_e_a', 'hand');
  assert.equal(ps.pieceView(book).showTags.showtag_value_1, 0);
  h.m.dispatch(ps, 'onRoundStart', { round: 2 });
  h.m.dispatch(ps, 'onRoundStart', { round: 3 });
  assert.equal(ps.pieceView(book).showTags.showtag_value_1, 2);
  const wearer = give(h.m, ps, 'chess_char_1_06_a', 'board', [10, 4]);
  const funds = ps.funds;
  assert.equal(ps.equip(book.uid, wearer.uid).ok, true);
  assert.equal(ps.funds - funds, 2);
});
