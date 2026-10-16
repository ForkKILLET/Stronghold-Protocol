import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { createAssets } from '../../public/js/assets.js';

let fake, UnitView;
before(async () => {
  fake = installFakePixi();
  ({ UnitView } = await import('../../public/js/render/units.js'));
});
after(() => fake.restore());
const SKIN = 'char_x@winter#1';
const side = (id) => ({ skel: `/assets/${id}.skel`, atlas: `/assets/${id}.atlas`, textures: [`/assets/${id}.png`], anims: { idle: 'Idle' } });
const manifest = { chars: { char_x: {
  avatar: '/assets/default.png', avatarE2: '/assets/default2.png', spine: { front: side('default'), back: side('default-back') },
  skins: { [SKIN]: { avatar: '/assets/skin.png', spine: { front: side('skin'), back: side('skin-back') } } },
} } };

test('a disabled viewer never requests other players skin art; live toggle invalidates a pending skin load', async (t) => {
  const lookups = createAssets({ manifest });
  const images = [], models = [], released = [], pending = [];
  const assets = { ...lookups, image(url) { images.push(url); return Promise.resolve(null); },
    spine: { acquire(entry) { models.push(entry.skel); return new Promise((_, reject) => pending.push(reject)); },
      release(entry) { released.push(entry.skel); } },
  };
  const settings = { skinsEnabled: false };
  const v = new UnitView(fakeViewCtx(fake.P, { assets, settings }), {
    id: 1, side: 'ally', kind: 'op', ownerId: 'OTHER', defId: 'chess_x', spine: 'char_x', avatar: 'char_x_2',
    maxHp: 1000, dir: 'UP', skin: SKIN,
  });
  t.after(() => v.destroy());
  await Promise.resolve();
  assert.deepEqual(images, ['/assets/default2.png']);
  assert.deepEqual(models, ['/assets/default-back.skel']);
  v.hp = 450; v.sp = 23; v.alive = false;
  settings.skinsEnabled = true; v.refreshSkin(); await Promise.resolve();
  assert.equal(images.at(-1), '/assets/skin.png');
  assert.equal(models.at(-1), '/assets/skin.skel', 'downed unit uses the skins own Front without a Back die clip');
  settings.skinsEnabled = false; v.refreshSkin(); await Promise.resolve();
  assert.equal(images.at(-1), '/assets/default2.png');
  assert.equal(models.at(-1), '/assets/default.skel');
  assert.equal(v.hp, 450); assert.equal(v.sp, 23); assert.equal(v.alive, false);
  const count = models.length; v.refreshSkin(); assert.equal(models.length, count);
  // Superseded requests release their references and cannot install obsolete skin actors or start their fallback.
  pending[0](new Error('cancelled')); pending[1](new Error('cancelled'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(models.length, count);
  assert.equal(released.length, 2);
  v.destroy(); pending[2](new Error('cancelled')); await Promise.resolve();
});

test('installed skin loads carry a default-model fallback; broken skin Front falls back immediately', () => {
  const assets = createAssets({ manifest });
  const skin = assets.spineEntry('char_x', { skin: SKIN, back: true });
  assert.equal(skin.skel, '/assets/skin-back.skel');
  assert.equal(skin.fallback.skel, '/assets/default-back.skel');
  const broken = createAssets({ manifest: { chars: { char_x: {
    ...manifest.chars.char_x, skins: { [SKIN]: { spine: { front: {} } } },
  } } } });
  assert.equal(broken.spineEntry('char_x', { skin: SKIN }).skel, '/assets/default.skel');
  assert.equal(broken.hasBack('char_x', SKIN), true);
});
