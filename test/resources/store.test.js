// test/resources/store.test.js — the Cache Storage downloader (public/js/resources/store.js) and the Service Worker
// handler (public/js/resources/service.js, docs/ASSETS.md「Preload」).
//
// Cache Storage and fetch are injected: a tiny in-memory cache plus a scripted fetcher, so the tests describe exactly
// what the browser would do (order, skipping, pauses, quota) without a browser and without megabytes of fixtures.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { CACHE_NAME, CACHE_PREFIX, cacheName, indexUrl, rangeResponse } from '../../public/js/resources/common.js';
import { ResourceStore } from '../../public/js/resources/store.js';
import { handleResourceRequest } from '../../public/js/resources/service.js';
import { readRuntimeIndex, updateRuntimeIndex } from '../../public/js/resources/runtimeIndex.js';

/** Minimal Cache Storage (Cache API surface the store uses: open/keys/delete + cache.put/match/keys). */
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
  async match(url) { for (const c of this.map.values()) { const hit = await c.match(url); if (hit) return hit; } return undefined; }
}

const ORIGIN = 'https://game.example';

function manifest(files, over = {}) {
  // Every file carries a hash unless the test says otherwise (`hash: null` is the pre-hash manifest).
  const all = files.map((f, i) => (f.hash !== undefined ? f : { ...f, hash: `h${i}` }));
  const totalBytes = all.reduce((n, f) => n + (Number.isSafeInteger(f.size) ? f.size : 0), 0);
  const sized = all.filter((f) => Number.isSafeInteger(f.size)).length;
  return { format: 1, version: 'v1', count: all.length, tier1: all.filter((f) => f.tier === 1).length, sized, totalBytes: sized ? totalBytes : null, files: all, ...over };
}

/**
 * Put a file into the preload cache the way a finished run leaves it: the body plus its hash in the index. A file
 * without a hash (an older manifest) needs no index record.
 */
async function seed(caches, url, body, hash) {
  const cache = await caches.open(CACHE_NAME);
  await cache.put(url, new Response(body));
  if (hash) {
    const res = await cache.match(indexUrl(ORIGIN));
    const doc = res ? await res.json() : { version: 1, manifest: '', files: {} };
    doc.files[url] = hash;
    await cache.put(indexUrl(ORIGIN), new Response(JSON.stringify(doc)));
  }
  return cache;
}

/** The hash the server writes for these bytes (12 hex of a SHA-1): the store verifies cached entries against it. */
async function digest(body) {
  const bits = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(body));
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

/** A fetcher that answers every URL with `body.length` bytes and records the call order. */
function fetcherFor({ bodies = {}, fail = [], opaque = [], gzip = [], onCall } = {}) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push(url);
    onCall?.(url, opts);
    if (opts.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (fail.includes(url)) throw new Error('HTTP 404');
    const body = bodies[url] ?? 'x'.repeat(8);
    if (opaque.includes(url)) return { type: 'opaque', ok: true, status: 200, body: null, headers: new Headers() };
    // a gzipped transfer: fetch hands over the DECODED body while Content-Length describes the compressed bytes
    if (gzip.includes(url)) return new Response(body, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'gzip', 'Content-Length': '42' } });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': String(body.length) } });
  };
  return { fetch, calls };
}

const store = (m, extra = {}) => new ResourceStore(m, { caches: extra.caches ?? new MemoryCaches(), fetcher: extra.fetch, origin: ORIGIN, smallLanes: extra.smallLanes ?? 4, bigLanes: extra.bigLanes ?? 1, now: extra.now });

describe('ResourceStore', () => {
  test('fast status reads indexes without enumerating keys; full verification repairs evicted records', async () => {
    const caches = new MemoryCaches();
    const key = `${ORIGIN}/assets/a.png`;
    const cache = await seed(caches, key, 'a', 'h0');
    const s = store(manifest([{ url: '/assets/a.png', tier: 1, size: 1 }]), { caches });
    const keys = cache.keys.bind(cache);
    let scans = 0;
    cache.keys = async () => { scans++; return keys(); };
    assert.equal((await s.status({ verifyCache: false })).count, 1);
    assert.equal(scans, 0, 'startup does not enumerate Cache Storage');
    await cache.delete(key);
    assert.equal((await s.status({ verifyCache: false })).cacheVerified, false);
    const verified = await s.status();
    assert.equal(verified.count, 0);
    await s.reconcileRuntimeIndex(verified);
    assert.equal((await s.status({ verifyCache: false })).count, 0, 'repair removes evicted preload records');
    assert.equal(scans, 1);
  });

  test('runtime metadata merges concurrently without overwriting preload fingerprints', async () => {
    const caches = new MemoryCaches();
    const a = `${ORIGIN}/assets/a.png`, b = `${ORIGIN}/assets/b.png`, c = `${ORIGIN}/assets/c.png`;
    const cache = await seed(caches, a, 'a', 'h0');
    await Promise.all([
      updateRuntimeIndex(cache, ORIGIN, { add: [b] }),
      updateRuntimeIndex(cache, ORIGIN, { add: [c] }),
    ]);
    assert.deepEqual(Object.keys(await readRuntimeIndex(cache, ORIGIN)).sort(), [b, c]);
    assert.equal((await (await cache.match(indexUrl(ORIGIN))).json()).files[a], 'h0');
    const s = store(manifest([
      { url: '/assets/a.png', tier: 1, size: 1 },
      { url: '/assets/b.png', tier: 2, size: 1 },
      { url: '/assets/c.png', tier: 2, size: 1 },
    ]), { caches });
    assert.equal((await s.status({ verifyCache: false })).count, 3);
    const verified = await s.status();
    await s.reconcileRuntimeIndex(verified);
    assert.deepEqual(await readRuntimeIndex(cache, ORIGIN), {}, 'full check removes evicted runtime metadata');
  });

  test('full verification never reuses an in-flight provisional index check', async () => {
    const caches = new MemoryCaches();
    const cache = await seed(caches, `${ORIGIN}/assets/a.png`, 'a', 'h0');
    await cache.delete(`${ORIGIN}/assets/a.png`);
    const s = store(manifest([{ url: '/assets/a.png', tier: 1, size: 1 }]), { caches });
    const [fast, actual] = await Promise.all([s.status({ verifyCache: false }), s.status()]);
    assert.equal(fast.count, 1);
    assert.equal(actual.count, 0);
    assert.equal(actual.cacheVerified, true);
  });

  test('full inspection migrates legacy unindexed runtime entries to the fast metadata index', async () => {
    const caches = new MemoryCaches();
    const cache = await caches.open(CACHE_NAME);
    await cache.put(`${ORIGIN}/assets/a.png`, new Response('a'));
    const s = store(manifest([{ url: '/assets/a.png', tier: 1, size: 1 }]), { caches });
    assert.equal((await s.status({ verifyCache: false })).count, 0);
    await s.reconcileRuntimeIndex(await s.status());
    assert.equal((await s.status({ verifyCache: false })).count, 1);
    await s.prune();
    assert.equal((await s.status({ verifyCache: false })).count, 1, 'prune preserves the runtime metadata entry');
  });

  test('metadata repair does not relabel known stale bytes as unindexed runtime art', async () => {
    const caches = new MemoryCaches();
    const key = `${ORIGIN}/assets/a.png`;
    const cache = await seed(caches, key, 'old', 'old-hash');
    await updateRuntimeIndex(cache, ORIGIN, { add: [key] });
    const s = store(manifest([{ url: '/assets/a.png', tier: 1, size: 3, hash: 'new-hash' }]), { caches });
    await s.reconcileRuntimeIndex(await s.status());
    assert.equal((await s.status()).count, 0);
    assert.equal((await s.status({ verifyCache: false })).count, 0);
    await s.pruneStale();
    assert.equal((await s.status({ verifyCache: false })).count, 0);
    assert.equal(await cache.match(key), undefined);
  });

  test('simultaneous status checks share cache metadata reads; later checks detect actual eviction', async () => {
    const m = manifest([{ url: '/assets/a.png', tier: 1, size: 1 }]);
    const caches = new MemoryCaches();
    await seed(caches, `${ORIGIN}/assets/a.png`, 'a', 'h0');
    const cache = await caches.open(CACHE_NAME);
    const keys = cache.keys.bind(cache);
    const match = cache.match.bind(cache);
    const keysStarted = Promise.withResolvers();
    const indexStarted = Promise.withResolvers();
    const release = Promise.withResolvers();
    let keyReads = 0;
    let indexReads = 0;
    cache.keys = async () => { keyReads++; keysStarted.resolve(); await release.promise; return keys(); };
    cache.match = async (key) => { indexReads++; indexStarted.resolve(); await release.promise; return match(key); };
    const s = store(m, { caches });
    const pending = [s.status(), s.status(), s.status()];
    await Promise.all([keysStarted.promise, indexStarted.promise]);
    assert.deepEqual([keyReads, indexReads], [1, 2], 'key enumeration and both metadata indexes start in parallel, once');
    release.resolve();
    const [a, b, c] = await Promise.all(pending);
    assert.deepEqual([a.count, b.count, c.count], [1, 1, 1]);
    a.present.clear();
    a.groups[0].present = 99;
    assert.equal(b.present.size, 1);
    assert.equal(b.groups[0].present, 1);
    await cache.delete(`${ORIGIN}/assets/a.png`);
    assert.equal((await s.status()).count, 0, 'status results are not permanently cached');
    assert.deepEqual([keyReads, indexReads], [2, 4]);
  });

  test('a failed metadata check does not leave a rejected status promise cached', async () => {
    const caches = new MemoryCaches();
    const cache = await caches.open(CACHE_NAME);
    const keys = cache.keys.bind(cache);
    cache.keys = async () => { throw new Error('cache keys unavailable'); };
    const s = store(manifest([{ url: '/assets/a.png', tier: 1, size: 1 }]), { caches });
    await assert.rejects(s.status(), /cache keys unavailable/);
    cache.keys = keys;
    assert.equal((await s.status()).count, 0);
  });

  test('status reports what is cached, in files and bytes', async () => {
    const m = manifest([{ url: '/assets/a.png', tier: 1, size: 10 }, { url: '/assets/b.png', tier: 2, size: 20 }, { url: '/assets/c.png', tier: 2, size: 30 }]);
    const caches = new MemoryCaches();
    const s = store(m, { caches });
    const empty = await s.status();
    assert.deepEqual([empty.count, empty.total, empty.bytes, empty.complete, empty.tier1, empty.tier1Present], [0, 3, 0, false, 1, 0]);
    await seed(caches, `${ORIGIN}/assets/a.png`, '0123456789', 'h0');
    const one = await s.status();
    assert.deepEqual([one.count, one.bytes, one.tier1Present, one.complete], [1, 10, 1, false]);
    // …and a cached file of another revision does not count as current
    await seed(caches, `${ORIGIN}/assets/b.png`, 'stale-bytes', 'an-old-digest');
    const stale = await s.status();
    assert.deepEqual([stale.count, stale.complete], [1, false], 'the cached bytes belong to an older revision');
  });

  test('runtime-cached entries without a preload index record appear in resource lists', async () => {
    const m = manifest([
      { url: '/assets/char/runtime.png', tier: 1, size: 12, hash: 'runtime-hash' },
      { url: '/assets/audio/runtime.mp3', tier: 2, size: 8, hash: 'runtime-audio' },
    ]);
    const caches = new MemoryCaches();
    const cache = await caches.open(CACHE_NAME);
    await cache.put(`${ORIGIN}/assets/char/runtime.png`, new Response('runtime-image'));
    await cache.put(`${ORIGIN}/assets/audio/runtime.mp3`, new Response('runtime-audio'));
    const status = await store(m, { caches }).status();
    assert.deepEqual([status.count, status.tier1Present, status.tier2Present, status.complete], [2, 1, 1, true]);
  });

  test('downloads the essential tier first, then the rest, skipping what is cached', async () => {
    const m = manifest([
      { url: '/assets/ui/a.png', tier: 1, size: 8 },
      { url: '/assets/avatar/b.png', tier: 1, size: 8 },
      { url: '/assets/spine/c.skel', tier: 2, size: 8 },
      { url: '/assets/spine/d.png', tier: 2, size: 8 },
    ]);
    const caches = new MemoryCaches();
    await seed(caches, `${ORIGIN}/assets/avatar/b.png`, 'cached!!', 'h1');
    const { fetch, calls } = fetcherFor();
    const s = store(m, { caches, fetch });
    const seen = [];
    const res = await s.download({ onProgress: (p) => seen.push(p) });
    assert.deepEqual(calls, [`${ORIGIN}/assets/ui/a.png`, `${ORIGIN}/assets/spine/c.skel`, `${ORIGIN}/assets/spine/d.png`], 'cached file skipped, essential first');
    assert.equal(res.complete, true);
    assert.deepEqual([res.count, res.total, res.bytes, res.totalBytes, res.failed], [4, 4, 32, 32, 0]);
    assert.equal(seen.at(-1).complete, true);
    assert.equal(seen.at(-1).count, 4);
    // every progress payload carries the same counters as status(): the panel must never read an undefined field
    for (const p of seen) {
      for (const k of ['count', 'total', 'wanted', 'bytes', 'skipped', 'sized', 'sizedTotal', 'tier1', 'tier1Present', 'tier2', 'tier2Present']) {
        assert.equal(typeof p[k], 'number', `progress.${k} while ${p.phase} (${JSON.stringify(p[k])})`);
      }
    }
    assert.equal(seen.at(-1).sizedTotal, 4, 'the manifest sized every file');
    assert.equal(seen.at(-1).count, 4);
    const cached = await (await caches.open(CACHE_NAME)).match(`${ORIGIN}/assets/spine/c.skel`);
    assert.equal(await cached.text(), 'x'.repeat(8));
    assert.equal(cached.headers.get('x-sp-resource'), '1', 'entries are marked as ours');
    assert.equal(cached.headers.get('accept-ranges'), 'bytes');
    assert.equal(cached.headers.get('content-length'), '8', 'an uncompressed response keeps its exact length');
  });

  test('a gzip response never keeps the compressed Content-Length (it would truncate the stored body)', async () => {
    const m = manifest([{ url: '/assets/spine/a.skel', tier: 1, size: 8 }]);
    const caches = new MemoryCaches();
    const { fetch } = fetcherFor({ gzip: [`${ORIGIN}/assets/spine/a.skel`] });
    const s = store(m, { caches, fetch });
    const res = await s.download();
    assert.equal(res.failed, 0);
    const cached = await (await caches.open(CACHE_NAME)).match(`${ORIGIN}/assets/spine/a.skel`);
    assert.equal(cached.headers.get('content-length'), null, 'fetch reports the compressed size (42) for a longer body');
    assert.equal(cached.headers.get('content-encoding'), null, 'the stored body is already decoded');
    assert.equal(cached.headers.get('content-type'), 'application/octet-stream', 'the type still follows the file');
    assert.equal(await cached.text(), 'x'.repeat(8));
  });

  test('two passes (tiers) can be run one after the other, as the controller does', async () => {
    const m = manifest([{ url: '/assets/ui/a.png', tier: 1, size: 8 }, { url: '/assets/spine/b.skel', tier: 2, size: 8 }]);
    const { fetch, calls } = fetcherFor();
    const s = store(m, { fetch });
    await s.download({ tiers: [1] });
    assert.deepEqual(calls, [`${ORIGIN}/assets/ui/a.png`]);
    const rest = await s.download({ tiers: [2] });
    assert.deepEqual(calls, [`${ORIGIN}/assets/ui/a.png`, `${ORIGIN}/assets/spine/b.skel`]);
    assert.equal(rest.complete, true);
  });

  test('a single failure is collected, not fatal; an opaque response is a failure too', async () => {
    const m = manifest([{ url: '/assets/a.png', tier: 1, size: 8 }, { url: '/assets/b.png', tier: 1, size: 8 }, { url: '/assets/c.png', tier: 1, size: 8 }]);
    const { fetch } = fetcherFor({ fail: [`${ORIGIN}/assets/a.png`], opaque: [`${ORIGIN}/assets/b.png`] });
    const s = store(m, { fetch });
    const res = await s.download();
    assert.equal(res.failed, 2);
    assert.equal(res.count, 1);
    assert.equal(res.complete, false);
    assert.deepEqual(res.failures.map((f) => f.url), ['/assets/a.png', '/assets/b.png'], 'the manifest keeps the original URL');
    assert.match(res.failures[0].message, /404/);
    assert.match(res.failures[1].message, /CORS/);
  });

  test('an abort stops the run and keeps what was already stored', async () => {
    const files = Array.from({ length: 12 }, (_, i) => ({ url: `/assets/f${i}.png`, tier: 1, size: 8 }));
    const ac = new AbortController();
    let seen = 0;
    const { fetch, calls } = fetcherFor({ onCall: () => { if (++seen > 3) ac.abort(); } });
    const s = store(manifest(files), { fetch, smallLanes: 1 });
    await assert.rejects(() => s.download({ signal: ac.signal }), (err) => err.name === 'AbortError');
    assert.ok(calls.length <= 5, `stopped early (${calls.length} requests)`);
    const st = await s.status();
    assert.ok(st.count >= 3 && st.count < 12, `kept the finished files (${st.count})`);
  });

  test('a quota failure is reported as such (the UI tells the player, it does not retry 4 000 times)', async () => {
    const m = manifest([{ url: '/assets/a.png', tier: 1, size: 8 }]);
    const caches = new MemoryCaches();
    const cache = await caches.open(CACHE_NAME);
    cache.put = async () => { const err = new Error('The quota has been exceeded.'); err.name = 'QuotaExceededError'; throw err; };
    const { fetch } = fetcherFor();
    const s = store(m, { caches, fetch });
    await assert.rejects(() => s.download(), (err) => err.name === 'QuotaExceededError');
  });

  test('a failed concurrent preload waits for started writes and persists their index before rejecting', async () => {
    const m = manifest([
      { url: '/assets/a.png', tier: 1, size: 8 },
      { url: '/assets/b.png', tier: 1, size: 8 },
      { url: '/assets/c.png', tier: 1, size: 8 },
    ]);
    const caches = new MemoryCaches();
    const cache = await caches.open(CACHE_NAME);
    const put = cache.put.bind(cache);
    const started = Promise.withResolvers(), release = Promise.withResolvers(), quotaRaised = Promise.withResolvers();
    cache.put = async (key, response) => {
      if (key.endsWith('/a.png')) { started.resolve(); await release.promise; }
      if (key.endsWith('/b.png')) {
        await started.promise;
        quotaRaised.resolve();
        throw new DOMException('', 'QuotaExceededError');
      }
      await put(key, response);
    };
    const { fetch, calls } = fetcherFor();
    const s = store(m, { caches, fetch, smallLanes: 2 });
    let settled = false;
    const downloading = s.download();
    downloading.then(() => { settled = true; }, () => { settled = true; });
    await quotaRaised.promise;
    await new Promise(setImmediate);
    const earlySettlement = settled;
    release.resolve();
    await assert.rejects(downloading, { name: 'QuotaExceededError' });
    assert.equal(earlySettlement, false, 'preload keeps the resource lock until every started write settles');
    assert.equal((await s.status({ verifyCache: false })).count, 1, 'the late successful put is indexed');
    assert.equal(calls.includes(`${ORIGIN}/assets/c.png`), false, 'failure prevents a lane from starting another file');
  });

  test('preload already downloads four small resources concurrently and supports configured lane counts', async () => {
    for (const lanes of [undefined, 8]) {
      const files = Array.from({ length: 12 }, (_, i) => ({ url: `/assets/${i}.png`, tier: 1, size: 8 }));
      let active = 0, maxActive = 0;
      const fetch = async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return new Response('xxxxxxxx');
      };
      const s = store(manifest(files), { fetch, smallLanes: lanes });
      const result = await s.download();
      assert.equal(maxActive, lanes ?? 4);
      assert.equal(result.downloaded, files.length);
      assert.equal((await s.status({ verifyCache: false })).count, files.length);
    }
  });

  test('files bigger than the cap are skipped, never fetched', async () => {
    const m = manifest([{ url: '/assets/small.png', tier: 1, size: 8 }, { url: '/assets/huge.png', tier: 2, size: 25 * 1024 * 1024 }]);
    const { fetch, calls } = fetcherFor();
    const s = store(m, { fetch });
    const res = await s.download();
    assert.deepEqual(calls, [`${ORIGIN}/assets/small.png`]);
    assert.equal(res.skipped, 1);
    assert.equal(res.complete, true, 'the skipped file does not keep the preload incomplete');
  });

  test('progress is throttled but always ends with the final state', async () => {
    const files = Array.from({ length: 30 }, (_, i) => ({ url: `/assets/f${i}.png`, tier: 1, size: 8 }));
    let t = 0;
    const { fetch } = fetcherFor();
    const s = store(manifest(files), { fetch, smallLanes: 4, now: () => (t += 10) });
    const seen = [];
    const res = await s.download({ onProgress: (p) => seen.push(p) });
    assert.ok(seen.length < files.length, `throttled (${seen.length} updates for ${files.length} files)`);
    assert.equal(res.count, 30);
    assert.equal(seen[0].count, 0);
    assert.equal(seen.at(-1).phase, 'ready');
    assert.equal(seen.at(-1).count, res.count);
    assert.ok(seen.every((p, i) => i === 0 || p.count >= seen[i - 1].count), 'monotonic');
  });

  test('clear deletes every version, pruneOld only the stale ones', async () => {
    const m = manifest([{ url: '/assets/a.png', tier: 1, size: 8 }]);
    const caches = new MemoryCaches();
    await (await caches.open(CACHE_NAME)).put(`${ORIGIN}/assets/a.png`, new Response('old'));
    await (await caches.open(cacheName('v1'))).put(`${ORIGIN}/assets/legacy.png`, new Response('pre-hash layout'));
    await (await caches.open(cacheName('v0'))).put(`${ORIGIN}/assets/removed.png`, new Response('ancient'));
    await caches.open('unrelated-cache');
    const s = store(m, { caches, fetch: fetcherFor().fetch });
    assert.deepEqual((await s.pruneOld()).sort(), [`${CACHE_PREFIX}v0`, `${CACHE_PREFIX}v1`].sort());
    assert.deepEqual(await caches.keys(), [CACHE_NAME, 'unrelated-cache']);
    const after = await s.clear();
    assert.deepEqual(await caches.keys(), ['unrelated-cache'], 'other caches of the origin are never touched');
    assert.equal(after.count, 0);
  });

  test('an unchanged manifest downloads nothing at all', async () => {
    const m = manifest([{ url: '/assets/a.png', tier: 1, size: 8 }, { url: '/assets/b.png', tier: 2, size: 8 }]);
    const caches = new MemoryCaches();
    await seed(caches, `${ORIGIN}/assets/a.png`, 'aaa', 'h0');
    await seed(caches, `${ORIGIN}/assets/b.png`, 'bbb', 'h1');
    const { fetch, calls } = fetcherFor();
    const s = store(m, { caches, fetch });
    const res = await s.download();
    assert.deepEqual(calls, [], 'the hashes match: nothing is fetched');
    assert.equal(res.complete, true);
    assert.deepEqual([res.count, res.bytes], [2, 16]);
  });

  test('only the file whose hash changed is fetched again, and its bytes are replaced', async () => {
    const m = manifest([{ url: '/assets/a.png', tier: 1, size: 8 }, { url: '/assets/b.png', tier: 1, size: 8 }]);
    const caches = new MemoryCaches();
    await seed(caches, `${ORIGIN}/assets/a.png`, 'same-bytes', 'h0');
    await seed(caches, `${ORIGIN}/assets/b.png`, 'old-bytes', 'an-old-digest');
    const { fetch, calls } = fetcherFor({ bodies: { [`${ORIGIN}/assets/b.png`]: 'new-bytes' } });
    const s = store(m, { caches, fetch });
    const res = await s.download();
    assert.deepEqual(calls, [`${ORIGIN}/assets/b.png`]);
    assert.equal(res.complete, true, 'the replaced file closes the set');
    const cache = await caches.open(CACHE_NAME);
    assert.equal(await (await cache.match(`${ORIGIN}/assets/b.png`)).text(), 'new-bytes');
    assert.equal(await (await cache.match(`${ORIGIN}/assets/a.png`)).text(), 'same-bytes', 'the current file is left alone');
    const index = await (await cache.match(indexUrl(ORIGIN))).json();
    assert.deepEqual(index.files, { [`${ORIGIN}/assets/a.png`]: 'h0', [`${ORIGIN}/assets/b.png`]: 'h1' });
  });

  test('a file the manifest dropped is pruned, index record included', async () => {
    const m = manifest([{ url: '/assets/a.png', tier: 1, size: 8 }]);
    const caches = new MemoryCaches();
    await seed(caches, `${ORIGIN}/assets/a.png`, 'aaa', 'h0');
    await seed(caches, `${ORIGIN}/assets/gone.png`, 'orphan', 'old');
    const s = store(m, { caches, fetch: fetcherFor().fetch });
    assert.deepEqual(await s.prune(), { caches: [], files: 1 });
    const cache = await caches.open(CACHE_NAME);
    assert.equal(await cache.match(`${ORIGIN}/assets/gone.png`), undefined);
    assert.equal(await cache.match(`${ORIGIN}/assets/a.png`) !== undefined, true, 'the listed file stays');
    const index = await (await cache.match(indexUrl(ORIGIN))).json();
    assert.deepEqual(Object.keys(index.files), [`${ORIGIN}/assets/a.png`]);
  });

  test('a manifest without hashes keeps the old rule: whatever is cached counts as current', async () => {
    const m = manifest([{ url: '/assets/a.png', tier: 1, size: 8, hash: null }, { url: '/assets/b.png', tier: 1, size: 8, hash: null }]);
    const caches = new MemoryCaches();
    await seed(caches, `${ORIGIN}/assets/a.png`, 'aaa', null);
    const { fetch, calls } = fetcherFor();
    const s = store(m, { caches, fetch });
    const res = await s.download();
    assert.deepEqual(calls, [`${ORIGIN}/assets/b.png`]);
    assert.equal(res.complete, true);
  });

  test('a cache of the previous layout is migrated, not re-downloaded', async () => {
    const bodies = { '/assets/a.png': 'aaa-bytes', '/assets/b.png': 'bbb-bytes-longer' };
    const files = [];
    for (const [url, body] of Object.entries(bodies)) files.push({ url, tier: 1, size: body.length, hash: await digest(body) });
    const m = manifest(files);
    const caches = new MemoryCaches();
    const legacy = await caches.open(cacheName('v1')); // the pre-hash layout: no index, no recorded hashes
    for (const [url, body] of Object.entries(bodies)) await legacy.put(`${ORIGIN}${url}`, new Response(body));
    const { fetch, calls } = fetcherFor();
    const s = store(m, { caches, fetch });
    const res = await s.download();
    assert.deepEqual(calls, [], 'every file was verified against its hash and moved: no network at all');
    assert.equal(res.adopted, 2);
    assert.equal(res.downloaded, 0);
    assert.equal(res.complete, true);
    assert.equal(await (await (await caches.open(CACHE_NAME)).match(`${ORIGIN}/assets/a.png`)).text(), 'aaa-bytes');
    assert.deepEqual(await caches.keys(), [CACHE_NAME], 'the emptied old cache is dropped once the set is complete');
    // and the migrated set is simply current next time (the index was written as the files moved)
    const again = await store(manifest(files), { caches, fetch: fetcherFor().fetch }).download();
    assert.equal(again.complete, true);
    assert.equal(again.adopted, 0);
  });

  test('a stale entry in an old cache is dropped and fetched, never left to shadow the new file', async () => {
    const fresh = 'new-bytes';
    const m = manifest([{ url: '/assets/a.png', tier: 1, size: fresh.length, hash: await digest(fresh) }]);
    const caches = new MemoryCaches();
    await (await caches.open(cacheName('v1'))).put(`${ORIGIN}/assets/a.png`, new Response('old-bytes'));
    const { fetch, calls } = fetcherFor({ bodies: { [`${ORIGIN}/assets/a.png`]: fresh } });
    const s = store(m, { caches, fetch });
    const res = await s.download();
    assert.deepEqual(calls, [`${ORIGIN}/assets/a.png`], 'the stored bytes do not match the manifest hash');
    assert.deepEqual([res.adopted, res.downloaded], [0, 1]);
    assert.deepEqual(await caches.keys(), [CACHE_NAME], 'the stale copy went with the old cache');
    assert.equal(await (await (await caches.open(CACHE_NAME)).match(`${ORIGIN}/assets/a.png`)).text(), fresh);
  });

  test('a download is verified: bytes a stale Service Worker would hand back are re-asked for', async () => {
    const fresh = 'fresh-bytes';
    const hash = await digest(fresh);
    const m = manifest([{ url: '/assets/a.png', tier: 1, size: fresh.length, hash }]);
    const caches = new MemoryCaches();
    // the first answer is what an older worker's cache would return; the retry carries a query no entry matches
    const { fetch, calls } = fetcherFor({ bodies: { [`${ORIGIN}/assets/a.png`]: 'stale-bytes', [`${ORIGIN}/assets/a.png?sp=${hash}`]: fresh } });
    const s = store(m, { caches, fetch });
    const res = await s.download();
    assert.equal(calls.length, 2, `asked twice (${calls.join(' , ')})`);
    assert.match(calls[1], /\?sp=/);
    assert.equal(res.failed, 0);
    assert.equal(res.adopted, 0);
    assert.equal(res.downloaded, 1);
    assert.equal(await (await (await caches.open(CACHE_NAME)).match(`${ORIGIN}/assets/a.png`)).text(), fresh, 'the canonical key holds the verified bytes');
  });

  test('a synthetic hash is never verified against cached bytes (there is nothing to compare)', async () => {
    const m = manifest([{ url: '/assets/a.png', tier: 1, size: 8, hash: 'syn-07572a8a157e' }]);
    const caches = new MemoryCaches();
    await (await caches.open(cacheName('v1'))).put(`${ORIGIN}/assets/a.png`, new Response('whatever'));
    const { fetch, calls } = fetcherFor();
    const res = await store(m, { caches, fetch }).download();
    assert.deepEqual(calls, [`${ORIGIN}/assets/a.png`]);
    assert.equal(res.adopted, 0);
    assert.equal(res.downloaded, 1);
  });

  test('an incomplete CDN update cannot endorse old bytes under the new audio fingerprint', async () => {
    const url = '/assets/audio/voice/cn/a.mp3', old = 'old-audio', fresh = 'new-audio';
    const oldHash = await digest(old), hash = await digest(fresh);
    const caches = new MemoryCaches();
    const cache = await seed(caches, ORIGIN + url, old, oldHash);
    const { fetch, calls } = fetcherFor({ bodies: {
      [ORIGIN + url]: old, [`${ORIGIN}${url}?sp=${hash}`]: old,
    } });
    const s = store(manifest([{ url, tier: 2, size: fresh.length, hash }]), { caches, fetch });
    const result = await s.download({ tiers: [2] });
    assert.equal(result.failed, 1);
    assert.equal(result.downloaded, 0);
    assert.equal(calls.length, 2);
    assert.equal(await (await cache.match(ORIGIN + url)).text(), old);
    assert.equal((await (await cache.match(indexUrl(ORIGIN))).json()).files[ORIGIN + url], oldHash);
    assert.equal(result.complete, false);
  });

  test('an interrupted run keeps the progress it flushed', async () => {
    const files = Array.from({ length: 70 }, (_, i) => ({ url: `/assets/f${i}.png`, tier: 1, size: 8 }));
    const ac = new AbortController();
    let seen = 0;
    const { fetch } = fetcherFor({ onCall: () => { if (++seen > 66) ac.abort(); } });
    const caches = new MemoryCaches();
    const s = store(manifest(files), { caches, fetch, smallLanes: 1 });
    await assert.rejects(() => s.download({ signal: ac.signal }), (err) => err.name === 'AbortError');
    const st = await s.status();
    assert.ok(st.count >= 64 && st.count <= 66, `the index was flushed mid-run (${st.count} kept)`);
    const calls2 = fetcherFor().calls;
    const s2 = store(manifest(files), { caches, fetch: fetcherFor({ onCall: (u) => calls2.push(u) }).fetch });
    await s2.download();
    assert.ok(calls2.length <= 6, `the next run only fetches the remainder (${calls2.length})`);
  });

  test('a second download while one is running is the same promise (no double run)', async () => {
    const m = manifest([{ url: '/assets/a.png', tier: 1, size: 8 }]);
    let release;
    const gate = new Promise((r) => { release = r; });
    const { fetch, calls } = fetcherFor({ onCall: () => gate });
    const s = store(m, { fetch });
    const a = s.download();
    const b = s.download();
    assert.equal(a, b);
    release();
    const res = await a;
    assert.equal(calls.length, 1);
    assert.equal(res.count, 1);
  });

  test('a transport pack imports package-authenticated bytes and commits the manifest index without per-file hashing', async () => {
    const bytes = new TextEncoder().encode('package authenticated image');
    const f = { url: '/assets/pack/a.png', tier: 1, size: bytes.byteLength, hash: await digest('package authenticated image') };
    const caches = new MemoryCaches();
    const s = store(manifest([f]), { caches });
    const progress = [];
    const result = await s.importTransportPack([{ file: s.files[0], bytes }], { onProgress: (p) => progress.push(p) });
    assert.equal(result.imported, 1);
    assert.deepEqual(progress.map((p) => [p.done, p.total]), [[0, 1], [1, 1]]);
    const cache = await caches.open(CACHE_NAME);
    assert.equal(await (await cache.match(`${ORIGIN}${f.url}`)).text(), 'package authenticated image');
    const index = await (await cache.match(indexUrl(ORIGIN))).json();
    assert.equal(index.files[`${ORIGIN}${f.url}`], f.hash);
    assert.equal((await s.importTransportPack([{ file: s.files[0], bytes }])).imported, 0);
  });
});

describe('the Service Worker handler', () => {
  test('failed resource writes never enqueue phantom runtime metadata', async (t) => {
    const caches = new MemoryCaches();
    const cache = await caches.open(CACHE_NAME);
    const key = `${ORIGIN}/assets/runtime/quota.png`;
    cache.put = async () => { throw new DOMException('', 'QuotaExceededError'); };
    t.mock.method(console, 'warn', () => {});
    const waits = [];
    const response = await handleResourceRequest(new Request(key), {
      caches, fetcher: async () => new Response('image'), waitUntil: (task) => waits.push(task),
    });
    assert.equal(await response.text(), 'image');
    await Promise.all(waits);
    assert.deepEqual(await readRuntimeIndex(cache), {});
    assert.equal(cache.entries.size, 0);
  });

  test('fetch lifetime and shared lock remain active through the batch flush; clear cannot race it', async (t) => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    let activeShared = 0;
    const locks = {
      async request(name, opts, job) {
        if (name !== 'stronghold-resources-preload') return job({ name });
        if (opts.mode === 'shared') {
          activeShared++;
          try { return await job({ name }); } finally { activeShared--; }
        }
        return job(activeShared ? null : { name });
      },
    };
    Object.defineProperty(globalThis, 'navigator', { value: { locks }, configurable: true });
    t.after(() => { if (saved) Object.defineProperty(globalThis, 'navigator', saved); else delete globalThis.navigator; });
    const caches = new MemoryCaches();
    const waits = [];
    const responses = await Promise.all([1, 2].map((i) =>
      handleResourceRequest(new Request(`${ORIGIN}/assets/runtime/locked-${i}.png`), {
        caches, fetcher: async () => new Response('image'), waitUntil: (task) => waits.push(task),
      })));
    assert.equal(waits.length, 2);
    assert.equal(activeShared, 2);
    assert.equal(await locks.request('stronghold-resources-preload', { ifAvailable: true }, (lock) => !!lock), false);
    assert.equal(await responses[0].text(), 'image', 'network reply is usable while metadata is pending');
    await Promise.all(waits);
    assert.equal(activeShared, 0, 'waitUntil covers index persistence, not only Cache.put');
    await locks.request('stronghold-resources-preload', { ifAvailable: true }, async (lock) => {
      assert.ok(lock);
      await caches.delete(CACHE_NAME);
    });
    assert.deepEqual(await caches.keys(), [], 'no deferred index task recreates the cleared cache');
  });

  test('runtime writes clone before browser consumption and record metadata only after Cache.put succeeds', async () => {
    const caches = new MemoryCaches();
    const cache = await caches.open(CACHE_NAME);
    const open = caches.open.bind(caches);
    const gate = Promise.withResolvers();
    let opens = 0;
    caches.open = async (...args) => {
      if (++opens > 1) await gate.promise; // lookup can finish; only the background writer waits
      return open(...args);
    };
    const key = `${ORIGIN}/assets/runtime/consume.png`;
    const waits = [];
    const response = await handleResourceRequest(new Request(key), {
      caches, fetcher: async () => new Response('runtime-body'), waitUntil: (task) => waits.push(task),
    });
    assert.equal(await response.text(), 'runtime-body', 'the browser can consume before cache.open resolves');
    gate.resolve();
    await Promise.all(waits);
    assert.equal(await (await cache.match(key)).text(), 'runtime-body');
    const runtime = await readRuntimeIndex(cache);
    assert.ok(Object.hasOwn(runtime, key));
    assert.equal(await cache.match(indexUrl()), undefined, 'SW never rewrites the preload fingerprint index');
  });
  const cached = async () => {
    const caches = new MemoryCaches();
    await (await caches.open(CACHE_NAME)).put(`${ORIGIN}/assets/a.png`, new Response('0123456789', { headers: { 'Content-Type': 'image/png' } }));
    return caches;
  };

  test('serves a cached resource, with ranges', async () => {
    const caches = await cached();
    const full = await handleResourceRequest(new Request(`${ORIGIN}/assets/a.png`), { caches });
    assert.equal(full.status, 200);
    assert.equal(await full.text(), '0123456789');
    const part = await handleResourceRequest(new Request(`${ORIGIN}/assets/a.png`, { headers: { Range: 'bytes=2-4' } }), { caches });
    assert.equal(part.status, 206);
    assert.equal(await part.text(), '234');
    assert.equal(part.headers.get('content-range'), 'bytes 2-4/10');
  });

  test('a CDN URL is answered from the cache as well (the resource may live elsewhere)', async () => {
    const caches = new MemoryCaches();
    const url = 'https://cdn.example.com/static/assets/spine/x.skel';
    // a cache of the pre-hash layout: the worker serves from every cache this app wrote, so an update never blanks out
    await (await caches.open(cacheName('legacy'))).put(url, new Response('skel-bytes'));
    const res = await handleResourceRequest(new Request(url), { caches });
    assert.equal(await res.text(), 'skel-bytes');
  });

  test('the current cache wins over an older one (a migrated file is never shadowed by a stale copy)', async () => {
    const caches = new MemoryCaches();
    await (await caches.open(cacheName('v1'))).put(`${ORIGIN}/assets/a.png`, new Response('stale'));
    await (await caches.open(CACHE_NAME)).put(`${ORIGIN}/assets/a.png`, new Response('fresh'));
    const res = await handleResourceRequest(new Request(`${ORIGIN}/assets/a.png`), { caches });
    assert.equal(await res.text(), 'fresh');
  });

  test('the extension-less audio route is answered from the canonical file the manifest lists', async () => {
    const caches = new MemoryCaches();
    await (await caches.open(CACHE_NAME)).put(`${ORIGIN}/assets/audio/bgm/act1.mp3`, new Response('mp3-bytes', { headers: { 'Content-Type': 'audio/mpeg' } }));
    // Since 0.1.2 the game asks for audio as /media/bgm/act1 (download managers hijack *.mp3 requests, shared/media.js);
    // what the preload stored is the canonical /assets/audio/bgm/act1.mp3 the manifest lists.
    const res = await handleResourceRequest(new Request(`${ORIGIN}/media/bgm/act1`), { caches });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'audio/mpeg', 'the stored type is what Web Audio sniffs');
    assert.equal(await res.text(), 'mp3-bytes');
  });

  test('the audio route tries the extensions in the server order, and gives up like the server does', async () => {
    const caches = new MemoryCaches();
    await (await caches.open(CACHE_NAME)).put(`${ORIGIN}/assets/audio/bgm/act1.ogg`, new Response('ogg-bytes'));
    assert.equal(await (await handleResourceRequest(new Request(`${ORIGIN}/media/bgm/act1`), { caches })).text(), 'ogg-bytes', 'a later candidate still hits');
    assert.equal(await handleResourceRequest(new Request(`${ORIGIN}/media/bgm/act2`), { caches }), null, 'nothing stored → the network answers');
    assert.equal(await handleResourceRequest(new Request(`${ORIGIN}/media/../data/assets.json`), { caches }), null, 'a dot segment is refused, as serveMedia refuses it');
    assert.equal(await handleResourceRequest(new Request(`${ORIGIN}/media/bgm/act1.png`), { caches }), null, 'not an audio extension: the name keeps its tail, so no entry matches');
  });

  test('anything that is not a cached resource is left to the network (null)', async () => {
    const caches = await cached();
    assert.equal(await handleResourceRequest(new Request(`${ORIGIN}/assets/missing.png`), { caches }), null);
    assert.equal(await handleResourceRequest(new Request(`${ORIGIN}/js/main.js`), { caches }), null);
    assert.equal(await handleResourceRequest(new Request(`${ORIGIN}/data/assets.json`), { caches }), null);
    assert.equal(await handleResourceRequest(new Request(`${ORIGIN}/api/hello`), { caches }), null);
    assert.equal(await handleResourceRequest(new Request(`${ORIGIN}/ws`), { caches }), null);
    assert.equal(await handleResourceRequest(new Request(`${ORIGIN}/assets/a.png`, { method: 'POST' }), { caches }), null);
    assert.equal(await handleResourceRequest(new Request(`${ORIGIN}/assets/a.png`), { caches: null }), null);
    const empty = new MemoryCaches();
    assert.equal(await handleResourceRequest(new Request(`${ORIGIN}/assets/a.png`), { caches: empty }), null);
    assert.equal(await handleResourceRequest(new Request(`${ORIGIN}/assets/a.png`, { headers: { Range: 'bytes=99-100' } }), { caches: await cached() }).then((r) => r.status), 416);
  });

  test('the cached entry survives a re-serve (a range reply never mutates the cache)', async () => {
    const caches = await cached();
    const hit = await handleResourceRequest(new Request(`${ORIGIN}/assets/a.png`), { caches });
    assert.equal(hit.headers.get('accept-ranges'), null, 'the stored response is served as stored');
    await rangeResponse(await (await caches.open(CACHE_NAME)).match(`${ORIGIN}/assets/a.png`), 'bytes=0-1');
    const again = await handleResourceRequest(new Request(`${ORIGIN}/assets/a.png`), { caches });
    assert.equal(await again.text(), '0123456789');
  });
});
