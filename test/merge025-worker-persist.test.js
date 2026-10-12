import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './match/harness.js';
import { snapshotMatch, restoreMatch, captureMatch, encodeMatchCapture } from '../server/match/snapshot.js';
import { createRngFromState } from '../server/sim/rng.js';
import { MatchWorkerPool } from '../server/workers/matchPool.js';
import { PHASE } from '../shared/constants.js';

const quiet = { warn() {}, error() {}, info() {}, debug() {} };
const seats = [0, 1, 2, 3].map(seat => ({ seat, playerId: `p_${seat}`, name: `Merge${seat}`, isBot: false, connected: true }));
const options = { mode: 'coop', seats, seed: 29, fake: true };
const deps = { createRngFromState, log: quiet };
const expected = [['p_3', 'p_1'], ['p_0', 'p_2']];

function bossPrep(h) {
  h.start().toPrep();
  h.m.round = h.m.gd.bossRound;
  h.m.bossPairs = structuredClone(expected);
  h.m._planBossWaves();
  h.m.phase = PHASE.PREP;
  return h;
}

for (const legacy of [false, true]) test(`0.2.5 boss partners and sides survive checkpoint restore (legacy=${legacy})`, () => {
  const a = bossPrep(makeMatch(options)), b = makeMatch(options);
  try {
    const doc = snapshotMatch(a.m);
    assert.deepEqual(doc.bossPairs, expected);
    if (legacy) delete doc.bossPairs;
    assert.equal(restoreMatch(b.m, doc, deps), true);
    assert.deepEqual(b.m.bossPairs, expected);
    assert.deepEqual(b.m.publicView().bossPairs, expected);
    for (const id of expected.flat()) {
      assert.deepEqual(b.m.bossGroupOf(b.ps(id)), a.m.bossGroupOf(a.ps(id)));
      assert.equal(b.m.deployFieldOf(b.ps(id)), a.m.deployFieldOf(a.ps(id)));
    }
    b.m.round = b.m.gd.hiddenRound;
    b.m._planBossWaves();
    assert.deepEqual(b.m.bossPairs, expected, 'Hidden Core retains the restored pairing');
    b.ps('p_1').alive = false;
    b.ps('p_1').left = true;
    b.m._planBossWaves();
    assert.deepEqual(b.m.bossPairs, [['p_0', 'p_2'], ['p_3']], 'the intact pair keeps its partners/sides');
  } finally { a.m.dispose(); b.m.dispose(); }
});

test('0.2.5 full Worker capture carries boss pairing without a separate state owner', () => {
  const a = bossPrep(makeMatch(options));
  try {
    const capture = captureMatch(a.m);
    assert.deepEqual(capture.doc.bossPairs, expected);
    assert.deepEqual(encodeMatchCapture(capture).bossPairs, expected);
  } finally { a.m.dispose(); }
});

test('0.2.5 malformed optional pairing recovers authoritative preparation groups', () => {
  for (const bad of [7, [null], [['unknown']], [['p_0', 'p_0']], []]) {
    const a = bossPrep(makeMatch(options)), b = makeMatch(options);
    try {
      const doc = snapshotMatch(a.m);
      doc.bossPairs = bad;
      assert.equal(restoreMatch(b.m, doc, { ...deps, bestEffort: true }), true);
      assert.deepEqual(b.m.bossPairs, expected);
      b.m._planBossWaves();
      assert.deepEqual(b.m.bossPairs, expected);
    } finally { a.m.dispose(); b.m.dispose(); }
  }
});

test('0.2.5 Match Workers preserve boss pairing through two restores', async t => {
  const source = bossPrep(makeMatch(options));
  t.after(() => source.m.dispose());
  const pool = new MatchWorkerPool({ data: DATA, lanes: 1 });
  t.after(() => pool.close());
  const opts = { roomCode: 'M025', mode: 'coop', difficulty: 'NORMAL', seed: 29, matchNo: 1, seats };
  const first = await pool.create('merge025-first', opts, {}, snapshotMatch(source.m));
  const one = await first.snapshot();
  assert.deepEqual(one.bossPairs, expected);
  const second = await pool.create('merge025-second', opts, {}, one);
  const two = await second.snapshot();
  assert.deepEqual(two.bossPairs, expected);
  assert.deepEqual(two.bossWaves.map(w => w.players), expected);
  await first.dispose();
  await second.dispose();
});
