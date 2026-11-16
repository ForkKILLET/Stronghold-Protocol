import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchCardCounter } from '../../public/js/ui/cardCounterClient.js';
import { counterRoster, favoriteOperators, pinnedTools, oddsText } from '../../public/js/ui/gameToolsModel.js';
import { getVersionData } from '../../server/data.js';

function clientFixture() {
  let now = 0, id = 0, visible = true;
  const queue = new Map(), listeners = new Set(), requests = [], states = [];
  const timers = { setTimeout(fn, delay) { const key = ++id; queue.set(key, { fn, at: now + delay }); return key; }, clearTimeout(key) { queue.delete(key); } };
  const net = { on(type, fn) { assert.equal(type, 'm.cardCounter'); listeners.add(fn); return () => listeners.delete(fn); },
    request(type, fields) { requests.push({ type, ...fields }); return Promise.resolve(); } };
  const options = { net, timers, visible: () => visible, chessId: 'target', playerId: 'p1', matchKey: 'room:1', onState: state => states.push(state) };
  const advance = ms => {
    const until = now + ms;
    for (;;) { const task = [...queue].sort((a, b) => a[1].at - b[1].at)[0]; if (!task || task[1].at > until) break; now = task[1].at; queue.delete(task[0]); task[1].fn(); }
    now = until;
  };
  const emit = fields => { const msg = { t: 'm.cardCounter', seq: requests.at(-1).seq, chessId: 'target', playerId: 'p1', matchKey: 'room:1', holders: [], odds: { slot: .01 }, ...fields }; for (const fn of listeners) fn(msg); };
  return { options, requests, states, advance, emit, queue, listeners, net, hide: () => { visible = false; }, show: () => { visible = true; } };
}

test('the tracker polls only while open, has one in-flight query, and disposes subscriptions and timers', () => {
  const f = clientFixture(), live = watchCardCounter(f.options);
  assert.equal(f.requests.length, 1);
  live.refresh(); live.refresh();
  assert.equal(f.requests.length, 1);
  f.emit({ remaining: 7 });
  assert.equal(f.states.at(-1).data.remaining, 7);
  f.advance(1999); assert.equal(f.requests.length, 1);
  f.advance(1); assert.equal(f.requests.length, 2);
  live.stop(); f.advance(10000);
  assert.equal(f.requests.length, 2);
  assert.equal(f.queue.size, 0);
  assert.equal(f.listeners.size, 0);
});

test('stale or foreign target, player, match and sequence replies cannot overwrite displayed data', () => {
  const f = clientFixture(), live = watchCardCounter(f.options);
  for (const foreign of [{ seq: 0 }, { chessId: 'other' }, { playerId: 'p2' }, { matchKey: 'room:old' }]) f.emit({ remaining: 99, ...foreign });
  assert.equal(f.states.at(-1).data, null);
  f.emit({ remaining: 8 });
  const old = f.requests.at(-1).seq;
  live.stop();
  const next = watchCardCounter(f.options);
  assert.notEqual(f.requests.at(-1).seq, old);
  f.emit({ seq: old, remaining: 99 });
  assert.equal(f.states.at(-1).data, null);
  f.emit({ remaining: 5 }); assert.equal(f.states.at(-1).data.remaining, 5);
  next.stop();
});

test('a hidden tab stops requesting until it becomes visible; waking does not duplicate an in-flight request', () => {
  const f = clientFixture(), live = watchCardCounter(f.options);
  f.emit({ remaining: 2 }); f.hide(); f.advance(10000);
  assert.equal(f.requests.length, 1);
  f.show(); live.refresh(); assert.equal(f.requests.length, 2);
  live.refresh(); assert.equal(f.requests.length, 2);
  live.stop();
});

test('timeouts expose an error and retain the last confirmed values, never a fabricated zero', () => {
  const f = clientFixture(), live = watchCardCounter(f.options);
  f.emit({ remaining: 4 }); f.advance(2000); f.advance(5000);
  assert.equal(f.states.at(-1).error, 'TIMEOUT');
  assert.equal(f.states.at(-1).data.remaining, 4);
  f.advance(2000);
  assert.equal(f.states.at(-1).loading, true);
  assert.equal(f.states.at(-1).error, 'TIMEOUT', 'retrying must not relabel stale data as current');
  f.emit({ remaining: 3 });
  assert.equal(f.states.at(-1).error, null);
  assert.equal(f.states.at(-1).data.remaining, 3);
  live.stop();
});

test('an older server rejecting the unknown feature does not get an automatic request loop', async () => {
  const f = clientFixture();
  f.net.request = (type, fields) => { f.requests.push({ type, ...fields }); return Promise.reject({ code: 'BAD_MSG' }); };
  const live = watchCardCounter(f.options);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.states.at(-1).error, 'BAD_MSG');
  f.advance(60000);
  assert.equal(f.requests.length, 1);
  live.stop();
});

test('tool pins and operator favorites survive explicit empty choices and reject corrupt preference data', () => {
  assert.deepEqual(pinnedTools(null), ['metrics']);
  assert.deepEqual(pinnedTools({ v: 1, pinned: [] }), []);
  assert.deepEqual(pinnedTools({ v: 1, pinned: ['cards', 'unknown', 'cards', 'metrics'] }), ['metrics', 'cards']);
  assert.deepEqual(favoriteOperators(null), ['char_249_mlyss']);
  assert.deepEqual(favoriteOperators({ v: 1, favorites: [] }), []);
  assert.deepEqual(favoriteOperators({ v: 1, favorites: ['chess_char_6_11_a', '__proto__', 'char_249_mlyss', 'char_249_mlyss'] }), ['char_249_mlyss']);
});

test('the default favorite resolves to the same operator across seasons with different chess ids', () => {
  const id = favoriteOperators(null)[0];
  const rows = ['act2autochess', 'act3autochess@V3_1'].map(version => counterRoster(Object.values(getVersionData(version).chess)));
  const picks = rows.map(roster => roster.find(c => c.charId === id));
  assert.equal(picks[0].name, '缪尔赛思'); assert.equal(picks[1].name, '缪尔赛思');
  assert.notEqual(picks[0].chessId, picks[1].chessId);
  assert.ok(rows.every(roster => roster.every(c => c.visible && !c.isHidden && !c.isDiy && !c.isGolden)));
});

test('very low positive odds never appear as zero, and missing or invalid odds stay unknown', () => {
  assert.equal(oddsText(0), '0%'); assert.equal(oddsText(1), '100%');
  assert.equal(oddsText(.000000001), '<0.001%');
  for (const bad of [null, undefined, NaN, -1, 2]) assert.equal(oddsText(bad), '—');
});
