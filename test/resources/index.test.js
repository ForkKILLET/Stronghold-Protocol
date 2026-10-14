// test/resources/index.test.js — the preload controller (public/js/resources/index.js, docs/ASSETS.md「Preload」):
// settings → manifest → Service Worker → Cache Storage, with the browser APIs (fetch, caches, navigator.serviceWorker,
// localStorage) stubbed. One test walks the whole lifecycle, because the controller is a module-level singleton.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CACHE_NAME, MANIFEST_URL, SW_URL, cacheName, indexUrl } from '../../public/js/resources/common.js';
import { DOWNLOAD_LOCK } from '../../public/js/resources/index.js';
import { createHash } from 'node:crypto';
import { ResourceStore } from '../../public/js/resources/store.js';
import { exportResourceZip } from '../../public/js/resources/archive.js';

class MemoryCache {
  constructor() { this.entries = new Map(); }
  async put(request, response) { this.entries.set(typeof request === 'string' ? request : request.url, response.clone()); }
  async match(request) { const hit = this.entries.get(typeof request === 'string' ? request : request.url); return hit ? hit.clone() : undefined; }
  async keys() { return [...this.entries.keys()].map((url) => new Request(url)); }
  async delete(request) { return this.entries.delete(typeof request === 'string' ? request : request.url); }
}
class MemoryCaches {
  constructor() { this.map = new Map(); }
  async open(name) { if (!this.map.has(name)) this.map.set(name, new MemoryCache()); return this.map.get(name); }
  async keys() { return [...this.map.keys()]; }
  async delete(name) { return this.map.delete(name); }
}

const ORIGIN = 'https://game.example';
const FILES = [
  // the real manifest is sorted essential-first (server/resources.js) — the fixture mirrors that
  { url: '/assets/audio/bgm.mp3', tier: 1, size: 6 },
  { url: '/assets/ui/panel.png', tier: 1, size: 4 },
  { url: '/assets/char/portrait.png', tier: 2, size: 5 },
  { url: '/assets/spine/op/x/front/x.skel', tier: 2, size: 7 },
];
const MANIFEST = { format: 1, version: 'testversion', count: FILES.length, tier1: 2, sized: FILES.length, totalBytes: 22, files: FILES };

const SKIN_FILES = [
  { url: '/assets/ui/base.png', tier: 1, size: 4 },
  { url: '/assets/audio/sfx/deploy.mp3', tier: 2, size: 4 },
  { url: '/assets/char/avatar/skin/char_x_winter_1.png', tier: 2, size: 4 },
  { url: '/assets/spine/op/char_x/char_x_winter_1/front/char_x.skel', tier: 2, size: 4 },
];
const SKIN_MANIFEST = { ...MANIFEST, version: 'skin-scope', files: SKIN_FILES, tier1: 1, totalBytes: 16 };

test('skin preloading is independent: optional audio never opts in skins, skins need no audio opt-in', async t => {
  const env = stubEnv({ manifest: SKIN_MANIFEST }); t.after(env.restore);
  const mod = await import('../../public/js/resources/index.js?skins-independent');
  await mod.syncResources(true, true, 'cn', false);
  assert.deepEqual(env.calls.fetch.slice(1), SKIN_FILES.slice(0, 2).map(cacheKey));
  assert.equal(mod.resourceState().selectionComplete, true);
  assert.equal(mod.resourceState().groups.find(g => g.id === 'skins').selected, false);
  await mod.syncResources(true, false, 'cn', true);
  assert.deepEqual(env.calls.fetch.slice(3), SKIN_FILES.slice(2).map(cacheKey));
  assert.equal(mod.resourceState().selectedWanted, 3);
  assert.equal(mod.resourceState().groups.find(g => g.id === 'sfx').selected, false);
  const fetched = env.calls.fetch.length;
  await mod.syncResources(true, true, 'cn', false);
  assert.equal(env.calls.fetch.length, fetched, 'changing scope keeps valid cached files');
  assert.equal(mod.resourceState().done, 4);
  await mod.syncResources(false, false, 'cn', false);
});

test('changing skin scope during combat defers downloads and respects a manual pause', async t => {
  const env = stubEnv({ manifest: SKIN_MANIFEST }); t.after(env.restore);
  const mod = await import('../../public/js/resources/index.js?skins-combat');
  await mod.syncResourceCombat(true);
  await mod.syncResources(true, false, 'cn', true);
  await mod.syncResources(true, true, 'cn', false);
  await mod.inspectResources();
  assert.deepEqual(env.calls.fetch, []);
  await mod.syncResourceCombat(false);
  assert.deepEqual(env.calls.fetch.slice(1), SKIN_FILES.slice(0, 2).map(cacheKey), 'only latest scope resumes');
  await mod.syncResourceCombat(true); mod.pauseResources();
  await mod.syncResources(true, false, 'cn', true);
  const n = env.calls.fetch.length;
  await mod.syncResourceCombat(false);
  assert.equal(env.calls.fetch.length, n, 'changing skins does not override manual pause');
  await mod.startResources();
  assert.deepEqual(env.calls.fetch.slice(n), SKIN_FILES.slice(2).map(cacheKey));
  await mod.syncResources(false, false, 'cn', false);
});

test('ZIP retains validated skins even when unselected, then fills only the selected missing category', async t => {
  const files = SKIN_FILES.map(f => ({ ...f, hash: createHash('sha1').update('b'.repeat(f.size)).digest('hex').slice(0, 12) }));
  const source = new ResourceStore({ ...SKIN_MANIFEST, files: files.slice(2, 3) }, {
    caches: new MemoryCaches(), origin: ORIGIN, fetcher: async () => new Response('b'.repeat(4)),
  });
  await source.download();
  const { blob } = await exportResourceZip(source);
  const env = stubEnv({ manifest: { ...SKIN_MANIFEST, files } }); t.after(env.restore);
  const mod = await import('../../public/js/resources/index.js?skins-zip');
  await mod.syncResources(false, true, 'cn', false);
  await mod.importResources(blob); await mod.startResources();
  assert.deepEqual(env.calls.fetch.slice(1), files.slice(0, 2).map(cacheKey));
  assert.equal(mod.resourceState().groups.find(g => g.id === 'skins').present, 1);
  assert.equal((await mod.exportResources()).count, 3);
  const n = env.calls.fetch.length;
  await mod.syncResources(true, false, 'cn', true);
  assert.deepEqual(env.calls.fetch.slice(n), files.slice(3).map(cacheKey));
  assert.equal(mod.resourceState().selectionComplete, true);
  await mod.syncResources(false, false, 'cn', false);
});

test('required-only preload stops after visuals; opting in later downloads only missing optional files', async (t) => {
  const env = stubEnv();
  t.after(env.restore);
  const mod = await import('../../public/js/resources/index.js?optional-selection');
  await mod.inspectResources();
  assert.deepEqual(env.calls.fetch, [MANIFEST_URL]);
  assert.equal(env.calls.registered.length, 0, 'opening the manager does not enable preloading');
  await mod.syncResources(true, false);
  assert.deepEqual(env.calls.fetch.slice(1), FILES.filter((f) => f.tier === 1).map((f) => ORIGIN + f.url));
  assert.equal(mod.resourceState().selectionComplete, true);
  assert.equal(mod.resourceState().complete, false);
  assert.match(mod.resourceState().message, /必备资源已预载完成/);
  const count = env.calls.fetch.length;
  await mod.startResources();
  assert.equal(env.calls.fetch.length, count, 'resuming a completed required tier does not fetch optional files');
  await mod.syncResources(true, true);
  assert.deepEqual(env.calls.fetch.slice(count), FILES.filter((f) => f.tier === 2).map((f) => ORIGIN + f.url));
  assert.equal(mod.resourceState().complete, true);
  await mod.syncResources(false);
});

test('controller ZIP import/export uses shared lock, automatically enables preload, then fills only selected missing tiers', async (t) => {
  const files = FILES.map((f) => ({ ...f, hash: createHash('sha1').update('b'.repeat(f.size)).digest('hex').slice(0, 12) }));
  const env = stubEnv({ manifest: { ...MANIFEST, files } });
  t.after(env.restore);
  const locks = [];
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: {
    request: async (name, options, job) => { locks.push(name); return job({ name }); },
  } });
  const mod = await import('../../public/js/resources/index.js?controller-zip');
  await mod.syncResources(true, false);
  const exported = await mod.exportResources();
  assert.equal(exported.count, 2);
  assert.equal(exported.blob.type, 'application/zip');
  await mod.syncResources(false);
  await mod.clearResources();
  const previous = env.calls.fetch.length;
  let persistedPreload = false;
  let enabledCallbacks = 0;
  const result = await mod.importResources(exported.blob, { onImported: () => {
    persistedPreload = true;
    enabledCallbacks++;
    assert.equal(mod.resourceState().archive, '', 'the setting changes only after the archive lock is released');
  } });
  assert.equal(result.imported, 2);
  assert.equal(mod.resourceState().enabled, true);
  assert.equal(persistedPreload, true);
  assert.equal(enabledCallbacks, 1);
  assert.equal(mod.resourceState().archive, '');
  assert.equal(env.calls.fetch.length, previous);
  await mod.syncResources(true, true);
  assert.deepEqual(env.calls.fetch.slice(previous), FILES.filter((f) => f.tier === 2).map((f) => ORIGIN + f.url));
  assert.ok(locks.filter((name) => name === DOWNLOAD_LOCK).length >= 4);
  assert.ok(locks.every((name) => name === DOWNLOAD_LOCK || name === 'stronghold-resources-runtime-index'));
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: { request: async (_, options, job) => job(null) } });
  const cached = mod.resourceState().done;
  await assert.rejects(mod.exportResources(), /另一个标签页/);
  await assert.rejects(mod.importResources(exported.blob), /另一个标签页/);
  await mod.clearResources();
  assert.equal(mod.resourceState().done, cached, 'busy lock prevents deleting another tab\'s cache');
  await mod.syncResources(false);
});

test('changing download scope and disabling preload while checking does not restart an obsolete request', async (t) => {
  const env = stubEnv();
  t.after(env.restore);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetcher = globalThis.fetch;
  globalThis.fetch = async (url, options) => { if (url === MANIFEST_URL) await gate; return fetcher(url, options); };
  const mod = await import('../../public/js/resources/index.js?selection-race');
  const original = mod.syncResources(true, false);
  const changed = mod.syncResources(true, true);
  await mod.syncResources(false, false);
  release();
  await Promise.all([original, changed]);
  assert.equal(mod.resourceState().enabled, false);
  assert.deepEqual(env.calls.fetch, [MANIFEST_URL], 'a superseded settings update cannot enable resource downloads');
  await mod.syncResources(true, false);
  assert.deepEqual(env.calls.fetch.slice(1), FILES.filter((f) => f.tier === 1).map((f) => ORIGIN + f.url));
  await mod.syncResources(false);
});

test('opening resource management during startup shares its active check instead of scanning the cache twice', async (t) => {
  const env = stubEnv();
  t.after(env.restore);
  const mod = await import('../../public/js/resources/index.js?opening-during-startup');
  const cache = await env.caches.open(CACHE_NAME);
  const keys = cache.keys.bind(cache);
  const gate = Promise.withResolvers();
  const started = Promise.withResolvers();
  let scans = 0;
  cache.keys = async () => { scans++; started.resolve(); await gate.promise; return keys(); };
  const startup = mod.syncResources(true, false);
  await started.promise;
  assert.equal(mod.resourceState().phase, 'download', 'the fast index check finishes before the download scan');
  await mod.inspectResources();
  await mod.inspectResources();
  assert.equal(scans, 1);
  gate.resolve();
  await startup;
  assert.equal(mod.resourceState().selectionComplete, true);
  await mod.syncResources(false);
});

test('complete indexed startup skips scans; deferred verification detects eviction and refills', async (t) => {
  const env = stubEnv();
  t.after(env.restore);
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let deferred;
  Object.defineProperty(globalThis, 'window', {
    configurable: true, value: {
      setTimeout: (fn, ms) => { assert.equal(ms, 5000); deferred = fn; return 1; },
      clearTimeout: () => { deferred = null; },
    },
  });
  t.after(() => { if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete globalThis.window; });
  const mod = await import('../../public/js/resources/index.js?fast-complete-startup');
  const cache = await env.caches.open(CACHE_NAME);
  const files = {};
  for (const file of FILES) {
    const key = ORIGIN + file.url;
    await cache.put(key, new Response('b'.repeat(file.size)));
    files[key] = null;
  }
  await cache.put(indexUrl(ORIGIN), new Response(JSON.stringify({ version: 1, manifest: MANIFEST.version, files })));
  const keys = cache.keys.bind(cache);
  let scans = 0;
  cache.keys = async () => { scans++; return keys(); };
  await mod.syncResources(true, false);
  assert.equal(scans, 0);
  assert.equal(mod.resourceState().cacheVerified, false);
  assert.equal(mod.resourceState().phase, 'ready');
  assert.deepEqual(env.calls.fetch, [MANIFEST_URL]);
  await cache.delete(ORIGIN + FILES[1].url);
  deferred();
  await mod.startResources(); // joins the active background verification
  assert.equal(mod.resourceState().cacheVerified, true);
  assert.equal(mod.resourceState().selectionComplete, true);
  assert.deepEqual(env.calls.fetch.slice(1), [ORIGIN + FILES[1].url], 'only evicted resource is fetched');
  assert.ok(scans > 0);
  await mod.syncResources(false);
});

test('ZIP quota failures are recognized by name even without an English error message', async (t) => {
  const files = FILES.slice(0, 2).map((f) => ({ ...f, hash: createHash('sha1').update('b'.repeat(f.size)).digest('hex').slice(0, 12) }));
  const manifest = { ...MANIFEST, files };
  const source = new ResourceStore(manifest, { caches: new MemoryCaches(), origin: ORIGIN,
    fetcher: async (url) => new Response('b'.repeat(files.find((f) => url.endsWith(f.url)).size)) });
  await source.download();
  const { blob } = await exportResourceZip(source);
  const env = stubEnv({ manifest });
  t.after(env.restore);
  const cache = await env.caches.open(CACHE_NAME);
  const put = cache.put.bind(cache);
  const firstWritten = Promise.withResolvers();
  cache.put = async (url, response) => {
    if (url.endsWith(files[1].url)) {
      // Concurrent verification may finish out of ZIP order; this assertion concerns an ALREADY completed write.
      await firstWritten.promise;
      throw new DOMException('', 'QuotaExceededError');
    }
    await put(url, response);
    if (url.endsWith(files[0].url)) firstWritten.resolve();
  };
  const mod = await import('../../public/js/resources/index.js?zip-quota-name');
  let enabled = false;
  await assert.rejects(mod.importResources(blob, { onImported: () => { enabled = true; } }), (err) => err.name === 'QuotaExceededError');
  assert.equal(mod.resourceState().done, 1);
  assert.equal(mod.resourceState().error, true);
  assert.match(mod.resourceState().message, /浏览器存储空间不足/);
  assert.equal(mod.resourceState().enabled, false);
  assert.equal(enabled, false, 'a failed import does not persist an enabled setting');
});

test('successful ZIP import persists the preload setting and completes only the selected missing resources', async (t) => {
  const files = FILES.map((f) => ({ ...f, hash: createHash('sha1').update('b'.repeat(f.size)).digest('hex').slice(0, 12) }));
  const source = new ResourceStore({ format: 1, version: 'partial', files: files.slice(0, 1) }, {
    caches: new MemoryCaches(), origin: ORIGIN, fetcher: async () => new Response('b'.repeat(files[0].size)),
  });
  await source.download();
  const { blob } = await exportResourceZip(source);
  const env = stubEnv({ manifest: { ...MANIFEST, files } });
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const prefs = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => prefs.get(key) ?? null, setItem: (key, value) => prefs.set(key, value),
  } });
  const { settingsStore, updateSettings } = await import('../../public/js/ui/settings.js?zip-enabled-setting');
  const originalSettings = settingsStore.get();
  t.after(async () => {
    await mod.syncResources(false);
    updateSettings(originalSettings);
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
    env.restore();
  });
  updateSettings({ preload: false, preloadOptional: false });
  const mod = await import('../../public/js/resources/index.js?zip-enabled-setting');
  await mod.importResources(blob, { onImported: () => updateSettings({ preload: true }) });
  await mod.startResources();
  assert.equal(settingsStore.get().preload, true);
  assert.equal(JSON.parse(prefs.get('sp.pref.settings')).preload, true);
  assert.equal(JSON.parse(prefs.get('sp.pref.settings')).preloadOptional, false);
  assert.equal(mod.resourceState().enabled, true);
  assert.deepEqual(env.calls.fetch, [MANIFEST_URL, ORIGIN + files[1].url], 'only the missing essential file downloads');
});

test('invalid or cancelled ZIP imports do not enable preload or invoke the persisted-setting callback', async (t) => {
  const env = stubEnv();
  t.after(env.restore);
  const mod = await import('../../public/js/resources/index.js?zip-enable-failures');
  let callbacks = 0;
  const options = { onImported: () => { callbacks++; } };
  await assert.rejects(mod.importResources(new Blob(['not a ZIP']), options));
  assert.equal(mod.resourceState().enabled, false);
  const pending = mod.importResources(new Blob(['not a ZIP']), options);
  mod.pauseResources();
  await assert.rejects(pending, (err) => err.name === 'AbortError');
  assert.equal(mod.resourceState().enabled, false);
  assert.equal(callbacks, 0);
});

test('ZIP percentages and category counters update together every 500 ms, with immediate phase completion', async (t) => {
  const files = Array.from({ length: 6 }, (_, i) => ({ url: `/assets/map/${i}.png`, tier: 1, size: 1,
    hash: createHash('sha1').update('b').digest('hex').slice(0, 12) }));
  const manifest = { ...MANIFEST, files, count: 6, tier1: 6, sized: 6, totalBytes: 6 };
  const source = new ResourceStore(manifest, { caches: new MemoryCaches(), origin: ORIGIN, fetcher: async () => new Response('b') });
  await source.download();
  const { blob } = await exportResourceZip(source);
  const env = stubEnv({ manifest });
  t.after(env.restore);
  let time = 0;
  t.mock.method(performance, 'now', () => time);
  const cache = await env.caches.open(CACHE_NAME);
  const put = cache.put.bind(cache);
  const times = [50, 500, 600, 999, 1000, 1050];
  let written = 0;
  cache.put = async (url, response) => {
    await put(url, response);
    if (url.includes('/assets/map/')) time = times[written++];
  };
  const mod = await import('../../public/js/resources/index.js?zip-progress-throttle');
  const progress = [];
  t.after(mod.subscribeResources((s) => {
    if (s.archivePhase === 'import') progress.push({ time, percent: s.archivePercent, done: s.done,
      group: s.archiveGroup, count: s.groups.find((g) => g.id === 'map')?.present, message: s.message });
  }));
  await mod.importResources(blob);
  const updates = progress.filter((p) => p.message.startsWith('正在导入资源包：'));
  assert.deepEqual(updates.map((p) => [p.time, p.percent, p.done, p.count]),
    [[0, 0, 0, 0], [500, 33, 2, 2], [1000, 83, 5, 5], [1050, 100, 6, 6]]);
  assert.deepEqual(updates.slice(1).map((p) => p.group), ['map', 'map', 'map']);
  assert.ok(updates.every((p) => /\d+%$/.test(p.message)));
  assert.equal(mod.resourceState().done, 6);
  assert.equal(mod.resourceState().archiveGroup, '', 'completion clears the active category');

  // Existing valid entries still advance the percentage to 100%, although no files need writing a second time.
  assert.equal((await mod.importResources(blob)).imported, 0);
  assert.equal(mod.resourceState().archivePercent, 100);
});

/** Install stubs and return the recorder of what the module did. */
function stubEnv({ manifest = MANIFEST, fail = false, secure = true } = {}) {
  const calls = { fetch: [], fetchOptions: [], registered: [], unregistered: 0, released: [] };
  const globals = ['fetch', 'caches', 'navigator', 'isSecureContext', 'location'];
  const saved = Object.fromEntries(globals.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const restore = () => {
    for (const k of globals) {
      if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
      else delete globalThis[k];
    }
  };
  const caches = new MemoryCaches();
  Object.defineProperty(globalThis, 'isSecureContext', { value: secure, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'location', { value: { origin: ORIGIN }, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'caches', { value: caches, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      serviceWorker: {
        async register(url, opts) { calls.registered.push([url, opts]); return { scope: '/' }; },
        async getRegistrations() { return [{ active: { scriptURL: ORIGIN + SW_URL }, async unregister() { calls.unregistered++; } }]; },
      },
    },
    configurable: true, writable: true,
  });
  Object.defineProperty(globalThis, 'fetch', {
    value: async (url, opts) => {
      calls.fetch.push(url);
      calls.fetchOptions.push(opts);
      if (url === MANIFEST_URL) {
        if (fail) return new Response('nope', { status: 503 });
        return new Response(JSON.stringify(manifest), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const file = manifest.files.find((f) => url.endsWith(f.url));
      if (!file) return new Response('missing', { status: 404 });
      if (opts?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return new Response('b'.repeat(file.size), { status: 200, headers: { 'Content-Type': 'image/png' } });
    },
    configurable: true, writable: true,
  });
  return { calls, caches, restore };
}

test('the preload controller: off by default, downloads in two passes, serves offline state', async (t) => {
  // `import` after the stubs: the module reads globals lazily, but the manifest fetch is kicked off on the first call
  const env = stubEnv();
  t.after(env.restore);
  const mod = await import('../../public/js/resources/index.js');
  const states = [];
  const unsub = mod.subscribeResources((s) => states.push(s));
  t.after(unsub);

  assert.equal(mod.resourceState().phase, 'off');
  assert.equal(mod.resourceState().enabled, false);

  // Bulk download is off, but the runtime caching worker is still registered.
  await mod.syncResources(false);
  assert.equal(env.calls.fetch.length, 0, 'no manifest request while the preload is off');
  assert.equal(env.calls.registered.length, 1, 'the worker is registered even when bulk preload is off');

  // turning it on: manifest, worker, essential tier first, then the rest
  await mod.syncResources(true, true);
  const st = mod.resourceState();
  assert.equal(env.calls.registered.length, 1, 'enabling bulk preload reuses the existing worker');
  assert.deepEqual(env.calls.registered[0], [SW_URL, { type: 'module', scope: '/', updateViaCache: 'none' }]);
  assert.equal(env.calls.fetch[0], MANIFEST_URL);
  assert.equal(env.calls.fetchOptions[0].cache, 'no-cache', 'manifest reads revalidate the HTTP cache instead of bypassing it');
  assert.deepEqual(env.calls.fetch.slice(1), [
    `${ORIGIN}/assets/audio/bgm.mp3`, `${ORIGIN}/assets/ui/panel.png`, // essential tier, alphabetical
    `${ORIGIN}/assets/char/portrait.png`, `${ORIGIN}/assets/spine/op/x/front/x.skel`, // then the rest
  ]);
  assert.equal(st.phase, 'ready');
  assert.equal(st.complete, true);
  assert.deepEqual([st.done, st.total, st.bytes, st.totalBytes], [4, 4, 22, 22]);
  assert.deepEqual([st.tier1Done, st.tier1Total, st.tier2Done, st.tier2Total], [2, 2, 2, 2]);
  assert.match(st.message, /资源已全部预载完成/, 'the copy never promises offline play');
  assert.equal(/离线/.test(JSON.stringify(states)), false, 'no state text says 离线');
  assert.equal(st.error, false);
  assert.ok(states.some((s) => s.phase === 'download'), 'progress states were published');
  // the panel renders numeric counters: an undefined one used to show as "undefined/3966" mid-download
  for (const s of states) {
    for (const k of ['done', 'total', 'wanted', 'bytes', 'skipped', 'sized', 'sizedTotal', 'tier1Done', 'tier1Total', 'tier2Done', 'tier2Total']) {
      assert.equal(typeof s[k], 'number', `state.${k} while ${s.phase} (${JSON.stringify(s[k])})`);
    }
  }
  assert.ok(states.some((s) => s.phase === 'download' && s.done >= 1 && s.done < 4), 'a mid-download update carried the partial count');
  assert.equal(await (await env.caches.open(CACHE_NAME)).match(`${ORIGIN}/assets/ui/panel.png`) !== undefined, true);

  // a second sync with the same value is a no-op (the settings store fires for volume changes too)
  const fetches = env.calls.fetch.length;
  await mod.syncResources(true, true);
  assert.equal(env.calls.fetch.length, fetches, 'no second download');

  // pausing, continuing and clearing
  await mod.syncResources(false);
  assert.equal(mod.resourceState().enabled, false);
  assert.equal(mod.resourceState().phase, 'ready', 'what is cached stays usable');
  await mod.clearResources();
  assert.deepEqual(await env.caches.keys(), [], 'every cache of this app is gone');
  assert.equal(mod.resourceState().phase, 'off');
  assert.equal(mod.resourceState().done, 0);
  assert.equal(env.calls.unregistered, 0, 'disabling preload never unregisters the runtime worker');
});

test('a second tab does not download the same files twice (Web Locks)', async (t) => {
  const env = stubEnv();
  t.after(env.restore);
  const lockCalls = [];
  // another tab owns the lock: with `ifAvailable` the callback runs with null instead of queueing behind 250 MiB
  Object.defineProperty(globalThis.navigator, 'locks', {
    value: { request: async (name, opts, cb) => { lockCalls.push([name, opts]); return cb(null); } },
    configurable: true, writable: true,
  });
  const mod = await import('../../public/js/resources/index.js?other-tab');
  await mod.syncResources(true, true);
  const st = mod.resourceState();
  assert.deepEqual(lockCalls, [[DOWNLOAD_LOCK, { ifAvailable: true }]]);
  assert.equal(st.phase, 'foreign');
  assert.match(st.message, /另一个标签页正在预载/);
  assert.deepEqual(env.calls.fetch, [MANIFEST_URL], 'nothing is downloaded: only the manifest was asked for');
  assert.deepEqual([st.done, st.total], [0, FILES.length], 'the counters still come from the shared cache');
  assert.equal(st.enabled, true, 'the setting stays on');

  // the other tab is gone (released the lock): 再检查一次 downloads the rest
  Object.defineProperty(globalThis.navigator, 'locks', { value: { request: async (name, opts, cb) => cb({ name }) }, configurable: true, writable: true });
  await mod.startResources();
  assert.equal(mod.resourceState().phase, 'ready');
  assert.equal(mod.resourceState().complete, true);
  assert.equal(env.calls.fetch.length, 1 + FILES.length, 'the tab that owns the lock does the work');
  await mod.syncResources(false);
});

test('the worker entry (public/resource-sw.js) intercepts resources only', async (t) => {
  const saved = ['self', 'caches'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  const handlers = {};
  const caches = new MemoryCaches();
  const asset = `${ORIGIN}/assets/e2e/a.png`;
  await (await caches.open(cacheName('sw'))).put(asset, new Response('cached-bytes'));
  Object.defineProperty(globalThis, 'self', { value: { addEventListener: (name, fn) => { handlers[name] = fn; } }, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'caches', { value: caches, configurable: true, writable: true });
  t.after(() => { for (const [k, d] of saved) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } });
  await import('../../public/resource-sw.js');
  assert.deepEqual(Object.keys(handlers).sort(), ['activate', 'fetch', 'install'], 'the worker registers its listeners');

  const answered = [];
  const fire = (url, method = 'GET') => {
    let promise = null;
    handlers.fetch({ request: new Request(url, { method }), respondWith: (p) => { promise = p; answered.push(url); } });
    return promise;
  };
  assert.equal(await fire(asset).then((r) => r.text()), 'cached-bytes', 'a cached resource is answered');
  assert.equal(fire(`${ORIGIN}/js/main.js`), null, 'code passes through');
  for (const name of ['index-AbCd1234.js', 'index-AbCd1234.css', 'pixi.min-AbCd1234.js']) {
    const url = `${ORIGIN}/build/assets/${name}`;
    await (await caches.open(cacheName('sw'))).put(url, new Response('stale-build'));
    assert.equal(fire(url), null, 'Vite files never call respondWith, even if an old cache contains them');
  }
  assert.equal(fire(`${ORIGIN}/data/assets.json`), null, 'game data passes through');
  assert.equal(fire(`${ORIGIN}/assets/e2e/a.png`, 'POST'), null, 'only GET');
  assert.deepEqual(answered, [asset]);
});

test('the worker caches successful visual loads on demand and uses network-first audio', async () => {
  const saved = ['self', 'caches', 'fetch'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  const handlers = {};
  const caches = new MemoryCaches();
  const calls = [];
  Object.defineProperty(globalThis, 'self', { value: { addEventListener: (name, fn) => { handlers[name] = fn; } }, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'caches', { value: caches, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'fetch', { value: async (request) => {
    calls.push(request.url);
    return new Response(request.url.endsWith('.mp3') ? 'network-audio' : 'network-image', {
      status: 200, headers: { 'Content-Type': request.url.endsWith('.mp3') ? 'audio/mpeg' : 'image/png' },
    });
  }, configurable: true, writable: true });
  try {
    await import('../../public/resource-sw.js?runtime-cache');
    const fire = (url) => {
      let promise;
      const waits = [];
      handlers.fetch({ request: new Request(url), respondWith: (p) => { promise = p; }, waitUntil: (p) => waits.push(p) });
      return Promise.all([promise, ...waits]).then(([response]) => response);
    };
    const image = `${ORIGIN}/assets/runtime/image.png`;
    assert.equal(await (await fire(image)).text(), 'network-image');
    assert.equal(await (await (await caches.open(CACHE_NAME)).match(image)).text(), 'network-image');
    calls.length = 0;
    assert.equal(await (await fire(image)).text(), 'network-image');
    assert.deepEqual(calls, [], 'visual resources are cache-first after the first successful load');

    const audio = `${ORIGIN}/assets/audio/runtime.mp3`;
    assert.equal(await (await fire(audio)).text(), 'network-audio');
    assert.equal(calls.at(-1), audio);
  } finally {
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k];
    }
  }
});

test('the worker also stores successful opaque CDN responses', async () => {
  const saved = ['self', 'caches', 'fetch'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  const handlers = {};
  const caches = new MemoryCaches();
  Object.defineProperty(globalThis, 'self', { value: { addEventListener: (name, fn) => { handlers[name] = fn; } }, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'caches', { value: caches, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'fetch', { value: async () => new Response(null, { status: 200 }), configurable: true, writable: true });
  try {
    await import('../../public/resource-sw.js?runtime-opaque');
    let response;
    const waits = [];
    handlers.fetch({
      request: new Request('https://cdn.example/assets/runtime/opaque.png'),
      respondWith: (promise) => { response = promise; },
      waitUntil: (promise) => waits.push(promise),
    });
    await response;
    await Promise.all(waits);
    const cache = await caches.open(CACHE_NAME);
    assert.ok(await cache.match('https://cdn.example/assets/runtime/opaque.png'));
  } finally {
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k];
    }
  }
});

test('a browser without Cache Storage is reported instead of downloading', async (t) => {
  const env = stubEnv({ secure: false });
  t.after(env.restore);
  // a separate module instance (the controller keeps a session-wide manifest/worker state, as in the browser)
  const mod = await import('../../public/js/resources/index.js?insecure-context');
  await mod.syncResources(true, true);
  const st = mod.resourceState();
  assert.equal(st.enabled, true, 'the switch stays where the player put it');
  assert.equal(st.supported, false);
  assert.equal(st.phase, 'error');
  assert.match(st.message, /HTTPS|Cache Storage|Service Worker/);
  assert.deepEqual(env.calls.fetch, [], 'nothing is downloaded');
  await mod.syncResources(false);
});


const VOICE_FILES = [
  { url: '/assets/ui/voice-scope.png', tier: 1, size: 4 },
  { url: '/assets/audio/voice/cn/char_test/cn_019.mp3', tier: 2, size: 3 },
  // JP uses cn_019 filenames too: language comes from the directory, not the filename.
  { url: 'https://cdn.example/prefix/assets/audio/voice/jp/char_test/cn_019.mp3', tier: 2, size: 5 },
  { url: '/assets/audio/sfx/click.mp3', tier: 2, size: 2 },
];
const VOICE_MANIFEST = { format: 1, version: 'voice-scope', files: VOICE_FILES, totalBytes: 14, sized: 4 };
const cacheKey = (f) => new URL(f.url, ORIGIN).href;

test('Chinese/Japanese scope downloads incrementally, counts selected files and keeps both cached dubs', async (t) => {
  const env = stubEnv({ manifest: VOICE_MANIFEST }); t.after(env.restore);
  const mod = await import('../../public/js/resources/index.js?voice-dub-scope');
  const snapshots = []; const unsubscribe = mod.subscribeResources((s) => snapshots.push(s)); t.after(unsubscribe);
  await mod.syncResources(true, true, 'cn');
  assert.deepEqual(env.calls.fetch, [MANIFEST_URL, ...VOICE_FILES.filter((_, i) => i !== 2).map(cacheKey)]);
  let st = mod.resourceState(); assert.equal(st.selectionComplete, true); assert.equal(st.complete, false);
  assert.equal(st.selectedDone, 3); assert.equal(st.selectedWanted, 3); assert.equal(st.selectedBytes, 9);
  assert.equal(st.groups.find((g) => g.id === 'voice_jp').selected, false);
  assert.match(st.message, /所选资源已齐全/);
  const first = snapshots.find((s) => s.groups.length > 0 && s.selectedDone === 0);
  const before = env.calls.fetch.length;
  await mod.syncResources(true, true, 'jp');
  assert.deepEqual(env.calls.fetch.slice(before), [cacheKey(VOICE_FILES[2])]);
  st = mod.resourceState(); assert.equal(st.selectedDone, 3); assert.equal(st.selectedBytes, 11);
  assert.equal(st.groups.find((g) => g.id === 'voice_cn').present, 1);
  assert.equal(st.groups.find((g) => g.id === 'voice_cn').selected, false);
  assert.equal(first.groups.every((g) => g.present === 0), true, 'progress snapshots are independent');
  const end = env.calls.fetch.length;
  await mod.syncResources(true, true, 'cn'); await mod.syncResources(true, true, 'all');
  assert.equal(env.calls.fetch.length, end, 'switching to cached dubs never re-downloads');
  await mod.syncResources(true, true, 'none');
  assert.equal(mod.resourceState().selectedWanted, 2); assert.equal(mod.resourceState().selectionComplete, true);
  await mod.syncResources(true, false, 'jp');
  assert.equal(mod.resourceState().selectedWanted, 1); assert.equal(mod.resourceState().selectionComplete, true);
  const keys = await (await env.caches.open(CACHE_NAME)).keys();
  assert.equal(keys.filter((key) => key.url.includes('/assets/')).length, 4, 'selection changes do not delete cached audio');
  await mod.syncResources(false);
});

test('voice selection during active downloads aborts old scope; rapid changes use the latest language', async (t) => {
  const env = stubEnv({ manifest: VOICE_MANIFEST }); t.after(env.restore);
  const fetcher = globalThis.fetch; const started = Promise.withResolvers();
  globalThis.fetch = async (url, options) => {
    if (url === cacheKey(VOICE_FILES[1])) {
      started.resolve();
      await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }));
    }
    return fetcher(url, options);
  };
  const mod = await import('../../public/js/resources/index.js?voice-scope-race');
  const original = mod.syncResources(true, true, 'cn'); await started.promise;
  const next = mod.syncResources(true, true, 'jp'); const old = mod.syncResources(true, true, 'cn');
  const latest = mod.syncResources(true, true, 'jp'); await Promise.all([original, next, old, latest]);
  assert.equal(mod.resourceState().voiceLang, 'jp'); assert.equal(mod.resourceState().selectionComplete, true);
  const cache = await env.caches.open(CACHE_NAME);
  assert.equal(await cache.match(cacheKey(VOICE_FILES[1])), undefined);
  assert.ok(await cache.match(cacheKey(VOICE_FILES[2])));
  await mod.syncResources(false);
});

test('ZIP import keeps valid unselected voices but incremental completion fetches only the selected dub', async (t) => {
  const files = VOICE_FILES.map((f) => ({ ...f, hash: createHash('sha1').update('b'.repeat(f.size)).digest('hex').slice(0, 12) }));
  const source = new ResourceStore({ ...VOICE_MANIFEST, files: files.slice(2, 3) }, {
    caches: new MemoryCaches(), origin: ORIGIN, fetcher: async () => new Response('b'.repeat(5)),
  });
  await source.download(); const { blob } = await exportResourceZip(source);
  const env = stubEnv({ manifest: { ...VOICE_MANIFEST, files } }); t.after(env.restore);
  const mod = await import('../../public/js/resources/index.js?voice-zip-scope');
  await mod.syncResources(false, true, 'cn'); await mod.importResources(blob); await mod.startResources();
  assert.deepEqual(env.calls.fetch, [MANIFEST_URL, ...files.filter((_, i) => i !== 2).map(cacheKey)]);
  assert.equal(mod.resourceState().voiceLang, 'cn'); assert.equal(mod.resourceState().selectionComplete, true);
  assert.equal(mod.resourceState().selectedWanted, 3);
  assert.equal(mod.resourceState().groups.find((g) => g.id === 'voice_jp').present, 1);
  assert.equal((await mod.exportResources()).count, 4, 'ZIP export still includes every cached valid resource');
  await mod.syncResources(false);
});

test('changing language while preload is disabled updates selected progress without fetching assets', async (t) => {
  const env = stubEnv({ manifest: VOICE_MANIFEST }); t.after(env.restore);
  const mod = await import('../../public/js/resources/index.js?voice-disabled');
  await mod.syncResources(false, true, 'jp'); assert.deepEqual(env.calls.fetch, []);
  await mod.inspectResources(); const calls = env.calls.fetch.length;
  assert.equal(mod.resourceState().selectedWanted, 3);
  await mod.syncResources(false, true, 'none');
  assert.equal(mod.resourceState().selectedWanted, 2); assert.equal(env.calls.fetch.length, calls);
  await mod.syncResources(true, true, 'none');
  assert.ok(!env.calls.fetch.some((url) => url.includes('/voice/')));
  assert.equal(mod.resourceState().selectionComplete, true);
  await mod.syncResources(false);
});

test('restored combat defers enabled preload/inspection without changing user choice; leaving downloads latest selection', async t => {
  const env = stubEnv({ manifest: VOICE_MANIFEST }); t.after(env.restore);
  const mod = await import('../../public/js/resources/index.js?combat-restored');
  await mod.syncResourceCombat(true);
  await mod.syncResources(true, true, 'cn');
  await mod.syncResources(true, true, 'jp');
  await mod.inspectResources();
  await mod.startResources();
  assert.deepEqual(env.calls.fetch, [], 'no manifest/cache check or bulk resource request during initial combat');
  assert.equal(mod.resourceState().enabled, true);
  assert.equal(mod.resourceState().combatPaused, true);
  assert.equal(mod.resourceState().voiceLang, 'jp');
  assert.match(mod.resourceState().message, /战斗中/);
  assert.ok(env.calls.registered.length > 0, 'runtime SW remains available');
  await mod.syncResourceCombat(false);
  assert.equal(mod.resourceState().selectionComplete, true);
  assert.deepEqual(env.calls.fetch.slice(1), VOICE_FILES.filter(f => !f.url.includes('/voice/cn/')).map(cacheKey));
  await mod.syncResources(false);
});

test('entering combat aborts the optional download after essentials, keeps cached/indexed files and resumes missing only', async t => {
  const env = stubEnv(); t.after(env.restore);
  const mod = await import('../../public/js/resources/index.js?combat-download');
  const originalFetch = globalThis.fetch, started = Promise.withResolvers();
  let held = false, signal;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith(FILES[2].url) && !held) {
      held = true; signal = options.signal; started.resolve();
      await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
    }
    return originalFetch(url, options);
  };
  const run = mod.syncResources(true, true);
  await started.promise;
  await mod.syncResourceCombat(true);
  assert.equal(signal.aborted, true);
  await run;
  const before = env.calls.fetch.length;
  await mod.inspectResources();
  await mod.syncResources(true, true);
  assert.equal(env.calls.fetch.length, before, 'same settings/manager cannot restart paused bulk');
  assert.equal(mod.resourceState().phase, 'paused');
  const cache = await env.caches.open(CACHE_NAME);
  for (const file of FILES.filter(f => f.tier === 1)) assert.ok(await cache.match(cacheKey(file)), 'completed essential preserved');
  assert.ok(await cache.match(indexUrl(ORIGIN)), 'abort flushes the index');
  await mod.syncResourceCombat(false);
  assert.equal(mod.resourceState().complete, true);
  assert.ok(env.calls.fetch.slice(before).every(url => !FILES.filter(f => f.tier === 1).some(f => url.endsWith(f.url))), 'no refetch of preserved essentials');
  await mod.syncResources(false);
});

test('combat transition during a manifest/check await remains paused; exit/reentry and changed settings never revive an obsolete run', async t => {
  const env = stubEnv(); t.after(env.restore);
  const gate = Promise.withResolvers(), begun = Promise.withResolvers();
  const fetcher = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (url === MANIFEST_URL) { begun.resolve(); await gate.promise; }
    return fetcher(url, options);
  };
  const mod = await import('../../public/js/resources/index.js?combat-check-race');
  const run = mod.syncResources(true, false);
  await begun.promise;
  await mod.syncResourceCombat(true);
  const exit = mod.syncResourceCombat(false);
  await mod.syncResourceCombat(true);
  const scope = mod.syncResources(true, true);
  gate.resolve();
  await Promise.all([run, exit, scope]);
  assert.deepEqual(env.calls.fetch, [MANIFEST_URL]);
  assert.equal(mod.resourceState().combatPaused, true);
  assert.equal(mod.resourceState().phase, 'paused');
  await mod.syncResourceCombat(false);
  assert.equal(mod.resourceState().complete, true);
  await mod.syncResources(false);
});

test('manual pause, clearing and disabled preload are never undone by combat end, including settings edits', async t => {
  const env = stubEnv(); t.after(env.restore);
  const mod = await import('../../public/js/resources/index.js?combat-user-choice');
  await mod.syncResources(true, false);
  mod.pauseResources();
  await mod.syncResourceCombat(true);
  await mod.syncResources(true, true);
  const count = env.calls.fetch.length;
  await mod.syncResourceCombat(false);
  assert.equal(env.calls.fetch.length, count);
  assert.equal(mod.resourceState().manualPaused, true);
  await mod.startResources();
  assert.equal(mod.resourceState().complete, true, 'explicit resume clears manual pause');
  await mod.syncResourceCombat(true);
  await mod.clearResources();
  await mod.syncResourceCombat(false);
  assert.equal(mod.resourceState().done, 0);
  assert.equal(env.calls.fetch.length, count + 2, 'clear is not auto-refilled');
  await mod.startResources();
  assert.equal(mod.resourceState().complete, true);
  await mod.syncResourceCombat(true);
  await mod.syncResources(false);
  const disabled = env.calls.fetch.length;
  await mod.syncResourceCombat(false);
  assert.equal(mod.resourceState().enabled, false);
  assert.equal(env.calls.fetch.length, disabled);
});

test('automatic pause waits pending Cache.put/index flush before resume obtains the download lock', async t => {
  const env = stubEnv(); t.after(env.restore);
  const mod = await import('../../public/js/resources/index.js?combat-cache-write');
  const cache = await env.caches.open(CACHE_NAME), put = cache.put.bind(cache);
  const gate = Promise.withResolvers(), started = Promise.withResolvers();
  let held = false, active = 0, maxActive = 0;
  cache.put = async (key, response) => {
    if (key.endsWith(FILES[0].url) && !held) { held = true; started.resolve(); await gate.promise; }
    return put(key, response);
  };
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: {
    request: async (_name, _options, job) => {
      active++; maxActive = Math.max(maxActive, active);
      try { return await job({}); } finally { active--; }
    },
  } });
  const run = mod.syncResources(true, false);
  await started.promise;
  await mod.syncResourceCombat(true);
  const exit = mod.syncResourceCombat(false);
  assert.equal(active, 1, 'uncancellable Cache.put still owns the first lock');
  gate.resolve();
  await Promise.all([run, exit]);
  assert.equal(maxActive, 1, 'new resume cannot overlap the old writer');
  assert.ok(await cache.match(cacheKey(FILES[0])));
  const index = await (await cache.match(indexUrl(ORIGIN))).json();
  assert.ok(Object.hasOwn(index.files, cacheKey(FILES[0])));
  assert.equal(mod.resourceState().selectionComplete, true);
  await mod.syncResources(false);
});

test('successful ZIP during combat is not cancelled and enables preload but defers missing network resources until exit', async t => {
  const files = FILES.map(f => ({ ...f, hash: createHash('sha1').update('b'.repeat(f.size)).digest('hex').slice(0, 12) }));
  const source = new ResourceStore({ ...MANIFEST, files: files.slice(0, 1) }, {
    caches: new MemoryCaches(), origin: ORIGIN, fetcher: async () => new Response('b'.repeat(files[0].size)),
  });
  await source.download(); const { blob } = await exportResourceZip(source);
  const env = stubEnv({ manifest: { ...MANIFEST, files } }); t.after(env.restore);
  const mod = await import('../../public/js/resources/index.js?combat-zip');
  await mod.syncResourceCombat(true);
  let enabled = false;
  const result = await mod.importResources(blob, { onImported: () => { enabled = true; } });
  assert.equal(result.imported, 1);
  assert.equal(enabled, true);
  assert.equal(mod.resourceState().enabled, true);
  assert.equal(mod.resourceState().combatPaused, true);
  assert.deepEqual(env.calls.fetch, [MANIFEST_URL], 'ZIP can read metadata but no bulk asset download during combat');
  const out = await mod.exportResources();
  assert.equal(out.count, 1, 'manual ZIP export works during combat too');
  await mod.syncResourceCombat(false);
  assert.deepEqual(env.calls.fetch.slice(1), [cacheKey(files[1])]);
  assert.equal(mod.resourceState().selectionComplete, true);
  await mod.syncResources(false);
});

test('combat cancels deferred background verification; even a dispatched old callback cannot scan until combat ends', async t => {
  const env = stubEnv(); t.after(env.restore);
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'window'), tasks = new Map();
  let id = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setTimeout(fn, ms) { assert.equal(ms, 5000); tasks.set(++id, fn); return id; },
    clearTimeout(key) { tasks.delete(key); },
  } });
  t.after(() => { if (saved) Object.defineProperty(globalThis, 'window', saved); else delete globalThis.window; });
  const mod = await import('../../public/js/resources/index.js?combat-background');
  const cache = await env.caches.open(CACHE_NAME), index = {};
  for (const file of FILES) {
    await cache.put(cacheKey(file), new Response('b'.repeat(file.size)));
    index[cacheKey(file)] = null;
  }
  await cache.put(indexUrl(ORIGIN), new Response(JSON.stringify({ version: 1, manifest: MANIFEST.version, files: index })));
  let scans = 0; const keys = cache.keys.bind(cache);
  cache.keys = async () => { scans++; return keys(); };
  await mod.syncResources(true, false);
  assert.equal(scans, 0);
  assert.equal(tasks.size, 1);
  const old = [...tasks.values()][0];
  await mod.syncResourceCombat(true);
  assert.equal(tasks.size, 0);
  old(); // simulate an old callback already dispatched before clearTimeout
  await mod.inspectResources();
  assert.equal(scans, 0);
  assert.deepEqual(env.calls.fetch, [MANIFEST_URL]);
  await mod.syncResourceCombat(false);
  assert.equal(tasks.size, 1, 'verification is rescheduled outside battle');
  assert.equal(scans, 0, 'resume retains the fast startup index path');
  mod.pauseResources();
  await mod.syncResourceCombat(true);
  await mod.syncResourceCombat(false);
  assert.equal(tasks.size, 0, 'manual pause prevents deferred restart too');
  await mod.syncResources(false);
});

test('manual pause while automatically paused is authoritative; an existing preload error is not retried on every combat end', async t => {
  const env = stubEnv(); t.after(env.restore);
  const mod = await import('../../public/js/resources/index.js?combat-manual-during');
  await mod.syncResourceCombat(true);
  await mod.syncResources(true, false);
  mod.pauseResources();
  await mod.syncResources(true, true);
  await mod.syncResourceCombat(false);
  assert.deepEqual(env.calls.fetch, []);
  assert.equal(mod.resourceState().manualPaused, true);
  await mod.startResources();
  assert.equal(mod.resourceState().complete, true);
  await mod.syncResources(false);
  const failure = stubEnv({ fail: true });
  try {
    const failed = await import('../../public/js/resources/index.js?combat-existing-error');
    await failed.syncResources(true);
    const count = failure.calls.fetch.length;
    assert.equal(failed.resourceState().error, true);
    await failed.syncResourceCombat(true);
    await failed.syncResourceCombat(false);
    assert.equal(failure.calls.fetch.length, count);
    assert.equal(failed.resourceState().error, true);
    await failed.syncResources(false);
  } finally { failure.restore(); }
});
