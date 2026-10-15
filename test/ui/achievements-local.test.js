// Node/vnode and stylesheet checks, not browser/phone layout validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { achievementStats, bondOperators, recordBonds, ACHIEVEMENTS, ACHIEVEMENT_GROUPS } from '../../public/js/ui/achievementModel.js';
import { AchievementView, AchievementEntryView, AchievementMark } from '../../public/js/ui/achievements.js';
import {
  STATS_VERSION, FULL_KEEP, MAX_RECORDS, MAX_CHARS, buildRecord, compactRecord, normalizeRecord,
  emptyStats, loadStats, saveStats, subscribeStats, exportStats, importStats, aggregateStats, fitToBudget,
} from '../../public/js/ui/stats.js';
import { Modal } from '../../public/js/ui/components.js';

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const row = (over = {}) => ({
  playerId: 'me', name: '<img onerror=bad>', seat: 0, victory: true, alive: true,
  roundsPassed: 14, bandId: 'band-a', trophies: 5, title: { id: 'comment_1' },
  stats: { gold: 100, merges: 3, kills: 50 },
  bonds: [{ bondId: 'bond-a', active: true, layers: 9 }], lineup: [{ id: 'op-a', tier: 1 }],
  ...over,
});
const rec = (id, over = {}, self = {}) => ({
  id, t: 1, end: 'settled', selfId: 'me', roomMode: 'coop', difficulty: 'HARD',
  players: [row(self), row({ playerId: 'other', trophies: 999, stats: { gold: 99999, kills: 99999 } })],
  ...over,
});

test('local achievements match the existing counting/self-victory rules, not team totals or early quits', () => {
  const records = [
    rec('win'), rec('win'), // same imported/replayed id does not count twice
    rec('loss', { roomMode: 'solo', difficulty: 'ABYSS', victory: true }, { victory: false, trophies: 0 }),
    rec('early', { end: 'quit' }, { roundsPassed: 0, trophies: 999, stats: { kills: 99999 } }),
    rec('quit', { end: 'quit' }, { victory: false, roundsPassed: 1, trophies: 0, stats: { kills: 99999 } }),
    null,
  ];
  const original = JSON.stringify(records);
  const s = achievementStats(records);
  assert.equal(s.count, 3);
  assert.equal(s.modes.coop.games, 2);
  assert.equal(s.modes.coop.wins, 1);
  assert.equal(s.modes.coop.hard, 1);
  assert.equal(s.modes.solo.wins, 0, 'a dead/left self does not inherit the team win');
  assert.equal(s.trophies, 5, 'no teammate rewards and no excluded records');
  assert.deepEqual(s.maxima, { gold: 100, merges: 3, kills: 50 }, 'quit bookkeeping does not become a settled best');
  assert.equal(s.titles.comment_1, 3);
  const deduped = records.filter((r, i) => r && i !== 1);
  const old = aggregateStats(deduped);
  assert.equal(s.count, old.count);
  assert.equal(s.modes.coop.wins + s.modes.solo.wins, old.wins);
  assert.equal(s.bestRound, old.rounds.max);
  assert.equal(JSON.stringify(records), original, 'reading never mutates saved records');
});

test('best bond, top-three usage and special strategy marks use retained details and real clears', () => {
  const records = [
    rec('a', {}, { bonds: [{ bondId: 'hidden', layers: 9999, active: true }, { bondId: 'x', layers: 15, active: true }, { bondId: 'x', layers: 15, active: true }] }),
    rec('b', { difficulty: 'FUNNY' }, { bandId: 'band-b', bonds: [{ bondId: 'y', layers: 7, active: true }] }),
    rec('c', { difficulty: 'ABYSS' }, { bandId: 'band-c', victory: false, bonds: [{ bondId: 'x', layers: 12, active: true }] }),
    rec('compact', { compact: true }, { bonds: [{ bondId: 'fake', active: true, layers: 500 }], trophies: 8 }),
  ];
  const s = achievementStats(records, { hiddenLayers: (id) => id === 'hidden' });
  assert.equal(s.best.bondId, 'x');
  assert.equal(s.best.layers, 15);
  assert.equal(s.best.rec.id, 'a');
  assert.equal(s.detailed, 3);
  assert.equal(s.trophies, 23);
  assert.equal(s.topBonds.find((b) => b.bondId === 'x').games, 2, 'one activation per match');
  assert.equal(s.topBonds.some((b) => b.bondId === 'fake'), false);
  assert.deepEqual(s.markedBands, ['band-a'], 'FUNNY and failed ABYSS do not earn the mark');
  assert.equal(s.topBands[0].bandId, 'band-a', 'compact records still count known strategies');
  const picks = recordBonds([{ bondId: 'hidden', active: true, layers: 999 }, { bondId: 'x', active: true, layers: 9 }], (id) => id === 'hidden');
  assert.equal(picks[0].bondId, 'x');
  assert.equal(picks[1].hidden, true);
  assert.equal(achievementStats([rec('old', { compact: true }, { trophies: undefined, lineup: undefined, bonds: undefined })]).trophies, 0);
});

test('old/malformed inputs and hidden/elite/DIY operators cannot contaminate the local view', () => {
  const s = achievementStats([rec('hostile', { roomMode: '__proto__' }, { title: { id: '__proto__' } })]);
  assert.equal(s.titles.__proto__, 1);
  assert.equal(Object.prototype.games, undefined);
  assert.equal(s.modes.coop.games, 0);
  assert.equal(achievementStats(null).count, 0);
  assert.equal(achievementStats([{}]).best, null);
  const operators = [
    { chessId: 'a', charId: 'a', tier: 2, bonds: ['x'] },
    { chessId: 'b', charId: 'b', tier: 1, bonds: ['x'] },
    { chessId: 'a2', charId: 'a', tier: 2, bonds: ['x'] },
    { chessId: 'elite', isGolden: true, bonds: ['x'] },
    { chessId: 'hidden', visible: false, bonds: ['x'] },
    { chessId: 'diy', isDiy: true, bonds: ['x'] },
  ];
  assert.deepEqual(bondOperators(operators, 'x').map((c) => c.chessId), ['b', 'a']);
});

test('30 local achievement goals share the existing counting rules, compact history and self-only totals', () => {
  assert.equal(ACHIEVEMENTS.length, 30);
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, 30);
  assert.equal(ACHIEVEMENT_GROUPS.length, 7);
  const settled = rec('win', { durationMs: 10 * 3.6e6, hiddenCleared: true, difficulty: 'ABYSS' },
    { trophies: 10, stats: { kills: 1000, bossDamage: 1e6, perfectRounds: 50, merges: 200 } });
  const compact = normalizeRecord(compactRecord(normalizeRecord(settled)));
  const records = [compact, compact, rec('excluded', { end: 'quit' }, { roundsPassed: 0, trophies: 1000 }),
    rec('quit', { end: 'quit', durationMs: 0 }, { victory: false, trophies: 0, roundsPassed: 1, stats: { kills: 1e9 } })];
  const original = JSON.stringify(records);
  const s = achievementStats(records);
  const get = (id) => s.achievements.find((a) => a.id === id);
  assert.equal(get('games_10').current, 2);
  assert.equal(get('wins_20').current, 1);
  for (const id of ['games_1', 'wins_1', 'hours_10', 'clear_ABYSS', 'hidden_1', 'hidden_abyss',
    'kills_1000', 'boss_1m', 'perfect_50', 'merges_200', 'trophy_10']) assert.equal(get(id).done, true, id);
  assert.equal(get('trophy_30').current, 10);
  assert.equal(get('kills_20000').current, 1000, 'no teammate/quit totals');
  assert.equal(s.achieved, s.achievements.filter((a) => a.done).length);
  assert.equal(s.detailed, 1);
  assert.equal(JSON.stringify(records), original);
  const empty = achievementStats([]).achievements;
  assert.ok(empty.every((a) => !a.done && a.frac === 0 && a.current === 0));
  assert.ok(s.achievements.every((a) => a.frac >= 0 && a.frac <= 1));
});

test('unknown title ids cannot complete the six real comments; all seven reference categories have goals', () => {
  const s = achievementStats(Array.from({ length: 6 }, (_, i) => rec(String(i), {}, { title: { id: `unknown-${i}` } })));
  assert.equal(s.achievements.find((a) => a.id === 'titles_6').current, 0);
  for (const [group] of ACHIEVEMENT_GROUPS) {
    const list = s.achievements.filter((a) => a.group === group);
    assert.ok(list.length > 0);
    assert.ok(list.every((a) => a.group === group));
  }
});

test('achievement rows follow reference markup and expose accessible progress and completion', () => {
  const list = achievementStats([]).achievements;
  const view = AchievementMark({ a: list[0], icon: 'hourglass' });
  assert.equal(view.props.class, 'ach-mark ach-mark--row');
  const progress = [...walk(view)].find((v) => v.props?.role === 'progressbar');
  assert.equal(progress.props['aria-valuenow'], 0);
  assert.equal(progress.props['aria-valuemax'], 1);
  assert.match(text(view), /初次模拟.*完成 1 场模拟.*0 \/ 1/);
  const done = AchievementMark({ a: { ...list[0], done: true, current: 1, frac: 1 }, icon: 'hourglass' });
  assert.match(done.props.class, /is-done/);
  assert.match(text(done), /已达成/);
  assert.equal([...walk(done)].some((v) => v.props?.role === 'progressbar'), false);
});

test('new compact rows retain own trophies without names/teammates/lineup, old rows remain compatible', () => {
  const full = buildRecord({ modeId: 'mode_multi_hard', difficulty: 'HARD', players: [row(), row({ playerId: 'other' })] }, { myId: 'me', now: 1 });
  const compact = compactRecord(full);
  assert.equal(compact.players[0].trophies, 5);
  assert.equal(compact.players[0].name, undefined);
  assert.equal(compact.players[0].bonds, undefined);
  assert.equal(compact.players[0].lineup, undefined);
  assert.equal(compact.players.length, 1);
  assert.deepEqual(compactRecord(normalizeRecord(compact)), compact);
  const old = structuredClone(compact);
  delete old.players[0].trophies;
  assert.equal(achievementStats([normalizeRecord(old)]).trophies, 0, 'missing history is never reconstructed');
  const eliminated = compactRecord(rec('out', {}, { alive: false, eliminatedRound: 9 }));
  assert.equal(normalizeRecord(eliminated).players[0].eliminatedRound, 9);
  const many = Array.from({ length: MAX_RECORDS }, (_, i) => ({ ...full, id: `r${i}`, t: MAX_RECORDS - i }));
  const fit = fitToBudget(many);
  assert.ok(JSON.stringify({ v: STATS_VERSION, records: fit }).length <= MAX_CHARS);
  assert.equal(achievementStats(fit).trophies, fit.length * 5);
  assert.equal(fit[FULL_KEEP].compact, true);
});

test('save/import/clear notify local views, failed and future-version writes do not; no second store', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const mem = new Map();
  let refuse = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => { if (refuse) throw new Error('quota'); mem.set(k, v); },
    removeItem: (k) => mem.delete(k),
  } });
  let calls = 0;
  const stop = subscribeStats(() => calls++);
  const stopBroken = subscribeStats(() => { throw new Error('view failure'); });
  try {
    const original = emptyStats();
    original.records = [normalizeRecord(rec('local'))];
    assert.equal(saveStats(original), true);
    await Promise.resolve();
    assert.equal(calls, 1);
    assert.equal(achievementStats(loadStats().records).trophies, 5);
    const exported = exportStats(loadStats());
    assert.equal(saveStats(emptyStats()), true);
    await Promise.resolve();
    assert.equal(achievementStats(loadStats().records).count, 0);
    const imported = importStats(exported, loadStats());
    assert.equal(saveStats(imported.stats), true);
    await Promise.resolve();
    assert.equal(achievementStats(loadStats().records).trophies, 5);
    const count = calls, before = mem.get('sp.pref.stats');
    assert.equal(saveStats({ ...original, newer: true }), false);
    refuse = true;
    assert.equal(saveStats(original), false);
    await Promise.resolve();
    assert.equal(calls, count);
    assert.equal(mem.get('sp.pref.stats'), before);
    refuse = false;
    stop();
    assert.equal(saveStats(emptyStats()), true);
    await Promise.resolve();
    assert.equal(calls, count, 'unmounted views unsubscribe');
    assert.deepEqual([...mem.keys()], ['sp.pref.stats']);
  } finally {
    stop(); stopBroken();
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

function* walk(v) {
  if (Array.isArray(v)) { for (const node of v) yield* walk(node); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const text = (v) => v == null || typeof v === 'boolean' ? '' : typeof v !== 'object' ? String(v)
  : Array.isArray(v) ? v.map(text).join('') : text(v.props?.children);

test('the local view uses the reference panel/header, preserves empty/newer states and links to existing stats', () => {
  const s = achievementStats([]);
  let opened = 0;
  const entry = AchievementEntryView({ s, onOpen: () => opened++ });
  entry.props.onClick();
  assert.equal(opened, 1);
  assert.match(text(entry), /成就统计.*本机记录/);
  let closed = 0, openedStats = 0;
  const tree = AchievementView({ me: { name: '<script>' }, ready: true, gd: {}, local: {}, s,
    onClose: () => closed++, onStats: () => openedStats++ });
  assert.equal(tree.type, 'div');
  assert.equal(tree.props.class, 'ach');
  const dialog = [...walk(tree)].find((v) => v.props?.role === 'dialog');
  assert.equal(dialog.props['aria-modal'], 'true');
  assert.equal(dialog.props['aria-label'], '成就统计');
  assert.equal(dialog.props.class, 'ach__box');
  assert.equal([...walk(tree)].some((v) => v.type === Modal), false);
  [...walk(tree)].find((v) => v.props?.class === 'ach__close').props.onClick();
  [...walk(tree)].find((v) => v.props?.class === 'ach-local__stats').props.onClick();
  assert.equal(closed, 1);
  assert.equal(openedStats, 1);
  assert.match(text(tree), /当前浏览器保留的对局.*不上传服务器/s);
  assert.equal([...walk(tree)].filter((v) => v.type === AchievementMark).length, 30);
  assert.equal([...walk(tree)].some((v) => v.type === 'select' || /ach-(?:banner|filters|goal)/.test(v.props?.class || '')), false);
  const names = [...walk(tree)].map((v) => v.type?.name);
  for (const name of ['Plate', 'ModeTable', 'TitleHex', 'BestRecord', 'Maxima', 'BondRecord', 'BandRecord']) assert.ok(names.includes(name), name);
  const plate = [...walk(tree)].find((v) => v.type?.name === 'Plate');
  const renderedPlate = plate.type(plate.props);
  assert.match(text(renderedPlate), /<script>/, 'the name is a text vnode, not markup');
  assert.equal([...walk(renderedPlate)].some((v) => v.props?.dangerouslySetInnerHTML), false);
  const newer = AchievementView({ ready: true, gd: {}, local: { newer: true }, s, onClose() {} });
  assert.match(text(newer), /战绩由更新版本保存/);
  assert.equal([...walk(newer)].some((v) => v.type?.name === 'BestRecord'), false);
});

test('the achievement entry remains local-only and the original design keeps shared focus and responsive sizing', () => {
  const view = read('public/js/ui/achievements.js');
  assert.match(view, /subscribeStats\(refresh\)/);
  assert.match(view, /addEventListener\?\.\('storage', storage\)/);
  assert.match(view, /removeEventListener\?\.\('storage', storage\)/);
  assert.doesNotMatch(view, /setInterval|accountApi|localStorage\.setItem|net\.request|fetch\(/);
  assert.doesNotMatch(view, /from ['"].*(?:accounts|friends|cloudStats|namecards|trophies)\.js/);
  assert.match(read('public/js/screens/lobby.js'), /panel === 'achievements' \? html`<\$\{AchievementPanel\}/);
  for (const file of ['public/css/screens/lobby.css', 'public/css/utility-mobile.css']) {
    const sheet = postcss.parse(read(file));
    sheet.walkDecls('--t', () => assert.fail('only theme.css may define the text root'));
  }
  const css = read('public/css/utility-mobile.css');
  assert.match(view, /useModalFocus\(true, close, boxRef\)/);
  assert.match(view, /260 - \(Date\.now\(\) - opened\.current\)/);
  assert.match(view, /useLeave\(onClose, 180\)/);
  const sheet = read('public/css/screens/lobby.css');
  assert.match(sheet, /\.ach-top-area \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(sheet, /\.ach-marks--list \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(4\.6rem, 1fr\)\)/);
  const mobile = read('public/css/utility-mobile.css');
  assert.match(mobile, /\.ach-marks--list \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(mobile, /\.ach-mark--row \{ min-width: 0; gap: \.1rem/);
  assert.match(sheet, /\.ach__box \{[^}]*width: min\(17\.4rem, calc\(100vw - 1\.1rem\)\)/);
  assert.match(css, /\.ach__box \{[^}]*--sa-l[^}]*--sp-vh/);
  const pending = AchievementView({ ready: false, s: achievementStats([]), local: {}, gd: {}, onClose() {} });
  assert.ok([...walk(pending)].some((v) => v.props?.class === 'ach__loader'));
});
