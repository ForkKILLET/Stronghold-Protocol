import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateResourcePacks, RESOURCE_PACK_MAX_BYTES, resourcePackPercent } from '../../public/js/resources/common.js';
import { readTransportPack } from '../../public/js/resources/archive.js';
import { Sha1Stream } from '../../public/js/resources/sha1Stream.js';
import { CACHE_NAME, MANIFEST_URL } from '../../public/js/resources/common.js';

test('resource pack index validation accepts only 16 MB same-origin ZIP metadata', () => {
  const good = { format: 'stronghold-resource-pack-index', version: 1, maxBytes: RESOURCE_PACK_MAX_BYTES,
    packs: [{ id: 'ui-01', url: '/resource-packs/ui-01.zip', size: 100, sha1: 'a'.repeat(40), tier: 1,
      files: [{ url: '/assets/ui/a.webp', size: 4, hash: '0123456789ab' }] }] };
  assert.equal(validateResourcePacks(good).length, 1);
  // The server embeds the index's pack entries as `manifest.packs`, without the
  // standalone index envelope. This is the shape consumed by resourceContext().
  assert.equal(validateResourcePacks(good.packs).length, 1);
  assert.equal(validateResourcePacks({
    ...good, packs: [{ ...good.packs[0], url: 'https://cdn.example/resource-packs/ui-01-0123456789ab.zip' }],
  }).length, 1);
  assert.equal(validateResourcePacks({
    ...good, packs: [{ ...good.packs[0], sha1: 'bad' }],
  }).length, 0);
  assert.equal(validateResourcePacks({ ...good, maxBytes: 16000001 }).length, 0);
  assert.equal(validateResourcePacks({ ...good, packs: [{ ...good.packs[0], url: 'https://evil/x.zip' }] }).length, 0);
  assert.equal(validateResourcePacks({ ...good, packs: [{ ...good.packs[0], size: RESOURCE_PACK_MAX_BYTES + 1 }] }).length, 0);
});

test('incremental package SHA-1 handles split input and standard vectors', async () => {
  const hash = new Sha1Stream();
  hash.update(new TextEncoder().encode('123'));
  hash.update(new TextEncoder().encode('456789'));
  assert.equal(hash.digest(), 'f7c3bc1d808e04732adf679965ccc34ca7ae3441');
});

test('transport pack progress covers both streamed download bytes and import files', () => {
  assert.equal(resourcePackPercent({ phase: 'download', loaded: 25, totalBytes: 100 }), 25);
  assert.equal(resourcePackPercent({ phase: 'import', done: 3, totalFiles: 6 }), 50);
  assert.equal(resourcePackPercent({ phase: 'download', loaded: 120, totalBytes: 100 }), 100);
  assert.equal(resourcePackPercent({ downloadedBytes: 75, totalBytes: 100 }), 75);
  assert.equal(resourcePackPercent({ phase: 'import', done: 0, totalFiles: 0 }), 0);
});

test('Python pack builder keeps every pack below 16 MB and records verified resource hashes', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-resource-packs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const assets = path.join(root, 'public');
  const data = path.join(root, 'data');
  await mkdir(path.join(assets, 'assets', 'ui'), { recursive: true });
  await mkdir(data, { recursive: true });
  const body = Buffer.alloc(1200, 7);
  await writeFile(path.join(assets, 'assets', 'ui', 'a.png'), body);
  await writeFile(path.join(assets, 'assets', 'ui', 'b.png'), Buffer.alloc(1200, 8));
  const crypto = await import('node:crypto');
  const hash = (bytes) => crypto.createHash('sha1').update(bytes).digest('hex');
  const manifest = { version: 'fixture', files: [
    { url: '/assets/ui/a.png', tier: 1, size: body.length, hash: hash(body).slice(0, 12) },
    { url: '/assets/ui/b.png', tier: 1, size: 1200, hash: hash(Buffer.alloc(1200, 8)).slice(0, 12) },
  ] };
  const manifestPath = path.join(root, 'manifest.json');
  const indexPath = path.join(data, 'resource-packs.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  const script = path.resolve('tools/resource_packs.py');
  const result = spawnSync(process.env.PYTHON || 'python', [script, '--manifest', manifestPath,
    '--assets-root', assets, '--output', path.join(root, 'resource-packs'), '--index', indexPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  assert.equal(index.maxBytes, RESOURCE_PACK_MAX_BYTES);
  assert.equal(index.packs.length, 1);
  assert.ok(index.packs[0].size <= RESOURCE_PACK_MAX_BYTES);
  assert.match(index.packs[0].sha1, /^[0-9a-f]{40}$/);
  assert.match(index.packs[0].url, /\/resource-packs\/ui-01-[0-9a-f]{12}\.zip$/);
  const zipPath = path.join(root, 'resource-packs', path.basename(index.packs[0].url));
  const zipBytes = await readFile(zipPath);
  const entries = await readTransportPack(new Response(zipBytes), index.packs[0]);
  assert.equal(entries.length, 2);
  assert.equal(new TextDecoder().decode(entries[0].bytes), body.toString());
  assert.equal(new TextDecoder().decode(entries[1].bytes), Buffer.alloc(1200, 8).toString());
  const partial = await readTransportPack(new Response(zipBytes), index.packs[0], {
    selectedPaths: new Set(['/assets/ui/a.png']),
  });
  assert.equal(partial.length, 1);
  assert.equal(partial[0].row.url, '/assets/ui/a.png');
  const corrupted = Buffer.from(zipBytes);
  corrupted[corrupted.length - 1] ^= 1;
  await assert.rejects(() => readTransportPack(new Response(corrupted), index.packs[0]), /整包校验失败/);

  await t.test('controller overlaps two ZIP requests and continues downloading during cache writes', async (t) => {
    const saved = new Map(['fetch', 'caches', 'navigator', 'location', 'isSecureContext']
      .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    t.after(() => {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    });
    const origin = 'https://pack.example';
    const entries = new Map();
    let requests = 0;
    let heldWrite = false;
    const writeGate = Promise.withResolvers();
    const writeStarted = Promise.withResolvers();
    const secondRequest = Promise.withResolvers();
    const cache = {
      async match(key) { return entries.get(typeof key === 'string' ? key : key.url)?.clone(); },
      async keys() { return [...entries.keys()].map((url) => new Request(url)); },
      async delete(key) { return entries.delete(typeof key === 'string' ? key : key.url); },
      async put(key, value) {
        if (String(key).includes('/assets/') && !heldWrite) {
          heldWrite = true;
          writeStarted.resolve();
          await writeGate.promise;
        }
        entries.set(typeof key === 'string' ? key : key.url, value.clone());
      },
    };
    const packs = [1, 2, 3].map((n) => ({ ...index.packs[0], id: `ui-${n}`, url: `/resource-packs/ui-${n}.zip` }));
    for (const [key, value] of Object.entries({
      isSecureContext: true, location: { origin },
      caches: { open: async () => cache, keys: async () => [CACHE_NAME], delete: async () => true },
      navigator: { serviceWorker: { register: async () => ({}), getRegistrations: async () => [] } },
      fetch: async (url) => {
        if (url === MANIFEST_URL) return Response.json({ format: 1, version: 'packs', files: manifest.files, packs });
        assert.match(url, /^\/resource-packs\//, 'no per-file fallback on a valid transport pack');
        if (++requests === 1) await secondRequest.promise;
        else if (requests === 2) secondRequest.resolve();
        else {
          await writeStarted.promise;
          assert.equal(heldWrite, true, 'third request starts while first cache write is held');
          writeGate.resolve();
        }
        return new Response(zipBytes);
      },
    })) Object.defineProperty(globalThis, key, { configurable: true, value });
    const controller = await import('../../public/js/resources/index.js?pack-pipeline-regression');
    const progress = [];
    const unsubscribe = controller.subscribeResources((s) => {
      if (s.packProgress) progress.push(s.packProgress);
    });
    try {
      await controller.syncResources(true, false);
      assert.equal(requests, 3);
      assert.equal(controller.resourceState().selectionComplete, true);
      assert.ok(progress.some((p) => p.activeDownloads === 2));
      assert.ok(progress.some((p) => p.importing && p.activeDownloads > 0));
      assert.ok(await cache.match(`${origin}/assets/ui/a.png`));
    } finally {
      writeGate.resolve();
      unsubscribe();
      await controller.syncResources(false);
    }
  });
});

test('Python pack builder decodes canonical bracket URLs when reading local files', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-resource-packs-brackets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const assets = path.join(root, 'public');
  const data = path.join(root, 'data');
  await mkdir(path.join(assets, 'assets', 'local', 'map', 'fx'), { recursive: true });
  await mkdir(data, { recursive: true });
  const body = Buffer.from('bracket texture');
  await writeFile(path.join(assets, 'assets', 'local', 'map', 'fx', '[opt]x.webp'), body);
  const crypto = await import('node:crypto');
  const full = crypto.createHash('sha1').update(body).digest('hex');
  const manifestPath = path.join(root, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({ version: 'fixture', files: [{
    url: '/assets/local/map/fx/%5Bopt%5Dx.webp', tier: 1, size: body.length, hash: full.slice(0, 12),
  }] }));
  const result = spawnSync(process.env.PYTHON || 'python', [path.resolve('tools/resource_packs.py'),
    '--manifest', manifestPath, '--assets-root', assets, '--output', path.join(root, 'packs'),
    '--index', path.join(data, 'resource-packs.json')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const index = JSON.parse(await readFile(path.join(data, 'resource-packs.json'), 'utf8'));
  assert.equal(index.packs[0].files[0].url, '/assets/local/map/fx/%5Bopt%5Dx.webp');
});
