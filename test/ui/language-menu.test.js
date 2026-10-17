// Vnode/keyboard contracts; real touch/focus rendering still requires a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LanguageMenuView } from '../../public/js/ui/languageMenu.js';
import { Icon, ICONS } from '../../public/js/ui/components.js';

const items = ['zh', 'en', 'ja', 'ko', 'zh-TW'].map((code, i) => ({ code, label: code, htmlLang: code, on: i === 1 }));
function* walk(v) {
  if (Array.isArray(v)) { for (const child of v) yield* walk(child); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
function fixture(open = false, active = 1) {
  const calls = [], props = { items, label: 'Language / 语言', id: 'languages', open, active,
    onNavigate: index => calls.push(['navigate', index]), onDismiss: focus => calls.push(['dismiss', focus]),
    onPick: code => calls.push(['pick', code]) };
  const view = LanguageMenuView(props);
  return { view, calls, nodes: [...walk(view)], key(key, extra = {}) {
    const event = { key, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
    view.props.onKeyDown(event);
    return event;
  } };
}

test('scaled dropdown uses a real named button, current language and existing icon without a native select', () => {
  const f = fixture();
  const trigger = f.nodes.find(node => node.props?.class === 'set-lang__trigger');
  assert.equal(trigger.type, 'button');
  assert.equal(trigger.props['aria-label'], 'Language / 语言: en');
  assert.equal(trigger.props['aria-expanded'], 'false');
  assert.equal(trigger.props['aria-haspopup'], 'listbox');
  assert.equal(f.nodes.some(node => node.type === 'select'), false);
  const icon = f.nodes.find(node => node.type === Icon);
  assert.ok(ICONS[icon.props.name]);
  assert.equal(f.nodes.find(node => node.type === 'span').props.children, 'en');
  trigger.props.onClick();
  assert.deepEqual(f.calls, [['navigate', 1]]);
});

test('open menu links its listbox, keeps every language and forwards the exact selected code', () => {
  const f = fixture(true);
  const trigger = f.nodes.find(node => node.props?.class === 'set-lang__trigger');
  const list = f.nodes.find(node => node.props?.role === 'listbox');
  assert.equal(trigger.props['aria-controls'], list.props.id);
  assert.equal(trigger.props['aria-expanded'], 'true');
  const options = f.nodes.filter(node => node.props?.role === 'option');
  assert.equal(options.length, items.length);
  assert.deepEqual(options.map(node => node.props['aria-selected']), ['false', 'true', 'false', 'false', 'false']);
  assert.deepEqual(options.map(node => node.props.tabindex), [-1, 0, -1, -1, -1]);
  options[4].props.onClick();
  assert.deepEqual(f.calls, [['pick', 'zh-TW']]);
});

test('arrow/Home/End navigation moves within the menu and wraps', () => {
  for (const [key, active, expected] of [['ArrowDown', 1, 2], ['ArrowUp', 0, 4], ['Home', 3, 0], ['End', 0, 4]]) {
    const f = fixture(true, active), event = f.key(key);
    assert.deepEqual(f.calls, [['navigate', expected]]);
    assert.ok(event.prevented && event.stopped);
  }
  const closed = fixture();
  closed.key('ArrowDown');
  assert.deepEqual(closed.calls, [['navigate', 1]]);
});

test('Escape closes only an open menu, Tab keeps native traversal and IME does not navigate', () => {
  const open = fixture(true), escape = open.key('Escape');
  assert.deepEqual(open.calls, [['dismiss', true]]);
  assert.ok(escape.prevented && escape.stopped, 'Escape must not reach the settings Modal');
  const closed = fixture(), nextEscape = closed.key('Escape');
  assert.equal(nextEscape.stopped, false, 'the settings Modal can now handle Escape');
  assert.deepEqual(closed.calls, []);
  const tab = fixture(true), event = tab.key('Tab');
  assert.deepEqual(tab.calls, [['dismiss', true]]);
  assert.equal(event.prevented, false);
  const ime = fixture(true);
  ime.key('ArrowDown', { isComposing: true });
  assert.deepEqual(ime.calls, []);
});

test('moving focus outside dismisses the list without stealing focus', () => {
  const f = fixture(true);
  f.view.props.onBlur({ relatedTarget: {}, currentTarget: { contains: () => false } });
  assert.deepEqual(f.calls, [['dismiss', false]]);
});
