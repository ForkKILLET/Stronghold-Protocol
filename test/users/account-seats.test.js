import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../server/index.js';
import { TestClient } from '../helpers/wsClient.js';

async function harness(t, remote) {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workers: 0,
    matchWorkers: remote ? 1 : 0, userFile: ':memory:', nameModeration: null, assetIndex: false });
  const clients = [];
  t.after(async () => { await Promise.all(clients.map(c => c.close())); await server.close(); });
  const identity = async () => {
    const r = await fetch(server.url + '/api/user');
    return r.headers.get('set-cookie').split(';')[0];
  };
  return {
    server, identity,
    async connect(cookie, token) {
      const c = await TestClient.connect(server.url.replace('http:', 'ws:') + '/ws', { wsOptions: { headers: { Cookie: cookie } } });
      clients.push(c);
      const welcome = await c.hello('account test', token);
      return { c, welcome, s: server.registry.byId(welcome.playerId) };
    },
    async create(player, mode = 'coop') {
      assert.equal((await player.c.request({ t: 'room.create', mode, difficulty: 'NORMAL' })).t, 'ok');
      const state = await player.c.waitFor('room.state', m => m.code === player.s.roomCode);
      assert.ok(state.seats.every(s => !s || !('userId' in s)));
      return server.lobby.rooms.get(state.code);
    },
  };
}

const queue = { t: 'match.join', mode: 'coop', difficulty: 'NORMAL' };
const blocked = async (player, msg) => assert.equal((await player.c.request(msg)).code, 'ACCOUNT_ACTIVE');
const ok = async (player, msg) => assert.equal((await player.c.request(msg)).t, 'ok');

for (const remote of [false, true]) {
  const backend = remote ? 'Worker' : 'local';
  test(`${backend}: one profile can run separate simulations and resume either session`, { timeout: 40000 }, async t => {
    const h = await harness(t, remote), cookie = await h.identity();
    const a = await h.connect(cookie), b = await h.connect(cookie);
    assert.notEqual(a.s.playerId, b.s.playerId);
    assert.equal(a.s.userId, b.s.userId);
    const first = await h.create(a, 'solo'), second = await h.create(b, 'solo');
    for (const player of [a, b]) {
      await ok(player, { t: 'room.start' });
      const pub = await player.c.waitFor('m.public', () => true, 15000);
      assert.ok(pub.players.every(p => !('userId' in p)));
    }
    assert.ok(first.match && second.match && first.match !== second.match);
    assert.equal((await a.c.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' })).code, 'ROOM_STARTED');
    await a.c.terminate();
    // Another tab may start while the original disconnected seat stays resumable.
    const c = await h.connect(cookie), third = await h.create(c, 'solo');
    await ok(c, { t: 'room.start' }); await c.c.waitFor('m.public', () => true, 15000);
    const resumed = await h.connect(cookie, a.welcome.token);
    assert.equal(resumed.s.playerId, a.s.playerId);
    assert.equal(resumed.s.roomCode, first.code);
    await resumed.c.waitFor('m.public', () => true, 15000);
    await ok(resumed, { t: 'g.leave' });
    assert.ok(second.match && !second.matchCtx.disposed && third.match && !third.matchCtx.disposed);
    await ok(b, { t: 'g.infoReady' }); await ok(c, { t: 'g.infoReady' });
  });

  test(`${backend}: duplicate seating is scoped to the target room, including disconnected seats`, { timeout: 40000 }, async t => {
    const h = await harness(t, remote), cookie = await h.identity();
    const a = await h.connect(cookie), b = await h.connect(cookie), other = await h.connect(await h.identity());
    const first = await h.create(a), second = await h.create(b);
    await blocked(b, { t: 'room.join', code: first.code });
    assert.equal(b.s.roomCode, second.code, 'a rejected join preserves the other room');
    await ok(other, { t: 'room.join', code: first.code });
    await ok(b, { t: 'room.spectate', code: first.code });
    await blocked(b, { t: 'room.join', code: first.code });
    await a.c.terminate();
    await blocked(b, { t: 'room.join', code: first.code });
    const resumed = await h.connect(cookie, a.welcome.token);
    await ok(resumed, { t: 'room.spectate', code: first.code });
    await ok(b, { t: 'room.join', code: first.code });
    await blocked(resumed, { t: 'room.join', code: first.code });
    // Defense in depth for rooms restored from before the per-match restriction.
    const userId = other.s.userId; other.s.userId = a.s.userId;
    await blocked(other, { t: 'room.start' }); await blocked(other, queue);
    other.s.userId = userId;
    await ok(b, { t: 'room.leave' });
    await ok(resumed, { t: 'room.join', code: first.code });
  });

  test(`${backend}: overlapping profile tickets form different public matches`, { timeout: 50000 }, async t => {
    const h = await harness(t, remote), cookie = await h.identity();
    const a = await h.connect(cookie), b = await h.connect(cookie), others = [];
    for (let i = 0; i < 6; i++) others.push(await h.connect(await h.identity()));
    // A party and a solo ticket overlap through a non-host party member.
    const room = await h.create(others[0]);
    await ok(a, { t: 'room.join', code: room.code }); await ok(a, { t: 'room.ready', ready: true });
    await ok(others[0], queue); await ok(b, queue);
    assert.equal(room.matching.count, 2);
    assert.equal(b.c.log.filter(m => m.t === 'match.queue').at(-1).count, 1);
    await ok(others[1], queue); await ok(others[2], queue);
    const teams = [[others[0], a, others[1], others[2]], [b, ...others.slice(3)]];
    const checkTeam = async team => {
      for (const player of team) {
        const pub = await player.c.waitFor('m.public', () => true, 15000);
        assert.deepEqual(pub.players.map(p => p.playerId).sort(), team.map(p => p.s.playerId).sort());
        assert.ok(pub.players.every(p => !('userId' in p)));
      }
    };
    await checkTeam(teams[0]);
    assert.ok(a.s.activeMatchCtx && !b.s.activeMatchCtx);
    // The other tab may launch while the first match (including its Worker) remains active.
    for (const player of others.slice(3)) await ok(player, queue);
    await checkTeam(teams[1]);
    assert.notEqual(a.s.activeMatchCtx, b.s.activeMatchCtx);
    assert.equal(h.server.lobby.queueByPlayer.size, 0);
    assert.equal(a.s.roomCode, room.code);
  });
}
