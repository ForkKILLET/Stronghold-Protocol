import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FxLibrary } from '../../public/js/render/vfx/library.js';
import { FX_LIST_URL, resetFxList } from '../../public/js/render/vfx/available.js';

function manifest() {
  return { groups: {
    fx: {
      index: { path: '/assets/local/fx/index.json' },
      textures: { path: '/assets/local/fx/textures.json' },
    },
    'fx/prefabs': {
      effect: { path: '/assets/local/fx/prefabs/effect.json' },
      external: { path: 'https://plugins.example/fx.json' },
      rewritten: { path: 'https://old-cdn.example/assets/local/fx/prefabs/other.json' },
      relative: { path: 'prefabs/relative.json' },
      plugin: { path: '/packs/example/effect.json' },
    },
    'fx/mesh': { mesh: { path: '/assets/local/fx/mesh/mesh.json' } },
    'fx/tex': { texture: { path: '/assets/local/fx/tex/full.png', half: '/assets/local/fx/tex/half.png' } },
  } };
}

for (const source of ['shared', 'fetched', 'injected', 'fallback-empty', 'fallback-failed']) {
  test(`official effects rewrite raw ${source} manifest URLs to the assets CDN`, async (t) => {
    const list = manifest(), before = structuredClone(list), calls = [];
    const assetsCdn = 'https://cdn.example/stronghold';
    const fetch = async (url) => {
      calls.push(url);
      if (url === FX_LIST_URL) {
        if (source === 'fallback-failed') return { ok: false, status: 404 };
        return { ok: true, json: async () => source === 'fallback-empty' ? { groups: {} } : list };
      }
      const body = url.endsWith('/index.json') ? { version: 2 }
        : url.endsWith('/textures.json') ? { textures: {} }
          : url.includes('/mesh/') ? { positions: [0, 0, 0] } : { format: 'fx-prefab' };
      return { ok: true, json: async () => body };
    };
    const opts = { assetsCdn, fetch, list: source === 'injected' ? list : undefined,
      assets: { local: async () => list } };
    if (source === 'shared') {
      resetFxList();
      t.after(resetFxList);
      t.mock.method(globalThis, 'fetch', fetch);
      delete opts.fetch;
    }
    const lib = new FxLibrary(opts);
    assert.equal(await lib.init(), true);
    for (const [group, entries] of Object.entries(before.groups)) {
      for (const [key, entry] of Object.entries(entries)) {
        assert.equal(lib.url(group, key), entry.path.startsWith('/assets/') ? assetsCdn + entry.path : entry.path);
      }
    }
    assert.equal(lib.groups['fx/tex'].texture.half, assetsCdn + before.groups['fx/tex'].texture.half);
    assert.equal((await lib.index()).version, 2);
    assert.deepEqual(await lib.texInfo(), {});
    assert.equal((await lib.descriptor('EFFECT')).format, 'fx-prefab');
    assert.deepEqual((await lib.loadMesh('mesh')).positions, [0, 0, 0]);
    const images = [];
    t.mock.method(lib, '_image', async (url) => {
      images.push(url);
      return { image: {}, flipped: true };
    });
    assert.ok(await lib.loadTexture('texture', false));
    assert.ok(await lib.loadTexture('texture', true));
    assert.deepEqual(images, [
      `${assetsCdn}/assets/local/fx/tex/full.png`,
      `${assetsCdn}/assets/local/fx/tex/half.png`,
    ]);
    for (const path of ['/index.json', '/textures.json', '/prefabs/effect.json', '/mesh/mesh.json']) {
      assert.ok(calls.includes(`${assetsCdn}/assets/local/fx${path}`), path);
    }
    assert.deepEqual(list, before, 'shared or caller-owned manifests must not be mutated');
    assert.equal(calls.filter((url) => url === FX_LIST_URL).length, source === 'injected' ? 0 : 1);
  });
}

for (const assetsCdn of ['', '/cdn']) {
  test(`official effects preserve the ${assetsCdn || 'same-origin'} CDN mode`, async () => {
    const lib = new FxLibrary({ list: manifest(), assetsCdn });
    assert.equal(await lib.init(), true);
    assert.equal(lib.url('fx', 'index'), `${assetsCdn}/assets/local/fx/index.json`);
    assert.equal(lib.groups['fx/tex'].texture.half, `${assetsCdn}/assets/local/fx/tex/half.png`);
    assert.equal(lib.url('fx/prefabs', 'external'), 'https://plugins.example/fx.json');
  });
}
