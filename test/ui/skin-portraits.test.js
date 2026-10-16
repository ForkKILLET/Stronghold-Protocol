import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Component, h, options } from '../../public/vendor/preact.module.js';
import { portraitUrl } from '../../public/js/assets.js';
import { chessPortraitUrl } from '../../public/js/ui/assetUrls.js';
import { OperatorPortrait, portraitSkin } from '../../public/js/ui/operatorPortrait.js';
import { cardPortraitUrl, cardPortraitSkins, seatPortrait } from '../../public/js/ui/seatArt.js';
import { AvatarPickerView, AvatarVariantsView } from '../../public/js/ui/opPicker.js';
import { ResultPortrait } from '../../public/js/ui/resultAvatar.js';
import { SeatCardView } from '../../public/js/screens/room.js';
import { cleanPlayerCard } from '../../shared/playerCard.js';
import { store } from '../../public/js/store.js';
import { settingsStore } from '../../public/js/ui/settings.js';
import { skinsStore } from '../../public/js/ui/skins.js';
import { cardStore } from '../../public/js/ui/playerCard.js';
import { installCardSync, setCardOperator } from '../../public/js/ui/playerCard.js';
import { createStore, loadPref } from '../../public/js/store.js';
import { data } from '../../public/js/data.js';
import { resolveDetail } from '../../public/js/ui/detailPanel.js';

const charId = 'char_test', skin = `${charId}@summer#1`, mateSkin = `${charId}@winter#2`;
const chess = { charId, chessId: 'base', baseId: 'base', assets: { portrait: `${charId}_1` } };
const elite = { ...chess, chessId: 'elite', isGolden: true, assets: { portrait: `${charId}_2` } };
const m = { chars: { [charId]: { portrait: '/assets/base.png', portraitE2: '/assets/elite.png', skins: {
  [skin]: { portrait: '/assets/summer.png' }, [mateSkin]: { portrait: '/assets/winter.png' },
} } } };
function render(type, props) {
  const old = options.__s, vnode = h(type, props), instance = new Component(props, {});
  instance.__h = []; vnode.__c = instance; instance.__v = vnode; options.__s = true;
  try { options.__r(vnode); return type(props); }
  finally { options.diffed(vnode); options.unmount(vnode); options.__s = old; }
}
function* walk(v) {
  if (Array.isArray(v)) { for (const c of v) yield* walk(c); return; }
  if (!v || typeof v !== 'object') return;
  yield v; yield* walk(v.props?.children);
}

test('portrait helpers resolve installed skins and preserve normal/elite fallback without guessing URLs', () => {
  for (const c of [chess, elite]) assert.equal(chessPortraitUrl(m, c, { skin }), '/assets/summer.png');
  assert.equal(portraitUrl(m, `${charId}_2`, { skin }), '/assets/summer.png');
  assert.equal(chessPortraitUrl(m, elite, { skin: 'unknown' }), '/assets/elite.png');
  assert.equal(portraitUrl(m, charId, { skin: 'unknown' }), '/assets/base.png');
  assert.equal(chessPortraitUrl(m, { ...chess, charId: 'other', assets: null }, { skin }), null);
});

test('gameplay portraits follow owner metadata, frozen unit skin and viewer opt-in; local choices never leak', () => {
  const context = { settings: { skinsEnabled: true }, entries: { base: skin },
    state: { me: { playerId: 'me' }, match: { public: { players: [
      { playerId: 'me', skins: { base: skin } }, { playerId: 'mate', skins: { base: mateSkin } },
      { playerId: 'bot', isBot: true, skins: { base: skin } },
    ] } } } };
  assert.equal(portraitSkin(elite, context), skin);
  assert.equal(portraitSkin(elite, { ...context, ownerId: 'mate' }), mateSkin);
  assert.equal(portraitSkin(elite, { ...context, ownerId: 'missing' }), null);
  assert.equal(portraitSkin(elite, { ...context, ownerId: null }), null);
  assert.equal(portraitSkin(elite, { ...context, ownerId: 'bot' }), null);
  assert.equal(portraitSkin(elite, { ...context, ownerId: 'mate', skin }), skin, 'battle snapshot wins');
  assert.equal(portraitSkin(elite, { ...context, skin: null }), null, 'explicit default never reads local choices');
  assert.equal(portraitSkin(elite, { ...context, settings: { skinsEnabled: false } }), null);
  for (const extra of [{ isDiy: true }, { standInFor: 'original' }]) assert.equal(portraitSkin({ ...elite, ...extra }, context), null);
});

test('live portrait changes use subscribed state and a failed skin request has a default portrait fallback', (t) => {
  const state = store.get(), prefs = settingsStore.get(), skins = skinsStore.get();
  t.after(() => { store.set(state); settingsStore.set(prefs); skinsStore.set(skins); });
  store.set({ me: { playerId: 'me' }, match: { public: null } });
  skinsStore.set({ entries: { base: skin } }); settingsStore.set({ skinsEnabled: true });
  const view = render(OperatorPortrait, { m, chess: elite, class: 'art' });
  assert.equal(view.props.src, '/assets/summer.png');
  assert.equal(view.props.fallback.props.src, '/assets/elite.png');
  assert.equal(view.props.fallback.props.class, 'art');
  settingsStore.set({ skinsEnabled: false });
  assert.equal(render(OperatorPortrait, { m, chess: elite }).props.src, '/assets/elite.png');
});

test('room portraits use their own selection and require only deployed portrait files', () => {
  const catalogue = { chars: { [charId]: [{ id: skin, name: 'Summer', group: 'I' }, { id: 'char_other@x#1' }, { id: `${charId}@missing#1` }] } };
  assert.deepEqual(cardPortraitSkins(charId, m, catalogue), [catalogue.chars[charId][0]]);
  assert.equal(cardPortraitUrl(skin, m, elite), '/assets/summer.png');
  assert.equal(cardPortraitUrl(`${charId}@missing#1`, m, elite), '/assets/elite.png');
  assert.equal(cardPortraitUrl('https://example.com/x', m), null);
  const seat = { playerId: 'mate', card: { charId: skin, avatar: 'char_other' } };
  const portraits = { pool: [elite], m };
  assert.equal(seatPortrait(seat, portraits), '/assets/summer.png');
  const props = { seat, index: 0, room: { mode: 'coop' }, facts: {}, portraits };
  const image = (bad) => [...walk(SeatCardView({ ...props, bad }))].find((v) => v.type === 'img');
  assert.equal(image([]).props.src, '/assets/summer.png');
  assert.equal(image(['/assets/summer.png']).props.src, '/assets/elite.png');
  assert.equal(image(['/assets/summer.png', '/assets/elite.png']), undefined);
  assert.deepEqual(cleanPlayerCard({ charId: skin, avatar: charId }, (id) => id === charId), { charId: skin, avatar: charId });
});

test('portrait picker keeps two steps and failure states, commits only the chosen variant', () => {
  let picked = null, operator = null;
  const props = { kind: 'portrait', current: skin, list: [elite], m, q: 'kept', star: 6,
    onPick: (v) => { picked = v; }, onOperator: (v) => { operator = v; } };
  const first = AvatarPickerView(props);
  assert.equal(first.props.current, charId); assert.equal(first.props.body, null);
  first.props.onPick(charId); assert.equal(operator, charId); assert.equal(picked, null);
  const second = AvatarPickerView({ ...props, operator });
  assert.equal(second.props.body.props.kind, 'portrait');
  second.props.body.props.onBack(); assert.equal(operator, null);
  assert.equal(AvatarPickerView(props).props.q, 'kept');
  for (const status of ['loading', 'missing', 'ready']) {
    const nodes = [...walk(AvatarVariantsView({ ...props, operator: elite, skins: [], status }))];
    assert.ok(nodes.some((v) => v.props?.role === 'status'));
    const base = nodes.find((v) => v.props?.['data-avatar'] === charId);
    base.props.onClick(); assert.equal(picked, charId);
  }
});

test('settlement skin portraits preserve owner choice and ignore avatar skin selection', (t) => {
  const previous = cardStore.get(); t.after(() => cardStore.set(previous));
  t.mock.method(data, 'get', () => m); t.mock.method(data, 'list', () => [elite]);
  cardStore.set({ charId: skin, avatar: mateSkin });
  const view = render(ResultPortrait, { player: { playerId: 'me' }, self: true });
  assert.equal(view.props.src, '/assets/summer.png');
  assert.equal(view.props.fallback.props.src, '/assets/elite.png');
});

test('skin portraits survive local preferences, sync preparation, picker close and reconnect', async (t) => {
  const previous = cardStore.get(), descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
  } });
  t.after(() => {
    cardStore.set(previous);
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage;
  });
  setCardOperator(skin);
  assert.equal(loadPref('room.card', null).charId, skin);
  const target = createStore({ charId: skin, avatar: charId, open: true, sync: 'idle' });
  const calls = [], handlers = new Map();
  const net = { status: 'online', on(type, cb) { handlers.set(type, cb); return () => handlers.delete(type); },
    async request(type, body) { calls.push({ type, ...body }); } };
  const sync = installCardSync({ net, target, ready: async () => [chess], operators: () => [chess] });
  t.after(sync.dispose);
  await sync.flush();
  assert.equal(calls[0].charId, skin);
  target.set({ charId: mateSkin, open: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.at(-1).charId, mateSkin);
  handlers.get('welcome')(); await sync.flush();
  assert.equal(calls.at(-1).charId, mateSkin);
});

test('foreign detail targets preserve owner and unit snapshot skins', (t) => {
  t.mock.method(data, 'lookup', () => chess); t.mock.method(data, 'get', () => null);
  const foreign = resolveDetail({ kind: 'chess', id: 'base', owner: 'mate' }, new Map(), { priv: { playerId: 'me' } });
  assert.equal(foreign.ownerId, 'mate');
  assert.equal(resolveDetail({ kind: 'chess', id: 'base', owner: 'mate' }, new Map()).ownerId, 'mate', 'spectators have no private player view');
  const unit = resolveDetail({ kind: 'unit', unit: { defId: 'base', ownerId: 'mate', skin, side: 'ally' } }, new Map());
  assert.equal(unit.ownerId, 'mate'); assert.equal(unit.skin, skin);
});
