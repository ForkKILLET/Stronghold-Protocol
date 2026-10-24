import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { Network, SessionRegistry, CLOSE, CAPACITY_RECONNECT_MS } from '../server/net.js';
import { Lobby } from '../server/lobby.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { sessionDoc } from '../server/persist.js';
import { startServer } from '../server/index.js';
import { Net } from '../public/js/net.js';
import { TestClient } from './helpers/wsClient.js';

function harness(t, { handler = {}, nameModeration = null, options = {} } = {}) {
  let now = 1_000_000;
  const registry = new SessionRegistry({ now: () => now });
  const network = new Network({ registry, now: () => now, handler: { onMessage() {}, ...handler },
    nameModeration, options: { maxConnections: 1, ...options } });
  t.after(() => network.close());
  function socket() {
    const ws = new EventEmitter();
    Object.assign(ws, { readyState: 1, bufferedAmount: 0, frames: [],
      send(raw, cb) { this.frames.push(JSON.parse(raw)); cb?.(); },
      close(code) { this.code = code; this.readyState = 3; this.emit('close'); },
      terminate() { this.close(); }, ping() {},
    });
    network.handleConnection(ws);
    ws.hello = (fields = {}) => ws.emit('message', Buffer.from(JSON.stringify({ t: 'hello', rid: 1, name: 'Player', ...fields })), false);
    ws.last = () => ws.frames.at(-1);
    return ws;
  }
  return { network, registry, socket, now: () => now, advance(ms) { now += ms; } };
}

test('capacity uses authenticated online count; refusals create no session and do not moderate names', async (t) => {
  let reviews = 0;
  const h = harness(t, { nameModeration: { check() { reviews++; return { allowed: true }; } } });
  const a = h.socket(), idle = h.socket();
  assert.equal(h.network.onlineCount, 0);
  a.hello(); await nextTurn();
  const token = a.last().token;
  assert.equal(h.network.onlineCount, 1);
  idle.hello({ token: 'forged-token' });
  assert.equal(idle.last().code, 'SERVER_FULL');
  assert.equal(idle.last().msg, '当前服务器容量已满');
  assert.equal(idle.code, CLOSE.SERVER_FULL);
  assert.equal(h.registry.size, 1);
  assert.equal(reviews, 1);
  a.hello(); await nextTurn();
  assert.equal(a.last().t, 'welcome');
  const replacement = h.socket();
  replacement.hello({ token, noReplace: true }); await nextTurn();
  assert.equal(replacement.last().code, 'SESSION_IN_USE');
  replacement.hello({ token }); await nextTurn();
  assert.equal(replacement.last().t, 'welcome');
  assert.equal(a.code, CLOSE.REPLACED);
  a.emit('close');
  assert.equal(h.network.onlineCount, 1);
  replacement.close();
  const newcomer = h.socket(); newcomer.hello(); await nextTurn();
  assert.equal(newcomer.last().t, 'welcome');
});

test('concurrent asynchronous hello reviews recheck capacity before binding', async (t) => {
  const resolve = [];
  const h = harness(t, { nameModeration: { check() { return new Promise((done) => resolve.push(done)); } } });
  const a = h.socket(), b = h.socket(); a.hello(); b.hello(); await nextTurn();
  assert.equal(resolve.length, 2);
  resolve[0]({ allowed: true }); resolve[1]({ allowed: true }); await nextTurn();
  assert.equal(a.last().t, 'welcome');
  assert.equal(b.last().code, 'SERVER_FULL');
  assert.equal(b.code, CLOSE.SERVER_FULL);
  assert.equal(h.network.onlineCount, 1);
  assert.equal(h.registry.size, 1);
});

test('recent match tokens resume above capacity only within ten minutes; idle tokens do not renew eligibility', (t) => {
  const h = harness(t);
  const a = h.socket(); a.hello(); const token = a.last().token;
  const session = h.registry.byToken(token);
  session.lastMatchAt = h.now(); session.resumeWindowMs = 24 * 60 * 60_000;
  a.close();
  const filler = h.socket(); filler.hello();
  h.advance(CAPACITY_RECONNECT_MS);
  const resumed = h.socket(); resumed.hello({ token });
  assert.equal(resumed.last().t, 'welcome');
  assert.equal(resumed.last().resumed, true);
  assert.equal(h.network.onlineCount, 2);
  resumed.close(); h.advance(1);
  const stale = h.socket(); stale.hello({ token });
  assert.equal(stale.last().code, 'SERVER_FULL');
  assert.equal(h.registry.byToken(token), session, 'capacity rejection preserves solo identity');
  const idleToken = h.registry.create('Idle').token;
  const idle = h.socket(); idle.hello({ token: idleToken });
  assert.equal(idle.last().code, 'SERVER_FULL');
});

test('active solo matches also lose their capacity exemption after ten minutes offline', (t) => {
  const h = harness(t, { handler: { hasActiveMatch: () => true } });
  const a = h.socket(); a.hello(); const token = a.last().token;
  h.registry.byToken(token).resumeWindowMs = 24 * 60 * 60_000;
  a.close(); const filler = h.socket(); filler.hello();
  h.advance(CAPACITY_RECONNECT_MS + 1);
  const reconnect = h.socket(); reconnect.hello({ token });
  assert.equal(reconnect.last().code, 'SERVER_FULL');
});

test('upgrade reserves bounded unauthenticated capacity even when online players reach the limit', (t) => {
  const h = harness(t, { options: { maxPendingConnections: 2 } });
  const player = h.socket(); player.hello();
  const req = { socket: { remoteAddress: '127.0.0.1' }, headers: {} };
  assert.equal(h.network.admission(req), null);
  const idle = h.socket(); h.socket();
  assert.equal(h.network.admission(req), 'full');
  idle.close(); assert.equal(h.network.admission(req), null);
});

test('lobby match ownership excludes spectators, bots and departed players; recent match timestamp persists', (t) => {
  const h = harness(t);
  const lobby = new Lobby({ registry: h.registry, now: h.now });
  t.after(() => lobby.shutdown());
  const session = h.registry.create('Player');
  const member = { playerId: session.playerId, isBot: false, left: false };
  session.activeMatchCtx = { match: { phase: 'PREP' }, members: [member], ended: false };
  assert.equal(lobby.hasActiveMatch(session), true);
  member.left = true; assert.equal(lobby.hasActiveMatch(session), false);
  member.left = false; member.isBot = true; assert.equal(lobby.hasActiveMatch(session), false);
  member.isBot = false; session.activeMatchCtx.members = []; assert.equal(lobby.hasActiveMatch(session), false);
  session.lastMatchAt = h.now();
  const doc = sessionDoc(session, h.now());
  const restored = new SessionRegistry({ now: h.now }).adopt(doc);
  assert.equal(restored.lastMatchAt, session.lastMatchAt);
  delete doc.lastMatchAt;
  assert.equal(new SessionRegistry({ now: h.now }).adopt(doc).lastMatchAt, null);
});

for (const matchWorkers of [0, 1]) test(`real WS hello refuses new players and resumes a match above capacity (Match Workers=${matchWorkers})`, async (t) => {
  const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, workers: 0, matchWorkers,
    maxConnections: 1, store: null, nameModeration: null });
  t.after(() => srv.close());
  const clients = [];
  const connect = async () => { const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c); return c; };
  t.after(async () => { for (const c of clients) await c.close(); });
  const owner = await connect(); const welcome = await owner.hello('Owner');
  const rejected = await connect();
  assert.equal((await rejected.request({ t: 'hello', name: 'Newcomer' })).code, 'SERVER_FULL');
  assert.equal((await rejected.closed).code, CLOSE.SERVER_FULL);
  assert.equal((await owner.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' })).t, 'ok');
  assert.equal((await owner.request({ t: 'room.start' }, 15_000)).t, 'ok');
  const session = srv.registry.byToken(welcome.token);
  assert.equal(srv.lobby.hasActiveMatch(session), true);
  await owner.close();
  const filler = await connect(); await filler.hello('Filler');
  assert.ok(session.lastMatchAt > 0);
  const resumed = await connect();
  assert.equal((await resumed.hello('Owner', welcome.token)).resumed, true);
  assert.equal(srv.network.onlineCount, 2);
  await resumed.waitFor('room.state', (room) => room.inMatch);
});

test('a recently finished match also permits its original token to reconnect above capacity', async (t) => {
  const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, workers: 0, matchWorkers: 0,
    MatchClass: StubMatch, maxConnections: 1, store: null, nameModeration: null });
  t.after(() => srv.close());
  const clients = [];
  const connect = async () => { const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`); clients.push(c); return c; };
  t.after(async () => { for (const c of clients) await c.close(); });
  const owner = await connect(); const welcome = await owner.hello('Owner');
  await owner.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
  await owner.request({ t: 'room.start' });
  assert.equal((await owner.request({ t: 'g.infoReady' })).t, 'ok');
  await owner.waitFor('m.result');
  const session = srv.registry.byToken(welcome.token);
  assert.equal(srv.lobby.hasActiveMatch(session), false);
  assert.ok(session.lastMatchAt > 0);
  await owner.close();
  const filler = await connect(); await filler.hello('Filler');
  const resumed = await connect();
  assert.equal((await resumed.hello('Owner', welcome.token)).resumed, true);
  assert.equal(srv.network.onlineCount, 2);
});

for (const closeOnly of [false, true]) test(`client capacity refusal stops all reconnect triggers and retains feedback (close only=${closeOnly})`, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const sockets = [];
  class Socket {
    constructor() { this.readyState = 0; this.sent = []; sockets.push(this); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  }
  const net = new Net({ WebSocket: Socket, getToken: () => 'saved-token' });
  t.after(() => net.close());
  const errors = []; net.on('helloError', (err) => errors.push(err.code));
  net.setName('Owner'); const ws = sockets[0]; ws.readyState = 1; ws.onopen();
  const queued = net.request('room.create', { mode: 'solo', difficulty: 'NORMAL' });
  const failed = assert.rejects(queued, { code: 'CLOSED' });
  if (closeOnly) ws.onclose({ code: CLOSE.SERVER_FULL });
  else ws.onmessage({ data: JSON.stringify({ t: 'error', rid: ws.sent.find((m) => m.t === 'hello').rid, code: 'SERVER_FULL' }) });
  await failed;
  assert.equal(net.status, 'closed'); assert.equal(net.lastError.message, '当前服务器容量已满');
  assert.deepEqual(errors, ['SERVER_FULL']); assert.equal(net.retryAt, 0);
  net.retryNow(); net.reconnectNow(); net.connect(); net.setName('Other');
  t.mock.timers.tick(30 * 60_000);
  assert.equal(sockets.length, 1); assert.equal(net.pendingCount, 0);
});

test('capacity refusal returns even an entered game page to the title without clearing its token', async () => {
  const { returnToTitleAfterNameReview } = await import('../public/js/screens/title.js');
  const calls = [];
  const identity = { setEntered: (on) => calls.push(['entered', on]), clearToken: () => assert.fail('token must survive') };
  const state = { patch: (...args) => calls.push(args) };
  assert.equal(returnToTitleAfterNameReview({ code: 'SERVER_FULL' }, { status: 'closed' }, identity, state), true);
  assert.deepEqual(calls, [['entered', false], ['session', { entered: false }], ['ui', { restoring: false }]]);
});

for (const connected of [false, true]) test(`account ownership is required before a token grants capacity priority (online=${connected})`, t => {
  const h = harness(t);
  const owner = h.socket();
  h.network.conns.get(owner).userProfile = { id: 'owner-account' };
  owner.hello();
  const token = owner.last().token, session = h.registry.byToken(token);
  session.lastMatchAt = h.now();
  if (!connected) { owner.close(); const filler = h.socket(); filler.hello(); }
  h.registry.recoveryPending = true; // a known foreign token cannot use the deferred-recovery gate either
  for (const account of [null, { id: 'different-account' }]) {
    const stranger = h.socket();
    h.network.conns.get(stranger).userProfile = account;
    stranger.hello({ token });
    assert.equal(stranger.last().code, 'SERVER_FULL');
    assert.equal(h.network.onlineCount, 1);
    assert.equal(h.registry.size, connected ? 1 : 2);
  }
  const replacement = h.socket();
  h.network.conns.get(replacement).userProfile = { id: 'owner-account' };
  replacement.hello({ token });
  assert.equal(replacement.last().t, 'welcome');
  assert.equal(replacement.last().playerId, session.playerId);
});

test('configured capacity grace expires independently of a retained solo checkpoint', t => {
  const h = harness(t, { handler: { hasActiveMatch: () => true }, options: { capacityReconnectMs: 100 } });
  const owner = h.socket(); owner.hello(); const token = owner.last().token;
  h.registry.byToken(token).resumeWindowMs = 86400_000;
  owner.close(); const filler = h.socket(); filler.hello(); h.advance(101);
  const reconnect = h.socket(); reconnect.hello({ token });
  assert.equal(reconnect.last().code, 'SERVER_FULL');
  assert.ok(h.registry.byToken(token), 'saved game retention does not extend admission priority');
});
