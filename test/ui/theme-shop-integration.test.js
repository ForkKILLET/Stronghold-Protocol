import { test } from 'node:test';
import assert from 'node:assert/strict';

test('theme selection and season changes repaint compatible artwork without rewriting the saved shop preference', async (t) => {
  const originals = new Map(['fetch', 'document', 'createImageBitmap', 'localStorage']
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const saved = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  } });
  const manifest = { groups: {} };
  const files = new Map();
  for (const id of ['ac_n_iron', 'ac_s_closur']) {
    const prefix = `/assets/local/themes/${id}/`;
    manifest.groups[`themes/${id}`] = {
      'theme.json': { path: `${prefix}theme.json` }, 'art.png': { path: `${prefix}art.png` },
    };
    files.set(`${prefix}theme.json`, JSON.stringify({
      spTheme: 1, id, name: id, colors: { skinLightColor: '#00FFC4' },
      images: { shop_level_1: 'art.png', chess_frame_normal: 'art.png', img_check_player: 'art.png' },
      character: { image: 'art.png' },
    }));
    files.set(`${prefix}art.png`, Uint8Array.of(1, 2, 3));
  }
  globalThis.fetch = async url => {
    const path = String(url).split('?')[0];
    if (path === '/data/local-assets.json') return new Response(JSON.stringify(manifest));
    return files.has(path) ? new Response(files.get(path)) : new Response('', { status: 404 });
  };
  // Image decoding is outside this test; the real downloader, pack store, settings and data subscriptions run.
  globalThis.createImageBitmap = async () => ({ width: 8, height: 8, close() {} });
  const { data } = await import('../../public/js/data.js');
  const { updateSettings, settingsStore } = await import('../../public/js/ui/settings.js');
  const { bootUiThemes, prepareTheme, selectTheme, themePack } = await import('../../public/js/uiTheme.js');
  await bootUiThemes();
  const props = {};
  globalThis.document = { documentElement: {
    dataset: {},
    style: {
      setProperty: (key, value) => { props[key] = value; },
      removeProperty: key => { delete props[key]; },
    },
  } };
  const season = family => data.setContent({ id: family, values: { config: { version: { family } } } });
  for (const preferred of [false, true]) {
    updateSettings({ officialRegulationHud: preferred });
    for (const id of ['ac_n_iron', 'ac_s_closur']) {
      assert.equal((await prepareTheme(id)).ok, true);
      season('regulation');
      selectTheme(id);
      const raw = themePack(id);
      assert.ok(raw.character);
      const artwork = props['--sp-img-shop_level_1'];
      assert.match(artwork, /^url\("blob:/);
      season('covenant');
      assert.equal(props['--sp-img-shop_level_1'], undefined);
      assert.equal(props['--sp-img-chess_frame_normal'], undefined);
      assert.match(props['--sp-img-img_check_player'], /^url\("blob:/);
      assert.equal(props['--sp-c-skin-light'], '#00FFC4');
      season('regulation');
      assert.equal(props['--sp-img-shop_level_1'], artwork);
      assert.equal(themePack(id), raw);
      assert.ok(raw.character);
      selectTheme('');
      assert.equal(props['--sp-img-shop_level_1'], undefined);
      assert.equal(settingsStore.get().officialRegulationHud, preferred);
      assert.equal(JSON.parse(saved.get('sp.pref.settings')).officialRegulationHud, preferred);
    }
  }
  data.setContent(null);
});
