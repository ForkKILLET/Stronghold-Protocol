import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { Lobby } from '../server/lobby.js';
import { ERR } from '../shared/constants.js';
import { TestClient } from './helpers/wsClient.js';

const clients = [];
let srv;

async function player(name, server = srv, pool = clients) {
  const c = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`);
  pool.push(c);
  c.id = (await c.hello(name)).playerId;
  return c;
}

async function ok(c, msg) {
  assert.equal((await c.request(msg)).t, 'ok');
}

async function party(host, guest, difficulty = 'NORMAL') {
  await ok(host, { t: 'room.create', mode: 'coop', difficulty });
  const room = await host.waitFor('room.state', (s) => s.code);
  await ok(guest, { t: 'room.join', code: room.code });
  return room.code;
}

function humanTeam(pub, cs) {
  assert.equal(pub.players.length, 4);
  assert.ok(pub.players.every((p) => !p.isBot));
  assert.deepEqual(pub.players.map((p) => p.playerId).sort(), cs.map((c) => c.id).sort());
}

after(async () => {
  for (const c of clients) await c.terminate().catch(() => {});
  await srv?.close();
});

before(async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workers: 0, store: null,
    MatchClass: StubMatch, matchmakingTickMs: 100 });
});

test('public and room matchmaking retain operator ownership and self-selected picks', async () => {
  const c = await player('QLoadout');
  const session = srv.registry.byId(c.id);
  session.notOwned = ['chess_char_4_22_a'];
  session.diy = { chess_char_5_diy1_a: { charId: 'char_112_siege', skillIndex: 2 } };
  for (const inRoom of [false, true]) {
    if (inRoom) {
      await ok(c, { t: 'room.create', mode: 'coop', difficulty: 'ABYSS' });
      await c.waitFor('room.state', (s) => s.code);
    }
    await ok(c, { t: 'match.join', mode: 'coop', difficulty: 'ABYSS' });
    const entry = srv.lobby.queueByPlayer.get(c.id);
    assert.deepEqual(entry.players[0].notOwned, session.notOwned);
    assert.deepEqual(entry.players[0].diy, session.diy);
    await ok(c, { t: 'match.leave' });
  }
  await ok(c, { t: 'room.leave' });
});

test('four solo queue entries start one four-human preparation match immediately', async () => {
  const cs = await Promise.all(['A', 'B', 'C', 'D'].map((name) => player(name)));
  for (const [i, c] of cs.entries()) {
    // mode=solo and the AI flag are accepted from old clients, but still join the human co-op pool.
    await ok(c, { t: 'match.join', mode: i === 0 ? 'solo' : 'coop', difficulty: 'FUNNY', fillBots: i % 2 === 0 });
    const queued = await c.waitFor('match.queue', (m) => m.status === 'queued');
    assert.equal(queued.count, i + 1);
    assert.equal(queued.mode, 'coop');
    assert.ok(!Object.hasOwn(queued, 'deadlineAt'));
    assert.ok(!Object.hasOwn(queued, 'fillBots'));
  }
  for (const c of cs) humanTeam(await c.waitFor('m.public', (m) => m.phase === 'INFO_CHECK'), cs);
  await ok(cs[0], { t: 'g.autoplay', on: true });
  assert.equal(srv.lobby.stats().rooms, 0);
});

for (const matchWorkers of [0, 1]) for (const fillBots of [undefined, false, true]) {
  test(`two-human party combines with two solos (${matchWorkers ? 'real Worker' : 'local'}, legacy flag=${fillBots})`, async (t) => {
    const localClients = [];
    const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workers: 0, matchWorkers,
      store: null, nameModeration: null, ...(matchWorkers ? {} : { MatchClass: StubMatch }) });
    t.after(async () => {
      for (const c of localClients) await c.terminate().catch(() => {});
      await server.close();
    });
    const cs = await Promise.all(['Host', 'Guest', 'Solo A', 'Solo B'].map((name) => player(name, server, localClients)));
    await party(cs[0], cs[1]);
    await ok(cs[0], { t: 'match.join', mode: 'coop', difficulty: 'NORMAL',
      ...(fillBots === undefined ? {} : { fillBots }) });
    const queued = await cs[0].waitFor('match.queue', (m) => m.status === 'queued');
    assert.equal(queued.count, 2);
    await cs[1].waitFor('room.state', (m) => m.matching?.count === 2);
    await ok(cs[2], { t: 'match.join', mode: 'coop', difficulty: 'NORMAL' });
    const roomUpdate = await cs[1].waitFor('room.state', (m) => m.matching?.count === 3);
    assert.equal(roomUpdate.matching.capacity, 4);
    assert.equal(roomUpdate.matching.queuedAt, queued.queuedAt);
    await ok(cs[3], { t: 'match.join', mode: 'coop', difficulty: 'NORMAL' });
    for (const c of cs) {
      humanTeam(await c.waitFor('m.public', (m) => m.phase === 'INFO_CHECK', 10000), cs);
      await c.waitFor('m.private', () => true, 10000);
    }
    assert.equal(server.lobby.queueByPlayer.size, 0);
  });
}

test('two two-human rooms combine immediately and return to their own rooms after the result', async () => {
  const cs = await Promise.all(['Party A', 'Guest A', 'Party B', 'Guest B'].map((name) => player(name)));
  const codes = [await party(cs[0], cs[1]), await party(cs[2], cs[3])];
  for (const host of [cs[0], cs[2]]) await ok(host, { t: 'match.join', mode: 'coop', difficulty: 'NORMAL' });
  for (const c of cs) {
    humanTeam(await c.waitFor('m.public', (m) => m.phase === 'INFO_CHECK'), cs);
    await ok(c, { t: 'g.infoReady' });
  }
  for (const [i, c] of cs.entries()) {
    await c.waitFor('m.result');
    const back = await c.waitFor('room.state', (s) => s.code === codes[Math.floor(i / 2)] && !s.inMatch && !s.matching);
    assert.ok(back.seats.some((s) => s?.playerId === c.id));
    await ok(c, { t: 'room.leave' });
  }
});

test('rooms with manually added AI cannot match, but direct private-room starts still support AI', async () => {
  const c = await player('Manual AI');
  await ok(c, { t: 'room.create', mode: 'coop', difficulty: 'ABYSS' });
  const code = (await c.waitFor('room.state', (s) => s.code)).code;
  await ok(c, { t: 'room.addBot' });
  for (const fillBots of [false, true]) {
    const reply = await c.request({ t: 'match.join', mode: 'coop', difficulty: 'ABYSS', fillBots });
    assert.equal(reply.t, 'error');
    assert.equal(reply.code, ERR.BAD_MSG);
    assert.match(reply.detail, /AI/);
  }
  assert.equal(srv.lobby.getRoom(code).matching, null);
  assert.equal(srv.lobby.queueByPlayer.has(c.id), false);
  await ok(c, { t: 'room.start' });
  const pub = await c.waitFor('m.public', (m) => m.phase === 'INFO_CHECK');
  assert.equal(pub.players.filter((p) => p.isBot).length, 1);
  await ok(c, { t: 'room.leave' });
});

function manualQueue(t) {
  let now = 1000;
  const sessions = new Map();
  const lobby = new Lobby({ registry: { byId: (id) => sessions.get(id) }, now: () => now });
  clearInterval(lobby.matchQueueTimer);
  lobby.matchQueueTimer = null;
  t.after(() => lobby.shutdown());
  const states = [], launched = [];
  lobby.broadcastState = (room) => states.push({ code: room.code, ...room.matching });
  lobby.startQueuedMatch = (owner, players) => launched.push(players);
  let seq = 0;
  return {
    lobby, states, launched,
    at(time) { now = time; },
    queueState(entry) { return sessions.get(entry.players[0].playerId).messages.at(-1); },
    join({ count = 1, difficulty = 'NORMAL', room = null } = {}) {
      const entry = lobby.makeQueueEntry({ mode: 'coop', difficulty, room,
        players: Array.from({ length: count }, () => {
          const playerId = `queue-test-${++seq}`;
          const messages = [];
          sessions.set(playerId, { playerId, connected: true, messages,
            ws: { readyState: 1, bufferedAmount: 0, send: (data) => messages.push(JSON.parse(data)) } });
          return { playerId, isBot: false };
        }) });
      lobby.enqueueMatchEntry(entry);
      return entry;
    },
  };
}

for (const count of [1, 2, 3]) test(`${count} queued humans never start or acquire AI, even after a day`, (t) => {
  const q = manualQueue(t);
  const room = count === 1 ? null : { code: 'TEST' };
  const entry = q.join({ count, room });
  const original = entry.players.map((p) => ({ ...p }));
  // Even stale internal timeout fields from the old implementation cannot launch an incomplete group.
  entry.deadlineAt = 0;
  entry.fillBots = true;
  for (const time of [61_000, 120_000, 86_401_000]) {
    q.at(time);
    q.lobby.processMatchQueues();
    assert.equal(q.launched.length, 0);
    assert.deepEqual(entry.players, original);
    assert.equal(q.queueState(entry).count, count);
    assert.equal(entry.queuedAt, 1000);
    assert.ok(!Object.hasOwn(q.queueState(entry), 'deadlineAt'));
    if (room) assert.deepEqual(room.matching, { queueId: entry.queueId, queuedAt: 1000, count, capacity: 4 });
  }
  q.lobby.cancelMatchQueue(entry);
  assert.equal(q.queueState(entry).status, 'cancelled');
  assert.equal(q.lobby.queueByPlayer.size, 0);
  if (room) assert.equal(room.matching, null);
});

for (const scenario of [
  { name: 'eight solo humans', sizes: [1, 1, 1, 1, 1, 1, 1, 1], counts: [4, 4, 4, 4, 4, 4, 4, 4], matches: 2, remaining: [] },
  { name: 'parties that cannot fit the head', sizes: [3, 2, 2, 2, 2, 2], counts: [3, 4, 4, 4, 4, 2], matches: 2, remaining: [0, 5] },
]) test(`queue counts and immediate launches use actual FIFO groups: ${scenario.name}`, (t) => {
  const q = manualQueue(t);
  const entries = scenario.sizes.map((count) => q.join({ count }));
  assert.deepEqual(entries.map((entry) => q.queueState(entry).count), scenario.counts);
  const otherDifficulty = q.join({ difficulty: 'HARD' });
  assert.equal(q.queueState(otherDifficulty).count, 1);
  q.lobby.processMatchQueues();
  assert.equal(q.launched.length, scenario.matches, 'later full groups are not blocked by an incomplete head');
  assert.ok(q.launched.every((players) => players.length === 4 && players.every((p) => !p.isBot)));
  const remaining = scenario.remaining.map((i) => entries[i]);
  assert.deepEqual(q.lobby.matchQueues.get('coop:NORMAL') || [], remaining);
  const ids = q.launched.flat().map((p) => p.playerId);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.equal(q.lobby.queueByPlayer.has(id), false);
  for (const entry of remaining) {
    for (const p of entry.players) assert.equal(q.lobby.queueByPlayer.get(p.playerId), entry);
  }
  q.at(86_401_000);
  q.lobby.processMatchQueues();
  assert.equal(q.launched.length, scenario.matches, 'ticks neither relaunch teams nor fill incomplete teams with AI');
});

test('cancellation updates group and room counts without changing original queue order', (t) => {
  const q = manualQueue(t);
  const first = q.join({ count: 3 });
  q.at(20_000);
  const room = { code: 'TEST' };
  const second = q.join({ count: 2, room });
  q.at(30_000);
  const third = q.join({ count: 2 });
  assert.equal(q.queueState(first).count, 3);
  assert.equal(q.queueState(second).count, 4);
  assert.equal(room.matching.count, 4);
  q.lobby.cancelMatchQueue(third);
  assert.equal(q.queueState(third).status, 'cancelled');
  assert.equal(q.queueState(second).count, 2);
  assert.equal(room.matching.count, 2);
  assert.equal(q.states.at(-1).count, 2);
  assert.equal(q.queueState(first).count, 3);
  assert.equal(second.queuedAt, 20_000);
  assert.equal(first.queuedAt, 1000);
});

test('queued launch rejects AI before dispatching to either local or Worker engines', (t) => {
  const lobby = new Lobby({ registry: { byId() {} } });
  t.after(() => lobby.shutdown());
  const players = [{ playerId: 'human' }, { playerId: 'ai_test', isBot: true }];
  assert.equal(lobby.startQueuedMatch({ mode: 'coop', difficulty: 'NORMAL' }, players).error, ERR.BAD_MSG);
  lobby.matchWorkerPool = { create() { assert.fail('AI must never reach a Match Worker'); } };
  assert.equal(lobby.startQueuedMatch({ mode: 'coop', difficulty: 'NORMAL' }, players).error, ERR.BAD_MSG);
});

test('matchmaking screens no longer expose AI flags, AI countdowns or deadline timers', async () => {
  for (const file of ['lobby.js', 'room.js']) {
    const source = await readFile(new URL(`../public/js/screens/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fillBots|deadlineAt|60 秒后|匹配剩余/);
    assert.match(source, /正在寻找同盟队友/);
  }
});

 test('public matchmaking refuses gameplay plugin rooms, including unresolved restored content', async () => {
  const c = await player('PluginQueue');
  await ok(c, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  const state = await c.waitFor('room.state', s => s.code);
  const room = srv.lobby.getRoom(state.code);
  const original = room.content;
  room.content = { ...original, vanilla: false };
  assert.equal((await c.request({ t: 'match.join', mode: 'coop', difficulty: 'NORMAL' })).code, ERR.MATCHING);
  room.content = original; room.recoveryContentMissing = true;
  assert.equal((await c.request({ t: 'match.join', mode: 'coop', difficulty: 'NORMAL' })).code, ERR.MATCHING);
  assert.equal(srv.lobby.queueByPlayer.has(c.id), false);
  room.recoveryContentMissing = false;
  await ok(c, { t: 'room.leave' });
});
