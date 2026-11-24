import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchWorkerPool } from '../server/workers/matchPool.js';
import { snapshotMatch } from '../server/match/snapshot.js';
import { DATA, makeMatch, give, legalTileFor, chessOfTier } from './match/harness.js';

test('peek snapshots cross the Match Worker only to the requester and reopen after reconnect', async () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 9301, fake: true }).start();
  const pool = new MatchWorkerPool({ data: DATA, lanes: 1 });
  try {
    h.toPrep(1);
    const mate = h.ps('p_1');
    mate.board.clear();
    const id = chessOfTier(1, (c) => c.position === 'MELEE').find((id) => h.m.pool.has(id));
    give(h.m, mate, id, 'board', legalTileFor(h.m, mate, id));
    const checkpoint = snapshotMatch(h.m);
    assert.ok(checkpoint);
    const expected = { p_1: [{ id: DATA.chess[id].charId }] };
    const sent = [];
    const match = await pool.create('PEEK', {
      roomCode: 'PEEK', mode: 'coop', difficulty: 'NORMAL', seed: 9301, matchNo: 1,
      seats: [0, 1].map((seat) => ({ seat, playerId: `p_${seat}`, name: `P${seat}`, isBot: false, connected: true })),
    }, { send(playerId, msg, encoded) {
      if (msg.t === 'm.peek') sent.push({ playerId, msg: JSON.parse(encoded || JSON.stringify(msg)) });
    } }, checkpoint);
    await match.onReconnect('p_1');
    assert.equal((await match.handle('p_0', { t: 'g.peek', open: true })).ok, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].playerId, 'p_0');
    assert.deepEqual(sent[0].msg.ops, expected);
    assert.equal(Object.hasOwn(match.publicView(), 'peek'), false);
    await match.onDisconnect('p_0');
    await match.onReconnect('p_0');
    assert.equal((await match.handle('p_0', { t: 'g.peek', open: true })).ok, true);
    assert.equal(sent.length, 2);
    assert.ok(sent[1].msg.seq > sent[0].msg.seq);
    assert.deepEqual(sent[1].msg.ops, expected);
    assert.equal((await match.handle('p_0', { t: 'g.pause', on: true })).ok, true);
    assert.equal((await match.handle('p_1', { t: 'g.pause', on: true })).ok, true);
    // Public views are throttled; a blocked prep action confirms the authoritative pause.
    assert.equal((await match.handle('p_0', { t: 'g.refresh' })).detail, 'match paused');
    assert.equal((await match.handle('p_0', { t: 'g.peek', open: false })).ok, true);
    assert.equal((await match.handle('p_0', { t: 'g.peek', open: true })).ok, true);
    assert.deepEqual(sent.at(-1).msg.ops, expected);
    const saved = await match.snapshot();
    assert.doesNotMatch(JSON.stringify(saved), /"_peek(?:Subs|Seq)"/);
  } finally {
    h.m.dispose();
    await pool.close();
  }
});
