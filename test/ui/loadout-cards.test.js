// Migration: The fork keeps its deck/list switch and TierChip design without the repeated operator level labels. Existing loadout and mobile browser tests own these surfaces.
// test/ui/loadout-cards.test.js — the 干员调配 tab's optional 卡片视图 (laid out after the event's 物资调配处): the stored
// view (the list stays the default), one operator card (an OperatorImage portrait — the owner's outfit, B6 —, the equipped
// skill and module, 潜能 as pips through cultivationView, the 已调整 mark, the 替补 ribbon), the 快速配置 columns beside it
// (the list rows' own handlers), the tier marker (the official shopLevelSprite tag, the CSS marker without it), the
// bottom bar's tier jumps and lock chip, the ⓘ sheet's own name, and the css rules of the view (text follows 文字大小, no
// !important, the 转场 only in the card view, no invented slogan). Hook-free views drawn as vnode trees. (The browser
// side: test/ui/loadout-cards.e2e.test.js.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSIONS } from '../../shared/versions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try { const body = readFileSync(path.join(ROOT, 'data', name), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(body) }; } catch { return { ok: false, status: 404, json: async () => ({}) }; }
};
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { DeckCard, TierMark, DeckBar, DeckHelp, loadoutViewPref } = await import('../../public/js/screens/loadout.js');
const { data } = await import('../../public/js/data.js');
const { OperatorImage, Img, PromotionIcon } = await import('../../public/js/ui/gameComponents.js');
const { OpCard } = await import('../../public/js/screens/settle.js');
await data.loadAll('chess', 'garrisons', 'assets', 'bonds', 'effects', 'backups');

const get = (id) => data.lookup('chess', id);
const INSIDE = 'chess_char_1_01_a';   // 隐现: S1 / S2 (default S2), MAR-X
const CHAR = (id) => get(id).charId;

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && ['QuickSkill', 'QuickModule', 'CultivationSelects', 'PotPips'].includes(v.type.name)) { yield* walk(v.type(v.props)); return; }
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const find = (tree, pred) => [...walk(tree)].filter(pred);
const byClass = (tree, c) => find(tree, (v) => hasClass(v, c));
const textOf = (v) => (v == null || typeof v === 'boolean' ? '' : typeof v !== 'object' ? String(v) : Array.isArray(v) ? v.map(textOf).join('') : textOf(v.props?.children));

const card = (props) => DeckCard({ m: null, chess: get(INSIDE), golden: get(get(INSIDE).goldenId), entries: {}, ops: {}, onPick: () => {}, onChange: () => {}, onOps: () => {}, ...props });









test('promotion icons: E0, E1 and E2 use the official images or a phase-specific missing-art fallback', () => {
  for (const phase of [0, 1, 2]) {
    const icon = PromotionIcon({ m: null, phase, class: 'phase-test' });
    assert.equal(icon.props.src, null);
    assert.equal(textOf(icon.props.fallback), `E${phase}`);
  }
  for (const phase of [undefined, null, -1, 3]) assert.equal(PromotionIcon({ m: null, phase }), null);
});
