// Migration: The fork keeps its own start/create pages, shared doctor archive and public matchmaking. Replaced mainline layout contracts are covered by fork-redesign and mobile-management browser tests.
// test/ui/lobby-hub.test.js — the hub lobby (PR #643 split 6, PR #812): the two entries (独立模拟 / 同盟模拟) open their
// dialogs, 选择模拟协议 (the project's Modal, full screen: four difficulty cards with the 已选定 stamp, the selected one's
// scene — its official picture on the drawn grid, ui/protocolScene.js — 开始独立模拟, the test-room box only in test mode;
// the room's 确认 and read-only uses) and 选择同盟方式 (the project's Modal, full screen: 创建同盟 creating the room at once
// at the remembered difficulty — the event's 联合模拟, the maintainer's decision of 2026-10-21 —, the key field (the
// project's TextField) with 观战, 加入同盟, recent keys that only fill it); the 成就统计 card is the lobby's only statistics
// entry; the official art keys the hub asks for exist in data/assets.json; the css follows 文字大小 without !important; no
// account / matchmaking / federation code came along. Hook-free views drawn as vnode trees. (The browser side:
// test/ui/lobby-hub.e2e.test.js, test/ui/room-settings.e2e.test.js.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unscaled } from '../helpers/uiSize.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try { const body = readFileSync(path.join(ROOT, 'data', name), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(body) }; } catch { return { ok: false, status: 404, json: async () => ({}) }; }
};
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { HubEntry, ProtocolSelect, AllianceSelect, normalizeCode, codeArg } = await import('../../public/js/screens/lobby.js');
const { Modal, TextField } = await import('../../public/js/ui/components.js');
const { ReplayWait, BondAchievement } = await import('../../public/js/screens/stats.js');
const { DIFFICULTIES } = await import('../../shared/constants.js');

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && ['DifficultyCard', 'BackPlate'].includes(v.type.name)) { yield* walk(v.type(v.props)); return; }
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const find = (tree, pred) => [...walk(tree)].filter(pred);
const byClass = (tree, c) => find(tree, (v) => hasClass(v, c));
const textOf = (v) => (v == null || typeof v === 'boolean' ? '' : typeof v !== 'object' ? String(v) : Array.isArray(v) ? v.map(textOf).join('') : textOf(v.props?.children));
const buttons = (tree) => find(tree, (v) => v.type === 'button');
const buttonText = (tree, text) => buttons(tree).find((b) => textOf(b).includes(text));
const titleOf = (tree) => textOf(byClass(tree, 'modal__title')[0]);

const MODES = {
  solo: { id: 'solo', name: '独立模拟', en: 'SOLO SIMULATION', icon: 'user', desc: '独自', points: ['1 名博士'] },
  coop: { id: 'coop', name: '同盟模拟', en: 'ALLIANCE SIMULATION', icon: 'users', desc: '同盟', points: ['联防'] },
};


/** Every plain rule of a style sheet as [selector, body], comments stripped; @-rule preludes are not selectors. */
function* cssRules(src) {
  for (const m of src.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?<=^|[{}])\s*([^{}@]+)\{([^{}]*)\}/g)) yield [m[1].trim(), m[2]];
}
/** Whether a selector reaches the room's big button (GoButton: .proto-start.rs-go > .proto-start__label, in
 *  .rs-foot__right / .room-bar__right of the .rs-foot / .room-bar footer of .rs): the button or anything inside it, or one
 *  of its ancestors as the subject; 选择模拟协议's own button (.proto-foot .proto-start__label) is not the room's. */
function wrapsRoomGo(sel) {
  const x = sel.trim();
  if (/^\.proto-foot \.proto-start__label$/.test(x)) return false;
  if (/\.(?:rs-go|proto-start|proto-start__label)(?![\w-])/.test(x)) return true;
  const subject = x.split(/\s*[\s>+~]\s*/).pop();
  return /\.(?:rs|rs-foot|rs-foot__right|room-bar|room-bar__right)(?![\w-])/.test(subject);
}


const proto = (props) => ProtocolSelect({
  roomMode: 'solo', difficulty: 'FUNNY', onDifficulty: () => {}, onClose: () => {}, onCreate: () => {}, busy: null, online: true,
  testMode: false, asTest: false, onTest: () => {}, ...props,
});







const ally = (props) => AllianceSelect({
  onClose: () => {}, onCreate: () => {}, code: '', onCode: () => {}, codeOk: false, online: true, busy: null,
  onJoin: () => {}, onSpectate: () => {}, recent: [], marks: [], focusKey: true, ...props,
});

test('选择同盟方式: 创建同盟 creates the room at once at the remembered difficulty (changed in the room); the test-room box in test mode', () => {
  const calls = [];
  const v = ally({ onCreate: (...a) => calls.push(['create', ...a]), difficulty: 'HARD' });
  assert.equal(v.type, Modal);
  assert.ok(hasClass(v, 'ally') && !hasClass(v, 'proto'), 'its own class: .modal__box.proto is 选择模拟协议 only');
  assert.equal(titleOf(v), '选择同盟方式');
  const create = find(v, (x) => x.props?.['data-testid'] === 'alliance-create')[0];
  assert.equal(create.type, 'button');
  assert.equal(create.props['data-difficulty'], 'HARD');
  assert.ok(textOf(create).includes('难度：绝境模拟（可在同盟内更改）'), textOf(create));
  assert.ok(!create.props.disabled);
  create.props.onClick({ type: 'click' });
  assert.deepEqual(calls, [['create']], 'no click event handed on, no difficulty step in between');
  const busy = find(ally({ busy: 'create' }), (x) => x.props?.['data-testid'] === 'alliance-create')[0];
  assert.ok(busy.props.disabled && busy.props['aria-busy'] === 'true', 'no second room while it is made');
  assert.ok(find(ally({ online: false }), (x) => x.props?.['data-testid'] === 'alliance-create')[0].props.disabled, 'offline');
  assert.equal(find(v, (x) => x.props?.['data-testid'] === 'create-test').length, 0, 'no test-room box outside test mode');
  const ticked = [];
  const test = ally({ testMode: true, asTest: true, onTest: (on) => ticked.push(on) });
  const box = find(test, (x) => x.props?.['data-testid'] === 'create-test');
  assert.equal(box.length, 1);
  const input = find(box[0], (x) => x.type === 'input')[0];
  assert.equal(input.props.checked, true);
  input.props.onChange({ target: { checked: false } });
  assert.deepEqual(ticked, [false]);
});

test('选择同盟方式: the key field is the project TextField (IME-safe Enter, normalised write-back, no length cap); join or watch once the key is whole', () => {
  const calls = [];
  const v = ally({ onCreate: () => calls.push('create') });
  const row = byClass(v, 'join-row');
  assert.equal(row.length, 1);
  assert.equal(find(row[0], (x) => x.type === 'input').length, 0, 'no raw <input>: TextField guards the IME composition');
  const field = find(row[0], (x) => x.type === TextField)[0];
  assert.ok(field, 'the key field');
  assert.equal(field.props.transform, normalizeCode, 'the normalised key is written back into the field');
  assert.equal(field.props.maxLength, undefined, 'no cap before normalizeCode: a long pasted invite link must reach it whole');
  assert.equal(field.props.modalFocus, true, 'the Modal focuses it');
  assert.equal(field.props.ariaLabel, '同盟密钥');
  assert.equal(find(ally({ focusKey: false }), (x) => x.type === TextField)[0].props.modalFocus, false, 'not on a touch screen');
  const enter = [];
  find(ally({ onJoin: (...a) => enter.push(a) }), (x) => x.type === TextField)[0].props.onEnter({ key: 'Enter' });
  assert.deepEqual(enter, [[]], 'Enter joins with the field’s key (no event handed on as a key)');
  assert.ok(buttonText(v, '加入同盟').props.disabled, 'no key yet');
  assert.ok(buttonText(v, '观战').props.disabled);

  const ready = ally({ code: 'ABCD', codeOk: true, onJoin: () => calls.push('join'), onSpectate: () => calls.push('spectate') });
  const join = buttonText(ready, '加入同盟');
  const watch = buttonText(ready, '观战');
  assert.ok(!join.props.disabled && !watch.props.disabled);
  assert.ok(hasClass(watch, 'join-spectate'));
  join.props.onClick();
  watch.props.onClick();
  assert.deepEqual(calls, ['join', 'spectate']);
  assert.ok(buttonText(ally({ code: 'ABCD', codeOk: true, online: false }), '加入同盟').props.disabled, 'offline');
});

test('选择同盟方式: a recent key fills the field (it never joins by itself); a test room keeps its mark', () => {
  const filled = [];
  const v = ally({ recent: ['ABCD', 'WXYZ'], marks: ['WXYZ'], onCode: (c) => filled.push(c), onJoin: () => assert.fail('joined') });
  const chips = byClass(v, 'code-chip');
  assert.deepEqual(chips.map((c) => textOf(c).trim()), ['ABCD', 'WXYZ']);
  assert.equal(find(chips[0], (x) => x.type?.name === 'TestMark').length, 0);
  assert.equal(find(chips[1], (x) => x.type?.name === 'TestMark').length, 1);
  chips[1].props.onClick();
  assert.deepEqual(filled, ['WXYZ']);
  assert.ok(textOf(ally({})).includes('向同伴索取'), 'no recent key: the hint');
});

const lobbySrc = readFileSync(path.join(ROOT, 'public/js/screens/lobby.js'), 'utf8');
const lobbyCss = unscaled(readFileSync(path.join(ROOT, 'public/css/screens/lobby.css'), 'utf8'));
const roomCss = unscaled(readFileSync(path.join(ROOT, 'public/css/screens/room.css'), 'utf8'));

test('the key: a pasted invite link of any length, a 5th character or a dash are normalised to the 4-letter key', () => {
  const link = 'https://crops-flexible-wedding-trademarks.trycloudflare.com/?room=QWER';
  assert.ok(link.length > 64);
  assert.equal(normalizeCode(link), 'QWER', 'the whole link reaches normalizeCode (the old maxlength 64 made it "HTTP")');
  assert.equal(normalizeCode(`${link} 凯尔希邀请你加入卫戍协议：盟约【标准模拟】`), 'QWER', 'the copied invitation line too');
  assert.equal(normalizeCode('abcde'), 'ABCD');
  assert.equal(normalizeCode('ab-'), 'AB');
  assert.equal(codeArg({ type: 'click' }, 'abcd'), 'ABCD', 'a click event falls back to the field');
});





test('选择模拟协议 scene: the official picture as an <image> of the drawn scene, the drawn hull when it fails to load', () => {
  assert.match(lobbySrc, /<\$\{ProtocolScene\} difficulty=\$\{difficulty\} art=\$\{uiUrl\(data\.get\('assets'\), `modeChoice\/\$\{PROTOCOL_ART\[difficulty\]\}_rhodes_island`\)\} \/>/);
  const scene = readFileSync(path.join(ROOT, 'public/js/ui/protocolScene.js'), 'utf8');
  assert.match(scene, /<image href=\$\{pic\}[^>]*onError=\$\{\(\) => setBad\(art\)\}/);
  const ui = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8')).ui;
  for (const k of ['funny', 'normal', 'hard', 'abyss']) assert.ok(ui[`modeChoice/${k}_rhodes_island`], k);
});











/** The short-screen @media block of lobby.css (comments dropped), up to its own closing brace. */
function shortBlock() {
  const css = lobbyCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = css.indexOf('@media (max-height: 520px) {');
  let end = css.indexOf('{', at) + 1;
  for (let depth = 1; depth > 0 && end < css.length; end++) { if (css[end] === '{') depth++; else if (css[end] === '}') depth--; } // loop-cap: the stylesheet's length
  return css.slice(at, end);
}



test('TextField placeholderShort: placeholderFits measures the text in the ::placeholder font (letter spacing included) against the inner width', async () => {
  const { placeholderFits } = await import('../../public/js/ui/components.js');
  const saved = { gcs: globalThis.getComputedStyle, doc: globalThis.document };
  try {
    // 10 px a character in the canvas, + 1 px letter spacing; the input 200 px wide with 10 px padding each side → 180 px
    const ph = { fontStyle: 'normal', fontWeight: '500', fontSize: '20px', fontFamily: 'x', letterSpacing: '1px' };
    const own = { fontStyle: 'normal', fontWeight: '700', fontSize: '20px', fontFamily: 'x', letterSpacing: '2px', paddingLeft: '10px', paddingRight: '10px' };
    let font = '';
    globalThis.document = { createElement: () => ({ getContext: () => ({ set font(f) { font = f; }, measureText: (s) => ({ width: s.length * 10 }) }) }) };
    globalThis.getComputedStyle = (el, pseudo) => (pseudo === '::placeholder' ? ph : own);
    const input = { clientWidth: 200 };
    assert.equal(placeholderFits(input, 'x'.repeat(16)), true, '16 × 11 = 176 ≤ 180');
    assert.equal(placeholderFits(input, 'x'.repeat(17)), false, '17 × 11 = 187 > 180');
    assert.equal(font, 'normal 500 20px x', 'the placeholder\'s own font');
    // no ::placeholder style (an older engine): the input's own font and spacing stand in
    globalThis.getComputedStyle = (el, pseudo) => (pseudo ? {} : own);
    assert.equal(placeholderFits(input, 'x'.repeat(15)), true, '15 × 12 = 180');
    assert.equal(placeholderFits(input, 'x'.repeat(16)), false);
    // nothing to measure with: the whole placeholder stays
    globalThis.getComputedStyle = () => { throw new Error('no layout'); };
    assert.equal(placeholderFits(input, 'x'.repeat(99)), true);
  } finally { globalThis.getComputedStyle = saved.gcs; globalThis.document = saved.doc; }
  const comp = readFileSync(path.join(ROOT, 'public/js/ui/components.js'), 'utf8');
  assert.match(comp, /const check = \(\) => \{ if \(live\) setPhShort\(!placeholderFits\(el, placeholder\)\); \};/);
  assert.match(comp, /ro\?\.observe\(el\);\n\s+const fonts = globalThis\.document\?\.fonts;\n\s+fonts\?\.addEventListener\?\.\('loadingdone', check\);/);
  assert.match(comp, /placeholder=\$\{phShort && placeholderShort \? placeholderShort : placeholder\}/);
});

/** A top-level @media block of lobby.css (comments dropped), up to its own closing brace. */
function mediaBlock(query) {
  const css = lobbyCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = css.indexOf(`@media ${query} {`);
  assert.ok(at >= 0, query);
  let end = css.indexOf('{', at) + 1;
  for (let depth = 1; depth > 0 && end < css.length; end++) { if (css[end] === '{') depth++; else if (css[end] === '}') depth--; } // loop-cap: the stylesheet's length
  return css.slice(at, end);
}
