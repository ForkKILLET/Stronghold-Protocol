import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { diySlotIds, diySlot } from '../../shared/diy.js';
import { createRngFromState } from '../../server/sim/rng.js';
import { snapshotMatch, restoreMatch, encodeState } from '../../server/match/snapshot.js';
import { openSkillChangeDraft } from '../../server/match/bandCommands.js';
import { recordAction } from '../../server/replays/capture.js';
import { makeMatch, giveItem } from './harness.js';

const version = 'act3autochess@V3_1', data = getVersionData(version);
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const options = { data, version, mode: 'solo', modeId: 'mode_single_12', seed: 93, fake: true };
function fixture(t, extra = {}) {
  const h = makeMatch({ ...options, ...extra });
  t.after(() => h.m.dispose());
  return h;
}
function restore(t, doc, extra = {}) {
  const b = fixture(t, extra);
  assert.equal(restoreMatch(b.m, doc, { createRngFromState, log: quiet }), true);
  return b;
}

test('CUSTOM_CHECK survives a checkpoint without selecting a bring or restocking excluded slots', t => {
  const slots = diySlotIds(data).filter(id => diySlot(id, data)?.tier === 5).slice(0, 2);
  const chars = data.backups.diy.prototypes[5];
  const diy = Object.fromEntries(slots.map((id, i) => [id, { charId: chars[i] }]));
  const seats = [0, 1].map(i => ({ seat: i, playerId: `p_${i}`, name: 'Doctor', connected: true, diy }));
  const a = fixture(t, { mode: 'coop', modeId: 'mode_multi_normal', seats, kitted: chars });
  a.start(); a.m.enterCustomCheck();
  assert.equal(a.m.handle('p_0', { t: 'g.diyBring', slots: [] }).ok, true);
  const before = a.ps('p_1').privateView();
  const doc = snapshotMatch(a.m);
  assert.ok(doc); assert.equal(doc.phase, 'CUSTOM_CHECK');
  const b = restore(t, doc, { mode: 'coop', modeId: 'mode_multi_normal', seats, kitted: chars });
  assert.equal(b.m.phase, 'CUSTOM_CHECK');
  assert.deepEqual(b.ps('p_0').diyBring, []);
  assert.equal(b.ps('p_0').diyStock.entries.size, 0);
  assert.equal(b.ps('p_1').diyBring, null);
  assert.equal(b.ps('p_1').diyStock.entries.size, 0);
  assert.deepEqual(b.ps('p_1').privateView().diy, before.diy);
  assert.equal(b.m.modeId, 'mode_multi_normal');
  assert.ok(b.m.deadline > 0);
  assert.equal(b.m.handle('p_1', { t: 'g.diyBring', slots: [] }).ok, true);
  assert.ok(b.run(() => b.m.phase !== 'CUSTOM_CHECK'));
});

test('regulation prep restores command cost, stock, marks, drafts, temporary layers and equipment overflow', t => {
  const a = fixture(t).start(); a.toPrep(1, { band: 'band_amiya' });
  const ps = a.ps('p_0');
  ps.command.records[ps.command.currentEffectId].totalUsed = 2;
  ps.command.records[ps.command.currentEffectId].currentCost = 7;
  ps.commandMarks.push({ id: 851, persistent: true, round: 1, row: 10, col: 4 });
  ps.commandDiscounts.push({ remaining: 2, amount: 1 });
  assert.equal(openSkillChangeDraft(ps, 'skill_change_1'), true);
  ps.tempLayers = { yanShip: 6 };
  for (let i = 0; i < 7; i++) giveItem(a.m, ps, 'chess_item_1_01_e_a', 'temp', i);
  const saved = snapshotMatch(a.m); assert.ok(saved);
  const b = restore(t, saved), next = b.ps('p_0');
  for (const field of ['command', 'commandMarks', 'commandDiscounts', 'commandDrafts', 'tempLayers', 'temp', '_tempDue', 'diyBring']) {
    assert.deepEqual(encodeState(next[field]), encodeState(ps[field]), field);
  }
  assert.equal(next.temp.filter(Boolean).length, 7);
  assert.equal(next.privateView().stashCount, 2);
  assert.equal(b.m.modeId, 'mode_single_12');
  assert.equal(b.m.version, version);
  assert.deepEqual(next.privateView().command, ps.privateView().command);
});

test('full economy replay records new intent kinds and server views without copying arbitrary input', t => {
  const h = fixture(t).start();
  h.m.replayMaxBytes = 2e6;
  const ps = h.ps('p_0');
  for (const action of ['g.bondGroup', 'g.diyBring', 'g.command', 'g.commandChoice']) {
    recordAction(h.m, ps, { t: action, token: 'never-record-this' });
  }
  assert.deepEqual(h.m.replayArchive.events.filter(e => e.kind === 'action').map(e => e.action),
    ['g.bondGroup', 'g.diyBring', 'g.command', 'g.commandChoice']);
  assert.equal(JSON.stringify(h.m.replayArchive).includes('never-record-this'), false);
  assert.ok(h.m.replayArchive.events.some(e => e.kind === 'view' && e.key === 'public'));
});
