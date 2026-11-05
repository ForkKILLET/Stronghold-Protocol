// test/ui/seat-art.test.js — 名片干员 on the room's seat cards (PR #643 split 6, public/js/ui/seatArt.js): the pickable
// operators (one per charId of the visible, non-自选 chess records, the elite form, 6★ first), the default pool (5★/6★ by
// charId), the operator a seat shows (one's own local pick at once, a teammate's seats[].card, else one chosen by the
// player id — the same whatever order the records arrive in; none for a bot or an empty seat), the outfit it wears
// (seatCardSkin, the maintainer's decision 4 of 2026-10-21), the picture a card falls back to when one fails to load
// (seatArtSrc: the outfit, the default portrait, the avatar frame), the pick's store, and room.css following 文字大小
// without !important. (The server's whitelist: test/lobby-card.test.js; the browser: test/ui/room-cards.e2e.test.js.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cardOperators, cardContext, seatOperator, seatCardSkin, seatArtSrc } from '../../public/js/ui/seatArt.js';
import { chessPortraitUrl } from '../../public/js/ui/assetUrls.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHESS = Object.values(JSON.parse(readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8')));

test('the pickable operators: one per visible, non-自选 charId, the elite form, 6★ first', () => {
  const list = cardOperators(CHESS);
  const ids = list.map((c) => c.charId);
  assert.equal(new Set(ids).size, ids.length, 'one record per charId');
  const visible = new Set(CHESS.filter((c) => !c.isDiy && c.visible !== false && typeof c.charId === 'string').map((c) => c.charId));
  assert.deepEqual(new Set(ids), visible);
  assert.ok(!ids.includes('char_616_pithst'), 'a hidden preset is not offered');
  for (const c of list) {
    if (CHESS.some((x) => x.charId === c.charId && x.isGolden && x.visible !== false && !x.isDiy)) assert.equal(c.isGolden, true, c.charId);
  }
  for (let i = 1; i < list.length; i++) assert.ok((list[i - 1].rarity ?? 0) >= (list[i].rarity ?? 0), 'rarity descending');
  assert.equal(list[0].rarity, 6);
  assert.deepEqual(cardOperators(null), []);
  assert.deepEqual(cardOperators([null, { isDiy: true, charId: 'char_1_x' }, { charId: 7 }]), []);
});

test('the default pool: 5★/6★ only, ordered by charId whatever order the records came in', () => {
  const list = cardOperators(CHESS);
  const a = cardContext(list);
  assert.ok(a.pool.length > 50 && a.pool.every((c) => c.rarity >= 5));
  const ids = a.pool.map((c) => c.charId);
  assert.deepEqual(ids, [...ids].sort());
  const b = cardContext(cardOperators([...CHESS].reverse()));
  assert.deepEqual(b.pool.map((c) => c.charId), ids);
  assert.equal(a.byChar.get('char_498_inside')?.charId, 'char_498_inside');
});

test('the operator a seat shows: own pick at once, a teammate\'s seats[].card, else the same default on every client', () => {
  const ctx = cardContext(cardOperators(CHESS));
  const other = cardContext(cardOperators([...CHESS].reverse()));
  const me = { playerId: 'p_me', name: 'Me', isBot: false, card: 'char_1012_skadi2' };
  const mate = { playerId: 'p_mate', name: 'Mate', isBot: false, card: 'char_498_inside' };
  // one's own seat: the local pick, even before the server echoes it (seat.card is still the old one)
  assert.deepEqual(seatOperator(me, ctx, { myId: 'p_me', myCard: 'char_498_inside' }), { chess: ctx.byChar.get('char_498_inside'), picked: true });
  // a teammate's seat: what the server says
  assert.equal(seatOperator(mate, ctx, { myId: 'p_me', myCard: 'char_1012_skadi2' }).chess.charId, 'char_498_inside');
  // no pick / an operator this client does not have / 默认 on one's own seat: the default by player id
  for (const [seat, own] of [[{ ...mate, card: undefined }, {}], [{ ...mate, card: 'char_999_nobody' }, {}], [me, { myId: 'p_me', myCard: '' }]]) {
    const op = seatOperator(seat, ctx, own);
    assert.equal(op.picked, false);
    assert.ok(ctx.pool.includes(op.chess));
    assert.equal(seatOperator(seat, other, own).chess.charId, op.chess.charId, 'the same default on every client');
  }
  const picks = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => seatOperator({ playerId: `p_${id}` }, ctx).chess.charId));
  assert.ok(picks.size > 1, 'different players get different defaults');
  // no portrait for a bot, an empty seat, or before the data loads
  assert.equal(seatOperator({ playerId: 'ai_1', isBot: true }, ctx), null);
  assert.equal(seatOperator(null, ctx), null);
  assert.equal(seatOperator({ playerId: 'p_x' }, cardContext([])), null);

});



test('a picture that fails to load: the outfit gives way to the default portrait, that to the avatar frame (§35.18)', () => {
  const OUTFIT = '/assets/chars/outfit.png';
  const PLAIN = '/assets/chars/plain.png';
  assert.equal(seatArtSrc([OUTFIT, PLAIN]), OUTFIT, 'the outfit first');
  assert.equal(seatArtSrc([OUTFIT, PLAIN], [OUTFIT]), PLAIN, 'the outfit failed: the default portrait');
  assert.equal(seatArtSrc([OUTFIT, PLAIN], [OUTFIT, PLAIN]), null, 'both failed: the avatar frame');
  assert.equal(seatArtSrc([PLAIN, null]), PLAIN, 'no outfit worn: the default only');
  assert.equal(seatArtSrc([PLAIN, PLAIN], [PLAIN]), null, 'an outfit this page lacks drew the default already: no second try');
  assert.equal(seatArtSrc([null, null]), null);
  assert.equal(seatArtSrc(undefined), null);
  // The fork resolves the independent portrait, its default and profile avatar in order.
  const room = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
  assert.match(room, /const preferred = seat.isBot \? null : seatPortrait/);
  assert.match(room, /const src = failed\(preferred\) \? base : preferred/);
  assert.match(room, /onError=\$\{\(\) => onBad\(src\)\}/);

});





test('an AI teammate\'s name split for the plate: 「AI·」 + the rest; a number-only name and a human seat unsplit (botNameParts)', async () => {
  const { botNameParts } = await import('../../public/js/screens/room.js');
  assert.deepEqual(botNameParts({ isBot: true, name: 'AI·华法琳' }), ['AI·', '华法琳']);
  assert.deepEqual(botNameParts({ isBot: true, name: 'AI · Warfarin' }), ['AI · ', 'Warfarin']);
  assert.deepEqual(botNameParts({ isBot: true, name: 'AI·Kal\'tsit\nx' }), ['AI·', 'Kal\'tsit\nx']);
  assert.equal(botNameParts({ isBot: true, name: 'AI·2' }), null, 'only a number after the prefix keeps it');
  assert.equal(botNameParts({ isBot: true, name: '华法琳' }), null);
  assert.equal(botNameParts({ isBot: true, name: 'AI·' }), null);
  assert.equal(botNameParts({ isBot: true }), null);
  assert.equal(botNameParts({ isBot: false, name: 'AI·x' }), null, 'a doctor named 「AI·x」 keeps the whole name');
  assert.equal(botNameParts({ name: 'AI·x' }), null);
  assert.equal(botNameParts(null), null);
});
