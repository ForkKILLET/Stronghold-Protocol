// Node/vnode and CSS contracts only; these are not browser or real-device layout tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { ProtocolSelect, ProtoCard, protocolEscapeAction } from '../../public/js/screens/lobby.js';
import { Modal } from '../../public/js/ui/components.js';

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
function* walk(v) {
  if (Array.isArray(v)) { for (const child of v) yield* walk(child); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const cls = (v, name) => String(v.props?.class || '').split(/\s+/).includes(name);
const find = (v, predicate) => [...walk(v)].find(predicate);
const text = (v) => v == null || typeof v === 'boolean' ? '' : typeof v !== 'object' ? String(v)
  : Array.isArray(v) ? v.map(text).join('') : text(v.props?.children);

for (const [mode, name, start] of [
  ['coop', '同盟模拟', '创建同盟'],
  ['solo', '独立模拟', '开始独立模拟'],
  ['match', '同盟匹配', '开始同盟匹配'],
]) {
  test(`${name} replaces the lobby with an accessible page and preserves difficulty/start/back callbacks`, () => {
    let closed = 0, started = 0, selected;
    const pageRef = { current: null };
    const tree = ProtocolSelect({
      card: { name, desc: name }, roomMode: mode, difficulty: 'NORMAL', online: true, pageRef,
      onClose: () => closed++, onStart: () => started++, onDifficulty: (d) => { selected = d; },
    });
    assert.equal(tree.type, 'main');
    assert.equal(tree.props.class, 'screen protocol-screen');
    assert.equal(tree.ref, pageRef);
    assert.equal(tree.props['aria-label'], `${name} · 选择模拟协议`);
    assert.equal(find(tree, (v) => v.type === Modal || v.props?.role === 'dialog' || v.props?.['aria-modal']), undefined);
    assert.equal(find(tree, (v) => cls(v, 'lobby-hub') || cls(v, 'hub-stage')), undefined);
    assert.equal(tree.props.onMouseDown, undefined, 'no click-away backdrop');
    const cards = [...walk(tree)].filter((v) => v.type === ProtoCard);
    assert.deepEqual(cards.map((v) => v.props.difficulty), ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']);
    assert.equal(cards.every((v) => v.props.roomMode === mode), true);
    assert.deepEqual(cards.filter((v) => v.props.selected).map((v) => v.props.difficulty), ['NORMAL']);
    ProtoCard(cards[3].props).props.onClick();
    assert.equal(selected, 'ABYSS');
    const startButton = find(tree, (v) => cls(v, 'proto-start'));
    assert.ok(text(startButton).includes(start));
    startButton.props.onClick();
    assert.equal(started, 1);
    find(tree, (v) => v.props?.['aria-label'] === '返回大厅').props.onClick();
    assert.equal(closed, 1);
  });
}

test('returning from matchmaking is separate from cancelling the queue', () => {
  let returned = 0, cancelled = 0;
  const queue = { count: 2, capacity: 4 };
  const tree = ProtocolSelect({
    card: { name: '同盟匹配' }, roomMode: 'match', difficulty: 'FUNNY', queue,
    onClose: () => returned++, onCancel: () => cancelled++,
  });
  const panel = find(tree, (v) => v.type?.name === 'MatchQueuePanel');
  assert.equal(panel.props.queue, queue);
  assert.equal(find(tree, (v) => cls(v, 'proto-start')), undefined);
  find(tree, (v) => cls(v, 'proto-back')).props.onClick();
  assert.equal(returned, 1);
  assert.equal(cancelled, 0, 'back must not send match.leave');
  panel.props.onCancel();
  assert.equal(cancelled, 1);
});

test('Escape belongs to the page only when no upper layer or IME owns it; Tab remains native', () => {
  assert.equal(protocolEscapeAction({ key: 'Escape' }), true);
  assert.equal(protocolEscapeAction({ key: 'Escape' }, true), false);
  for (const ev of [
    { key: 'Escape', defaultPrevented: true }, { key: 'Escape', isComposing: true },
    { key: 'Tab' }, { key: 'Tab', shiftKey: true }, { key: 'Enter' },
  ]) assert.equal(protocolEscapeAction(ev), false);
  const source = read('public/js/screens/lobby.js');
  const controller = source.slice(source.indexOf('function ProtocolPage('), source.indexOf('export function ProtocolSelect('));
  assert.match(controller, /window\.addEventListener\('keydown', onKey, true\)/);
  assert.match(controller, /window\.removeEventListener\('keydown', onKey, true\)/);
  assert.match(controller, /\.modal, \.guide, \.lo, \.st, \[aria-modal="true"\]/);
  assert.match(controller, /querySelector\('\.proto-back'\)\?\.focus\(\)/);
  assert.doesNotMatch(controller, /useModalFocus|focusin|key === 'Tab'/);
});

test('lobby navigation replaces its body and restores focus without losing mode/difficulty or queue state', () => {
  const source = read('public/js/screens/lobby.js');
  assert.match(source, /if \(panel === 'protocol'\) return html`<\$\{ProtocolPage\}/);
  const route = source.slice(source.indexOf("if (panel === 'protocol')"), source.indexOf('return html`<div ref=${lobbyRef}'));
  assert.match(route, /onClose=\$\{\(\) => setPanel\(null\)\}/);
  assert.match(route, /onStart=\$\{roomMode === 'match' \? matchmaking : create\}/);
  assert.match(route, /queue=\$\{matchQueue\} onCancel=\$\{cancelMatchmaking\}/);
  assert.match(source, /previousPanel\.current === 'protocol' && panel !== 'protocol'/);
  assert.match(source, /modeEntries\.current\[roomMode\]/);
  assert.match(source, /if \(entry && !entry\.disabled\) entry\.focus\(\)/);
  assert.match(source, /lobbyRef\.current\?\.querySelector\('\.match-queue button'\)\?\.focus\(\)/);
  assert.match(source, /entryRef=\$\{\(el\) => \{ modeEntries\.current\[c\.id\] = el; \}\}/);
  for (const pref of ['lobby.mode', 'lobby.difficulty']) assert.ok(source.includes(`savePref('${pref}'`));
  assert.match(source, /matchQueue \? html`<\$\{MatchQueuePanel\} queue=\$\{matchQueue\}/);
});

test('page fills the visible viewport and keeps safe areas, normal rem and an independently scrollable difficulty list', () => {
  const css = read('public/css/screens/lobby.css');
  const sheet = postcss.parse(css);
  const prop = (selector, name) => {
    let value;
    sheet.walkRules((rule) => {
      if (rule.selector === selector && rule.parent.type !== 'atrule') rule.walkDecls(name, (d) => { value = d.value; });
    });
    return value;
  };
  assert.equal(prop('.screen.protocol-screen', 'position'), 'fixed');
  assert.equal(prop('.screen.protocol-screen', 'height'), 'calc(var(--sp-vh, 1vh) * 100)');
  assert.equal(prop('.proto', 'position'), 'relative');
  assert.equal(prop('.proto', 'z-index'), undefined, 'content is not raised above other pages/overlays');
  assert.equal(prop('.proto', 'min-height'), '0');
  assert.equal(prop('.proto', 'box-sizing'), 'border-box');
  assert.match(prop('.proto', 'padding'), /var\(--sa-t.*var\(--sa-r.*var\(--sa-b.*var\(--sa-l/);
  assert.equal(prop('.proto-list', 'overflow-y'), 'auto');
  assert.equal(prop('.proto-list', 'min-height'), '0');
  assert.equal(prop('.proto-foot', 'flex'), 'none');
  assert.doesNotMatch(css, /protocol-modal/);
  sheet.walkRules((rule) => {
    if (!/protocol-screen|^\.proto(?:\s|\b)/.test(rule.selector)) return;
    rule.walkDecls((d) => assert.ok(!['zoom', '--t'].includes(d.prop), `${rule.selector}: ${d.prop}`));
  });
});
