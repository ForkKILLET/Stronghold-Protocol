// Node/vnode and CSS-contract tests only; these do not perform browser or real-device layout validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { PHASE } from '../../shared/constants.js';
import { C2S } from '../../shared/protocol.js';
import { ProtocolSelect, ProtoCard, difficultyInfo } from '../../public/js/screens/lobby.js';
import { SeatCardView, roomFacts, normalizeSeats, inviteLink } from '../../public/js/screens/room.js';
import { cardOperators, seatPortrait } from '../../public/js/ui/seatArt.js';
import { aceOf, rowCleared, fmtDuration } from '../../public/js/screens/settle.js';
import { spMarks, turnPopupDue } from '../../public/js/ui/choiceOverlay.js';
import { finalPlateRows, endPlateOf } from '../../public/js/ui/matchPlates.js';
import { capsuleFxKind } from '../../public/js/ui/hud.js';
import { roundsToBoss } from '../../public/js/ui/matchPopups.js';
import { data } from '../../public/js/data.js';
import { OpCard } from '../../public/js/screens/loadout.js';
import { loadoutStore } from '../../public/js/ui/loadoutSync.js';

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
function* walk(v) {
  if (Array.isArray(v)) { for (const child of v) yield* walk(child); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const cls = (v, name) => String(v.props?.class || '').split(/\s+/).includes(name);
const find = (v, predicate) => [...walk(v)].find(predicate);

test('protocol selection keeps four real difficulties, round/stage descriptions and the existing start callback', () => {
  let started = 0, picked;
  const props = { card: { name: '同盟匹配', desc: '仅匹配真人 · 满四人后开始', en: 'ALLIANCE MATCHMAKING' },
    roomMode: 'match', difficulty: 'FUNNY', online: true, busy: null, onClose() {},
    onStart: () => started++, onDifficulty: (d) => { picked = d; } };
  const tree = ProtocolSelect(props);
  assert.equal(tree.type, 'main', 'mode selection is a secondary page, not a modal');
  assert.equal(tree.props.class, 'screen protocol-screen');
  const cards = [...walk(tree)].filter((v) => v.type === ProtoCard);
  assert.deepEqual(cards.map((v) => v.props.difficulty), ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']);
  assert.equal(cards.every((v) => v.props.roomMode === 'match'), true);
  const hard = ProtoCard(cards[2].props);
  hard.props.onClick();
  assert.equal(picked, 'HARD');
  assert.equal(difficultyInfo('match', 'FUNNY').rounds, 14);
  assert.equal(difficultyInfo('solo', 'FUNNY').rounds, 9);
  find(tree, (v) => cls(v, 'proto-start')).props.onClick();
  assert.equal(started, 1);
  assert.equal(find(ProtocolSelect({ ...props, online: false }), (v) => cls(v, 'proto-start')).props.disabled, true);
  assert.equal(find(ProtocolSelect({ ...props, busy: 'match' }), (v) => cls(v, 'proto-start')).props.disabled, true);
});

test('queue replaces the start control and forwards cancel, without a countdown or bot-fill option', () => {
  let cancelled = 0;
  const tree = ProtocolSelect({ card: { name: '同盟匹配' }, roomMode: 'match', difficulty: 'FUNNY',
    queue: { count: 3, capacity: 4 }, onCancel: () => cancelled++ });
  assert.equal(find(tree, (v) => cls(v, 'proto-start')), undefined);
  const queue = find(tree, (v) => v.type?.name === 'MatchQueuePanel');
  assert.deepEqual(queue.props.queue, { count: 3, capacity: 4 });
  queue.props.onCancel();
  assert.equal(cancelled, 1);
  const source = read('public/js/screens/lobby.js');
  assert.match(source, /net\.request\('match\.join', \{ mode: 'coop', difficulty \}\)/);
  assert.match(source, /net\.request\('match\.leave', \{\}\)/);
  assert.doesNotMatch(source, /fillBots|setTimeout|match\.queue|match\.cancel/);
});

const host = { playerId: 'host', seat: 0, name: '<script>host</script>', connected: true };
const bot = { playerId: 'bot', seat: 1, name: 'AI', isBot: true };
const room = { mode: 'coop', hostId: 'host', seats: [host, bot], spectators: [{ playerId: 'spec' }] };
const seatProps = { room, facts: roomFacts(room, 'host'), myId: 'host', portraits: { pool: [], m: {} } };

test('redesigned seats preserve private-room AI add/remove, host kicks and spectator restrictions', () => {
  let added = 0, removed, kicked;
  const empty = SeatCardView({ ...seatProps, seat: null, index: 2, onAddBot: () => added++ });
  find(empty, (v) => v.props?.icon === 'robot').props.onClick();
  assert.equal(added, 1);
  const waiting = SeatCardView({ ...seatProps, room: { ...room, matching: {} }, seat: null, index: 2 });
  assert.equal(find(waiting, (v) => v.props?.icon === 'robot').props.disabled, true);
  const ai = SeatCardView({ ...seatProps, seat: bot, index: 1, onRemoveBot: (i) => { removed = i; } });
  find(ai, (v) => v.props?.['aria-label'] === '移除 AI 队友').props.onClick();
  assert.equal(removed, 1);
  const guest = { playerId: 'guest', seat: 2, name: 'guest' };
  const guestTree = SeatCardView({ ...seatProps, seat: guest, index: 2, onKick: (...args) => { kicked = args; } });
  find(guestTree, (v) => v.props?.['aria-label'] === '移出该博士').props.onClick();
  assert.deepEqual(kicked, [2, 'guest', 'guest']);
  const spec = SeatCardView({ ...seatProps, facts: roomFacts(room, 'spec'), myId: 'spec', seat: null, index: 3 });
  assert.equal(find(spec, (v) => v.props?.icon === 'robot'), undefined);
  assert.equal(find(spec, (v) => cls(v, 'rseat__invite')), undefined);
  assert.equal(normalizeSeats(room).length, 4);
  assert.equal(normalizeSeats({ mode: 'solo', seats: [host] }).length, 1);
  assert.doesNotMatch(inviteLink('ABCD'), /node=/);
});

test('seat art is deterministic decoration with missing-art fallback and plain-text names', () => {
  const pool = cardOperators([
    { charId: 'a', name: 'A', visible: true, rarity: 6 },
    { charId: 'a', name: 'A elite', isGolden: true, rarity: 6 },
    { charId: 'b', name: 'Hidden', visible: false },
    { charId: 'c', name: 'DIY', isDiy: true },
  ]);
  assert.equal(pool.length, 1);
  assert.equal(pool[0].isGolden, true);
  assert.equal(seatPortrait(host, { pool: [], m: {} }), null);
  const before = JSON.stringify(host);
  assert.equal(seatPortrait(host, { pool, m: {} }), seatPortrait({ ...host, card: 'ignored' }, { pool, m: {} }));
  const tree = SeatCardView({ ...seatProps, seat: host, index: 0 });
  assert.equal(find(tree, (v) => cls(v, 'rseat__name')).props.children, host.name);
  assert.equal(JSON.stringify(host), before);
  assert.equal(find(tree, (v) => v.props?.dangerouslySetInnerHTML), undefined);
});

test('loadout deck quick choices reuse the existing skill/module handler and do not mutate saved state', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(read(`data/${String(url).split('/').pop()}`)) });
  try { await data.loadAll('chess', 'assets', 'bonds'); } finally { globalThis.fetch = oldFetch; }
  const chess = data.lookup('chess', 'chess_char_1_01_a');
  const golden = data.lookup('chess', chess.goldenId);
  const before = JSON.stringify(loadoutStore.get());
  let change, pick;
  const tree = OpCard({ chess, golden, m: data.get('assets'), entries: {}, quick: 'skill',
    onChange: (...args) => { change = args; }, onPick: (id) => { pick = id; } });
  const skill = find(tree, (v) => v.type?.name === 'QuickSkill');
  skill.props.onPick(1);
  assert.deepEqual(change, [chess.chessId, { skill: 1 }]);
  find(tree, (v) => cls(v, 'lo-op__pick')).props.onClick();
  assert.equal(pick, chess.chessId);
  assert.equal(JSON.stringify(loadoutStore.get()), before);
  const source = read('public/js/screens/loadout.js');
  assert.match(source, /<\$\{SkinSection\} chess=\$\{chess\}/);
  assert.match(source, /<\$\{OperatorVoice\}/);
  assert.match(source, /utility=\$\{true\} class="loadout-io-modal"/);
  assert.doesNotMatch(source, /skinsStore|setSkins|ItemCodex|ItemDetail/);
});

test('battle/settlement decoration reads authoritative facts and does not invent XP or account state', () => {
  const a = { playerId: 'a', seat: 0, alive: true, lp: 12 };
  const b = { playerId: 'b', seat: 1, alive: false, lp: 0 };
  assert.deepEqual(finalPlateRows({ players: [a, b], teamLp: 27 }), { rows: [{ player: a, lp: 12 }], total: 27 });
  assert.equal(endPlateOf({ victory: true, hiddenReached: true, hiddenCleared: false }), 'coreFail');
  assert.equal(endPlateOf({ victory: false }), 'abort');
  assert.equal(rowCleared({ victory: false }, { alive: true }, true), false);
  assert.equal(rowCleared(null, { left: true }, true), false);
  const lineup = [{ id: 'a', tier: 1 }, { id: 'token', kind: 'token', tier: 6 }, { id: 'b', tier: 5, golden: true }];
  assert.equal(aceOf(lineup), lineup[2]);
  assert.equal(fmtDuration(65_000), '00时01分05秒');
  assert.equal(capsuleFxKind(PHASE.UNITE, PHASE.COMBAT), 'unite');
  assert.equal(roundsToBoss({ round: 12, bossRound: 14 }), 2);
  const sp = { order: ['a', 'b'], pickOf: new Map([['a', 0]]), turnPid: 'b' };
  assert.deepEqual([...spMarks(sp, { solo: false })], [['a', 'done'], ['b', 'turn']]);
  assert.equal(turnPopupDue(sp, { myId: 'b', solo: false }), true);
  for (const file of ['public/js/screens/lobby.js', 'public/js/screens/room.js', 'public/js/screens/settle.js']) {
    const src = read(file);
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, /from ['\"](?:.*\/)?(?:accounts|friends|cloudStats|federation|randomMode|namecards|trophies)\.js/);
    for (const [, type] of code.matchAll(/net\.request\('([^']+)'/g)) assert.ok(Object.hasOwn(C2S, type), `${file}: ${type}`);
  }
  assert.doesNotMatch(read('public/js/screens/settle.js'), /LevelStrip|levelProgress|accountApi|fetch\(|net\.request/);
});

test('new layout stays on existing grids and text scale; mode selection uses page layout, not modal styling', () => {
  for (const file of ['lobby', 'room', 'loadout', 'game', 'game-panels', 'result']) {
    const sheet = postcss.parse(read(`public/css/screens/${file}.css`));
    sheet.walkDecls('--t', () => assert.fail(`${file} must not redefine the text root`));
    sheet.walkRules((rule) => {
      if (rule.selector === '.gm.has-spdraft .gtop') rule.walkDecls('visibility', (decl) => assert.notEqual(decl.value, 'hidden'));
    });
  }
  assert.match(read('public/css/screens/room.css'), /\.room-screen \.rseat \{[^}]*width: 100%[^}]*min-height: 3\.5rem/);
  assert.match(read('public/css/screens/lobby.css'), /\.screen\.protocol-screen \{[^}]*height: calc\(var\(--sp-vh/);
  assert.doesNotMatch(read('public/css/screens/lobby.css'), /protocol-modal/);
  assert.match(read('public/css/utility-mobile.css'), /\.lo--deck \.lo-top--deck \{[^}]*height: auto/);
});
