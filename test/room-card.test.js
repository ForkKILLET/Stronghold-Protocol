import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startServer } from '../server/index.js';
import { SessionRegistry, HEAVY_TYPES } from '../server/net.js';
import { Lobby } from '../server/lobby.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { snapshotServer, restoreServer } from '../server/persist.js';
import { validateC2S } from '../shared/protocol.js';
import { cleanPlayerCard, cardAvatarOperatorId } from '../shared/playerCard.js';
import { TestClient } from './helpers/wsClient.js';

const chess = JSON.parse(readFileSync(new URL('../data/chess.json', import.meta.url)));
const operators = [...new Set(Object.values(chess).filter((c) => !c.isGolden && !c.isDiy && !c.isHidden && c.visible !== false).map((c) => c.charId))];
const [aId, bId] = operators;
const card = { charId: aId, avatar: bId };
const skinCard = { charId: `${aId}@test#1`, avatar: `${bId}@test#1` };
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

test('room.card schema admits bounded cosmetic IDs only; unknown operators and invalid partial edits are atomic', () => {
  assert.equal(validateC2S({ t: 'room.card', ...card }), null);
  assert.ok(HEAVY_TYPES.has('room.card'));
  for (const bad of ['https://example.com/avatar.png', '../char_a', 'char_a<script>', 'x'.repeat(81), null, 3]) {
    assert.ok(validateC2S({ t: 'room.card', charId: bad, avatar: '' }));
  }
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, log: quiet, MatchClass: StubMatch, getData: () => ({ chess }) });
  const s = registry.create('A');
  assert.deepEqual(lobby.card(s, card), { ok: true });
  assert.deepEqual(s.card, card);
  for (const bad of [{ charId: 'char_unknown', avatar: bId }, { charId: aId, avatar: 'char_unknown' }, { charId: aId }]) {
    assert.ok(lobby.card(s, bad).error);
    assert.deepEqual(s.card, card, 'one invalid field cannot replace the other');
  }
  assert.equal(Object.isFrozen(s.card), true);
  assert.deepEqual(cleanPlayerCard({ charId: aId, avatar: 'https://example.com', playerId: 'other', trophies: 999 }), { charId: aId, avatar: '' });
  assert.deepEqual(lobby.card(s, { charId: '', avatar: '' }), { ok: true });
  assert.deepEqual(s.card, { charId: '', avatar: '' });
});

test('public room cards survive session/seat persistence and consecutive restore; legacy saves keep defaults', (t) => {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, log: quiet, MatchClass: StubMatch, getData: () => ({ chess }) });
  t.after(() => lobby.shutdown());
  const a = registry.create('A');
  lobby.card(a, skinCard);
  lobby.create(a, { mode: 'coop', difficulty: 'NORMAL' });
  const code = a.roomCode;
  let doc = snapshotServer({ registry, lobby });
  assert.deepEqual(doc.sessions[0].card, skinCard);
  assert.deepEqual(doc.rooms[0].seats[0].card, skinCard);
  for (let i = 0; i < 2; i++) {
    const r = new SessionRegistry();
    const l = new Lobby({ registry: r, log: quiet, MatchClass: StubMatch, getData: () => ({ chess }) });
    t.after(() => l.shutdown());
    const stats = restoreServer({ doc, registry: r, lobby: l, log: quiet });
    assert.equal(stats.sessions, 1);
    assert.deepEqual(r.byToken(a.token).card, skinCard);
    assert.deepEqual(l.getRoom(code).toState().seats[0].card, skinCard);
    doc = snapshotServer({ registry: r, lobby: l });
  }
  delete doc.sessions[0].card;
  delete doc.rooms[0].seats[0].card;
  const r = new SessionRegistry();
  const l = new Lobby({ registry: r, log: quiet, MatchClass: StubMatch, getData: () => ({ chess }) });
  t.after(() => l.shutdown());
  restoreServer({ doc, registry: r, lobby: l, log: quiet });
  assert.equal(l.getRoom(code).toState().seats[0].card, undefined);
});

test('WebSocket room broadcast shares each owner card with both players, late joiners, spectators and reconnects', async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', log: quiet, MatchClass: StubMatch });
  const clients = [];
  t.after(async () => { await Promise.all(clients.map((c) => c.terminate())); await srv.close(); });
  const connect = async (name, token) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    clients.push(c);
    const w = await c.hello(name, token);
    c.id = w.playerId; c.token = w.token;
    return c;
  };
  const ok = async (c, msg) => assert.equal((await c.request(msg)).t, 'ok');
  const a = await connect('A');
  await ok(a, { t: 'room.card', ...card });
  await ok(a, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  const initial = await a.waitFor('room.state');
  const code = initial.code;
  assert.deepEqual(initial.seats[0].card, card);
  const b = await connect('B');
  await ok(b, { t: 'room.join', code });
  assert.deepEqual((await b.waitFor('room.state')).seats[0].card, card);
  const watcher = await connect('Watcher');
  await ok(watcher, { t: 'room.spectate', code });
  assert.deepEqual((await watcher.waitFor('room.state')).seats[0].card, card);
  await ok(a, { t: 'room.card', ...skinCard });
  for (const c of [a, b, watcher]) {
    const state = await c.waitFor('room.state', (s) => s.seats[0]?.card?.avatar === skinCard.avatar);
    assert.deepEqual(state.seats[0].card, skinCard, 'skin avatars are owner metadata shared with players and spectators');
  }
  const other = { charId: bId, avatar: aId };
  await ok(b, { t: 'room.card', ...other, playerId: a.id });
  for (const c of [a, b, watcher]) {
    const state = await c.waitFor('room.state', (s) => s.seats[1]?.card?.charId === bId);
    assert.deepEqual(state.seats[0].card, skinCard, 'cannot spoof another player ID');
    assert.deepEqual(state.seats[1].card, other);
  }
  const readyBefore = srv.lobby.getRoom(code).seatOf(b.id).ready;
  await ok(b, { t: 'room.card', charId: '', avatar: '' });
  assert.equal(srv.lobby.getRoom(code).seatOf(b.id).ready, readyBefore, 'display settings do not reset readiness');
  const invalid = await a.request({ t: 'room.card', charId: 'char_unknown', avatar: bId });
  assert.equal(invalid.code, 'BAD_TARGET');
  await a.terminate();
  const resumed = await connect('A', a.token);
  const state = await resumed.waitFor('room.state');
  assert.equal(resumed.id, a.id);
  assert.deepEqual(state.seats[0].card, skinCard);
});

test('skin avatar and portrait ids validate their operator and never accept paths or URLs', () => {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, log: quiet, MatchClass: StubMatch, getData: () => ({ chess }) });
  const s = registry.create('Avatar');
  assert.equal(validateC2S({ t: 'room.card', ...skinCard }), null);
  assert.deepEqual(lobby.card(s, skinCard), { ok: true });
  assert.equal(cardAvatarOperatorId(skinCard.avatar), bId);
  assert.deepEqual(cleanPlayerCard(skinCard, (id) => operators.includes(id)), skinCard);
  assert.deepEqual(cleanPlayerCard(skinCard, (id) => id === aId), { charId: skinCard.charId, avatar: '' });
  for (const avatar of [`${bId}@`, `${bId}@../a`, `${bId}@https://example.com/a`, `${bId}@x@y`, 'https://example.com/a', `${bId}@${'x'.repeat(65)}`]) {
    assert.ok(validateC2S({ t: 'room.card', charId: aId, avatar }));
    assert.ok(lobby.card(s, { charId: aId, avatar }).error);
    assert.deepEqual(s.card, skinCard);
  }
  assert.equal(lobby.card(s, { ...card, avatar: 'char_unknown@test#1' }).error, 'BAD_TARGET');
  assert.deepEqual(s.card, skinCard);
  assert.equal(validateC2S({ t: 'room.card', charId: skinCard.avatar, avatar: bId }), null);
  assert.deepEqual(lobby.card(s, { charId: skinCard.avatar, avatar: bId }), { ok: true });
  assert.equal(s.card.charId, skinCard.avatar, 'portrait validates its own operator independently of the avatar');
  for (const charId of [`${aId}@`, `${aId}@../x`, `${aId}@x@y`, 'https://example.com/x']) {
    assert.ok(validateC2S({ t: 'room.card', charId, avatar: bId }));
    assert.ok(lobby.card(s, { charId, avatar: bId }).error);
  }
  assert.equal(lobby.card(s, { charId: 'char_unknown@test#1', avatar: bId }).error, 'BAD_TARGET');
});
