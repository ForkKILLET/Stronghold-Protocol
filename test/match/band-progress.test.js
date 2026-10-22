import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, DATA } from './harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { snapshotMatch, restoreMatch } from '../../server/match/snapshot.js';
import { createRngFromState } from '../../server/sim/rng.js';

const quiet = { warn() {}, error() {}, info() {} };
function setup(t, bandId = 'band_chiave') {
  const h = makeMatch({ mode: 'solo', seed: 17, fake: true, registry: createRegistry({ log: quiet }) }).start();
  t.after(() => h.m.dispose()); h.toPrep(1);
  const ps = h.ps('p_0'); ps.bandId = bandId; ps.shop.level = 4; ps.funds = 200;
  const effect = () => ps.effectsView().find(e => e.iconKind === 'band');
  const refresh = n => { for (let i = 0; i < n; i++) assert.deepEqual(h.m.handle('p_0', { t: 'g.refresh' }), { ok: true }); };
  return { h, ps, effect, refresh };
}

test('Chiave shows the actual six-refresh cycle and the two-reward round cap', t => {
  const { h, ps, effect, refresh } = setup(t);
  assert.deepEqual(effect().progress, { current: 0, total: 6 });
  refresh(5);
  assert.deepEqual(effect().progress, { current: 5, total: 6 });
  assert.deepEqual(effect().roundProgress, { current: 0, total: 2 });
  refresh(1);
  assert.deepEqual(effect().progress, { current: 0, total: 6 });
  assert.deepEqual(effect().roundProgress, { current: 1, total: 2 });
  refresh(14);
  assert.deepEqual(effect().progress, { current: 2, total: 6 });
  assert.deepEqual(effect().roundProgress, { current: 2, total: 2 });
  const before = { ...ps.counters };
  assert.deepEqual(h.m.prepFieldMeta(ps).effects.find(e => e.id === effect().id), effect());
  assert.deepEqual(ps.battleInput().bandProgress, { progress: effect().progress, roundProgress: effect().roundProgress });
  h.m.round++;
  assert.deepEqual(effect().progress, { current: 2, total: 6 }, 'remainder continues across rounds');
  assert.deepEqual(effect().roundProgress, { current: 0, total: 2 }, 'old lazily-reset rewards are not shown in a new round');
  assert.deepEqual(ps.counters, before, 'reading views never resets the game counters');
  refresh(4);
  assert.deepEqual(effect().roundProgress, { current: 1, total: 2 });
});

function spend(ps, n) { assert.equal(ps.spend(n), true); ps._afterSpend(n, 'test'); }
function buy(h, ps, id) {
  ps.shop.slots[0] = { kind: 'chess', id, basePrice: h.m.gd.chessPrice(id), sold: false };
  assert.deepEqual(h.m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
}
function chess(h, bond = null) {
  return Object.values(DATA.chess).find(c => c.visible && !c.isGolden && c.tier <= 4 && h.m.pool.has(c.chessId)
    && (!bond || c.bonds.includes(bond)) && c.garrisonIds.every(id => DATA.garrisons[id].eventType === 'IN_BATTLE')).chessId;
}

test('Paganini shows capped spending progress and completes only after a successful reward', t => {
  const { ps, effect } = setup(t, 'band_paganini');
  spend(ps, 54);
  assert.deepEqual(effect().progress, { current: 54, total: 55 }); assert.equal(effect().completed, false);
  // An unavailable reward must not become a false "completed" just because the spending threshold was reached.
  const acquire = ps.acquireChess; ps.acquireChess = () => null;
  spend(ps, 5);
  assert.deepEqual(effect().progress, { current: 55, total: 55 }); assert.equal(effect().completed, false);
  ps.acquireChess = acquire; spend(ps, 1);
  assert.equal(effect().completed, true);
  const spent = ps.counters['band:paganini:spent']; spend(ps, 10);
  assert.equal(ps.counters['band:paganini:spent'], spent, 'one-off counter stops after the actual grant');
});

test('Kirara shows the remaining spend in each twenty-fund cycle, including multiple grants', t => {
  const { ps, effect } = setup(t, 'band_kirara');
  spend(ps, 19); assert.deepEqual(effect().progress, { current: 19, total: 20 });
  spend(ps, 46); assert.deepEqual(effect().progress, { current: 5, total: 20 });
});

test('Du Yaoye counts the first two manual refreshes, not operators per refresh or automatic rolls', t => {
  const { h, ps, effect, refresh } = setup(t, 'band_duyaoy');
  ps.rollShop(); assert.deepEqual(effect().progress, { current: 0, total: 2 });
  refresh(1); assert.equal(effect().progress.current, 1);
  refresh(2); assert.equal(effect().progress.current, 2);
  h.m.round++; ps.startRound(h.m.round);
  assert.deepEqual(effect().progress, { current: 0, total: 2 });
});

test('Mlynar displays earned next-round funds with the real per-round limit', t => {
  const { h, ps, effect } = setup(t, 'band_mlynar');
  const id = chess(h, 'kazimierzShip');
  for (let i = 0; i < 4; i++) buy(h, ps, id);
  assert.deepEqual(effect().progress, { current: 3, total: 3 });
  assert.equal(effect().progressType, 'income');
  const before = { ...ps.counters }; h.m.round++;
  assert.deepEqual(effect().progress, { current: 0, total: 3 });
  assert.deepEqual(ps.counters, before, 'view does not reset lazy content counters');
});

test('Shamare counts successful normal-operator swaps and resets the available use next round', t => {
  const { h, ps, effect } = setup(t, 'band_vodfox');
  const id = chess(h);
  const sell = piece => assert.deepEqual(h.m.handle('p_0', { t: 'g.sell', uid: piece.uid }), { ok: true });
  sell(give(h.m, ps, DATA.chess[id].goldenId));
  assert.equal(effect().progress.current, 0, 'elite sale does not use a normal-operator swap');
  sell(give(h.m, ps, id)); assert.deepEqual(effect().progress, { current: 1, total: 1 });
  h.m.round++; assert.deepEqual(effect().progress, { current: 0, total: 1 });
});

test('Sciurus only consumes the discount for the matching bond, and Pepe keeps queued special refreshes', t => {
  const { h, ps, effect } = setup(t, 'band_sciurus');
  buy(h, ps, chess(h, 'siracusaShip')); assert.equal(effect().progress.current, 0);
  buy(h, ps, chess(h, 'kjeragShip')); assert.deepEqual(effect().progress, { current: 1, total: 1 });
  h.m.round++; assert.equal(effect().progress.current, 0);
  ps.bandId = 'band_pepe'; ps.shop.level = 1;
  for (let i = 0; i < 3; i++) {
    ps.shop.upgradePrice = 0; assert.deepEqual(h.m.handle('p_0', { t: 'g.levelUp' }), { ok: true });
  }
  assert.equal(effect().remaining, 2, 'level two and four both queue a special refresh');
  assert.deepEqual(h.m.handle('p_0', { t: 'g.refresh' }), { ok: true }); assert.equal(effect().remaining, 1);
  assert.deepEqual(h.m.handle('p_0', { t: 'g.refresh' }), { ok: true }); assert.equal(effect().remaining, 0);
});

test('all prep strategy counters survive checkpoint restore and reach scouting / combat metadata', t => {
  for (const bandId of ['band_paganini', 'band_kirara', 'band_duyaoy', 'band_mlynar', 'band_vodfox', 'band_sciurus', 'band_pepe']) {
    const { h, ps } = setup(t, bandId);
    ps.counters = { 'band:paganini:spent': 24, 'band:kirara:acc': 7, 'band:mlynar:r': h.m.round, 'band:mlynar': 2,
      'band:vodfox:r': h.m.round, 'band:vodfox': 1, 'band:sciurus:r': h.m.round, 'band:pepe:special': 2 };
    ps.round.refreshes = 1;
    const expected = ps.bandProgressView(), cp = snapshotMatch(h.m), restored = setup(t, bandId).h;
    assert.equal(restoreMatch(restored.m, cp, { createRngFromState, log: quiet }), true);
    assert.deepEqual(restored.ps('p_0').bandProgressView(), expected, bandId);
    assert.deepEqual(ps.battleInput().bandProgress, expected);
    const scout = h.m.prepFieldMeta(ps).effects.find(e => e.iconKind === 'band');
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(scout[key], value, key);
  }
});

test('automatic shop rolls do not advance Chiave; progress survives restore', t => {
  const { h, ps, effect, refresh } = setup(t);
  refresh(3); ps.rollShop();
  assert.deepEqual(effect().progress, { current: 3, total: 6 });
  const cp = snapshotMatch(h.m), restored = setup(t).h;
  assert.equal(restoreMatch(restored.m, cp, { createRngFromState, log: quiet }), true);
  assert.deepEqual(restored.ps('p_0').bandProgressView(), { progress: { current: 3, total: 6 }, roundProgress: { current: 0, total: 2 } });
  assert.deepEqual(restored.m.handle('p_0', { t: 'g.refresh' }), { ok: true });
  assert.equal(restored.ps('p_0').bandProgressView().progress.current, 4);
});

test('unrelated strategies do not acquire counters or battle metadata', t => {
  const { ps } = setup(t); ps.bandId = 'band_bldsk';
  assert.equal(ps.bandProgressView(), null);
  assert.equal(Object.hasOwn(ps.effectsView()[0], 'progress'), false);
  assert.equal(Object.hasOwn(ps.battleInput(), 'bandProgress'), false);
});
