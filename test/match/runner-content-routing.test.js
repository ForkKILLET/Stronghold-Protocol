import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattleRunner } from '../../public/js/battle/runner.js';
import { createStore, initialState } from '../../public/js/store.js';

for (const version of ['act3autochess@V3_1', 'act2autochess']) {
  test(`gameplay content for ${version} selects the Worker without loading an in-page sim`, async t => {
    const cs = 'ab'.repeat(32);
    const content = { cs, version, hashInput: { vanilla: false, version }, data: {}, scripts: [] };
    const runner = createBattleRunner({
      net: { on: () => () => {} }, store: createStore(initialState), doc: null,
      vanillaCs: () => 'cd'.repeat(32), contentFor: async want => want === cs ? content : null,
      raf: () => 1, caf() {}, setInterval: () => 1, clearInterval() {},
    });
    t.after(() => runner.dispose());
    const selected = await runner.ensureSim(cs);
    assert.equal(selected.remote, true);
    assert.equal(selected.content, content);
    assert.equal(selected.cs, cs);
    assert.equal(selected.spec, undefined, 'the page does not construct or import the plugin simulation');
  });
}

test('an injected simulation loader remains available for deterministic runner harnesses', async t => {
  const cs = 'ab'.repeat(32);
  const content = { cs, version: 'act3autochess@V3_1', hashInput: { vanilla: false } };
  const sim = { cs, testLoader: true };
  const loads = [];
  const runner = createBattleRunner({
    net: { on: () => () => {} }, store: createStore(initialState), doc: null,
    vanillaCs: () => 'cd'.repeat(32), contentFor: async () => content,
    loadSim: async value => { loads.push(value); return sim; },
    raf: () => 1, caf() {}, setInterval: () => 1, clearInterval() {},
  });
  t.after(() => runner.dispose());
  assert.equal(await runner.ensureSim(cs), sim);
  assert.deepEqual(loads, [content]);
});
