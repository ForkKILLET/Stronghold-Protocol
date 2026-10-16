// Node/vnode regressions for settings transitions and unavailable data; no browser automation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Component, h, options } from '../../public/vendor/preact.module.js';
import { SkinSection } from '../../public/js/ui/skinPicker.js';
import { settingsStore, updateSettings } from '../../public/js/ui/settings.js';
import { skinsStore } from '../../public/js/ui/skins.js';
import { data } from '../../public/js/data.js';

const CHESS = 'chess_char_1_01_a', CHAR = 'char_498_inside', SKIN = `${CHAR}@kitchen#2`;
const chess = { chessId: CHESS, charId: CHAR };
function render(type, props) {
  const old = options.__s, vnode = h(type, props), instance = new Component(props, {});
  instance.__h = []; vnode.__c = instance; instance.__v = vnode; options.__s = true;
  try { options.__r(vnode); return type(props); }
  finally { options.diffed(vnode); options.unmount(vnode); options.__s = old; }
}
function section() {
  const tree = render(SkinSection, { chess });
  return typeof tree?.type === 'function' ? render(tree.type, tree.props) : tree;
}
function* walk(v) {
  if (Array.isArray(v)) { for (const child of v) yield* walk(child); return; }
  if (!v || typeof v !== 'object') return;
  yield v; yield* walk(v.props?.children);
}
function text(v) {
  if (Array.isArray(v)) return v.map(text).join(' ');
  return typeof v === 'string' ? v : v?.props ? text(v.props.children) : '';
}
const button = (tree, label) => [...walk(tree)].find((v) => typeof v.props?.onClick === 'function' && text(v) === label);

function setup(t, { enabled = true, status = {}, catalogue = [{ id: SKIN, name: '甜品大奖', group: '罗德厨房/II' }], installed = false } = {}) {
  const settings = settingsStore.get(), skins = skinsStore.get();
  t.after(() => { settingsStore.set(settings); skinsStore.set(skins); });
  updateSettings({ skinsEnabled: enabled });
  t.mock.method(data, 'status', (name) => status[name] || 'ready');
  t.mock.method(data, 'get', (name) => name === 'skins' ? { chars: { [CHAR]: catalogue } }
    : name === 'assets' ? { chars: { [CHAR]: { skins: installed ? { [SKIN]: { spine: { front: { anims: { idle: 'Idle' } } } } } : {} } } } : null);
}

test('enabling skins retains the section, explains missing deployment and keeps a way to turn skins off', (t) => {
  setup(t, { enabled: false });
  const before = section();
  assert.equal(before.props['data-state'], 'disabled');
  assert.equal(data.get.mock.calls.length, 0, 'disabled picker does not read the catalogue');
  button(before, '启用皮肤').props.onClick();
  const after = section();
  assert.equal(after.props['data-testid'], 'skin-section');
  assert.equal(after.props['data-state'], 'empty');
  assert.match(text(after), /尚未部署/);
  assert.ok(button(after, '关闭皮肤'));
  assert.equal([...walk(after)].filter((v) => v.props?.role === 'radio').length, 1, 'only default is offered');
  button(after, '关闭皮肤').props.onClick();
  assert.equal(section().props['data-state'], 'disabled');
});

test('loading and failed skin data keep their header and expose a retry for only the failed files', async (t) => {
  const status = { skins: 'loading' }; setup(t, { status });
  assert.equal(section().props['data-state'], 'loading');
  assert.match(text(section()), /正在载入/);
  status.skins = 'missing';
  const retry = t.mock.method(data, 'invalidate', async () => null), failed = section();
  assert.equal(failed.props['data-state'], 'missing');
  assert.match(text(failed), /加载失败/);
  await button(failed, '重试').props.onClick();
  assert.deepEqual(retry.mock.calls.map((c) => c.arguments[0]), ['skins']);
  status.skins = 'loading'; assert.equal(section().props['data-state'], 'loading');
  status.skins = 'ready'; assert.equal(section().props['data-state'], 'empty');
});

test('operators without catalogue entries show an empty state instead of disappearing', (t) => {
  setup(t, { catalogue: [] });
  const tree = section();
  assert.equal(tree.props['data-state'], 'empty');
  assert.match(text(tree), /暂无可用皮肤/);
});

test('deployed outfits still select/clear by chess id; disabling preserves choices and stale choices show default', (t) => {
  setup(t, { installed: true });
  const tree = section(); assert.equal(tree.props['data-state'], 'ready');
  [...walk(tree)].find((v) => v.props?.['data-skin'] === SKIN).props.onClick();
  assert.equal(skinsStore.get().entries[CHESS], SKIN);
  assert.equal([...walk(section())].find((v) => v.props?.['data-skin'] === SKIN).props['aria-checked'], 'true');
  button(section(), '关闭皮肤').props.onClick();
  assert.equal(skinsStore.get().entries[CHESS], SKIN);
  updateSettings({ skinsEnabled: true });
  skinsStore.set({ entries: { [CHESS]: 'not-deployed' } });
  assert.equal([...walk(section())].find((v) => v.props?.['data-skin'] === '').props['aria-checked'], 'true');
  assert.equal(skinsStore.get().entries[CHESS], 'not-deployed', 'unavailable preferences are retained');
  [...walk(section())].find((v) => v.props?.['data-skin'] === '').props.onClick();
  assert.equal(skinsStore.get().entries[CHESS], undefined);
});

test('loadout includes one picker and does not eagerly load the optional catalogue', () => {
  const source = readFileSync(new URL('../../public/js/screens/loadout.js', import.meta.url), 'utf8');
  assert.equal([...source.matchAll(/<\$\{SkinSection\} chess=\$\{chess\}/g)].length, 1);
  assert.doesNotMatch(source, /useData\([^)]*'skins'/);
});
