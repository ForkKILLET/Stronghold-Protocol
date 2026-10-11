import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateC2S } from '../shared/protocol.js';
import { isPrepSeconds } from '../shared/prepTime.js';
import { PHASE, ERR } from '../shared/constants.js';
import { makeMatch } from './match/harness.js';
import { snapshotMatch, restoreMatch } from '../server/match/snapshot.js';
import { createRngFromState } from '../server/sim/rng.js';
import { startServer } from '../server/index.js';
import { roomDoc } from '../server/persist.js';
import { TestClient } from './helpers/wsClient.js';
import { phaseTotalSeconds } from '../public/js/ui/gameLogic/phases.js';

const msg = (prepSeconds) => ({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', prepSeconds });
test('room preparation limit accepts old clients, default, untimed and bounded integers', () => {
  for (const value of [undefined, null, 0, 30, 120, 600]) assert.equal(validateC2S(msg(value)), null);
  for (const value of [-1, 1, 29, 601, 1.5, '120', true, {}, Infinity, NaN]) {
    assert.equal(isPrepSeconds(value), false);
    assert.match(validateC2S(msg(value)), /prepSeconds/);
  }
});
function prepare(options = {}) {
  const h = makeMatch({ humans: 2, fake: true, ...options });
  h.start();
  assert.ok(h.drive(() => h.m.phase === PHASE.PREP, { ready: false }));
  return h;
}
test('fixed preparation countdown is authoritative, shown consistently and expires', () => {
  const h = prepare({ prepSeconds: 120 });
  try {
    assert.equal(h.m.deadline - h.sched.now(), 120000);
    assert.equal(h.m.publicView().prepDuration, 120);
    assert.equal(phaseTotalSeconds(h.m.publicView(), h.m.data.config), 120);
    h.sched.advance(119000);
    assert.equal(h.m.phase, PHASE.PREP);
    h.sched.advance(1000);
    assert.notEqual(h.m.phase, PHASE.PREP);
  } finally { h.m.dispose(); }
});
test('untimed preparation waits indefinitely and still ends when everyone readies', () => {
  const h = prepare({ prepSeconds: 0 });
  try {
    assert.equal(h.m.deadline, 0);
    assert.equal(h.m.publicView().prepDuration, null);
    assert.equal(phaseTotalSeconds(h.m.publicView(), h.m.data.config), null);
    h.sched.advance(600000);
    assert.equal(h.m.phase, PHASE.PREP);
    for (const ps of h.m.alivePlayers()) {
      ps.resolveTemp();
      assert.equal(h.m.handle(ps.playerId, { t: 'g.ready', ready: true }).error, undefined);
    }
    h.sched.advance(1);
    assert.notEqual(h.m.phase, PHASE.PREP);
  } finally { h.m.dispose(); }
});
test('default rounds and single-human games preserve existing timing', () => {
  const h = prepare();
  const solo = makeMatch({ humans: 1, bots: 1, prepSeconds: 120, fake: true });
  try {
    assert.equal(h.m.prepTime(), 65);
    assert.equal(h.m.deadline - h.sched.now(), 65000);
    assert.equal(solo.m.prepTime(), null);
    assert.equal(phaseTotalSeconds({ phase: PHASE.PREP, round: 1, modeId: h.m.modeId }, h.m.data.config), 65);
  } finally { h.m.dispose(); solo.m.dispose(); }
});
for (const prepSeconds of [0, 120]) test(`checkpoint preserves room setting ${prepSeconds} and the remaining countdown`, () => {
  const h = prepare({ prepSeconds });
  const restored = makeMatch({ humans: 2, fake: true });
  try {
    h.sched.advance(10000);
    const doc = snapshotMatch(h.m);
    assert.ok(doc);
    assert.equal(restoreMatch(restored.m, doc, { createRngFromState }), true);
    assert.equal(restored.m.prepSeconds, prepSeconds);
    if (prepSeconds) assert.equal(restored.m.deadline - restored.sched.now(), 110000);
    else assert.equal(restored.m.deadline, 0);
  } finally { h.m.dispose(); restored.m.dispose(); }
});
test('two real WebSocket players share room settings; custom rooms cannot enter public queue', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', log: { info() {}, warn() {}, error() {} } });
  const clients = [];
  try {
    for (const name of ['Prep Host', 'Prep Guest']) {
      const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
      clients.push(c);
      c.id = (await c.hello(name)).playerId;
    }
    const [host, guest] = clients;
    assert.equal((await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', prepMultiplier: 2, battleSpeed: 4 })).t, 'ok');
    const state = await host.waitFor('room.state');
    assert.equal(state.battleSpeed,4);
    assert.equal(state.prepMultiplier, 2);
    assert.equal((await guest.request({ t: 'room.join', code: state.code })).t, 'ok');
    assert.equal((await guest.waitFor('room.state')).prepMultiplier, 2);
    assert.equal((await host.request({ t: 'match.join', mode: 'coop', difficulty: 'NORMAL', fillBots: true })).code, ERR.MATCHING);
    const room = srv.lobby.rooms.get(state.code);
    const saved = roomDoc(room);
    assert.equal(saved.prepMultiplier, 2);
    assert.equal((await guest.request({ t: 'room.ready', ready: true })).t, 'ok');
    assert.equal((await host.request({ t: 'room.start' })).t, 'ok');
    assert.equal(room.match.prepTime(), 180);
    assert.equal(room.match.publicView().prepMultiplier, 2);
    assert.equal((await host.request(msg(601))).code, ERR.BAD_MSG);
  } finally {
    for (const c of clients) await c.close();
    await srv.close();
  }
});

test('creation control supports fixed values, invalid input and keyboard-friendly mode buttons', async () => {
  const { PrepTimePicker, validPrepChoice, prepChoiceMultiplier } = await import('../public/js/ui/prepTime.js');
  assert.equal(validPrepChoice('2'), true);
  for (const value of ['', '0', '0.25', '4.25', '1.1']) assert.equal(validPrepChoice(value), false);
  assert.equal(prepChoiceMultiplier('2'), 2);
  assert.equal(validPrepChoice(0), true);
  const selected = [];
  function elements(v, type, out = []) {
    if (!v || typeof v !== 'object') return out;
    if (Array.isArray(v)) { for (const item of v) elements(item, type, out); return out; }
    if (v.type === type) out.push(v);
    elements(v.props?.children, type, out);
    return out;
  }
  const view = PrepTimePicker({ value: '2', onChange: value => selected.push(value) });
  const input = elements(view, 'input')[0];
  assert.equal(input.props.type, 'number');
  assert.equal(input.props['aria-invalid'], false);
  input.props.onInput({ currentTarget: { value: '3' } });
  assert.equal(selected.pop(), '3');
  const buttons = elements(view, 'button');
  assert.equal(buttons[1].props['aria-pressed'], true);
  buttons[0].props.onClick();
  assert.equal(selected.pop(), null);
  buttons[2].props.onClick();
  assert.equal(selected.pop(), 0);
  const bad = PrepTimePicker({ value: '', onChange() {} });
  assert.equal(elements(bad, 'input')[0].props['aria-invalid'], true);
  const pending = PrepTimePicker({ value: null, disabled: true, onChange() {} });
  assert.ok(elements(pending, 'button').every(v => v.props.disabled));
});


test('multiplier validation retains old clients and permits only bounded quarter steps', async () => {
  const { isPrepMultiplier, normalizePrepMultiplier } = await import('../shared/prepTime.js');
  for (const value of [undefined, null, 0, 0.5, 0.75, 1, 1.5, 2, 4]) {
    assert.equal(isPrepMultiplier(value), true);
    assert.equal(validateC2S({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', prepMultiplier: value }), null);
  }
  for (const value of [-1, 0.25, 4.25, 1.1, '2', true, {}, Infinity, NaN]) assert.equal(isPrepMultiplier(value), false);
  assert.equal(normalizePrepMultiplier(1), null);
});
test('multiplier follows different per-round defaults and publishes their scaled durations', () => {
  const h = prepare({ prepMultiplier: 2 });
  const lone = makeMatch({ humans: 1, bots: 1, prepMultiplier: 2, fake: true });
  try {
    assert.equal(h.m.deadline - h.sched.now(), 130000);
    assert.equal(h.m.publicView().prepDuration, 130);
    assert.equal(phaseTotalSeconds(h.m.publicView(), h.m.data.config), 130);
    h.m.round = 4;
    assert.equal(h.m.prepTime(), 190);
    h.m.round = 14;
    assert.equal(h.m.prepTime(), 390);
    assert.equal(lone.m.prepTime(), null);
  } finally { h.m.dispose(); lone.m.dispose(); }
});
for (const prepMultiplier of [0, 0.75, 2]) test(`multiplier ${prepMultiplier} survives checkpoint recovery`, () => {
  const h = prepare({ prepMultiplier });
  const restored = makeMatch({ humans: 2, fake: true });
  try {
    h.sched.advance(10000);
    const doc = snapshotMatch(h.m);
    assert.equal(restoreMatch(restored.m, doc, { createRngFromState }), true);
    assert.equal(restored.m.prepMultiplier, prepMultiplier);
    if (prepMultiplier) assert.equal(restored.m.deadline - restored.sched.now(), Math.round(65 * prepMultiplier) * 1000 - 10000);
    else assert.equal(restored.m.deadline, 0);
  } finally { h.m.dispose(); restored.m.dispose(); }
});
