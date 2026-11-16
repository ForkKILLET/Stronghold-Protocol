import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give } from './harness.js';
import { getVersionData } from '../../server/data.js';
import { SharedPool } from '../../server/match/pool.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { cardCounterView } from '../../server/match/cardCounter.js';
import { validateC2S } from '../../shared/protocol.js';

function fixture(t, version = null, mode = 'coop', humans = 2) {
  const h = makeMatch({ ...(version ? { data: getVersionData(version), version } : {}), mode, humans,
    fake: true, registry: createRegistry({ builtins: false }) });
  t.after(() => h.m.dispose());
  const m = h.m;
  m.phase = 'PREP'; m.round = 1; m.bondChoice = null;
  m.bannedChess = []; m.disabledBonds = []; m.staticInactiveBonds = [];
  m.pool = new SharedPool(m.gd);
  for (const ps of m.order) { ps.bandId = null; ps.shop.level = 6; }
  const id = m.gd.visibleChess.find(id => m.gd.chess(id).charId === 'char_249_mlyss');
  assert.ok(id);
  return { h, m, a: h.ps('p_0'), b: h.ps('p_1'), id,
    read: () => cardCounterView(m, h.ps('p_0'), id, 12) };
}

for (const version of [null, 'act3autochess@V3_1']) {
  test(`${version || 'default'}: board, hand and overflow count real occupancy separately from gifted equivalents`, t => {
    const { m, a, b, id, read } = fixture(t, version);
    give(m, a, id, 'board', [10, 4]);
    a.acquireChess(id, { fromPool: false });
    b.acquireChess(m.gd.goldenIdOf(id));
    give(m, b, id, 'temp', 30); // includes the hidden overflow, not just the visible slots
    const result = read(), copies = m.gd.goldenCopies;
    assert.equal(result.total - result.remaining, 2 + copies);
    assert.equal(result.held, 3 + copies);
    assert.deepEqual(result.holders.map(p => [p.normal, p.elite, p.held, p.occupied, p.extra]), [[2, 0, 2, 1, 1], [1, 1, 1 + copies, 1 + copies, 0]]);
    assert.equal(result.holders[1].playerId, b.playerId);
  });

  test(`${version || 'default'}: a mixed gift merge preserves its real ledger; ordinary promotion reserves extra copies`, t => {
    const { m, a, b, id, read } = fixture(t, version);
    a.acquireChess(id);
    a.acquireChess(id, { fromPool: false });
    const merged = a.acquireChess(id, { fromPool: false });
    assert.equal(m.gd.isGolden(merged.id), true);
    let p = read().holders[0];
    assert.equal(p.held, m.gd.goldenCopies);
    assert.equal(p.occupied, 1);
    assert.equal(p.extra, m.gd.goldenCopies - 1);
    const normal = b.acquireChess(id);
    b.promote(normal);
    p = read().holders[1];
    assert.equal(p.held, m.gd.goldenCopies);
    assert.equal(p.occupied, m.gd.goldenCopies);
    assert.equal(p.extra, 0);
    a.sell(merged.uid);
    assert.equal(read().holders[0].held, 0);
    assert.equal(read().remaining, read().total - m.gd.goldenCopies);
  });
}

test('displayed shop and reward cards do not reserve copies or enter player holdings', t => {
  const { a, b, id, read } = fixture(t);
  const before = read();
  a.shop.slots = Array.from({ length: 6 }, () => ({ kind: 'chess', id, frozen: true, sold: false }));
  b.offers = [{ slots: [{ kind: 'chess', id }] }];
  assert.deepEqual(read(), before);
  assert.equal('shop' in read(), false);
});

test('overdraw is visible without a negative drawable supply, and selling pays back the real reserved copies', t => {
  const { a, id, read } = fixture(t);
  const cap = read().total;
  for (let i = 0; i < cap + 2; i++) a.acquireChess(id);
  let result = read();
  assert.equal(result.remaining, 0);
  assert.equal(result.overdraw, 2);
  assert.equal(result.holders[0].occupied, cap + 2);
  assert.equal(result.odds.slot, 0);
  assert.equal(result.odds.refresh, 0);
  const elite = [...a.hand, ...a.temp, ...a.board.values()].find(p => p?.kind === 'chess' && a.gd.isGolden(p.id));
  a.sell(elite.uid);
  result = read();
  assert.equal(result.remaining, Math.max(0, a.gd.goldenCopies - 2));
  assert.equal(result.overdraw, 0);
});

test('natural odds use the actual weighted slot candidates, with this player\'s private DIY stock only', t => {
  const { m, a, b, id, read } = fixture(t);
  let total = 0;
  for (const e of m.pool.entries.values()) if (e.left > 0 && e.tier <= a.shop.level) total += e.left;
  let result = read();
  assert.equal(result.odds.denominator, total);
  assert.equal(result.odds.slot, m.pool.left(id) / total);
  assert.ok(Math.abs(result.odds.refresh - (1 - (1 - result.odds.slot) ** m.gd.shopSlots(6).chess)) < 1e-12);
  a.diyStock = { entries: new Map([['own_diy', { cap: 5, left: 5, tier: 6, shopLevel: 6 }]]) };
  b.diyStock = { entries: new Map([['other_diy', { cap: 7, left: 7, tier: 6, shopLevel: 6 }]]) };
  result = read();
  assert.equal(result.odds.denominator, total + 5);
  assert.equal(result.odds.numerator, m.pool.left(id));
  assert.equal(result.total, m.pool.cap(id));
  a.shop.level = 5;
  result = read();
  assert.equal(result.odds.numerator, 0);
  assert.equal(result.odds.slot, 0);
  a.diyStock = b.diyStock = null;
});

test('pool caps come from the match identity and solo/team multiplier, independent of team size', t => {
  const solo = fixture(t, null, 'solo', 1).read();
  const pair = fixture(t, null, 'coop', 2).read();
  const four = fixture(t, null, 'coop', 4).read();
  assert.equal(pair.total, solo.total * 2);
  assert.equal(four.total, pair.total);
});

test('banned and non-pool identities are explicit; missing provenance is unknown, not an invented free copy', t => {
  const { m, a, id, read } = fixture(t);
  const piece = a.acquireChess(id);
  delete piece.poolCopies;
  assert.equal(read().holders[0].occupied, null);
  assert.equal(read().holders[0].extra, null);
  piece.poolCopies = 1;
  a.sell(piece.uid);
  m.pool = new SharedPool(m.gd, { banned: [id] }); m.bannedChess = [id];
  assert.equal(read().status, 'banned');
  assert.equal(read().total, null);
  assert.equal(read().odds.slot, 0);
  const hidden = Object.values(m.gd.raw.chess).find(c => c.isHidden && !c.isDiy && !c.isGolden);
  assert.equal(cardCounterView(m, a, hidden.chessId, 1).status, 'unpooled');
  assert.equal(cardCounterView(m, a, 'not_a_chess', 1), null);
});

test('the requester-only route works during pause and changes no views, stock, RNG, dirty marks or replay', t => {
  const { h, m, a, id } = fixture(t);
  m.paused = true;
  const snapshot = () => JSON.stringify({ public: m.publicView(), private: m.order.map(p => p.privateView()),
    pool: [...m.pool.entries], uid: m.uidSeq, dirty: [m._pubDirty, [...m._privDirty].map(p => p.playerId)],
    rng: [m.rngMeta.state(), m.rngShop.state()], replay: m.replayArchive });
  const before = snapshot(), sent = h.sent.length, broadcasts = h.bc.length;
  assert.deepEqual(m.handle(a.playerId, { t: 'g.cardCounter', chessId: id, seq: 9 }), { ok: true });
  assert.equal(snapshot(), before);
  assert.equal(h.bc.length, broadcasts);
  assert.equal(h.sent.length, sent + 1);
  const [to, msg] = h.sent.at(-1);
  assert.equal(to, a.playerId);
  assert.equal(msg.t, 'm.cardCounter');
  assert.equal(msg.seq, 9);
  assert.equal(msg.matchKey, m.publicView().combatHistoryKey);
  assert.equal(m.handle('not_in_room', { t: 'g.cardCounter', chessId: id, seq: 10 }).error, 'NOT_IN_ROOM');
  assert.equal(m.handle(a.playerId, { t: 'g.cardCounter', chessId: 'unknown', seq: 10 }).error, 'BAD_TARGET');
});

test('the stock query has a bounded validated target and sequence', () => {
  assert.equal(validateC2S({ t: 'g.cardCounter', chessId: 'chess_char_6_19_a', seq: 1 }), null);
  for (const msg of [{}, { chessId: [], seq: 1 }, { chessId: 'x', seq: -1 }, { chessId: 'x'.repeat(80), seq: 1 }]) {
    assert.ok(validateC2S({ t: 'g.cardCounter', ...msg }));
  }
});
