import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../public/js/store.js';
import { installCardSync, cardStore } from '../../public/js/ui/playerCard.js';
import { options, h, Component } from '../../public/vendor/preact.module.js';
import { LobbyScreen } from '../../public/js/screens/lobby.js';
import { data } from '../../public/js/data.js';
import { seatPortrait, cardAvatarUrl } from '../../public/js/ui/seatArt.js';
import { filterCardOperators, OperatorPickerView } from '../../public/js/ui/opPicker.js';
import { SeatCardView, roomFacts } from '../../public/js/screens/room.js';
import { Modal, AvatarFrame } from '../../public/js/ui/components.js';

const list = [
  { charId: 'char_a', name: 'Alpha', appellation: 'First', rarity: 6, assets: { portrait: 'char_a_1' } },
  { charId: 'char_b', name: 'Beta', rarity: 5, assets: { portrait: 'char_b_1' } },
];
const manifest = { chars: {
  char_a: { avatar: '/assets/a-avatar.png', portrait: '/assets/a.png' },
  char_b: { avatar: '/assets/b-avatar.png', portrait: '/assets/b.png' },
} };
function env() {
  const target = createStore({ charId: 'char_a', avatar: 'char_b', open: false, sync: 'idle' });
  const handlers = new Map(), calls = [], timers = new Map();
  let n = 0;
  const net = { status: 'online', on(t, fn) { handlers.set(t, fn); return () => handlers.delete(t); },
    async request(t, body) { calls.push({ t, ...body }); } };
  const sync = installCardSync({ net, target, ready: async () => list, operators: () => list,
    timers: { setTimeout(fn) { timers.set(++n, fn); return n; }, clearTimeout(id) { timers.delete(id); } } });
  return { target, handlers, calls, net, sync, timers };
}
const turn = () => new Promise((resolve) => setImmediate(resolve));
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v; yield* walk(v.props?.children);
}

// Node-only shallow Preact render: initialise real hook state, suppress effects (no DOM/browser/network).
function renderHookComponent(type) {
  const prev = options.__s;
  const vnode = h(type, {});
  const instance = new Component({}, {});
  instance.__h = [];
  vnode.__c = instance;
  instance.__v = vnode;
  options.__s = true;
  try {
    options.__r(vnode);
    return type({});
  } finally {
    options.diffed(vnode);
    options.unmount(vnode);
    options.__s = prev;
  }
}

test('LobbyScreen renders with default and saved avatars without an undeclared data reference', async () => {
  const savedFetch = globalThis.fetch;
  const previous = cardStore.get();
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => manifest });
    await data.load('assets');
    for (const [avatar, expected] of [['', null], ['char_a', '/assets/a-avatar.png']]) {
      cardStore.set({ avatar });
      const tree = renderHookComponent(LobbyScreen);
      assert.equal(tree.props.class, 'screen lobby-screen lobby-hub');
      const frame = [...walk(tree)].find((v) => v.type === AvatarFrame);
      assert.ok(frame);
      assert.equal(frame.props.src, expected);
    }
  } finally { cardStore.set(previous); globalThis.fetch = savedFetch; }
});

test('room card sync reuses welcome/retry/order guards; closing the picker sends immediately', async (t) => {
  const e = env(); t.after(e.sync.dispose);
  await e.sync.flush();
  assert.deepEqual(e.calls[0], { t: 'room.card', charId: 'char_a', avatar: 'char_b' });
  e.handlers.get('welcome')();
  await e.sync.flush();
  assert.equal(e.calls.length, 2);
  e.target.set({ open: true, avatar: 'char_a' });
  e.target.set({ open: false });
  await turn();
  assert.equal(e.calls.at(-1).avatar, 'char_a');
  e.net.request = async () => { throw { code: 'RATE' }; };
  e.target.set({ charId: '' });
  await e.sync.flush();
  assert.equal(e.target.get().sync, 'pending');
  e.net.request = async (t, body) => { e.calls.push(body); };
  await e.sync.flush();
  assert.equal(e.target.get().sync, 'synced');
  e.sync.dispose();
  assert.equal(e.handlers.size, 0);
  assert.equal(e.timers.size, 0);
});

test('stale data preparations cannot overwrite the most recent avatar and missing data never clears it', async (t) => {
  const target = createStore({ charId: 'char_a', avatar: 'char_b', sync: 'idle' });
  const resolves = [], calls = [];
  const net = { status: 'online', on() {}, async request(_t, body) { calls.push(body); } };
  const sync = installCardSync({ net, target, operators: () => list,
    ready: () => new Promise((resolve) => resolves.push(resolve)) });
  t.after(sync.dispose);
  const old = sync.flush();
  target.set({ avatar: 'char_a' });
  const current = sync.flush();
  resolves[1](list); await current;
  resolves[0](list); await old;
  assert.deepEqual(calls, [{ charId: 'char_a', avatar: 'char_a' }]);
  target.set({ avatar: 'char_b' });
  const missing = sync.flush(); resolves[2](null); await missing;
  assert.equal(calls.length, 1);
  assert.equal(target.get().avatar, 'char_b');
});

test('each room seat uses its published portrait and avatar, independent of the viewer', () => {
  const portraits = { pool: list, m: manifest, myCard: 'char_a' };
  const seat = { playerId: 'other', card: { charId: 'char_b', avatar: 'char_a' } };
  assert.equal(seatPortrait(seat, portraits), '/assets/b.png');
  assert.equal(cardAvatarUrl(seat.card.avatar, manifest), '/assets/a-avatar.png');
  assert.equal(cardAvatarUrl('unknown', manifest), null);
  assert.equal(seatPortrait({ ...seat, isBot: true }, portraits), null);
  assert.equal(seatPortrait({ playerId: 'legacy' }, portraits), seatPortrait({ playerId: 'legacy' }, portraits));
});

test('room exposes edit actions only for the own human seat; teammates and spectators see shared art', () => {
  const mine = { seat: 0, playerId: 'a', name: 'A', card: { charId: 'char_a', avatar: 'char_b' } };
  const room = { mode: 'coop', hostId: 'a', seats: [mine], spectators: [{ playerId: 'watch' }] };
  let art = 0, avatar = 0;
  for (const [myId, editable] of [['a', true], ['other', false], ['watch', false]]) {
    const tree = SeatCardView({ seat: mine, index: 0, room, facts: roomFacts(room, myId), myId,
      portraits: { pool: list, m: manifest }, onPickCard: () => art++, onPickAvatar: () => avatar++ });
    const nodes = [...walk(tree)];
    const pick = nodes.find((v) => v.props?.class === 'rseat__pick');
    const face = nodes.find((v) => v.props?.class === 'rseat__avatar');
    assert.equal(!!pick, editable); assert.equal(!!face, editable);
    if (editable) { pick.props.onClick(); face.props.onClick(); }
    assert.equal(nodes.find((v) => v.type === AvatarFrame).props.src, '/assets/b-avatar.png');
  }
  assert.equal(art, 1); assert.equal(avatar, 1);
});

test('reference operator picker searches localized names, filters rarity, clears to defaults and keeps modal focus', () => {
  assert.deepEqual(filterCardOperators(list, ' first '), [list[0]]);
  assert.deepEqual(filterCardOperators(list, '', 5), [list[1]]);
  let picked, star, query;
  const tree = OperatorPickerView({ title: 'Card', current: 'char_a', list, faceOf: (c) => c.charId, q: '', star: 0,
    onPick: (id) => picked = id, onStar: (v) => star = v, onQuery: (v) => query = v, onClose() {} });
  assert.equal(tree.type, Modal);
  assert.equal(tree.props.utility, true);
  const nodes = [...walk(tree)];
  nodes.find((v) => v.key === 'char_b').props.onClick();
  assert.equal(picked, 'char_b');
  nodes.find((v) => v.props?.class?.includes('cardpick__op--auto')).props.onClick();
  assert.equal(picked, '');
  nodes.find((v) => v.props?.role === 'radio' && v.key === 6).props.onClick();
  nodes.find((v) => v.type === 'input').props.onInput({ currentTarget: { value: 'beta' } });
  assert.equal(star, 6); assert.equal(query, 'beta');
});
