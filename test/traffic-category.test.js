import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRAFFIC_CATEGORIES, trafficCategory } from '../shared/traffic.js';

test('plain-path traffic categories: audio, assets, code, data, other', () => {
  assert.deepEqual([...TRAFFIC_CATEGORIES], ['assets', 'audio', 'code', 'data', 'other']);
  const cases = {
    '/media/bgm/act1': 'audio', '/assets/audio/bgm/a.mp3': 'audio',
    '/assets/char/avatar/a.png': 'assets', '/fonts/f.woff2': 'assets', '/icons/app.svg': 'assets',
    '/packs/foo/art/a.png': 'assets', '/packs/index.json': 'data', '/data/assets.json': 'data',
    '/data/i18n/en.json': 'data', '/i18n/en.json': 'data', '/manifest.json': 'data',
    '/': 'code', '/index.html': 'code', '/js/main.js': 'code', '/css/theme.css': 'code',
    '/vendor/pixi.min.js': 'code', '/sim/Battle.js': 'code', '/shared/protocol.js': 'code',
    '/data.js': 'code', '/healthz': 'other', '/favicon.ico': 'other',
  };
  for (const [p, cat] of Object.entries(cases)) assert.equal(trafficCategory(p), cat, p);
});
