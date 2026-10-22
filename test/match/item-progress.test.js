import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, giveItem, legalTileFor, DATA } from './harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { Battle } from '../../server/sim/Battle.js';
import { snapshotMatch, restoreMatch } from '../../server/match/snapshot.js';
import { createRngFromState } from '../../server/sim/rng.js';
import { renderInfo } from '../../public/js/render/app/info.js';

const PACK = 'chess_item_5_07_e_a', GOLD = 'chess_item_5_07_e_b';
const HOLDER = 'chess_char_1_01_a', FODDER = 'chess_char_1_08_a';
const quiet = { info() {}, warn() {}, error() {} };
function setup(t) {
  const h = makeMatch({ mode: 'solo', seed: 17, fake: true, registry: createRegistry({ log: quiet }) }).start();
  t.after(() => h.m.dispose()); h.toPrep(1);
  const ps = h.ps('p_0'); ps.bandId = null; ps.funds = 50;
  const carrier = give(h.m, ps, HOLDER, 'board', legalTileFor(h.m, ps, HOLDER));
  const equip = id => {
    const item = giveItem(h.m, ps, id);
    assert.deepEqual(h.m.handle('p_0', { t: 'g.equip', itemUid: item.uid, targetUid: carrier.uid }), { ok: true });
    return item;
  };
  const sell = () => assert.deepEqual(h.m.handle('p_0', { t: 'g.sell', uid: give(h.m, ps, FODDER).uid }), { ok: true });
  return { h, ps, carrier, equip, sell };
}

test('pack progress is live, per equipment, resets at the concrete 8 / 7 threshold and reaches scouting views', t => {
  const { h, ps, carrier, equip, sell } = setup(t);
  ps.promote(carrier); // Keep reward copies from merging the carrier while checking both independent counters.
  const a = equip(PACK), b = equip(GOLD);
  const progress = uid => ps.pieceView(carrier).items.find(it => it.uid === uid).progress;
  assert.deepEqual(progress(a.uid), { current: 0, total: 8 });
  assert.deepEqual(progress(b.uid), { current: 0, total: 7 });
  for (let i = 0; i < 7; i++) sell();
  assert.deepEqual(progress(a.uid), { current: 7, total: 8 });
  assert.deepEqual(progress(b.uid), { current: 0, total: 7 });
  sell();
  assert.deepEqual(progress(a.uid), { current: 0, total: 8 });
  assert.deepEqual(progress(b.uid), { current: 1, total: 7 });
  assert.deepEqual(h.m.prepFieldMeta(ps).units.find(u => u.uid === carrier.uid).itemProgress,
    [{ uid: a.uid, id: PACK, current: 0, total: 8 }, { uid: b.uid, id: GOLD, current: 1, total: 7 }]);
  const plain = giveItem(h.m, ps, 'chess_item_1_01_e_a');
  assert.equal(Object.hasOwn(ps.pieceView(plain), 'progress'), false, 'unrelated items retain their existing view');
});

test('progress follows the returned equipment, survives checkpoint restore and continues on its next carrier', t => {
  const { h, ps, carrier, equip, sell } = setup(t);
  const pack = equip(PACK); equip('chess_item_5_08_e_a');
  for (let i = 0; i < 3; i++) sell();
  h.m.dispatch(ps, 'onBattleResult', { result: {}, lpLoss: 0, perfect: true });
  const returned = ps.find(pack.uid).piece;
  assert.deepEqual(ps.pieceView(returned).progress, { current: 3, total: 8 });
  const scout = h.m.prepFieldMeta(ps).units.find(u => u.uid === pack.uid);
  assert.deepEqual(scout.progress, { current: 3, total: 8 });
  const cp = snapshotMatch(h.m), restored = setup(t).h;
  assert.equal(restoreMatch(restored.m, cp, { createRngFromState, log: quiet }), true);
  const p = restored.ps('p_0');
  assert.deepEqual(p.pieceView(p.find(pack.uid).piece).progress, { current: 3, total: 8 });
  const next = p.allChess().find(c => c.uid !== carrier.uid);
  assert.deepEqual(restored.m.handle('p_0', { t: 'g.equip', itemUid: pack.uid, targetUid: next.uid }), { ok: true });
  assert.deepEqual(restored.m.handle('p_0', { t: 'g.sell', uid: give(restored.m, p, FODDER).uid }), { ok: true });
  assert.deepEqual(p.pieceView(next).items.find(it => it.uid === pack.uid).progress, { current: 4, total: 8 });
});

test('battle and renderer metadata retain progress without altering simulation snapshots', t => {
  const { ps, carrier, equip, sell } = setup(t);
  const pack = equip(PACK); for (let i = 0; i < 3; i++) sell();
  const input = ps.battleInput(), normal = structuredClone(input);
  normal.units.forEach(u => { delete u.itemProgress; });
  const make = player => {
    const b = new Battle({ fieldId: 'n:p_0', kind: 'normal', seed: 2, players: [player], spawns: [], data: DATA, log: quiet });
    b.start(); return b;
  };
  const b = make(input), baseline = make(normal);
  const u = b.fieldMeta().units.find(u => u.uid === carrier.uid);
  assert.deepEqual(renderInfo(u).itemProgress, [{ uid: pack.uid, id: PACK, current: 3, total: 8 }]);
  for (let i = 0; i < 20; i++) { b.step(); baseline.step(); }
  assert.deepEqual(b.snapshot(), baseline.snapshot(), 'display data does not affect battle state or logical frames');
});
