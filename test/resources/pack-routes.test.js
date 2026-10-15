import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { parseResourcePackRoutes, resourcePackUrls, routeResourcePacks, isResourcePackUrl } from '../../shared/resourcePackRoutes.js';
import { validateResourcePacks, RESOURCE_PACK_MAX_BYTES } from '../../public/js/resources/common.js';
import { fetchTransportPack } from '../../public/js/resources/transport.js';
import { createStaticHandler } from '../../server/http/static.js';
import { startServer } from '../../server/index.js';

const pack = { id: 'ui-01', url: '/resource-packs/ui-01-0123456789ab.zip', tier: 1, size: 100,
  sha1: 'a'.repeat(40), files: [{ url: '/assets/ui/a.png', size: 4, hash: '0123456789ab' }] };

test('server route setting supports bare hosts, directories, templates and literal ZIP rewrites', () => {
  const routes = parseResourcePackRoutes(JSON.stringify([
    'example.com/data/', 'https://two.example/bundles/{file}', '/proxy/{id}.zip', 'example.com/data/xxx.zip',
  ]));
  assert.deepEqual(resourcePackUrls(pack, routes), [
    'https://example.com/data/ui-01-0123456789ab.zip', 'https://two.example/bundles/ui-01-0123456789ab.zip',
    '/proxy/ui-01.zip', 'https://example.com/data/xxx.zip', pack.url,
  ]);
  assert.deepEqual(parseResourcePackRoutes(undefined), []);
  assert.deepEqual(parseResourcePackRoutes('  '), []);
  for (const value of ['wrong', '{}', '[null]', '[1]', '[""]', '["ftp://host/a.zip"]',
    '["//host/a.zip"]', '["https://user:pass@host/a.zip"]', '["/x/{unknown}.zip"]', '["/x/a.zip?q=1"]']) {
    assert.throws(() => parseResourcePackRoutes(value), /SP_RESOURCE_PACK_ROUTES/);
  }
});

test('CDN is last and deduplicated; routing changes neither fingerprints nor resource identities', () => {
  const cdn = 'https://cdn.example/game';
  const routes = parseResourcePackRoutes([`${cdn}/resource-packs/{file}`, 'mirror.example/data', 'https://mirror.example/data/{file}']);
  const [routed] = routeResourcePacks([pack], cdn, routes);
  assert.deepEqual(routed.urls, ['https://mirror.example/data/ui-01-0123456789ab.zip', `${cdn}${pack.url}`]);
  assert.equal(routed.url, `${cdn}${pack.url}`);
  assert.equal(routed.sha1, pack.sha1);
  assert.equal(routed.files[0].url, `${cdn}/assets/ui/a.png`);
  assert.equal(pack.files[0].url, '/assets/ui/a.png', 'input index is immutable');
  assert.equal(validateResourcePacks([routed]).length, 1, 'CDN path prefixes remain valid');
  assert.equal(routeResourcePacks([pack], '', [])[0].urls, undefined, 'unconfigured deployments keep one URL');
  assert.equal(isResourcePackUrl('javascript:alert(1).zip'), false);
  assert.equal(isResourcePackUrl('//example.com/a.zip'), false);
});

test('both HTTP index endpoints expose the same route order, support HEAD and revalidate ETags', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-pack-routes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data');
  const publicDir = path.join(root, 'public');
  await mkdir(dataDir);
  await mkdir(publicDir);
  await writeFile(path.join(dataDir, 'assets.json'), JSON.stringify({ ui: { a: pack.files[0].url } }));
  await writeFile(path.join(dataDir, 'resource-packs.json'), JSON.stringify({
    format: 'stronghold-resource-pack-index', version: 1, maxBytes: RESOURCE_PACK_MAX_BYTES, packs: [pack],
  }));
  const cdnBase = 'https://cdn.example/prefix';
  const resourcePackRoutes = parseResourcePackRoutes(['example.com/data/{file}', '/mirror/{id}.zip']);
  const makeServer = async (routes) => {
    const handler = createStaticHandler({ publicDir, dataDir, sharedDir: path.resolve('shared'), cdnBase,
      resourcePackRoutes: routes });
    const server = http.createServer((req, res) => { void handler(req, res, req.url, ''); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
  };
  const origin = await makeServer(resourcePackRoutes);
  const changed = await makeServer(parseResourcePackRoutes(['other.example/new/']));
  for (const endpoint of ['/data/resource-manifest.json', '/data/resource-packs.json']) {
    const response = await fetch(origin + endpoint);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    const doc = await response.json();
    assert.deepEqual(doc.packs[0].urls, ['https://example.com/data/ui-01-0123456789ab.zip',
      '/mirror/ui-01.zip', cdnBase + pack.url]);
    assert.equal(validateResourcePacks(endpoint.includes('manifest') ? doc.packs : doc).length, 1);
    const etag = response.headers.get('etag');
    const head = await fetch(origin + endpoint, { method: 'HEAD' });
    assert.equal(head.headers.get('etag'), etag);
    assert.equal(await head.text(), '');
    assert.equal((await fetch(origin + endpoint, { headers: { 'If-None-Match': etag } })).status, 304);
    assert.notEqual((await fetch(changed + endpoint)).headers.get('etag'), etag, 'route changes invalidate cached metadata');
  }
});

test('failed routes try CDN exactly once, skipping invalid or duplicate mirrors', async () => {
  const calls = [];
  await assert.rejects(fetchTransportPack({ ...pack, urls: [pack.url, 'javascript:a.zip', '//host/a.zip',
    'https://mirror.example/a.zip', 'https://mirror.example/a.zip'] }, {
    fetcher: async (url) => { calls.push(url); return new Response(null, { status: 404 }); },
  }), /HTTP 404/);
  assert.deepEqual(calls, ['https://mirror.example/a.zip', pack.url]);
});

test('startServer reads the environment setting and explicit empty routes disable mirrors', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-pack-routes-env-'));
  await writeFile(path.join(root, 'resource-packs.json'), JSON.stringify({
    format: 'stronghold-resource-pack-index', version: 1, maxBytes: RESOURCE_PACK_MAX_BYTES, packs: [pack],
  }));
  const previous = process.env.SP_RESOURCE_PACK_ROUTES;
  process.env.SP_RESOURCE_PACK_ROUTES = '["example.com/data/"]';
  const opts = { host: '127.0.0.1', port: 0, quiet: true, dataDir: root, store: null,
    assetsCdn: 'https://cdn.example/prefix', workers: 0, roomWorkers: 0, matchWorkers: 0,
    log: { info() {}, warn() {}, error() {}, debug() {} } };
  let server;
  t.after(async () => {
    await server?.close();
    if (previous === undefined) delete process.env.SP_RESOURCE_PACK_ROUTES;
    else process.env.SP_RESOURCE_PACK_ROUTES = previous;
    await rm(root, { recursive: true, force: true });
  });
  server = await startServer(opts);
  let doc = await (await fetch(`http://127.0.0.1:${server.port}/data/resource-packs.json`)).json();
  assert.deepEqual(doc.packs[0].urls, ['https://example.com/data/ui-01-0123456789ab.zip', opts.assetsCdn + pack.url]);
  await server.close();
  server = await startServer({ ...opts, resourcePackRoutes: [] });
  doc = await (await fetch(`http://127.0.0.1:${server.port}/data/resource-packs.json`)).json();
  assert.equal(doc.packs[0].urls, undefined);
  await assert.rejects(startServer({ ...opts, resourcePackRoutes: 'invalid' }), /SP_RESOURCE_PACK_ROUTES/);
});

test('idle and absolute timeouts switch routes; user cancellation never does', async () => {
  for (const [idleMs, timeoutMs] of [[15, 1000], [1000, 15]]) {
    const calls = [];
    await assert.rejects(fetchTransportPack({ ...pack, urls: ['https://mirror.example/a.zip'] }, {
      idleMs, timeoutMs,
      fetcher: async (url, { signal }) => {
        calls.push(url);
        if (url === pack.url) return new Response(null, { status: 503 });
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      },
    }), /HTTP 503/);
    assert.deepEqual(calls, ['https://mirror.example/a.zip', pack.url]);
  }
  const controller = new AbortController();
  const calls = [];
  await assert.rejects(fetchTransportPack({ ...pack, urls: ['https://mirror.example/a.zip'] }, {
    signal: controller.signal,
    fetcher: async (url) => { calls.push(url); controller.abort(new Error('user paused')); throw controller.signal.reason; },
  }), /user paused/);
  assert.deepEqual(calls, ['https://mirror.example/a.zip']);
});

test('a stalled response body times out and is cancelled before advancing', async () => {
  const calls = [];
  let cancelled = false;
  await assert.rejects(fetchTransportPack({ ...pack, urls: ['https://mirror.example/a.zip'] }, {
    idleMs: 15,
    fetcher: async (url, { signal }) => {
      calls.push(url);
      if (url === pack.url) {
        assert.equal(cancelled, true);
        return new Response(null, { status: 502 });
      }
      return new Response(new ReadableStream({
        start(c) { signal.addEventListener('abort', () => { cancelled = true; c.error(signal.reason); }, { once: true }); },
      }));
    },
  }), /HTTP 502/);
  assert.equal(calls.length, 2);
});
