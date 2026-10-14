import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlobReader, BlobWriter, ZipWriter } from '../../public/vendor/zip.module.js';
import { ARCHIVE_MANIFEST, importResourceZip } from '../../public/js/resources/archive.js';
import { ResourceStore } from '../../public/js/resources/store.js';

class MemoryCache {
  entries = new Map();
  async put(key, response) { this.entries.set(typeof key === 'string' ? key : key.url, response.clone()); }
  async match(key) { return this.entries.get(typeof key === 'string' ? key : key.url)?.clone(); }
  async keys() { return [...this.entries.keys()].map((url) => new Request(url)); }
  async delete(key) { return this.entries.delete(typeof key === 'string' ? key : key.url); }
}
class MemoryCaches {
  entries = new Map();
  async open(name) { if (!this.entries.has(name)) this.entries.set(name, new MemoryCache()); return this.entries.get(name); }
}
const hash = (body, algorithm = 'sha1') => createHash(algorithm).update(body).digest('hex');
const file = (url, body) => ({ url, body, size: Buffer.byteLength(body), hash: hash(body).slice(0, 12), tier: 1 });

async function packageZip(files, version) {
  const zip = new ZipWriter(new BlobWriter(), { useWebWorkers: false, level: 0 });
  const rows = [];
  for (const [index, f] of files.entries()) {
    const entry = `resources/${index}`;
    rows.push({ path: entry, url: f.url, hash: f.hash, size: f.size,
      ...(version === 1 ? { sha256: hash(f.body, 'sha256') } : { sha1: hash(f.body) }) });
    await zip.add(entry, new BlobReader(new Blob([f.body])));
  }
  await zip.add(ARCHIVE_MANIFEST, new BlobReader(new Blob([JSON.stringify({
    format: 'stronghold-resource-zip', version, resourceVersion: `v${version}`, files: rows,
  })])));
  return zip.close();
}

test('Python delta ZIP upgrades a legacy base through the existing browser importer without downloads', async (t) => {
  const python = process.env.PYTHON || 'python';
  const probe = spawnSync(python, ['--version'], { encoding: 'utf8' });
  if (probe.error?.code === 'ENOENT') return t.skip('Python is optional; run this test with Python 3.10+ installed');
  assert.equal(probe.status, 0, probe.stderr || probe.error?.message);
  const dir = await mkdtemp(path.join(tmpdir(), 'sp-resource-delta-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const baseFiles = [file('/assets/keep.png', 'same'), file('/assets/change.png', 'old'), file('/assets/gone.png', 'gone')];
  const targetFiles = [baseFiles[0], file('/assets/change.png', 'new'), file('/assets/local/map/autochess/tiles.json', '{}')];
  const baseBlob = await packageZip(baseFiles, 1);
  const targetBlob = await packageZip(targetFiles, 2);
  const basePath = path.join(dir, '全量资源包.zip');
  const targetPath = path.join(dir, 'target.zip');
  const outputPath = path.join(dir, 'delta.zip');
  const reportPath = path.join(dir, 'report.json');
  await writeFile(basePath, new Uint8Array(await baseBlob.arrayBuffer()));
  await writeFile(targetPath, new Uint8Array(await targetBlob.arrayBuffer()));
  const script = fileURLToPath(new URL('../../tools/resource_delta.py', import.meta.url));
  const result = spawnSync(python, [script, '--base', basePath, '--target', targetPath,
    '--output', outputPath, '--report', reportPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.deepEqual(['added', 'changed', 'unchanged', 'absentFromTarget'].map((key) => report.summary[key].count), [1, 1, 1, 1]);
  const caches = new MemoryCaches();
  const makeStore = (files, version) => new ResourceStore({
    format: 1, version, files, sized: files.length, totalBytes: files.reduce((n, f) => n + f.size, 0),
  }, { caches, origin: 'https://game.example', fetcher: () => { throw new Error('Unexpected resource download'); } });
  const baseStore = makeStore(baseFiles, 'old');
  assert.equal((await importResourceZip(baseStore, baseBlob)).imported, 3);
  const targetStore = makeStore(targetFiles, 'new');
  const imported = await importResourceZip(targetStore, new Blob([await readFile(outputPath)]));
  assert.equal(imported.packageCount, 2);
  assert.equal(imported.imported, 2);
  assert.equal((await targetStore.status()).complete, true);
  const cache = await caches.open(targetStore.cacheName);
  for (const f of targetFiles) assert.equal(await (await cache.match(targetStore.keyOf(f.url))).text(), f.body);
  assert.equal(await (await cache.match(baseStore.keyOf('/assets/gone.png'))).text(), 'gone',
    'partial resource packages do not carry deletion commands');
});
