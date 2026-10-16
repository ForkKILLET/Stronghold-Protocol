// Node/vnode tests only; no browser automation or image/model downloads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Component, h, options } from '../../public/vendor/preact.module.js';
import { AvatarPickerView, AvatarVariantsView, OperatorPickerView } from '../../public/js/ui/opPicker.js';
import { cardAvatarUrl, cardAvatarSkins } from '../../public/js/ui/seatArt.js';
import { installCardSync, cardStore, setCardAvatar } from '../../public/js/ui/playerCard.js';
import { createStore, loadPref, store } from '../../public/js/store.js';
import { cleanPlayerCard } from '../../shared/playerCard.js';
import { ResultAvatar, ResultPortrait } from '../../public/js/ui/resultAvatar.js';
import { data } from '../../public/js/data.js';
import { Modal } from '../../public/js/ui/components.js';

const CHAR = 'char_a', SKIN = `${CHAR}@summer#1`, OTHER = 'char_b';
const list = [{ charId: CHAR, name: 'Alpha', rarity: 6 }, { charId: OTHER, name: 'Beta', rarity: 5 }];
const catalogue = { chars: { [CHAR]: [
  { id: SKIN, name: 'Summer', group: 'Summer/I' },
  { id: `${CHAR}@missing#2`, name: 'Missing' },
  { id: `${OTHER}@summer#1`, name: 'Wrong operator' },
] } };
const m = { chars: {
  [CHAR]: { avatar: '/assets/base.png', portrait: '/assets/portrait.png', skins: { [SKIN]: { avatar: '/assets/skin.png' } } },
  [OTHER]: { avatar: '/assets/other.png', portrait: '/assets/other-portrait.png' },
} };
function* walk(v) {
  if (Array.isArray(v)) { for (const c of v) yield* walk(c); return; }
  if (!v || typeof v !== 'object') return;
  yield v; yield* walk(v.props?.children);
}
function render(type, props) {
  const old = options.__s, vnode = h(type, props), instance = new Component(props, {});
  instance.__h = []; vnode.__c = instance; instance.__v = vnode; options.__s = true;
  try { options.__r(vnode); return type(props); }
  finally { options.diffed(vnode); options.unmount(vnode); options.__s = old; }
}

test('avatar variants require only an installed avatar, validate the owner and safely fall back', () => {
  assert.deepEqual(cardAvatarSkins(CHAR, m, catalogue), [catalogue.chars[CHAR][0]]);
  assert.deepEqual(cardAvatarSkins(CHAR, m, null), []);
  assert.equal(cardAvatarUrl(SKIN, m), '/assets/skin.png');
  assert.equal(cardAvatarUrl(`${CHAR}@missing#2`, m), '/assets/base.png');
  assert.equal(cardAvatarUrl(`${OTHER}@summer#1`, m), '/assets/other.png');
  for (const bad of [null, '', 'https://example.com/avatar.png', 'char_a@../../avatar.png']) assert.equal(cardAvatarUrl(bad, m), null);
});

test('the first step previews an operator, keeps filtering, and only the second step commits an avatar', () => {
  let selected = null, picked = null, closed = false;
  const props = { current: SKIN, list, m, q: 'Alpha', star: 6,
    onOperator: (id) => { selected = id; }, onPick: (id) => { picked = id; }, onClose: () => { closed = true; } };
  let view = AvatarPickerView({ ...props, operator: selected });
  assert.equal(view.type, OperatorPickerView);
  assert.equal(view.props.current, CHAR, 'a saved skin still highlights its operator');
  assert.deepEqual(view.props.list, [list[0]]);
  assert.equal(view.props.body, null, 'the first step never mounts the optional catalogue loader');
  view.props.onPick(CHAR);
  assert.equal(picked, null, 'choosing the operator has no saved side effects');
  view = AvatarPickerView({ ...props, operator: selected });
  assert.equal(OperatorPickerView(view.props).type, Modal, 'the same modal shell serves both steps');
  view.props.body.props.onBack();
  assert.equal(selected, null);
  view = AvatarPickerView({ ...props, operator: selected });
  assert.equal(view.props.q, 'Alpha'); assert.equal(view.props.star, 6);
  view.props.onClose(); assert.equal(closed, true); assert.equal(picked, null);
  const variants = AvatarVariantsView({ operator: list[0], current: SKIN, m,
    skins: cardAvatarSkins(CHAR, m, catalogue), status: 'ready', onPick: props.onPick });
  const skin = [...walk(variants)].find((v) => v.props?.['data-avatar'] === SKIN);
  assert.equal(skin.props['aria-pressed'], 'true');
  skin.props.onClick(); assert.equal(picked, SKIN);
  [...walk(variants)].find((v) => v.props?.['data-avatar'] === CHAR).props.onClick();
  assert.equal(picked, CHAR, 'the operator default is independent of clearing all avatars');
  view.props.onPick(''); assert.equal(picked, '');
});

test('loading, failed and empty catalogues keep the base avatar selectable without erasing a saved skin', () => {
  for (const status of ['loading', 'missing', 'ready']) {
    let picked = null, retried = false;
    const tree = AvatarVariantsView({ operator: list[0], current: SKIN, m, skins: [], status,
      onPick: (id) => { picked = id; }, onRetry: () => { retried = true; } });
    assert.equal(picked, null);
    const buttons = [...walk(tree)];
    const base = buttons.find((v) => v.props?.['data-avatar'] === CHAR);
    assert.ok(base); base.props.onClick(); assert.equal(picked, CHAR);
    assert.ok(buttons.some((v) => v.props?.role === 'status'));
    if (status === 'missing') {
      buttons.find((v) => v.props?.onClick && v.props.children === '重试').props.onClick();
      assert.equal(retried, true);
    }
  }
});

test('skin avatars survive browser storage, sync preparation, closing the picker and reconnect', async (t) => {
  const previous = cardStore.get(), descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
  } });
  t.after(() => {
    cardStore.set(previous);
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage;
  });
  setCardAvatar(SKIN);
  assert.equal(cleanPlayerCard(loadPref('room.card', null)).avatar, SKIN);
  const target = createStore({ charId: CHAR, avatar: SKIN, open: true, sync: 'idle' });
  const calls = [], handlers = new Map();
  const net = { status: 'online', on(type, cb) { handlers.set(type, cb); return () => handlers.delete(type); },
    async request(type, body) { calls.push({ type, ...body }); } };
  const sync = installCardSync({ net, target, ready: async () => list, operators: () => list });
  t.after(sync.dispose);
  await sync.flush();
  assert.equal(calls[0].avatar, SKIN, 'preparation validates the base operator without dropping the skin');
  target.set({ avatar: CHAR, open: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.at(-1).avatar, CHAR);
  target.set({ avatar: SKIN }); await sync.flush();
  handlers.get('welcome')(); await sync.flush();
  assert.equal(calls.at(-1).avatar, SKIN);
});

test('settlement resolves each owner skin avatar independently of the viewer choice', (t) => {
  const previous = cardStore.get(), room = store.get().room;
  t.after(() => { cardStore.set(previous); store.set({ room }); });
  t.mock.method(data, 'get', (name) => name === 'assets' ? m : null);
  cardStore.set({ avatar: SKIN });
  store.set({ room: { seats: [{ playerId: 'other', card: { avatar: OTHER } }] } });
  assert.equal(render(ResultAvatar, { player: { playerId: 'me' }, self: true }).props.avatar, '/assets/skin.png');
  assert.equal(render(ResultAvatar, { player: { playerId: 'other' } }).props.avatar, '/assets/other.png');
});

test('settlement portraits prefer the chosen room operator and keep lineup art only as the fallback', (t) => {
  const previous = cardStore.get(), room = store.get().room;
  t.after(() => { cardStore.set(previous); store.set({ room }); });
  t.mock.method(data, 'get', (name) => name === 'assets' ? m : null);
  t.mock.method(data, 'list', () => list);
  cardStore.set({ charId: CHAR, avatar: `${OTHER}@summer#1` });
  store.set({ room: { seats: [{ playerId: 'other', card: { charId: OTHER, avatar: SKIN } }] } });
  const props = { fallbackSrc: '/assets/lineup-ace.png', fallbackClass: 'is-avatar', class: 'tcard__img' };
  const own = render(ResultPortrait, { ...props, player: { playerId: 'me' }, self: true });
  assert.equal(own.props.src, '/assets/portrait.png');
  assert.equal(own.props.class, 'tcard__img is-portrait');
  assert.equal(render(ResultPortrait, { ...props, player: { playerId: 'other' } }).props.src, '/assets/other-portrait.png');
  assert.equal(render(ResultPortrait, { ...props, player: { playerId: 'unknown' } }).props.src, props.fallbackSrc);
  assert.equal(render(ResultPortrait, { ...props, player: { playerId: 'other', isBot: true } }).props.src, props.fallbackSrc);
  for (const charId of ['', 'char_unavailable']) {
    cardStore.set({ charId });
    assert.equal(render(ResultPortrait, { ...props, player: { playerId: 'me' }, self: true }).props.src, props.fallbackSrc);
  }
});
