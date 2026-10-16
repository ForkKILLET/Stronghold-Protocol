// test/skins-lifecycle.test.js — end-to-end integration test for the skins pipeline:
// lobby session/seats -> Match/PlayerState -> prep pieceView & prepFieldMeta -> battleInput & sim units -> public/js assets & avatarUrl.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../server/lobby.js';
import { DATA, makeMatch } from './match/harness.js';
import { Battle } from '../server/sim/Battle.js';
import { avatarUrl, unitPictureUrl, createAssets } from '../public/js/assets.js';
import { SessionRegistry } from '../server/net.js';
import { snapshotServer, restoreServer } from '../server/persist.js';
import { snapshotMatch, restoreMatch } from '../server/match/snapshot.js';
import { createRngFromState } from '../server/sim/rng.js';
import { MatchWorkerPool } from '../server/workers/matchPool.js';
import { visibleSkin } from '../shared/skins.js';

const INSIDE = 'chess_char_1_01_a';
const INSIDE_GOLDEN = 'chess_char_1_01_b';
const SKIN_ID = 'char_498_inside@kitchen#2';
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

test('base/golden skins survive two checkpoints, while old checkpoints restore default skins', t => {
  const a = makeMatch({ mode: 'solo', humans: 1, bots: 0, fake: true });
  t.after(() => a.m.dispose()); a.start();
  a.m.setSkins('p_0', { [INSIDE]: SKIN_ID });
  const cp = snapshotMatch(a.m);
  assert.equal(cp.players[0].skins[INSIDE], SKIN_ID);
  const b = makeMatch({ mode: 'solo', humans: 1, bots: 0, fake: true });
  t.after(() => b.m.dispose());
  assert.equal(restoreMatch(b.m, cp, { createRngFromState, log: quiet }), true);
  assert.equal(b.ps('p_0').skins[INSIDE], SKIN_ID);
  assert.equal(Object.isFrozen(b.ps('p_0').skins), true);
  assert.deepEqual(snapshotMatch(b.m).players[0].skins, cp.players[0].skins);
  delete cp.players[0].skins;
  const c = makeMatch({ mode: 'solo', humans: 1, bots: 0, fake: true });
  t.after(() => c.m.dispose());
  assert.equal(restoreMatch(c.m, cp, { createRngFromState, log: quiet }), true);
  assert.deepEqual(c.ps('p_0').skins, {});
});

for (const remote of [false, true]) {
  test(`queued skin edits and external matched teammates survive two ${remote ? 'Worker' : 'local'} restores`, async t => {
    const pool = remote ? new MatchWorkerPool({ data: DATA, lanes: 1, log: quiet }) : null;
    if (pool) t.after(() => pool.close());
    const env = () => {
      const registry = new SessionRegistry();
      const lobby = new Lobby({ registry, getData: () => DATA, log: quiet, matchWorkerPool: pool });
      t.after(() => lobby.shutdown());
      return { registry, lobby };
    };
    const first = env(), { registry, lobby } = first;
    const sessions = ['A', 'B', 'C', 'D'].map(name => { const s = registry.create(name); s.connected = true; return s; });
    const [a, b] = sessions;
    lobby.create(a, { mode: 'coop', difficulty: 'NORMAL' });
    const room = lobby.roomOf(a);
    assert.equal(lobby.matchJoin(a, { mode: 'coop', difficulty: 'NORMAL' }).ok, true);
    const ticket = a.matchQueue;
    assert.equal(lobby.skins(a, { skins: { [INSIDE]: SKIN_ID } }).ok, true);
    assert.equal(ticket.players[0].skins[INSIDE], SKIN_ID, 'queued seat gets the latest preference');
    lobby.removeQueueReferences(ticket);
    assert.equal((await lobby.startQueuedMatch(ticket, [
      ...ticket.players, ...sessions.slice(1).map((s, i) => lobby.humanSeat(i + 1, s)),
    ], [])).ok, true);
    assert.equal(b.roomCode, null, 'external teammate is not a member of the owner room');
    assert.equal((await lobby.skins(b, { skins: { [INSIDE]: 'char_498_inside@winter#1' } })).ok, true);
    const cp = remote ? await room.match.snapshot() : snapshotMatch(room.match);
    assert.equal(cp.players.find(p => p.playerId === b.playerId).skins[INSIDE], 'char_498_inside@winter#1');
    const pub = room.match.publicView();
    assert.equal(pub.players.find(p => p.playerId === a.playerId).skins[INSIDE], SKIN_ID);
    assert.equal(visibleSkin(pub.players[0].skins[INSIDE], { skinsEnabled: false }), null);
    let doc = snapshotServer({ ...first, matchDocs: new Map([[room.code, cp]]) });
    if (remote) { await room.match.dispose(); pool.release(room.code, room.match); }
    for (const round of [1, 2]) {
      const next = env();
      const initial = restoreServer({ doc, ...next, log: quiet });
      const stats = initial.ready ? await initial.ready : initial;
      assert.equal(stats.matches, 1, `restore ${round}`);
      const backA = next.registry.byToken(a.token), backB = next.registry.byToken(b.token);
      assert.equal(backA.skins[INSIDE], SKIN_ID);
      assert.equal(backB.skins[INSIDE], 'char_498_inside@winter#1');
      assert.equal(backB.roomCode, null);
      const ctx = next.lobby.activeMatchOf(backB);
      assert.ok(ctx?.match, 'external teammate reconnects to the same match container');
      const restored = remote ? await ctx.match.snapshot() : snapshotMatch(ctx.match);
      assert.equal(restored.players.find(p => p.playerId === b.playerId).skins[INSIDE], 'char_498_inside@winter#1');
      // Opting out clears only the owner's published cosmetics, never the other player's state.
      if (round === 2) {
        assert.equal((await next.lobby.skins(backA, { skins: {} })).ok, true);
        const after = remote ? await ctx.match.snapshot() : snapshotMatch(ctx.match);
        assert.deepEqual(after.players.find(p => p.playerId === a.playerId).skins, {});
        assert.equal(after.players.find(p => p.playerId === b.playerId).skins[INSIDE], 'char_498_inside@winter#1');
      }
      doc = snapshotServer({ ...next, matchDocs: new Map([[room.code, restored]]) });
      if (remote) { await ctx.match.dispose(); pool.release(room.code, ctx.match); }
    }
  });
}

test('spectator preferences cannot change a player skin; bots and stand-ins retain their default appearance', async t => {
  const registry = new SessionRegistry(), lobby = new Lobby({ registry, getData: () => DATA, log: quiet });
  t.after(() => lobby.shutdown());
  const s = registry.create('Spectator'); s.connected = true;
  const match = { setSkins() { throw new Error('must not be called'); } };
  const room = { seatOf: () => null, match, matchCtx: { match } };
  lobby.roomOf = () => room;
  assert.equal((await lobby.skins(s, { skins: { [INSIDE]: SKIN_ID } })).ok, true);
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 1 }); t.after(() => h.m.dispose());
  const bot = h.m.order.find(p => p.isBot);
  assert.equal(bot.setSkins({ [INSIDE]: SKIN_ID }), false);
  assert.deepEqual(bot.skins, {});
});

describe('skins lifecycle: lobby wiring', () => {
  test('humanSeat copies session.skins and startMatch passes skins to Match seats', () => {
    // 本分支的 Lobby 通过 options 注入 registry / getData（上游是 new Lobby({ data })），测试按本分支构造
    const registry = { all: () => [], byId: () => null };
    const quietLog = { info() {}, warn() {}, error() {} };
    const lobby = new Lobby({ registry, getData: () => DATA, log: quietLog });
    const session = { playerId: 'p1', name: 'Player 1', connected: true, skins: { [INSIDE]: SKIN_ID }, loadout: null };
    const seat = lobby.humanSeat(0, session);
    assert.deepEqual(seat.skins, { [INSIDE]: SKIN_ID }, 'humanSeat must preserve skins from session');

    const room = {
      code: 'TEST',
      hostId: 'p1',
      mode: 'solo',
      difficulty: 'NORMAL',
      seats: [seat],
      // 本分支 startMatchWithLocal 会读 room.spectators（上游测试的房间桩没有这个字段）
      spectators: [],
      matchCount: 0,
      activeHumans: () => [seat],
      seatOf: (id) => (id === 'p1' ? seat : null),
      toState: () => ({ code: 'TEST' }),
    };

    let passedSeats = null;
    class MockMatch {
      constructor(opts) {
        passedSeats = opts.seats;
      }
    }
    lobby.MatchClass = MockMatch;
    lobby.broadcastState = () => {};
    lobby.startMatch(room);

    assert.ok(passedSeats, 'seats should be passed to Match');
    assert.equal(passedSeats[0].skins?.[INSIDE], SKIN_ID, 'seats[0].skins should be retained in startMatch');
  });
});

describe('skins lifecycle: PlayerState and Match', () => {
  test('skins propagate to base piece and golden piece in prep pieceView and battleInput', () => {
    const h = makeMatch({
      mode: 'solo',
      seats: [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, skins: { [INSIDE]: SKIN_ID } }],
    });
    const ps = h.ps('p_0');
    assert.equal(ps.skins[INSIDE], SKIN_ID, 'ps.skins should be initialized from seat.skins');

    // Place a base piece
    const pBase = ps.newPiece('chess', INSIDE);
    ps.board.set('0,0', pBase);

    // Place a golden piece
    const pGolden = ps.newPiece('chess', INSIDE_GOLDEN);
    ps.board.set('0,1', pGolden);

    // Check pieceView for both pieces during prep
    const viewBase = ps.pieceView(pBase, [0, 0]);
    assert.equal(viewBase.skin, SKIN_ID, 'base pieceView should carry skin');

    const viewGolden = ps.pieceView(pGolden, [0, 1]);
    assert.equal(viewGolden.skin, SKIN_ID, 'golden pieceView should carry skin');

    // Check scouting prepFieldMeta
    const meta = h.m.prepFieldMeta(ps);
    const metaBase = meta.units.find((u) => u.defId === INSIDE);
    const metaGolden = meta.units.find((u) => u.defId === INSIDE_GOLDEN);
    assert.equal(metaBase?.skin, SKIN_ID, 'scouting prepFieldMeta base piece should carry skin');
    assert.equal(metaGolden?.skin, SKIN_ID, 'scouting prepFieldMeta golden piece should carry skin');

    // Check battleInput
    const bInput = ps.battleInput({ side: 'ally' });
    const bBase = bInput.units.find((u) => u.chessId === INSIDE);
    const bGolden = bInput.units.find((u) => u.chessId === INSIDE_GOLDEN);
    assert.equal(bBase?.skin, SKIN_ID, 'base unit in battleInput must have skin');
    assert.equal(bGolden?.skin, SKIN_ID, 'golden unit in battleInput must have skin');

    // Simulate Battle ally creation on a valid field row (row 9 for normal field)
    const b = new Battle({
      fieldId: 'n:p_0',
      kind: 'normal',
      players: [{
        playerId: 'p_0',
        units: [
          { kind: 'chess', chessId: INSIDE, row: 9, col: 0, skin: bBase.skin },
          { kind: 'chess', chessId: INSIDE_GOLDEN, row: 9, col: 1, skin: bGolden.skin },
        ],
      }],
      spawns: [],
      data: DATA,
      log: { warn() {}, error() {}, info() {} },
    });
    b.start();
    const battleUnits = b.fieldMeta().units;
    const buBase = battleUnits.find((u) => u.defId === INSIDE);
    const buGolden = battleUnits.find((u) => u.defId === INSIDE_GOLDEN);
    assert.equal(buBase?.skin, SKIN_ID, 'sim unit for base piece must have skin in fieldMeta');
    assert.equal(buGolden?.skin, SKIN_ID, 'sim unit for golden piece must have skin in fieldMeta');
  });

  test('mid-match setSkins updates PlayerState and marks dirty', () => {
    const h = makeMatch({
      mode: 'solo',
      seats: [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true }],
    });
    const ps = h.ps('p_0');
    assert.deepEqual(ps.skins, {}, 'initially empty');

    let privateMarked = false;
    h.m.markPrivate = () => { privateMarked = true; };

    h.m.setSkins('p_0', { [INSIDE]: SKIN_ID });
    assert.equal(ps.skins[INSIDE], SKIN_ID, 'ps.skins updated');
    assert.ok(privateMarked, 'markPrivate was called');

    const pv = h.m.publicView();
    assert.equal(pv.players[0].skins?.[INSIDE], SKIN_ID, 'publicView carries updated skins');
  });
});

describe('skins lifecycle: client assets and avatars', () => {
  const MANIFEST = {
    chars: {
      char_498_inside: {
        avatar: '/default_avatar.png',
        avatarE2: '/default_avatar_e2.png',
        spine: { front: { skel: '/default.skel', atlas: '/default.atlas', textures: ['/default.png'], anims: { idle: 'Idle' } } },
        skins: {
          [SKIN_ID]: {
            avatar: '/skin_avatar.png',
            spine: {
              front: { skel: '/skin.skel', atlas: '/skin.atlas', textures: ['/skin.png'], anims: { idle: 'Idle' } },
              back: { skel: '/skin_back.skel', atlas: '/skin_back.atlas', textures: ['/skin_back.png'], anims: { idle: 'Idle' } },
            },
          },
        },
      },
    },
  };

  test('avatarUrl returns skin avatar when skin is given', () => {
    assert.equal(avatarUrl(MANIFEST, 'char_498_inside', { skin: SKIN_ID }), '/skin_avatar.png');
    assert.equal(avatarUrl(MANIFEST, 'char_498_inside', { skin: 'unknown' }), '/default_avatar.png');
    assert.equal(avatarUrl(MANIFEST, 'char_498_inside'), '/default_avatar.png');
  });

  test('unitPictureUrl forwards opts to avatarUrl', () => {
    assert.equal(unitPictureUrl(MANIFEST, 'char_498_inside', { skin: SKIN_ID }), '/skin_avatar.png');
  });

  test('createAssets forwards skinId to hasBack and opts to picture', () => {
    const assets = createAssets({ manifest: MANIFEST });
    assert.equal(assets.hasBack('char_498_inside', SKIN_ID), true, 'skin has back spine');
    assert.equal(assets.hasBack('char_498_inside'), false, 'default model has no back spine');
    assert.equal(assets.picture('char_498_inside', { skin: SKIN_ID }), '/skin_avatar.png');
  });
});
