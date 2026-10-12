import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { startServer } from '../server/index.js';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { Match } from '../server/match/Match.js';
import { Persister, restoreServer, snapshotServer } from '../server/persist.js';
import { MatchWorkerPool } from '../server/workers/matchPool.js';
import { DATA } from './match/harness.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { FakeBattle } from './match/fakeBattle.js';
import { TestClient } from './helpers/wsClient.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

function environment(t, { remote = false, MatchClass = StubMatch, empty = false } = {}) {
  const pool = remote ? new MatchWorkerPool({ data: DATA, lanes: 1, log: quiet }) : null;
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, getData: () => DATA, MatchClass, matchWorkerPool: pool, log: quiet });
  t.after(async () => { lobby.shutdown(); await pool?.close(); });
  if (empty) return { registry, lobby, pool };
  const players = Array.from({ length: 4 }, (_, i) => {
    const s = registry.create(`Player ${i}`);
    s.connected = true;
    return s;
  });
  lobby.create(players[0], { mode: 'coop', difficulty: 'NORMAL' });
  const room = lobby.roomOf(players[0]);
  return { registry, lobby, pool, players, room };
}

async function start(env) {
  const { lobby, room, players } = env;
  assert.equal((await lobby.startQueuedMatch({ room, mode: 'coop', difficulty: 'NORMAL' },
    players.map((s, i) => lobby.humanSeat(i, s)), [])).ok, true);
  return room.matchCtx;
}

for (const remote of [false, true]) {
  const label = remote ? 'Worker' : 'local';

  for (const departure of ['g.leave', 'room.leave', 'expired']) {
    test(`${label}: ${departure} of the owning room's last member preserves matched players over WS`, async (t) => {
      const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, log: quiet,
        workers: 0, roomWorkers: 0, matchWorkers: remote ? 1 : 0, store: null, nameModeration: null });
      const clients = [];
      t.after(async () => {
        for (const c of clients) await c.terminate();
        await srv.close();
      });
      const url = `ws://127.0.0.1:${srv.port}/ws`;
      const welcomes = [];
      for (let i = 0; i < 4; i++) {
        const c = await TestClient.connect(url);
        clients.push(c);
        welcomes.push(await c.hello(`WS player ${i}`));
      }
      assert.equal((await clients[0].request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
      const code = (await clients[0].waitFor('room.state')).code;
      for (const c of clients) assert.equal((await c.request({ t: 'match.join', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
      for (const c of clients) await c.waitFor('m.public', () => true, 10000);
      const ctx = srv.lobby.getRoom(code).matchCtx;
      if (departure === 'expired') {
        await clients[0].terminate();
        await clients[1].waitFor('m.public', (m) => m.players.some((p) => p.playerId === welcomes[0].playerId && !p.connected), 10000);
        const host = srv.registry.byId(welcomes[0].playerId);
        host.disconnectedAt = Date.now() - srv.registry.reconnectWindowMs - 1;
        srv.network.sweep();
      } else {
        assert.equal((await clients[0].request({ t: departure }, 10000)).t, 'ok');
      }
      assert.equal(srv.lobby.getRoom(code)?.matchCtx, ctx);
      assert.equal(ctx.disposed, false);
      for (let i = 1; i < 4; i++) {
        assert.equal((await clients[i].request({ t: 'g.autoplay', on: true }, 10000)).t, 'ok');
        assert.equal(clients[i].log.some((m) => m.t === 'room.closed'), false);
      }
      const back = await TestClient.connect(url);
      clients.push(back);
      assert.equal((await back.hello('WS player 1', welcomes[1].token)).resumed, true);
      await back.waitFor('m.public', (m) => m.players.some((p) => p.playerId === welcomes[1].playerId), 10000);
      await back.waitFor('m.private', () => true, 10000);
      assert.equal((await back.request({ t: 'g.autoplay', on: false }, 10000)).t, 'ok');
    });
  }

  test(`${label}: owning-room departures are persisted before Worker acknowledgement and survive consecutive restores`, async (t) => {
    const env = environment(t, { remote, MatchClass: Match });
    // Public teammate and another room party retain distinct room ownership.
    env.lobby.create(env.players[2], { mode: 'coop', difficulty: 'NORMAL' });
    const otherCode = env.players[2].roomCode;
    env.lobby.join(env.players[3], { code: otherCode });
    const ctx = await start(env);
    const cp = remote ? await ctx.match.snapshot() : null;
    assert.equal((await env.lobby.routeGame(env.players[0], { t: 'g.leave' })).ok, true);
    const metadata = snapshotServer(env);
    assert.deepEqual(metadata.matchDepartures[env.room.code], [env.players[0].playerId]);
    assert.equal(env.lobby.persistenceMatches()[0].key, env.room.code);
    const persister = new Persister({ ...env, store: { async save() { return true; } }, log: quiet });
    t.after(() => persister.encoder.close());
    assert.equal(await persister.flush('after-owner-departure'), true);
    let doc = await persister.document();
    // A pre-departure safe checkpoint must use the current independent departure record.
    if (cp) doc.matches[env.room.code] = cp;
    for (let i = 0; i < 2; i++) {
      const back = environment(t, { remote, MatchClass: Match, empty: true });
      const initial = restoreServer({ doc, ...back, log: quiet });
      const stats = initial.ready ? await initial.ready : initial;
      assert.equal(stats.matches, 1);
      const room = back.lobby.getRoom(env.room.code);
      assert.ok(room.match);
      assert.equal(room.activeHumans().length, 0, 'do not assign public teammates to the emptied original room');
      assert.equal(back.registry.byId(env.players[0].playerId).activeMatchCtx, undefined);
      assert.equal(back.registry.byId(env.players[1].playerId).roomCode, null);
      for (const player of env.players.slice(2)) assert.equal(back.registry.byId(player.playerId).roomCode, otherCode);
      for (const player of env.players.slice(1)) {
        const session = back.registry.byId(player.playerId);
        assert.equal(session.activeMatchCtx, room.matchCtx);
        assert.equal((await back.lobby.routeGame(session, { t: 'g.autoplay', on: true })).ok, true);
      }
      const saved = new Persister({ ...back, store: { async save() { return true; } }, log: quiet });
      t.after(() => saved.encoder.close());
      assert.equal(await saved.flush('restart-again'), true);
      doc = await saved.document();
    }
  });

  test(`${label}: the last external teammate frees the retained room and its lane`, async (t) => {
    const env = environment(t, { remote });
    const ctx = await start(env);
    for (const p of env.players) assert.equal((await env.lobby.routeGame(p, { t: 'g.leave' })).ok, true);
    await ctx.match.dispose();
    await nextTurn();
    assert.equal(env.lobby.rooms.size, 0);
    assert.equal(env.lobby.activeQueueMatches.size, 0);
    assert.equal(ctx.disposed, true);
    for (const p of env.players) assert.equal(p.activeMatchCtx, null);
    if (remote) assert.equal(env.pool.stats().rooms, 0);
  });

  test(`${label}: a new matched game clears the external teammate's previous settlement replay`, async (t) => {
    const env = environment(t, { remote });
    env.players[1].pendingResult = ['{"t":"m.result","victory":true}'];
    await start(env);
    assert.equal(env.players[1].pendingResult, null);
  });
}

test('the original member can leave during Worker initialization without cancelling external teammates', async (t) => {
  const env = environment(t, { remote: true });
  const starting = start(env);
  const ctx = env.room.matchCtx;
  assert.equal(ctx.match.ready, false);
  assert.equal(env.lobby.routeGame(env.players[0], { t: 'g.leave' }).ok, true);
  assert.equal(await starting, ctx);
  assert.equal(env.room.disposed, false);
  assert.equal(env.pool.stats().rooms, 1);
  assert.equal((await ctx.match.snapshot()).players.find((p) => p.playerId === env.players[0].playerId).left, true);
  for (const p of env.players.slice(1)) assert.equal((await env.lobby.routeGame(p, { t: 'g.autoplay', on: false })).ok, true);
});

test('a departed original member is not revived when its Worker dies before acknowledging onLeave', async (t) => {
  const env = environment(t, { remote: true });
  const ctx = await start(env);
  const persister = new Persister({ ...env, store: { async save() { return true; } }, log: quiet });
  t.after(() => persister.encoder.close());
  assert.equal(await persister.flush('before-crash'), true);
  await ctx.match.lane.worker.terminate();
  env.lobby.routeGame(env.players[0], { t: 'g.leave' });
  await nextTurn();
  assert.equal(await persister.flush('after-crash'), true);
  const doc = await persister.document();
  assert.deepEqual(doc.matchDepartures[env.room.code], [env.players[0].playerId]);
  assert.ok(doc.matches[env.room.code]);
  const back = environment(t, { empty: true, MatchClass: Match });
  assert.equal(restoreServer({ doc, ...back, log: quiet }).matches, 1);
  const restored = back.lobby.getRoom(env.room.code).matchCtx;
  assert.equal(restored.match.players.get(env.players[0].playerId).left, true);
  for (const p of env.players.slice(1)) assert.equal(back.registry.byId(p.playerId).activeMatchCtx, restored);
});

test('a deferred empty-room checkpoint is retained without leaking a room container', async (t) => {
  const env = environment(t, { MatchClass: Match });
  await start(env);
  env.lobby.routeGame(env.players[0], { t: 'g.leave' });
  const persister = new Persister({ ...env, store: { async save() { return true; } }, log: quiet });
  t.after(() => persister.encoder.close());
  assert.equal(await persister.flush('before-deferred-restore'), true);
  const doc = await persister.document();
  const back = environment(t, { empty: true, MatchClass: Match });
  back.lobby.getData = () => ({});
  const stats = restoreServer({ doc, ...back, log: quiet });
  assert.equal(stats.matches, 0);
  assert.equal(stats.deferredMatches, 1);
  assert.equal(back.lobby.rooms.size, 0);
  assert.equal(back.lobby.activeQueueMatches.size, 0);
  assert.deepEqual(back.lobby.recoveryDocs.get(env.room.code).checkpoint, doc.matches[env.room.code]);
  for (const p of env.players.slice(1)) assert.ok(back.registry.byToken(p.token));
});

test('a secondary party room.leave removes only that player from the shared match', async (t) => {
  const env = environment(t);
  env.lobby.create(env.players[2], { mode: 'coop', difficulty: 'NORMAL' });
  const otherRoom = env.lobby.roomOf(env.players[2]);
  const ctx = await start(env);
  assert.equal(env.lobby.leave(env.players[2]).ok, true);
  assert.equal(ctx.members.find((p) => p.playerId === env.players[2].playerId).left, true);
  assert.equal(env.players[2].activeMatchCtx, null);
  assert.equal(otherRoom.disposed, true);
  assert.equal(ctx.disposed, false);
  assert.equal(env.lobby.routeGame(env.players[1], { t: 'g.autoplay', on: true }).ok, true);
});

test('an original party of two can leave in PREP without changing the surviving players economy', async (t) => {
  class TestMatch extends Match {
    constructor(opts) {
      super({ ...opts, scheduler: new VirtualScheduler({ instantCombat: true }),
        BattleClass: FakeBattle, botRehearsal: 0, clientCombat: false });
    }
  }
  const env = environment(t, { MatchClass: TestMatch });
  env.lobby.join(env.players[1], { code: env.room.code });
  const ctx = await start(env);
  assert.ok(ctx.match.sched.runUntil(() => ctx.match.phase === 'PREP', { maxSteps: 20000 }));
  const funds = env.players.slice(2).map((p) => ctx.match.players.get(p.playerId).funds);
  env.lobby.routeGame(env.players[0], { t: 'g.leave' });
  assert.equal(env.room.hostId, env.players[1].playerId);
  env.lobby.routeGame(env.players[1], { t: 'g.leave' });
  assert.equal(env.room.hostId, null);
  assert.equal(ctx.match.phase, 'PREP');
  assert.equal(ctx.match.disposed, false);
  assert.deepEqual(env.players.slice(2).map((p) => ctx.match.players.get(p.playerId).funds), funds);
  for (const p of env.players.slice(2)) assert.equal(env.lobby.routeGame(p, { t: 'g.autoplay', on: false }).ok, true);
});

test('the last matched departure releases an empty room even when its match hook cannot complete', async (t) => {
  const env = environment(t);
  const ctx = await start(env);
  ctx.match.onLeave = () => { throw new Error('failed lifecycle hook'); };
  assert.equal(env.lobby.routeGame(env.players[0], { t: 'g.leave' }).ok, true);
  assert.equal(ctx.disposed, false);
  for (const p of env.players.slice(1)) assert.equal(env.lobby.routeGame(p, { t: 'g.leave' }).ok, true);
  await nextTurn();
  assert.equal(ctx.disposed, true);
  assert.equal(env.lobby.rooms.size, 0);
  assert.equal(env.lobby.activeQueueMatches.size, 0);
});

test('empty owning rooms do not lose offline external teammates settlements or their own rooms', async (t) => {
  const env = environment(t);
  env.lobby.create(env.players[2], { mode: 'coop', difficulty: 'NORMAL' });
  const otherCode = env.players[2].roomCode;
  const ctx = await start(env);
  env.lobby.routeGame(env.players[0], { t: 'g.leave' });
  const guest = env.players[2];
  guest.connected = false;
  env.lobby.onDisconnect(guest);
  const pub = JSON.stringify({ t: 'm.public', phase: 'RESULT' });
  const result = JSON.stringify({ t: 'm.result', victory: true });
  ctx.lastPublic = pub;
  assert.equal(env.lobby.queueMatchSend(ctx, guest.playerId, { t: 'm.result', victory: true }, result), false);
  env.lobby.onQueuedMatchEnd(ctx, { victory: true });
  await nextTurn();
  assert.equal(env.lobby.rooms.has(env.room.code), false);
  assert.equal(guest.roomCode, otherCode);
  assert.deepEqual(guest.pendingResult, [pub, result]);
  const received = [];
  guest.ws = { readyState: 1, bufferedAmount: 0, send: (data) => received.push(JSON.parse(data)) };
  guest.connected = true;
  env.lobby.onHello(guest, { resumed: true, repeat: false });
  assert.deepEqual(received.map((m) => m.t), ['room.state', 'm.public', 'm.result']);
});
