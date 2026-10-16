import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const bashCandidates = process.platform === 'win32'
  ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe')]
  : ['/bin/bash', '/usr/bin/bash'];
const bash = bashCandidates.find(existsSync);

test('R2 upload stages generated indexes, copies every data/art prefix, then purges Cloudflare', { skip: !bash && 'Bash is required' }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sp-r2-sync-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const data = path.join(root, 'data');
  const assets = path.join(root, 'public', 'assets');
  const fonts = path.join(root, 'public', 'fonts');
  const packs = path.join(root, 'public', 'resource-packs');
  await Promise.all([mkdir(bin), mkdir(data), mkdir(assets, { recursive: true }), mkdir(fonts, { recursive: true }), mkdir(packs, { recursive: true })]);
  await writeFile(path.join(data, 'assets.json'), JSON.stringify({ ui: { icon: '/assets/icon.png' } }));
  await writeFile(path.join(data, 'local-assets.json'), JSON.stringify({ version: 1, groups: {} }));
  await writeFile(path.join(data, 'local-fx.json'), JSON.stringify({ groups: {} }));
  await writeFile(path.join(data, 'chess.json'), JSON.stringify({ chars: [] }));
  await writeFile(path.join(data, 'asset-hashes.json'), JSON.stringify({ files: {} }));
  await writeFile(path.join(assets, 'icon.png'), 'image');
  await writeFile(path.join(fonts, 'game.woff2'), 'font');
  await writeFile(path.join(packs, 'ui-01-deadbeef1234.zip'), 'zip');
  await writeFile(path.join(data, 'resource-packs.json'), JSON.stringify({
    format: 'stronghold-resource-pack-index', version: 1, resourceVersion: 'fixture', maxBytes: 16000000,
    packs: [{ id: 'ui-01', url: '/resource-packs/ui-01-deadbeef1234.zip', size: 3,
      sha1: 'a'.repeat(40), tier: 1, files: [] }],
  }));
  const rclone = path.join(bin, 'mock-rclone');
  const curl = path.join(bin, 'mock-curl');
  await writeFile(rclone, `#!/usr/bin/env bash
printf '%s\\n' "RCLONE_CALL:$*"
if [[ -n "\${MOCK_UPLOAD_FAIL:-}" ]]; then exit 23; fi
if [[ "$2" == */data ]]; then
  find "$2" -maxdepth 1 -type f -printf 'STAGED_DATA_FILE:%f\\n'
fi
`);
  await writeFile(curl, `#!/usr/bin/env bash
[[ "$*" == *"zones/"*"/purge_cache"* ]] || exit 42
if [[ -n "\${MOCK_PURGE_FAIL:-}" ]]; then printf '%s\\n' '{"success":false}'; exit 0; fi
printf '%s\\n' '{"success":true,"result":{"id":"purge"}}'
`);
  await chmod(rclone, 0o755);
  await chmod(curl, 0o755);

  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    R2_REPO_ROOT: root,
    R2_TARGET: 'r2:game/release',
    DATA_CDN_BASE_URL: 'https://data.example/game',
    ASSETS_CDN_BASE_URL: 'https://assets.example/game',
    CF_ZONE_ID: 'a'.repeat(32),
    CF_API_TOKEN: 'test-token',
    RCLONE_BIN: path.basename(rclone),
    CURL_BIN: path.basename(curl),
  };
  const script = path.resolve('scripts/sync-to-r2.sh');
  const run = (...args) => spawnSync(bash, [script, ...args], { encoding: 'utf8', env, timeout: 20000 });
  const result = run('--apply');
  assert.equal(result.status, 0, result.stderr);
  const calls = result.stdout.split(/\r?\n/).filter(line => line.startsWith('RCLONE_CALL:'));
  assert.equal(calls.length, 4, result.stdout);
  assert.ok(calls.some(line => line.includes('public/assets') && line.includes('r2:game/release/assets')));
  assert.ok(calls.some(line => line.includes('public/fonts') && line.includes('r2:game/release/fonts')));
  assert.ok(calls.some(line => line.includes('public/resource-packs') && line.includes('r2:game/release/resource-packs')));
  assert.ok(calls.some(line => line.includes('/data') && line.includes('r2:game/release/data')));
  assert.ok(calls.every(line => line.startsWith('RCLONE_CALL:copy ')), 'normal upload never deletes remote files');
  assert.ok(result.stdout.indexOf('RCLONE_CALL:') < result.stdout.indexOf('Cloudflare cache purge accepted'), 'purge follows all uploads');
  assert.match(result.stdout, /STAGED_DATA_FILE:resource-manifest\.json/);
  assert.match(result.stdout, /STAGED_DATA_FILE:resource-packs\.json/);
  assert.match(result.stdout, /Cloudflare cache purge accepted/);
  assert.equal(existsSync(path.join(data, 'resource-manifest.json')), false, 'generated index never mutates source data');

  const mirror = run('--apply', '--mirror');
  assert.equal(mirror.status, 0, mirror.stderr);
  const mirrorCalls = mirror.stdout.split(/\r?\n/).filter(line => line.startsWith('RCLONE_CALL:'));
  assert.equal(mirrorCalls.length, 4);
  assert.ok(mirrorCalls.every(line => line.startsWith('RCLONE_CALL:sync ') && line.includes('--delete-after')));

  const preview = run();
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /--dry-run/);
  assert.doesNotMatch(preview.stdout, /Cloudflare cache purge accepted/);

  env.MOCK_UPLOAD_FAIL = '1';
  const failed = run('--apply');
  assert.equal(failed.status, 23, failed.stderr);
  assert.doesNotMatch(failed.stdout, /Cloudflare cache purge accepted/);
  delete env.MOCK_UPLOAD_FAIL;

  env.MOCK_PURGE_FAIL = '1';
  const rejectedPurge = run('--apply');
  assert.notEqual(rejectedPurge.status, 0);
  assert.match(rejectedPurge.stderr, /Cloudflare cache purge failed/);
  delete env.MOCK_PURGE_FAIL;

  const configPath = path.join(root, 'config.json');
  await writeFile(configPath, JSON.stringify({
    r2: { accountId: 'b'.repeat(32), accessKeyId: 'mock-access', secretAccessKey: 'mock-secret', bucket: 'game', prefix: 'release' },
    cdn: { dataBaseUrl: env.DATA_CDN_BASE_URL, assetsBaseUrl: env.ASSETS_CDN_BASE_URL },
    cloudflare: { zoneId: env.CF_ZONE_ID, apiToken: 'mock-token' },
  }));
  const configured = run('--config', configPath, '--apply');
  assert.equal(configured.status, 0, configured.stderr);
  assert.match(configured.stdout, /--config .*rclone\.conf/);
  assert.doesNotMatch(configured.stdout + configured.stderr, /mock-access|mock-secret|mock-token/);

  await rm(path.join(packs, 'ui-01-deadbeef1234.zip'));
  const missingPack = run('--apply');
  assert.notEqual(missingPack.status, 0);
  assert.doesNotMatch(missingPack.stdout, /RCLONE_CALL:|Cloudflare cache purge accepted/);
});

test('R2 config writes usable private INI credentials and scoped purge payload', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sp-r2-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'config.json');
  const config = {
    r2: { accountId: 'b'.repeat(32), accessKeyId: 'test-access', secretAccessKey: 'test-secret', bucket: 'game' },
    cdn: { dataBaseUrl: 'https://data.example/game', assetsBaseUrl: 'https://assets.example/game' },
    cloudflare: { zoneId: 'a'.repeat(32), apiToken: 'test-token' },
    sync: { packRoutes: ['mirror.example/resource-packs'] },
  };
  await writeFile(configPath, JSON.stringify(config));
  const run = () => spawnSync(process.execPath, ['scripts/prepare-r2-config.mjs', configPath, root], { encoding: 'utf8' });
  assert.equal(run().status, 0);
  const ini = await readFile(path.join(root, 'rclone.conf'), 'utf8');
  assert.match(ini, /^type = s3$/m);
  assert.match(ini, /^secret_access_key = test-secret$/m);
  const runtime = JSON.parse(await readFile(path.join(root, 'runtime.json'), 'utf8'));
  assert.deepEqual(runtime.packRoutes, ['https://mirror.example/resource-packs/{file}']);
  assert.ok(runtime.purge.prefixes.includes('data.example/game/data/'));
  assert.ok(runtime.purge.prefixes.includes('assets.example/game/i18n/'));
  assert.equal(runtime.purge.purge_everything, undefined);
  config.r2.secretAccessKey = 'secret\n[other]';
  await writeFile(configPath, JSON.stringify(config));
  assert.notEqual(run().status, 0, 'reject INI injection');
});
