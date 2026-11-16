// Shared loadout navigation, tier presentation and version-aware DIY instructions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try { const body = readFileSync(path.join(ROOT, 'data', name), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(body) }; } catch { return { ok: false, status: 404, json: async () => ({}) }; }
};
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { OpCard, LoadoutNavigation, diySettingsText } = await import('../../public/js/screens/loadout.js');
const { data } = await import('../../public/js/data.js');
const { PromotionIcon } = await import('../../public/js/ui/gameComponents.js');
const { TierChip } = await import('../../public/js/ui/components.js');
const { TierFilter } = await import('../../public/js/ui/rosterFilters.js');
const { RosterTierMark } = await import('../../public/js/ui/rosterDeck.js');
await data.loadAll('chess', 'garrisons', 'assets', 'bonds', 'effects', 'backups');

const get = (id) => data.lookup('chess', id);
const INSIDE = 'chess_char_1_01_a';   // 隐现: S1 / S2 (default S2), MAR-X

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && ['QuickSkill', 'QuickModule', 'CultivationSelects', 'PotPips'].includes(v.type.name)) { yield* walk(v.type(v.props)); return; }
  yield* walk(v.props?.children);
}
const find = (tree, pred) => [...walk(tree)].filter(pred);
const textOf = (v) => (v == null || typeof v === 'boolean' ? '' : typeof v !== 'object' ? String(v) : Array.isArray(v) ? v.map(textOf).join('') : textOf(v.props?.children));

test('promotion icons: E0, E1 and E2 use the official images or a phase-specific missing-art fallback', () => {
  for (const phase of [0, 1, 2]) {
    const icon = PromotionIcon({ m: null, phase, class: 'phase-test' });
    assert.equal(icon.props.src, null);
    assert.equal(textOf(icon.props.fallback), `E${phase}`);
  }
  for (const phase of [undefined, null, -1, 3]) assert.equal(PromotionIcon({ m: null, phase }), null);
});


test('both roster renderers expose all three destinations and preserve the active tab', () => {
  for (const view of ['list', 'deck']) for (const tab of ['loadout', 'ownership', 'diy']) {
    const events = [];
    const nav = LoadoutNavigation({ tab, view, nNotOwned: 2, nDiy: 3,
      onTab: (id) => events.push(['tab', id]), onView: (id) => events.push(['view', id]), onHelp() {} });
    const tabs = find(nav, (v) => v.props?.role === 'tab');
    assert.deepEqual(tabs.map((v) => v.props['data-tab']), ['loadout', 'ownership', 'diy']);
    assert.deepEqual(tabs.filter((v) => v.props['aria-selected'] === 'true').map((v) => v.props['data-tab']), [tab]);
    tabs.forEach((v) => v.props.onClick());
    const switches = find(nav, (v) => v.props?.['data-loadout-view']);
    assert.equal(switches.filter((v) => v.props['aria-pressed']).length, 1);
    switches.forEach((v) => v.props.onClick());
    assert.deepEqual(events, [['tab', 'loadout'], ['tab', 'ownership'], ['tab', 'diy'], ['view', 'deck'], ['view', 'list']]);
  }
});

test('DIY instructions distinguish regulation candidates from the in-match bring confirmation', () => {
  const regulation = JSON.parse(readFileSync(path.join(ROOT, 'data/versions/act3autochess-v3_1/config.json'), 'utf8'));
  const classic = JSON.parse(readFileSync(path.join(ROOT, 'data/config.json'), 'utf8'));
  assert.match(diySettingsText(regulation, false), /候选.*选择自编/);
  assert.match(diySettingsText(regulation, true), /下局候选.*不会改变本局/);
  assert.match(diySettingsText(classic, false), /局外设置.*下一局/);
  assert.match(diySettingsText(classic, true), /本局按开局时的设置/);
  assert.doesNotMatch(diySettingsText({ ...regulation, timers: {} }, false), /选择自编/);
});


test('tier filters, deck groups and operator cards use the same TierChip component', () => {
  const events = [];
  const filters = TierFilter({ tier: 5, onTier: tier => events.push(tier) });
  const buttons = find(filters, v => v.type === 'button');
  assert.deepEqual(find(filters, v => v.type === TierChip).map(v => v.props.tier), [1, 2, 3, 4, 5, 6]);
  buttons[5].props.onClick();
  buttons[6].props.onClick();
  assert.deepEqual(events, [null, 6], 'the shared badge preserves toggle filtering');
  for (let tier = 1; tier <= 6; tier++) {
    const marker = RosterTierMark({ tier, count: 2 });
    assert.equal(find(marker, v => v.type === TierChip)[0].props.tier, tier);
  }
  const chess = get(INSIDE);
  const card = OpCard({ m: null, chess, golden: get(chess.goldenId), entries: {}, onPick() {}, onChange() {}, onOps() {} });
  assert.equal(find(card, v => v.type === TierChip)[0].props.tier, chess.tier);
});
