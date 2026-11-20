import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InPageSimHost, WorkerSimHost } from '../../public/js/battle/simHost.js';
import { createSimWorker } from '../../public/js/battle/simWorkerRuntime.js';
import * as specModule from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { DATA } from '../match/harness.js';

const ds = new DataSource(DATA, null);
const spec = () => ({ fieldId: 'n:p1', kind: 'normal', seed: 1, players: [{ playerId: 'p1', units: [],
  bonds: { ursusShip: { count: 0, tier: 0, active: false, layers: 100 } } }], spawns: [] });
const sim = { spec: specModule, ds };

test('display observes actual temporary receipts, including signed adjustments, and replaces its old battle', () => {
  const host = new InPageSimHost(); host.sim = sim; host.start(spec());
  const b = host.battle;
  assert.equal(b.addTempLayers('p1', 'ursusShip', 20), 20);
  assert.equal(host.tempLayersSnapshot().p1.ursusShip, 20);
  assert.equal(b.getPlayer('p1').bonds.ursusShip.layers, 100);
  b.flags.layerGainsEnabled = false;
  b.emit('tempLayerGain', { playerId: 'p1', bondId: 'ursusShip', n: 2 });
  assert.equal(host.tempLayersSnapshot().p1.ursusShip, 20, 'a fabricated event cannot change the battle ledger');
  b.removeTempLayers('p1', 'ursusShip', 3);
  assert.equal(host.tempLayersSnapshot().p1.ursusShip, 17);
  assert.equal(b.tempLayers('p1', 'ursusShip'), 17, 'the observer cannot add settlement rewards');
  host.start(spec());
  assert.equal(host.tempLayersSnapshot().p1, undefined);
  b.emit('tempLayerGain', { playerId: 'p1', bondId: 'ursusShip', n: 4 });
  assert.equal(host.tempLayersSnapshot().p1, undefined, 'reusing the host detaches the old battle');
  host.stop(); assert.deepEqual(host.tempLayersSnapshot(), {});
});

test('temporary display does not change logical snapshots, results, events or RNG', () => {
  const host = new InPageSimHost(); host.sim = sim; host.start(spec());
  const baseline = specModule.createBattleFromSpec(spec(), ds, { resourceNumbers: true });
  for (const b of [host.battle, baseline]) b.addTempLayers('p1', 'ursusShip', 20);
  assert.deepEqual(host.battle.snapshot(), baseline.snapshot());
  assert.deepEqual(host.battle.drainEvents(), baseline.drainEvents());
  assert.equal(host.battle.rng.state(), baseline.rng.state());
  for (const b of [host.battle, baseline]) b.forceEnd('forced');
  assert.deepEqual(host.battle.result(), baseline.result());
  host.stop();
});

test('the simulation Worker packet carries temporary display separately and clears it on reuse', async () => {
  let battle;
  const runtime = createSimWorker({ loadSim: async () => ({ ...sim, spec: { ...specModule,
    createBattleFromSpec(...args) { battle = specModule.createBattleFromSpec(...args); return battle; } } }) });
  await runtime('load', [{ cs: 'display-only', data: {} }]);
  await runtime('start', [spec()]);
  battle.addTempLayers('p1', 'ursusShip', 20);
  const host = new WorkerSimHost({ workerFactory: () => ({ terminate() {}, postMessage() {} }) });
  try {
    host.accept(structuredClone(await runtime('step', [0])));
    assert.equal(host.tempLayersSnapshot().p1.ursusShip, 20);
    assert.equal(host.battle.getPlayer('p1').bonds.ursusShip.layers, 100);
    host.accept(structuredClone(await runtime('start', [spec()])));
    assert.equal(host.tempLayersSnapshot().p1, undefined);
  } finally { host.stop(); }
});
