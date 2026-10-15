// Node/vnode + CSS-contract regressions; not a browser/real-device layout test.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import {
  SweepShell, SweepView, BondPanel, BandPanel, EnemyPanel, CodexDetail, EnemyCodexView,
  enemyGrade, codexEnemies, bossEnemyKeys, codexSelection, sweepTab, handbookPage, sweepEscapeAction,
} from '../../public/js/screens/sweep.js';
import { data } from '../../public/js/data.js';
import { Modal } from '../../public/js/ui/components.js';
import { loadoutStore, closeLoadout } from '../../public/js/ui/loadoutSync.js';
import { guideStore, closeGuide } from '../../public/js/ui/guide.js';
import { AchievementView } from '../../public/js/ui/achievements.js';
import { achievementStats } from '../../public/js/ui/achievementModel.js';

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
before(async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(read(`data/${String(url).split('/').pop()}`)) });
  try { await data.loadAll('bonds', 'bands', 'bosses', 'factions', 'enemies', 'chess', 'assets', 'local', 'backups', 'effects', 'garrisons'); }
  finally { globalThis.fetch = saved; }
});

function* walk(v) {
  if (Array.isArray(v)) { for (const child of v) yield* walk(child); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const text = (v) => v == null || typeof v === 'boolean' ? '' : typeof v !== 'object' ? String(v)
  : Array.isArray(v) ? v.map(text).join('') : text(v.props?.children);
const has = (v, cls) => String(v.props?.class || '').split(/\s+/).includes(cls);
const find = (v, predicate) => [...walk(v)].find(predicate);

test('report is a full page without a modal or focus trap and yields to the loadout or guide', () => {
  for (const [loadoutOpen, guideOpen, suspended] of [[false, false, false], [true, false, true], [false, true, true]]) {
    const root = SweepShell({ loadoutOpen, guideOpen, children: 'report' });
    assert.equal(root.type, 'main');
    assert.equal(root.props.children, 'report');
    assert.equal(root.props.inert, suspended ? '' : undefined);
    assert.equal(root.props['aria-hidden'], suspended ? 'true' : undefined);
    assert.equal(find(root, (v) => v.type === Modal || v.props?.role === 'dialog' || v.props?.['aria-modal']), undefined);
  }
  const source = read('public/js/screens/sweep.js');
  assert.doesNotMatch(source, /\bModal\b|setTimeout|net\.request|fetch\(/, 'no dialogs or protocol');
  assert.match(source, /addEventListener\('keydown', onKey, true\)/);
  assert.match(source, /removeEventListener\('keydown', onKey, true\)/);
  assert.match(source, /hidden=\$\{!!codex\}/, 'codex replaces the visible report without discarding its scroll/selection');
  assert.match(source, /setTabState\(next\); savePref\(TAB_PREF, next\); setCodex\(null\)/);
});

test('Escape returns from the codex first and cannot cross an operator/guide/dialog layer', () => {
  const ev = { key: 'Escape' };
  assert.equal(sweepEscapeAction(ev, {}), 'report');
  assert.equal(sweepEscapeAction(ev, { codexOpen: true }), 'codex');
  for (const key of ['loadoutOpen', 'guideOpen', 'dialogOpen']) {
    assert.equal(sweepEscapeAction(ev, { [key]: true, codexOpen: true }), null);
  }
  for (const event of [{ key: 'Enter' }, { ...ev, defaultPrevented: true }, { ...ev, isComposing: true },
    { ...ev, target: { type: 'search', value: 'Scout' } }]) assert.equal(sweepEscapeAction(event, {}), null);
});

test('all report tabs, loading state, guide shortcut and selection callbacks are wired', () => {
  let selected;
  let closed = 0;
  const props = { ready: true, tab: 'bonds', onClose: () => closed++, onTab: (id) => { selected = id; }, notOwned: [] };
  const tree = SweepView(props);
  find(tree, (v) => v.props?.['aria-label'] === '返回大厅').props.onClick();
  assert.equal(closed, 1);
  const tabs = [...walk(tree)].filter((v) => v.props?.role === 'tab');
  assert.deepEqual(tabs.map(text), ['盟约报告', '策略报告', '敌方资料']);
  tabs[2].props.onClick();
  assert.equal(selected, 'enemies');
  for (const [tab, component] of [['bonds', 'BondPanel'], ['bands', 'BandPanel'], ['enemies', 'EnemyPanel']]) {
    assert.ok(find(SweepView({ ...props, tab }), (v) => v.type?.name === component), tab);
  }
  assert.match(text(SweepView({ ...props, ready: false })), /正在读取报告/);
  assert.equal(find(SweepView({ ...props, ready: false }), (v) => v.type?.name === 'BondPanel'), undefined);
  for (const v of [null, 'firepower', '__proto__', 3]) assert.equal(sweepTab(v), 'bonds');
  assert.equal(sweepTab('enemies'), 'enemies');
  const old = guideStore.get();
  try {
    find(tree, (v) => v.props?.['aria-label'] === '进阶图鉴').props.onClick();
    assert.equal(guideStore.get().open, true);
    assert.equal(guideStore.get().page, handbookPage());
    closeGuide();
  } finally { guideStore.set(old); }
});

test('bond report shows actual members/thresholds, ownership and opens the selected operator in the existing loadout', () => {
  const bond = data.list('bonds').find((b) => b.visibleMembers?.length);
  const id = bond.visibleMembers[0];
  const tree = BondPanel({ bond, m: null, notOwned: [id] });
  assert.match(text(tree), /激活所需人数/);
  assert.ok(text(tree).includes(bond.thresholds.join(' / ')));
  const member = find(tree, (v) => v.type === 'button' && v.key === id);
  assert.ok(member, 'the real data member is offered');
  assert.ok(has(member, 'is-standin'));
  const old = loadoutStore.get(), entries = JSON.stringify(old.entries);
  try {
    member.props.onClick();
    assert.equal(loadoutStore.get().open, true);
    assert.equal(loadoutStore.get().from, 'sweep');
    assert.equal(loadoutStore.get().sel, id);
    assert.equal(loadoutStore.get().tab, 'loadout');
    assert.equal(JSON.stringify(loadoutStore.get().entries), entries, 'viewing a member does not edit settings');
    closeLoadout();
  } finally { loadoutStore.set(old); }
  assert.match(read('public/js/screens/loadout.js'), /useState\(\(\) => st\.from === 'sweep' && !!st\.sel\)/);
});

test('strategy report reads the installed LP/effect/mode data and does not derive new gameplay values', () => {
  const band = data.list('bands').find((b) => b.modeTypeList.includes('SINGLE') && b.modeTypeList.includes('MULTI'));
  const tree = BandPanel({ band, m: null });
  assert.ok(text(tree).includes(String(band.totalHp)));
  assert.match(text(tree), /独立模拟.*同盟模拟/);
  const effect = find(tree, (v) => v.props?.text === (band.descRaw || band.desc));
  assert.ok(effect);
  assert.equal(find(tree, (v) => v.type?.name === 'Hero').props.name, band.name);
});

test('boss/escort and training-group details open the correct codex scope, including real installed data', () => {
  const boss = data.list('bosses').find((b) => !b.hidden);
  const keys = bossEnemyKeys(boss);
  assert.equal(keys[0], boss.enemyKey);
  assert.equal(new Set(keys).size, keys.length);
  for (const list of Object.values(boss.escortsByTemplate)) for (const e of list) assert.ok(keys.includes(e.key));
  let scope;
  const bossTree = EnemyPanel({ sel: { kind: 'boss', id: boss.bossId }, m: null, onCodex: (v) => { scope = v; } });
  find(bossTree, (v) => has(v, 'sw-look')).props.onClick();
  assert.deepEqual(scope.keys, keys);
  assert.equal(scope.key, boss.enemyKey);
  const f = Object.values(data.get('factions').types)[0];
  const group = EnemyPanel({ sel: { kind: 'type', id: f.type }, m: null, onCodex: (v) => { scope = v; } });
  find(group, (v) => has(v, 'sw-look')).props.onClick();
  assert.ok(scope.keys.length > 0);
  assert.ok(scope.keys.every((k) => f.pool.includes(k) || f.entries.includes(k)));
  assert.ok(scope.keys.every((k) => data.lookup('enemies', k)));
});

const enemies = [
  { key: 'enemy_2_a', name: 'Scout', rank: 'NORMAL', handbookIndex: 'A1' },
  { key: 'enemy_2_b', name: 'Scout', rank: 'NORMAL', handbookIndex: 'A1' }, // variant
  { key: 'enemy_3_a', name: 'Guard', rank: 'ELITE', handbookIndex: 'B2' },
  { key: 'enemy_4_a', name: 'Leader', rank: 'BOSS', handbookIndex: 'L1' },
  { key: 'enemy_5_a', name: 'Summon', rank: 'NORMAL', tokenOnly: true },
];
test('codex search/selection counts: name, handbook id, ranks, no matches and scoped variants', () => {
  assert.equal(codexEnemies(enemies).length, 3);
  assert.equal(codexSelection(enemies).list.length, 3);
  assert.equal(codexSelection(enemies, { query: ' SCOUT ' }).cur.key, 'enemy_2_a');
  assert.equal(codexSelection(enemies, { query: 'b2' }).cur.rank, 'ELITE');
  assert.equal(codexSelection(enemies, { rank: 'BOSS' }).cur.name, 'Leader');
  assert.equal(codexSelection(enemies, { query: 'none' }).cur, null);
  const scoped = codexSelection(enemies, { scope: ['enemy_2_b', 'enemy_2_b', 'missing'], selected: 'enemy_2_b' });
  assert.equal(scoped.cur.key, 'enemy_2_b', 'do not discard a requested variant just because the full codex dedupes it');
  assert.equal(scoped.list.length, 1);
  assert.equal(scoped.counts.all, 1);
  assert.equal(scoped.counts.BOSS, 0);
  assert.deepEqual(bossEnemyKeys(null), []);
  assert.deepEqual(codexEnemies(null), []);
});

test('enemy codex uses real base stats/abilities and labels its letter grades as nonofficial', () => {
  const enemy = data.list('enemies').find((e) => e.abilities.length && e.stats.atk > 0);
  const tree = CodexDetail({ e: enemy, m: null });
  assert.ok(text(tree).includes(enemy.name));
  assert.equal([...walk(tree)].some((v) => v.props?.dangerouslySetInnerHTML), false);
  for (const k of ['maxHp', 'atk', 'def', 'res']) assert.ok(find(tree, (v) => has(v, 'sw-stat') && v.key === k), k);
  assert.equal(enemyGrade('maxHp', 2000), 'D');
  assert.equal(enemyGrade('maxHp', 200000), 'S');
  assert.equal(enemyGrade('interval', 0.7), 'S');
  assert.equal(enemyGrade('interval', 6), 'E');
  for (const v of [null, NaN, Infinity, undefined]) assert.equal(enemyGrade('atk', v), '—');
  assert.equal(enemyGrade('not-a-stat', 5), '—');
  let scope = 'not changed', query, rank, selected;
  const model = codexSelection(enemies, { scope: ['enemy_2_b'] });
  const view = EnemyCodexView({ model, open: { title: 'group' }, scope: ['enemy_2_b'], rank: 'all', query: '',
    onClose() {}, onScope: (v) => { scope = v; }, onQuery: (v) => { query = v; }, onRank: (v) => { rank = v; }, onSelect: (v) => { selected = v; } });
  assert.equal(view.type, 'section');
  assert.equal(view.props['aria-label'], '敌方图鉴');
  assert.equal(find(view, (v) => v.type === Modal || v.props?.role === 'dialog'), undefined);
  assert.match(text(view), /不是官方评级/);
  find(view, (v) => has(v, 'sw-scope')).props.onClick();
  assert.equal(scope, null);
  find(view, (v) => v.type === 'input').props.onInput({ currentTarget: { value: 'A1' } });
  assert.equal(query, 'A1');
  find(view, (v) => v.props?.role === 'tab' && v.key === 'NORMAL').props.onClick();
  assert.equal(rank, 'NORMAL');
  find(view, (v) => v.type?.name === 'EnemyThumb').props.onClick();
  assert.equal(selected, 'enemy_2_b');
});

test('achievement canvas follows the reference design rem and viewport, without altering original stats or battle roots', () => {
  const view = AchievementView({ ready: true, gd: {}, s: achievementStats([]), local: {}, onClose() {} });
  assert.ok(find(view, (v) => v.props?.class === 'ach__box'));
  const sheet = postcss.parse(read('public/css/screens/lobby.css'));
  const heights = [];
  sheet.walkRules((r) => {
    if (r.selector === '.ach__box') r.walkDecls('width', (d) => heights.push(d.value));
  });
  assert.ok(heights.includes('min(17.4rem, calc(100vw - 1.1rem))'));
  const sizes = [];
  sheet.walkRules((r) => {
    if (r.selector === '.ach__box') r.walkDecls('height', (d) => sizes.push(d.value));
  });
  assert.ok(sizes.includes('min(9.06rem, calc(var(--sp-vh, 1vh) * 100 - .9rem))'));
  assert.doesNotMatch(read('public/css/screens/lobby.css'), /1080px|720px/);
  const stats = postcss.parse(read('public/css/screens/stats.css'));
  const compact = [];
  stats.walkRules((r) => { if (r.selector === '.st:not(.st--replay)') compact.push(r); });
  assert.equal(compact.length, 1);
  assert.equal(compact[0].parent.params, '(min-width: 1001px) and (min-height: 601px)');
  assert.match(compact[0].toString(), /width: min\(12rem, 1120px, 90vw\)/);
  assert.match(compact[0].toString(), /height: min\(8rem, 780px, 86dvh\)/);
  assert.doesNotMatch(compact[0].toString(), /transform|zoom|--t:/);
  assert.equal(compact[0].selector.includes('combat-metrics'), false);
});

test('report has an explicit lazy lobby entry, no extra service/assets, readable scrollable mobile controls', () => {
  const lobby = read('public/js/screens/lobby.js');
  assert.match(lobby, /import\('\.\/sweep\.js'\)/);
  assert.doesNotMatch(lobby, /import .+ from ['"]\.\/sweep\.js/);
  assert.match(lobby, /panel !== 'sweep' \|\| sweepModule/);
  assert.match(lobby, /hub-plate hub-plate--sweep/);
  const report = read('public/js/screens/sweep.js');
  assert.doesNotMatch(report, /accounts\.js|friends\.js|randomMode\.js|net\.request|fetch\(/);
  assert.match(report, /useData\('bonds', 'bands', 'bosses', 'factions', 'enemies', 'chess', 'assets'\)/);
  const mobile = read('public/css/utility-mobile.css');
  assert.match(mobile, /\.sweep-host \.sw-tile__cap \{ display: block; white-space: normal/);
  assert.match(mobile, /\.sweep-host \.sw-search input \{[^}]*font-size: 16px/);
  const css = read('public/css/screens/lobby.css');
  assert.match(css, /\.screen\.sweep-host \{[^}]*height: calc\(var\(--sp-vh/);
  assert.match(css, /\.sweep-host \.sw-left \{[^}]*overflow-y: auto/);
  assert.doesNotMatch(css + mobile, /sweep-(?:codex-)?modal/);
  assert.match(lobby, /if \(panel === 'sweep'\) return sweepModule/);
  assert.match(lobby, /<\$\{SweepLoadingPage\}/, 'the loading view is non-modal too');
  const loading = lobby.slice(lobby.indexOf('export function SweepLoadingPage'), lobby.indexOf('function StampRing'));
  assert.doesNotMatch(loading, /\bModal\b|aria-modal|role="dialog"/);
  assert.match(lobby, /previousPanel\.current === 'sweep'.*sweepEntry\.current\?\.focus\(\)/, 'return focus to the lobby entry');
});
