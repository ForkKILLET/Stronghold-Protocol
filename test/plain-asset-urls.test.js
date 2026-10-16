// The v0.2.6 branch merge excludes asset URL hashing, not resource/ZIP integrity fingerprints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startServer } from '../server/index.js';
import { mediaUrl } from '../public/js/media.js';

function get(port, url) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: url, agent: false }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

test('plain asset and media URLs, fingerprints and CDN manifest rewriting survive v0.2.6', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-plain-assets-'));
  const write = (file, body) => {
    const p = path.join(root, file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  const assets = { hash: 'existing-manifest-fingerprint', char: { avatar: { a: '/assets/a.png' } } };
  const local = { version: 1, count: 1, groups: { 'map/autochess': { D: { path: '/assets/a.png', hash: 'existing-file-fingerprint' } } } };
  write('public/index.html', '<!doctype html><p>plain assets</p>');
  write('public/assets/a.png', Buffer.from([1, 2, 3, 4]));
  write('public/assets/audio/bgm/a.mp3', Buffer.from([5, 6, 7, 8]));
  write('data/assets.json', JSON.stringify(assets));
  write('data/local-assets.json', JSON.stringify(local));
  fs.mkdirSync(path.join(root, 'shared'));
  const options = { port: 0, host: '127.0.0.1', quiet: true, workers: 0, roomWorkers: 0, announcementsFile: null,
    publicDir: path.join(root, 'public'), dataDir: path.join(root, 'data'), sharedDir: path.join(root, 'shared') };
  let srv;
  try {
    srv = await startServer(options);
    assert.deepEqual(JSON.parse((await get(srv.port, '/data/assets.json')).body), assets);
    assert.deepEqual(JSON.parse((await get(srv.port, '/data/local-assets.json')).body), local);
    const image = await get(srv.port, '/assets/a.png');
    assert.equal(image.headers['cache-control'], 'public, max-age=86400');
    assert.match(image.headers.etag, /^"[0-9a-f]+-[0-9a-f]+"$/);
    const audio = await get(srv.port, '/media/bgm/a');
    assert.equal(audio.status, 200);
    assert.equal(audio.headers['cache-control'], 'public, max-age=86400');
    assert.deepEqual(audio.body, Buffer.from([5, 6, 7, 8]));
    assert.equal(mediaUrl('/assets/audio/bgm/a.mp3', 'http://localhost'), '/media/bgm/a');
    for (const p of ['/assets/~0123456789abcdef/a.png', '/media/~0123456789abcdef/bgm/a']) {
      assert.equal((await get(srv.port, p)).status, 404, 'no content-hash alias route');
    }
    assert.equal('assetIndex' in srv, false);
    assert.equal('assetHashes' in JSON.parse((await get(srv.port, '/healthz?traffic=1')).body), false);
    await srv.close();
    srv = await startServer({ ...options, assetsCdn: 'https://cdn.example.invalid/game' });
    const rewritten = JSON.parse((await get(srv.port, '/data/assets.json')).body);
    assert.equal(rewritten.char.avatar.a, 'https://cdn.example.invalid/game/assets/a.png');
    assert.equal(rewritten.hash, assets.hash, 'fingerprint metadata is not URL hashing');
    const localCdn = JSON.parse((await get(srv.port, '/data/local-assets.json')).body);
    assert.equal(localCdn.groups['map/autochess'].D.hash, 'existing-file-fingerprint');
    assert.equal(localCdn.groups['map/autochess'].D.path, 'https://cdn.example.invalid/game/assets/a.png');
  } finally {
    await srv?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
