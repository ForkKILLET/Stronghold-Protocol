// Node component and CSS contracts; no browser layout or WebGL validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { options, h, Component } from '../../public/vendor/preact.module.js';
import { data } from '../../public/js/data.js';
import { store } from '../../public/js/store.js';
import { cardStore } from '../../public/js/ui/playerCard.js';
import { ResultAvatar } from '../../public/js/ui/resultAvatar.js';
import { Img, PlayerAvatar } from '../../public/js/ui/gameComponents.js';
import { OpCard } from '../../public/js/screens/settle.js';
import { itemIconUrl } from '../../public/js/ui/assetUrls.js';

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
function* walk(v) {
  if (Array.isArray(v)) { for (const child of v) yield* walk(child); return; }
  if (!v || typeof v !== 'object') return;
  yield v; yield* walk(v.props?.children);
}
function renderHooks(type, props) {
  const previous = options.__s, vnode = h(type, props), instance = new Component(props, {});
  instance.__h = []; vnode.__c = instance; instance.__v = vnode; options.__s = true;
  try { options.__r(vnode); return type(props); }
  finally { options.diffed(vnode); options.unmount(vnode); options.__s = previous; }
}
async function loadData() {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(read(`data/${String(url).split('/').pop()}`)) });
  try { await data.loadAll('assets', 'chess', 'items'); }
  finally { globalThis.fetch = previous; }
}

test('settlement uses the saved own avatar, each teammate seat and the existing legacy fallback', async () => {
  await loadData();
  const previousCard = cardStore.get(), previousRoom = store.get().room;
  const chars = Object.entries(data.get('assets').chars).filter(([, c]) => c.avatar);
  const [[mine, mineArt], [theirs, theirArt]] = chars;
  cardStore.set({ avatar: mine });
  store.set({ room: { seats: [null, { playerId: 'teammate', card: { avatar: theirs } }] } });
  const image = (props) => {
    const vnode = renderHooks(ResultAvatar, props);
    assert.equal(vnode.type, PlayerAvatar);
    return [...walk(PlayerAvatar(vnode.props))].find((v) => v.type === Img).props;
  };
  try {
    assert.equal(image({ player: { playerId: 'me', card: { avatar: theirs } }, self: true }).src, mineArt.avatar);
    assert.equal(image({ player: { playerId: 'teammate' } }).src, theirArt.avatar);
    assert.equal(image({ player: { playerId: 'unknown' } }).src, null, 'never apply the viewer avatar to another player');
    assert.equal(image({ player: { playerId: 'teammate', isBot: true }, self: true }).src, null);
    cardStore.set({ avatar: '' });
    const legacy = { name: 'Doctor', seat: 0, bandId: 'band_unknown' };
    assert.equal(image({ player: legacy, self: true }).src,
      [...walk(PlayerAvatar({ player: legacy }))].find((v) => v.type === Img).props.src);
    cardStore.set({ avatar: mine });
    assert.equal(image({ player: { playerId: 'me' }, self: true }).src, mineArt.avatar, 'a later selection is read on render');
  } finally { cardStore.set(previousCard); store.set({ room: previousRoom }); }
});

test('settlement equipment keeps both item icons and constrains their grid before fitting the complete image', async () => {
  await loadData();
  const m = data.get('assets');
  const items = data.list('items').filter((it) => itemIconUrl(m, it)).slice(0, 2);
  assert.equal(items.length, 2);
  const chess = data.list('chess').find((c) => !c.isDiy && !c.isHidden);
  const gd = { m, chess: (id) => data.lookup('chess', id), backups: null };
  const tree = OpCard({ u: { id: chess.chessId, items: items.map((it) => it.id) }, gd, i: 0 });
  const slots = [...walk(tree)].filter((v) => String(v.props?.class || '').split(' ').includes('sop__slot'));
  assert.equal(slots.length, 2);
  assert.deepEqual(slots.map((slot) => [...walk(slot)].find((v) => v.type === Img)?.props.src), items.map((it) => itemIconUrl(m, it)));
  const css = postcss.parse(read('public/css/screens/result.css'));
  const declarations = (selector) => {
    const out = {};
    css.walkRules(selector, (rule) => rule.walkDecls((d) => { out[d.prop] = d.value; }));
    return out;
  };
  const row = declarations('.sop__slots'), slot = declarations('.sop__slot'), img = declarations('.sop__slot img');
  assert.equal(row.display, 'grid');
  assert.equal(row['grid-template-columns'], 'repeat(2, minmax(0, 1fr))');
  for (const grid of [row, slot]) assert.equal(grid['grid-template-rows'], 'minmax(0, 1fr)', 'intrinsic image height cannot expand the track');
  assert.equal(slot['min-width'], '0'); assert.equal(slot['min-height'], '0');
  assert.equal(img.width, '100%'); assert.equal(img.height, '100%');
  assert.equal(img['box-sizing'], 'border-box'); assert.equal(img['object-fit'], 'contain');
});
