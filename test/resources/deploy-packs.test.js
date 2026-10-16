// Deployment planning stays read-only and packages existing assets without conversion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('prepare-assets plans hashing and ZIP packs without the removed shrink converter', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-deploy-packs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const compose = path.join(root, 'compose.yml');
  await writeFile(compose, 'services:\n  stronghold:\n    image: example\n');
  const result = spawnSync(process.execPath, ['scripts/deploy-compose.mjs',
    '--compose', compose, '--prepare-assets'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DRY-RUN/);
  assert.match(result.stdout, /16MB/);
  assert.match(result.stdout, /不转换图片或音频/);
  assert.doesNotMatch(result.stdout, /shrink-assets\.py|asset-shrink-state/);
  const source = await readFile('scripts/deploy-compose.mjs', 'utf8');
  assert.match(source, /'asset-hashes\.mjs'\), '--root', candidate/);
  assert.match(source, /'resource_packs\.py'/);
  assert.doesNotMatch(source, /shrink-assets\.py|asset-shrink-state/);
  assert.match(source, /'up', '-d', '--no-deps', '--no-build'/, 'rollback behavior retained');
});
