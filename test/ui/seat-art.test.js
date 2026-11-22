// test/ui/seat-art.test.js — 名片干员 on the room's seat cards (PR #643 split 6, public/js/ui/seatArt.js): the pickable
// operators (one per charId of the visible, non-自选 chess records, the elite form, 6★ first), the default pool (5★/6★ by
// charId), the operator a seat shows (one's own local pick at once, a teammate's seats[].card, else one chosen by the
// player id — the same whatever order the records arrive in; none for a bot or an empty seat), the outfit it wears
// (seatCardSkin, the maintainer's decision 4 of 2026-10-21), the picture a card falls back to when one fails to load
// (seatArtSrc: the outfit, the default portrait, the avatar frame), the pick's store, and room.css following 文字大小
// without !important. Other periods (#877, DESIGN §37.325): the roster's records (rosterOperators, cardName), the seat
// cards resolving them without touching the default pool (cardContext extra), the picker's groups (cardGroups) and the
// draft's outfits from the room's seats (cardSkinPlayers). (The server's whitelist: test/lobby-card.test.js; the browser:
// test/ui/room-cards.e2e.test.js.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cardOperators, cardContext, seatOperator, seatCardSkin, seatArtSrc, cardName, rosterOperators, cardGroups, cardSkinPlayers, withCardZh, cardMatches } from '../../public/js/ui/seatArt.js';
import { chessPortraitUrl, chessAvatarUrl } from '../../public/js/ui/assetUrls.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
import { CARD_PERIOD_ORDER } from '../../shared/cardRoster.js';
import { operatorCharIds } from '../../shared/protocol.js';
const BACKUPS = JSON.parse(readFileSync(path.join(ROOT, 'data/backups.json'), 'utf8'));
const ROSTER = JSON.parse(readFileSync(path.join(ROOT, 'data/card-roster.json'), 'utf8'));
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

// ---- #877 (DESIGN §37.325): other periods' operators on the cards --------------------------------------------------
test('a 自选编队 pool record carries its appellation from backups.units, so the picker finds it by its code name (#877)', () => {
  const list = cardOperators(CHESS, BACKUPS);
  const kalts = list.find((c) => c.charId === 'char_003_kalts');
  assert.equal(kalts.appellation, "Kal'tsit");
  assert.equal(kalts.name, '凯尔希');
  for (const c of list) assert.equal(typeof c.appellation, 'string', `${c.charId}: an appellation (chess records carry theirs)`);
  // no units entry: an empty appellation, never undefined
  assert.equal(cardOperators([], { diy: { ownedPool: ['char_9_x'], operators: { char_9_x: { name: 'X', rarity: 5 } } } })[0].appellation, '');
});

test('rosterOperators: the roster\'s operators the room lacks, as picker records, 6★ first; [] without a roster (#877)', () => {
  const room = cardOperators(CHESS, BACKUPS);
  const exclude = new Set(room.map((c) => c.charId));
  const others = rosterOperators(ROSTER, { exclude });
  assert.equal(room.length + others.length, ROSTER.operators.length, 'the room\'s list and the others make the whole roster');
  assert.ok(others.every((c) => !exclude.has(c.charId)), 'nothing of the room\'s list twice');
  const bee = others.find((c) => c.charId === 'char_344_beewax');
  assert.deepEqual({ ...bee, periods: [...bee.periods] }, { charId: 'char_344_beewax', name: '蜜蜡', zh: '蜜蜡', appellation: 'Beeswax', rarity: 5, isGolden: true,
    periods: ['act2autochess@V2_1'], other: true });
  for (let i = 1; i < others.length; i++) {
    const [a, b] = [others[i - 1], others[i]];
    assert.ok(a.rarity > b.rarity || (a.rarity === b.rarity && a.zh.localeCompare(b.zh, 'zh') <= 0), `${a.charId} before ${b.charId}`);
  }
  // (every 6★ of the other periods is in 第二期下半's list or pool: its others start at 5★; the whole roster at 6★)
  assert.equal(others[0].rarity, 5);
  assert.equal(rosterOperators(ROSTER)[0].rarity, 6);
  // a 自选-only operator of another period draws its E1 art (golden false), as in its own period's room
  const golden = new Map(ROSTER.operators.map((o) => [o.charId, o.golden]));
  for (const c of others) assert.equal(c.isGolden, golden.get(c.charId), c.charId);
  // the art: E2 of the roster's own charId (ui/assetUrls.js reads charId and isGolden, no chess record needed)
  const m = { chars: { char_344_beewax: { avatar: '/a/1.png', avatarE2: '/a/2.png', portrait: '/p/1.png', portraitE2: '/p/2.png' } } };
  assert.equal(chessPortraitUrl(m, bee), '/p/2.png');
  assert.equal(chessAvatarUrl(m, bee), '/a/2.png');
  for (const junk of [null, undefined, {}, { format: 2, operators: [] }, 'x']) assert.deepEqual(rosterOperators(junk), [], String(junk));
  assert.equal(rosterOperators(ROSTER).length, ROSTER.operators.length, 'no exclude: every row');
});

test('cardName: Chinese as it is; another language its game-text name, else the appellation; zh-TW the Chinese name (#877)', () => {
  const row = { name: '蜜蜡', appellation: 'Beeswax' };
  const names = { 蜜蜡: 'Beeswax (EN)' };
  const localeName = (zh) => names[zh] ?? zh; // data.js localeName: the name itself when the language lacks it
  assert.equal(cardName(row, { lang: 'zh', localeName }), '蜜蜡');
  assert.equal(cardName(row), '蜜蜡', 'the default language is Chinese');
  assert.equal(cardName(row, { lang: 'en', localeName }), 'Beeswax (EN)');
  assert.equal(cardName({ name: '摆渡人', appellation: 'Varkáris' }, { lang: 'en', localeName }), 'Varkáris', 'no name in the table: the appellation');
  assert.equal(cardName({ name: '摆渡人', appellation: 'Varkáris' }, { lang: 'ja', localeName }), 'Varkáris');
  assert.equal(cardName({ name: '摆渡人', appellation: 'Varkáris' }, { lang: 'zh-TW', localeName }), '摆渡人', 'a Chinese script keeps the Chinese name');
  assert.equal(cardName({ name: '蜜蜡', appellation: 'Beeswax' }, { lang: 'zh-TW', localeName: (zh) => (zh === '蜜蜡' ? '蜜蠟' : zh) }), '蜜蠟');
  assert.equal(cardName({ name: '摆渡人', appellation: '' }, { lang: 'en', localeName }), '摆渡人', 'no appellation either: the Chinese name');
  assert.equal(cardName(null, { lang: 'en' }), '');
  // rosterOperators names its records this way and keeps the Chinese one for the search
  const en = rosterOperators(ROSTER, { lang: 'en', localeName }).find((c) => c.charId === 'char_4166_varkis');
  assert.deepEqual([en.name, en.zh, en.appellation], ['Varkáris', '摆渡人', 'Varkáris']);
});

test('withCardZh / cardMatches: in another language the room\'s records keep their Chinese names, so the search finds 斯卡蒂 and the 自选 pool\'s 凯尔希 as it finds other periods\' operators (#877 review)', () => {
  // the room's list as data.js gives it in English (localized names) and as downloaded (data.js listRaw / getRaw)
  const EN = { char_263_skadi: 'Skadi', char_003_kalts: 'Kal\'tsit' };
  const enChess = CHESS.map((c) => (EN[c.charId] ? { ...c, name: EN[c.charId] } : c));
  const ops = BACKUPS.diy.operators;
  const enBackups = { ...BACKUPS, diy: { ...BACKUPS.diy, operators: Object.fromEntries(Object.entries(ops).map(([id, r]) => [id, EN[id] ? { ...r, name: EN[id] } : r])) } };
  assert.ok(Object.hasOwn(ops, 'char_003_kalts') && !CHESS.some((c) => c.charId === 'char_003_kalts'), '凯尔希: the 自选 pool only');
  const rawList = cardOperators(CHESS, BACKUPS);
  const enList = cardOperators(enChess, enBackups);
  const list = withCardZh(enList, rawList);
  assert.equal(list.length, enList.length);
  const skadi = list.find((c) => c.charId === 'char_263_skadi');
  const kalts = list.find((c) => c.charId === 'char_003_kalts');
  assert.deepEqual([skadi.name, skadi.zh, kalts.name, kalts.zh], ['Skadi', '斯卡蒂', 'Kal\'tsit', '凯尔希']);
  assert.equal(skadi.isGolden, true, 'the record as it was, its Chinese name beside');
  for (const [c, q] of [[skadi, '斯卡蒂'], [skadi, 'skadi'], [kalts, '凯尔希'], [kalts, 'kal\'tsit']]) assert.ok(cardMatches(c, q), `${c.charId}: ${q}`);
  assert.ok(!cardMatches(enList.find((c) => c.charId === 'char_263_skadi'), '斯卡蒂'), 'without it the Chinese name was not found');
  // a record already named in Chinese, or one the raw list lacks (a plugin's), stays the same object
  const same = list.find((c) => !EN[c.charId]);
  assert.equal(same, enList.find((c) => c.charId === same.charId));
  withCardZh(rawList, rawList).forEach((c, i) => assert.equal(c, rawList[i]));
  const plugin = { charId: 'char_9_plug', name: 'Plug', rarity: 5 };
  assert.equal(withCardZh([plugin], rawList)[0], plugin);
  assert.deepEqual(withCardZh(null, null), []);
  // cardMatches: '' answers every record; a cross-period record by its zh and its appellation
  assert.ok(cardMatches({ name: 'x' }, ''));
  const beeswax = { name: 'Beeswax', zh: '蜜蜡', appellation: 'Beeswax' };
  assert.ok(cardMatches(beeswax, '蜜蜡') && cardMatches(beeswax, 'bees') && !cardMatches(beeswax, '斯卡蒂'));
});

test('cardContext with the roster: other periods resolve a pick, the default pool and every default stay the same (#877)', () => {
  const room = cardOperators(CHESS, BACKUPS);
  const others = rosterOperators(ROSTER, { exclude: new Set(room.map((c) => c.charId)) });
  const plain = cardContext(room);
  const wide = cardContext(room, { extra: others });
  assert.ok(wide.byChar.has('char_344_beewax') && wide.byChar.has('char_4166_varkis'));
  assert.equal(wide.byChar.size, ROSTER.operators.length);
  assert.deepEqual(wide.pool, plain.pool, 'the default pool is the room\'s own list');
  for (let i = 0; i < 50; i++) {
    const seat = { playerId: `p_${i}`, name: `D${i}` };
    assert.equal(seatOperator(seat, wide).chess.charId, seatOperator(seat, plain).chess.charId, seat.playerId);
  }
  // a charId both lists hold keeps the room's record (a plugin's redefinition of an official operator)
  const mine = { charId: 'char_344_beewax', name: '插件蜜蜡', rarity: 6, isGolden: false };
  const ctx = cardContext([...room, mine], { extra: others });
  assert.equal(ctx.byChar.get('char_344_beewax'), mine);
  assert.equal(cardContext([], { extra: [null, ...others] }).byChar.size, others.length, 'junk in extra is skipped');
});

test('seatOperator and other periods: a teammate\'s cross-period card resolves; it waits while the roster loads; without one, the default (#877)', () => {
  const room = cardOperators(CHESS, BACKUPS);
  const others = rosterOperators(ROSTER, { exclude: new Set(room.map((c) => c.charId)) });
  const mate = { playerId: 'p_mate', name: 'Mate', isBot: false, card: 'char_4166_varkis' };
  const loaded = seatOperator(mate, cardContext(room, { extra: others }), { myId: 'p_me' });
  assert.equal(loaded.chess.charId, 'char_4166_varkis');
  assert.equal(loaded.picked, true);
  assert.equal(loaded.chess.other, true);
  // one's own local pick likewise, before the server echoes it
  assert.equal(seatOperator({ ...mate, card: '' }, cardContext(room, { extra: others }), { myId: 'p_mate', myCard: 'char_344_beewax' }).chess.charId, 'char_344_beewax');
  assert.equal(seatOperator(mate, cardContext(room, { pending: true })), null, 'the roster still loading: the avatar frame, no default for a moment');
  const missing = seatOperator(mate, cardContext(room));
  assert.equal(missing.picked, false, 'the roster missing: the default by player id');
  assert.equal(missing.chess.charId, seatOperator({ playerId: 'p_mate' }, cardContext(room)).chess.charId);
});

test('cardGroups: 第二期下半\'s room, then 规程, 第二期上半, 第一期下半 — each operator once, empty groups left out (#877)', () => {
  const room = cardOperators(CHESS, BACKUPS);
  const others = rosterOperators(ROSTER, { exclude: new Set(room.map((c) => c.charId)) });
  const groups = cardGroups(room, others, 'act2autochess');
  assert.deepEqual(groups.map((g) => g.key), ['room', 'act3autochess@V3_1', 'act2autochess@V2_1', 'act1autochess']);
  assert.deepEqual(groups.map((g) => g.ops.length), [187, 42, 6, 15]);
  assert.deepEqual(groups.map((g) => g.version), ['act2autochess', 'act3autochess@V3_1', 'act2autochess@V2_1', 'act1autochess']);
  const ids = groups.flatMap((g) => g.ops.map((c) => c.charId));
  assert.equal(new Set(ids).size, ids.length, 'each operator once');
  assert.equal(ids.length, ROSTER.operators.length);
  assert.deepEqual(groups[0].ops, room, 'the room\'s group: its own list in its order');
  // each other operator sits in the newest period that lists it besides the room's own
  for (const g of groups.slice(1)) {
    for (const c of g.ops) {
      const rest = c.periods.filter((p) => p !== 'act2autochess');
      assert.equal(g.key, rest.reduce((a, b) => (CARD_PERIOD_ORDER.indexOf(b) > CARD_PERIOD_ORDER.indexOf(a) ? b : a)), c.charId);
    }
  }
  assert.ok(groups.find((g) => g.key === 'act2autochess@V2_1').ops.some((c) => c.charId === 'char_344_beewax'));
  assert.ok(groups.find((g) => g.key === 'act3autochess@V3_1').ops.some((c) => c.charId === 'char_4166_varkis'));
  // a roster record only the room's version lists (an operator the room's plugins hide) joins the room's group, after its list
  const hidden = { charId: 'char_1_h', name: 'H', zh: 'H', rarity: 6, periods: ['act2autochess'], other: true };
  const g2 = cardGroups(room.slice(0, 3), [hidden, ...others.slice(0, 2)], 'act2autochess');
  assert.deepEqual(g2[0].ops.map((c) => c.charId), [...room.slice(0, 3).map((c) => c.charId), 'char_1_h']);
  // ([ASSUMED] 6, #877 review) so does one other periods list too: a plugin hides 斯卡蒂 (every period but 第一期 lists
  // her) — she stays in 本房间版本, not in 规程's group
  const hiddenRoom = cardOperators(CHESS.map((c) => (c.charId === 'char_263_skadi' ? { ...c, visible: false } : c)), BACKUPS);
  assert.ok(!hiddenRoom.some((c) => c.charId === 'char_263_skadi'));
  const hiddenOthers = rosterOperators(ROSTER, { exclude: new Set(hiddenRoom.map((c) => c.charId)) });
  const skadi = hiddenOthers.find((c) => c.charId === 'char_263_skadi');
  assert.ok(skadi.periods.includes('act2autochess') && skadi.periods.includes('act3autochess@V3_1'), skadi.periods.join());
  const g3 = cardGroups(hiddenRoom, hiddenOthers, 'act2autochess');
  assert.equal(g3.find((g) => g.ops.some((c) => c.charId === 'char_263_skadi'))?.key, 'room');
  assert.deepEqual(g3.map((g) => g.ops.length), [187, 42, 6, 15], 'the other groups as they were');
  // empty groups go: no others, an empty room (the data still loading)
  assert.deepEqual(cardGroups(room, [], 'act2autochess').map((g) => g.key), ['room']);
  assert.deepEqual(cardGroups([], [], 'act2autochess'), []);
  assert.deepEqual(cardGroups(null, null, 'act2autochess'), []);
  // a 规程 room: the other periods newest first, 规程 itself never a group of others
  const v3 = cardGroups(room, rosterOperators(ROSTER, { exclude: new Set(room.map((c) => c.charId)) }), 'act3autochess@V3_1');
  assert.ok(!v3.slice(1).some((g) => g.key === 'act3autochess@V3_1'));
  const order = v3.slice(1).map((g) => CARD_PERIOD_ORDER.indexOf(g.key));
  assert.deepEqual(order, [...order].sort((a, b) => b - a), 'newest first');
});

test('cardSkinPlayers: the draft\'s players over the room\'s seats — the match\'s choice wins per operator; no seat, no change (#877)', () => {
  const A = 'char_344_beewax', B = 'char_003_kalts';
  const players = [
    { playerId: 'p1', name: 'One', skins: { [B]: 'match#1' } },
    { playerId: 'p2', name: 'Two' },
    { playerId: 'p3', name: 'Three', skins: { [B]: 'match#3' } },
    null,
  ];
  const seats = [
    { playerId: 'p1', skins: { [A]: 'room#a', [B]: 'room#b' } },
    { playerId: 'p2', skins: { [A]: 'room#2' } },
    null,
    { playerId: 'ai_1', isBot: true },
  ];
  const out = cardSkinPlayers(players, seats);
  assert.deepEqual(out[0].skins, { [A]: 'room#a', [B]: 'match#1' }, 'the match\'s choice wins; the room adds the cross-period card');
  assert.deepEqual(out[1].skins, { [A]: 'room#2' });
  assert.equal(out[2], players[2], 'no room seat: the player as it is');
  assert.equal(out[3], null);
  assert.equal(out[0].name, 'One');
  assert.deepEqual(players[0].skins, { [B]: 'match#1' }, 'the input is never changed');
  assert.deepEqual(cardSkinPlayers(players, undefined), players);
  assert.deepEqual(cardSkinPlayers(undefined, seats), []);
  // the card wears it: seatCardSkin reads the merged list
  assert.equal(out[0].skins[A], 'room#a'); // Fork profile portraits select their own skin, independently of battle skins.
  assert.equal(seatCardSkin({ playerId: 'p1' }, A, { myId: 'p9', players: out, otherSkins: false }), null, '「显示其他玩家的皮肤」 off');
});

test('cardSkinPlayers: the room\'s seats fill only the operators the match\'s data lacks — an outfit taken off mid-match stays off (#877 review)', () => {
  // the room's seats are from before the start (room.skins during a match re-broadcasts no room.state): a teammate took
  // 斯卡蒂's outfit off in the match's 干员调配, so the match's map no longer has it — the room's old entry must not return
  const SKADI = 'char_263_skadi', VARKIS = 'char_4166_varkis';
  const matchOps = operatorCharIds({ chess: Object.fromEntries(CHESS.map((c) => [c.chessId, c])), backups: BACKUPS });
  assert.ok(matchOps.has(SKADI) && !matchOps.has(VARKIS), '第二期下半\'s data: 斯卡蒂, no 摆渡人');
  const players = [{ playerId: 'p2', name: 'Two', skins: {} }];
  const stale = [{ playerId: 'p2', skins: { [SKADI]: `${SKADI}@X`, [VARKIS]: `${VARKIS}@Y` } }];
  const out = cardSkinPlayers(players, stale, matchOps);
  assert.deepEqual(out[0].skins, { [VARKIS]: `${VARKIS}@Y` }, 'the cross-period card\'s outfit from the room, none for 斯卡蒂');
  assert.equal(seatCardSkin({ playerId: 'p2' }, SKADI, { myId: 'p9', players: out }), null, '斯卡蒂 in the default art');
  assert.equal(out[0].skins[VARKIS], `${VARKIS}@Y`);
  // the match's own choice for one of its operators shows; a room map of the match's operators only leaves the player as is
  const live = [{ playerId: 'p2', skins: { [SKADI]: `${SKADI}@Z` } }];
  assert.deepEqual(cardSkinPlayers(live, stale, matchOps)[0].skins, { [VARKIS]: `${VARKIS}@Y`, [SKADI]: `${SKADI}@Z` });
  assert.equal(cardSkinPlayers(players, [{ playerId: 'p2', skins: { [SKADI]: `${SKADI}@X` } }], matchOps)[0], players[0]);
  // no data known yet (null): the room fills every gap, as before
  assert.deepEqual(cardSkinPlayers(players, stale, null)[0].skins, stale[0].skins);
});
