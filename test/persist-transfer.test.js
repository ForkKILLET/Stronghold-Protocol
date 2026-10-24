import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { PersistenceWorker } from '../server/workers/persistenceClient.js';
import { makeMatch } from './match/harness.js';
import { captureMatch } from '../server/match/snapshot.js';

const decode = result => JSON.parse(Buffer.from(result.bytes).toString());

test('large session/seat metadata yields between bounded batches and preserves the document and shared profiles', async t => {
  const worker = new PersistenceWorker();
  t.after(() => worker.close());
  const sessions = Array.from({ length: 80 }, (_, i) => ({ playerId: `p${i}`, name: `Name ${i}`,
    loadout: { char_1: { skill: 1 } }, ops: { char_1: [1, 2] }, notOwned: ['char_2'],
    skins: { char_1: 'skin_1' }, card: null, pendingResult: ['settlement'] }));
  const doc = { v: 1, savedAt: 123, sessions, rooms: Array.from({ length: 20 }, (_, i) => ({ code: `R${i}`,
    seats: sessions.slice(i * 4, i * 4 + 4).map(s => ({ playerId: s.playerId, loadout: s.loadout, ops: s.ops })),
    hasMatch: false })), recovery: {}, matchDepartures: { old: ['departed'] }, matchBattleSeq: { old: 2 } };
  const request = worker.request.bind(worker);
  let batches = 0, profiles = 0, turnRan = false;
  worker.request = (type, payload, ...rest) => {
    if (type === 'documentBatch') {
      assert.ok(payload.rows.length <= 8);
      if (batches++) assert.ok(turnRan, 'main-thread work runs before the next batch');
      else setImmediate(() => { turnRan = true; });
      profiles += payload.values.length;
    }
    if (type === 'documentStart' || type === 'serialize') {
      assert.ok(!payload.doc?.sessions && !payload.doc?.rooms, 'large arrays never enter a single postMessage');
    }
    return request(type, payload, ...rest);
  };
  const first = await worker.serialize(doc, []);
  assert.deepEqual(decode(first), { ...doc, matches: {} });
  assert.equal(batches, 13);
  assert.equal(profiles, sessions.length * 5, 'seat profiles are reused across message boundaries');
  assert.equal(first.postBatches, batches + 2);
  assert.ok(first.postMs >= first.postMaxMs && first.postMaxMs >= 0);
  // Do not cache by identity between saves: old restored structures need not be frozen.
  sessions[0].loadout.char_1.skill = 3;
  sessions.pop();
  doc.rooms.length = 1;
  const second = decode(await worker.serialize(doc, []));
  assert.deepEqual(second, { ...doc, matches: {} });
  assert.equal(second.sessions[0].loadout.char_1.skill, 3);
  assert.equal(second.rooms[0].seats[0].loadout.char_1.skill, 3);
});

test('an interrupted metadata transfer never saves a partial document and a retry reseeds the last safe checkpoints', async t => {
  const worker = new PersistenceWorker();
  const h = makeMatch({ humans: 1, fake: true });
  t.after(async () => { h.m.dispose(); await worker.close(); });
  h.start();
  const entries = [{ key: 'TEST', generation: 1 }];
  await worker.request('checkpoint', { ...entries[0], capture: captureMatch(h.m) });
  const saved = await worker.serialize({ v: 1, sessions: [{ name: 'saved' }], recovery: {} }, entries);
  assert.ok(saved.bytes.buffer instanceof SharedArrayBuffer, 'restart seed shares encoded bytes without a main-thread copy');
  worker.remember(saved.bytes, entries);
  const request = worker.request.bind(worker);
  let interrupted = false;
  worker.request = async (type, payload, ...rest) => {
    const result = await request(type, payload, ...rest);
    if (type === 'documentBatch' && !interrupted) {
      interrupted = true;
      worker.drop(worker.worker, new Error('simulated transfer failure'));
    }
    return result;
  };
  await assert.rejects(worker.serialize({ v: 1, sessions: Array.from({ length: 24 }, () => ({ name: 'partial' })) }, entries),
    /worker changed/);
  assert.equal(worker.serializing, false);
  assert.equal(worker.pending.size, 0);
  const retried = decode(await worker.serialize({ v: 1, sessions: [{ name: 'retry' }], recovery: {} }, entries));
  assert.deepEqual(retried.sessions, [{ name: 'retry' }]);
  assert.deepEqual(retried.matches, decode(saved).matches);
  assert.deepEqual(decode(saved).sessions, [{ name: 'saved' }], 'later encodes never mutate a committed snapshot');
});

test('matches started or replaced while metadata yields keep their new checkpoints for the next save', async t => {
  const worker = new PersistenceWorker();
  const h = makeMatch({ humans: 1, fake: true });
  t.after(async () => { h.m.dispose(); await worker.close(); });
  h.start();
  const old = [{ key: 'ROOM', generation: 1 }];
  await worker.request('checkpoint', { ...old[0], capture: captureMatch(h.m) });
  const request = worker.request.bind(worker);
  let updated = false;
  worker.request = async (type, payload, ...rest) => {
    const result = await request(type, payload, ...rest);
    if (type === 'documentBatch' && !updated) {
      updated = true;
      h.m.order[0].funds += 10;
      await request('checkpoint', { key: 'ROOM', generation: 2, capture: captureMatch(h.m) });
      await request('checkpoint', { key: 'NEW', generation: 3, capture: captureMatch(h.m) });
    }
    return result;
  };
  const first = decode(await worker.serialize({ sessions: [{ playerId: 'old' }] }, old, 1));
  assert.deepEqual(first.matches, {}, 'newer checkpoints cannot be attached to an older metadata snapshot');
  await nextTurn();
  const second = decode(await worker.serialize({}, [{ key: 'ROOM', generation: 2 }, { key: 'NEW', generation: 3 }], 3));
  assert.deepEqual(Object.keys(second.matches).sort(), ['NEW', 'ROOM']);
  assert.equal(second.matches.ROOM.players[0].funds, h.m.order[0].funds);
  const removed = decode(await worker.serialize({}, [], 3));
  assert.deepEqual(removed.matches, {});
  const stale = decode(await worker.serialize({}, [{ key: 'ROOM', generation: 2 }], 3));
  assert.deepEqual(stale.matches, {}, 'ended checkpoints are pruned once within the snapshot boundary');
});

test('replay/combat result outbox is batched, survives transfer failure, and retains private profile metadata', async t => {
  const worker = new PersistenceWorker();
  t.after(() => worker.close());
  const entry = i => ({ id: 'match-' + i, endedAt: 1000, rows: [{ userId: 'account', playerId: 'p' }],
    replay: { events: [{ at: 1, payload: 'x'.repeat(128 * 1024) }] },
    combat: { fields: [{ battleId: 'battle-' + i, playerId: 'p', round: 1 }] } });
  const doc = { v: 1, sessions: [{ userId: 'account', avatarId: 'avatar:Avatar_def_01', publicId: '5JT4' }],
    rooms: [], recovery: {}, userResultOutbox: Array.from({ length: 12 }, (_, i) => entry(i)) };
  const request = worker.request.bind(worker);
  let batches = 0, interrupt = false;
  worker.request = async (type, payload, ...rest) => {
    if (type === 'documentStart') assert.equal(payload.doc.userResultOutbox, undefined, 'attachments are not in the initial clone');
    if (type === 'documentBatch' && payload.field === 'userResultOutbox') {
      assert.equal(payload.rows.length, 1, 'large results are sent individually'); batches++;
    }
    const result = await request(type, payload, ...rest);
    if (interrupt && type === 'documentBatch' && payload.field === 'userResultOutbox') {
      interrupt = false; worker.drop(worker.worker, new Error('test outbox interruption'));
    }
    return result;
  };
  const saved = await worker.serialize(doc, []); worker.remember(saved.bytes, []);
  assert.equal(batches, doc.userResultOutbox.length);
  assert.deepEqual(decode(saved), { ...doc, matches: {} });
  interrupt = true;
  await assert.rejects(worker.serialize({ ...doc, userResultOutbox: [entry('partial')] }, []), /worker changed/);
  assert.deepEqual(decode(saved).userResultOutbox, doc.userResultOutbox, 'partial transfers never mutate committed bytes');
  assert.deepEqual(decode(await worker.serialize(doc, [])), { ...doc, matches: {} });
  assert.deepEqual(decode(await worker.serialize({ ...doc, userResultOutbox: [] }, [])).userResultOutbox, []);
});
