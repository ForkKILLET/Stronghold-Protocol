import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateResourcePacks, RESOURCE_PACK_MAX_BYTES } from '../../public/js/resources/common.js';

test('resource pack index validation accepts only 16 MB same-origin ZIP metadata', () => {
  const good = { format: 'stronghold-resource-pack-index', version: 1, maxBytes: RESOURCE_PACK_MAX_BYTES,
    packs: [{ id: 'ui-01', url: '/resource-packs/ui-01.zip', size: 100, tier: 1,
      files: [{ url: '/assets/ui/a.webp', size: 4, hash: '0123456789ab' }] }] };
  assert.equal(validateResourcePacks(good).length, 1);
  assert.equal(validateResourcePacks({
    ...good, packs: [{ ...good.packs[0], url: 'https://cdn.example/resource-packs/ui-01-0123456789ab.zip' }],
  }).length, 1);
  assert.equal(validateResourcePacks({ ...good, maxBytes: 16000001 }).length, 0);
  assert.equal(validateResourcePacks({ ...good, packs: [{ ...good.packs[0], url: 'https://evil/x.zip' }] }).length, 0);
  assert.equal(validateResourcePacks({ ...good, packs: [{ ...good.packs[0], size: RESOURCE_PACK_MAX_BYTES + 1 }] }).length, 0);
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
  assert.match(index.packs[0].url, /\/resource-packs\/ui-01-[0-9a-f]{12}\.zip$/);
});
