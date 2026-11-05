import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fxFixture } from '../helpers/fxFixtures.js';
import { mergeLocalChars } from '../../server/plugins/artReferences.js';
import { createStaticHandler } from '../../server/http/static.js';
import { avatarUrl, portraitUrl, spineEntry } from '../../public/js/assets.js';
import { createCosmeticLayers, loadVisual } from '../../public/js/cosmetics.js';
import { sha256Hex } from '../../shared/sha256.js';
import { visualHashOf, writesHashOf, VISUAL_HASH_VERSION } from '../../shared/plugins/visual.js';

const ID = 'char_9001_test';
const model = face => ({ skel: `/assets/local/spine/char/${ID}/${face}/unit.skel`,
  atlas: `/assets/local/spine/char/${ID}/${face}/unit.atlas`, textures: [`/assets/local/spine/char/${ID}/${face}/page.png`],
  anims: { idle: 'Idle' }, animations: { Idle: 1 }, pma: true });
const local = () => ({ chars: { [ID]: { avatar: '/assets/local/a.png', avatarE2: '/assets/local/a2.png',
  portrait: '/assets/local/p.png', portraitE2: '/assets/local/p2.png', spine: { front: model('front'), back: model('back') } } }, groups: {} });

test('local art reaches the normal shop/detail/DIY and board helpers; original manifest and existing slots stay intact', () => {
  const base = { chars: { char_1_pool: { avatar: '/pool.png' } } }, l = local();
  const merged = mergeLocalChars(base, l);
  assert.equal(avatarUrl(merged, ID), '/assets/local/a.png');
  assert.equal(avatarUrl(merged, ID + '_2'), '/assets/local/a2.png');
  assert.equal(portraitUrl(merged, ID), '/assets/local/p.png');
  assert.equal(portraitUrl(merged, ID, { e2: true }), '/assets/local/p2.png');
  assert.equal(spineEntry(merged, ID).skel, model('front').skel);
  assert.equal(spineEntry(merged, ID, { back: true }).skel, model('back').skel);
  assert.equal(base.chars[ID], undefined);
  assert.equal(merged.chars.char_1_pool, base.chars.char_1_pool);
  const partial = { chars: { [ID]: { avatar: '/existing.png', spine: { front: { skel: '/existing.skel' } } } } };
  const filled = mergeLocalChars(partial, l).chars[ID];
  assert.equal(filled.avatar, '/existing.png');
  assert.equal(filled.spine.front.skel, '/existing.skel');
  assert.equal(filled.spine.back.skel, model('back').skel);
  for (const empty of [null, {}, { chars: {} }]) assert.equal(mergeLocalChars(base, empty), base);
});

test('room and personal plugin art override local art; failure and removal restore the extracted art', async () => {
  await loadVisual();
  const layers = createCosmeticLayers(), base = mergeLocalChars({ chars: {} }, local());
  const doc = (id, ops) => {
    const files = Object.fromEntries(['a.png', 'plugin.json', 'm/unit.skel', 'm/unit.atlas', 'm/page.png'].map(f => [f, sha256Hex(id + f)]));
    const parts = { assets: 'aa'.repeat(32), overlays: [{ id, version: '1.0.0', files, writes: writesHashOf(ops) }] };
    return { visual: { v: VISUAL_HASH_VERSION, vs: visualHashOf(parts), ...parts }, writes: [{ id, ops }] };
  };
  const avatar = [{ at: ['chars', ID, 'avatar'], file: 'a.png' }];
  layers.setRoom(doc('room-art', [...avatar, { at: ['chars', ID, 'spine', 'front'], spine: {
    skel: 'm/unit.skel', atlas: 'm/unit.atlas', textures: ['m/page.png'], pma: true,
    meta: { anims: { idle: 'Idle' }, animations: { Idle: 1 }, events: [], hits: {}, bounds: null },
  } }]));
  assert.match(avatarUrl(layers.apply(base), ID), /^\/p\/room-art\//);
  assert.match(spineEntry(layers.apply(base), ID).skel, /^\/p\/room-art\//);
  assert.equal(portraitUrl(layers.apply(base), ID), local().chars[ID].portrait);
  layers.setPersonal([{ id: 'personal-art', doc: doc('personal-art', avatar) }]);
  const url = avatarUrl(layers.apply(base), ID);
  assert.match(url, /^\/p\/personal-art\//);
  layers.fail(url);
  assert.match(avatarUrl(layers.apply(base), ID), /^\/p\/room-art\//);
  layers.setRoom(null); layers.setPersonal([]);
  assert.equal(avatarUrl(layers.apply(base), ID), local().chars[ID].avatar);
  assert.equal(spineEntry(layers.apply(base), ID).skel, model('front').skel);
  const alias = 'char_x_demo_one';
  layers.setRoom(doc('borrow-art', [{ at: ['chars', alias, 'spine', 'front'], from: ['chars', ID, 'spine', 'front'], ref: ID }]));
  assert.equal(spineEntry(layers.apply(base), alias)?.skel, model('front').skel, 'art references resolve against the merged installation');
});

// This fork keeps ordinary asset URLs and its preload fingerprints; mainline's /assets/~hash route is excluded.
test('served base manifest composes local art, invalidates it and keeps the committed file unchanged', async t => {
  const f = fxFixture(t), base = { chars: {} };
  f.put('data/assets.json', base);
  const handler = createStaticHandler({ dataDir: path.join(f.root, 'data'), publicDir: path.join(f.root, 'public'),
    sharedDir: path.join(f.root, 'shared'), packs: {}, clientBuild: false });
  t.after(() => handler.close());
  const server = http.createServer((req, res) => { handler(req, res, '/data/assets.json', '').catch(error => res.destroy(error)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function get(etag) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/data/assets.json`, { headers: etag ? { 'if-none-match': etag } : {} });
    return { status: response.status, headers: { ETag: response.headers.get('etag') }, doc: response.status === 304 ? null : await response.json() };
  }

  assert.deepEqual((await get()).doc, base);
  f.put('data/local-assets.json', local());
  const one = await get();
  assert.equal(one.doc.chars[ID].avatar, '/assets/local/a.png');
  assert.equal(one.doc.chars[ID].spine.front.skel, model('front').skel);
  assert.equal((await get(one.headers.ETag)).status, 304);
  const changed = local(); changed.chars[ID].avatar = '/assets/local/changed.png';
  f.put('data/local-assets.json', changed);
  const two = await get(one.headers.ETag);
  assert.equal(two.status, 200);
  assert.notEqual(one.headers.ETag, two.headers.ETag);
  assert.equal(two.doc.chars[ID].avatar, '/assets/local/changed.png');
  f.put('data/local-assets.json', { groups: {} });
  assert.deepEqual((await get()).doc, base);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, 'data/assets.json'))), base);
});
