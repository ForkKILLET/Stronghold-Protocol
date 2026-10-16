import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installSkinPortraits } from '../tools/install-skins.mjs';
import { isCompletePng } from '../tools/assets/formats.mjs';

test('portrait upgrade is resumable, publishes only valid downloads and preserves existing model/selection metadata', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-portraits-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'docs', 'research'), { recursive: true });
  await mkdir(path.join(root, 'data'), { recursive: true });
  const good = 'char_test@summer#1', missing = 'char_test@winter#2';
  const model = { spine: { front: { skel: '/assets/front.skel', anims: { idle: 'Idle' } } }, avatar: '/assets/avatar.png', custom: 7 };
  const manifest = { chars: { char_test: { portrait: '/assets/base.png', skins: { [good]: model, [missing]: { ...model } } } }, custom: { untouched: true } };
  const save = (file, v) => writeFile(path.join(root, file), JSON.stringify(v));
  await save('data/assets.json', manifest);
  await save('data/skins-installed.json', { installed: [good, missing] });
  await save('docs/research/08-skins.json', { skins: { char_test: [
    { skinId: good, stem: 'summer', portrait: { url: 'https://example.invalid/good.png' } },
    { skinId: missing, stem: 'winter', portrait: { url: 'https://example.invalid/missing.png' } },
  ] } });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
  assert.ok(isCompletePng(png));
  const requests = [];
  let available = false;
  const fetchImpl = async (url) => {
    requests.push(url);
    return url.endsWith('good.png') || available ? new Response(png) : new Response('not found', { status: 404 });
  };
  const run = () => installSkinPortraits({ root, log() {}, fetchImpl });
  assert.deepEqual(await run(), { installed: 1, failed: [missing] });
  let result = JSON.parse(await readFile(path.join(root, 'data/assets.json')));
  assert.deepEqual(result.chars.char_test.skins[good], { ...model, portrait: '/assets/char/portrait/skin/summer.png' });
  assert.deepEqual(result.chars.char_test.skins[missing], model);
  assert.deepEqual(result.custom, manifest.custom);
  const firstHash = result.hash;
  available = true; requests.length = 0;
  assert.deepEqual(await run(), { installed: 2, failed: [] });
  assert.equal(requests.length, 1, 'existing valid art is reused without another download');
  result = JSON.parse(await readFile(path.join(root, 'data/assets.json')));
  assert.notEqual(result.hash, firstHash);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'data/skins-installed.json'))), { installed: [good, missing] });
  assert.equal(isCompletePng(await readFile(path.join(root, 'public/assets/char/portrait/skin/winter.png'))), true);
});
