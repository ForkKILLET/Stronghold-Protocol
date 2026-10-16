// Verify real production artifacts and simulation parity without browser automation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { createStaticHandler, computeBuildTag, COMPRESSIBLE } from '../server/index.js';
import { getData } from '../server/data.js';
import * as nativeSpec from '../server/sim/spec.js';
import { DataSource } from '../server/sim/simdata.js';
import { scenariosOf } from '../tools/golden.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let temp, publicDir, outDir, manifest, server, origin;
before(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-vite-'));
  await fs.writeFile(path.join(temp, 'package.json'), '{"type":"module"}');
  publicDir = path.join(temp, 'public');
  outDir = path.join(publicDir, 'build');
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(path.join(publicDir, 'index.html'), '<html>source client</html>');
  await build({ configFile: path.join(root, 'vite.config.js'), logLevel: 'silent', build: { outDir } });
  manifest = JSON.parse(await fs.readFile(path.join(outDir, '.vite/manifest.json'), 'utf8'));
  const handler = createStaticHandler({ publicDir, dataDir: path.join(root, 'data'), sharedDir: path.join(root, 'shared'),
    cdnBase: 'https://art.example.com/game', dataCdnBase: 'https://data.example.com/game' });
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    handler(req, res, url.pathname, url.search.slice(1)).catch((err) => { res.statusCode = 500; res.end(String(err)); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (temp) await fs.rm(temp, { recursive: true, force: true });
});

test('management density overrides are bundled after touch rules without bypassing mandatory landscape', async () => {
  const cssFiles = manifest['index.html'].css || [];
  assert.ok(cssFiles.length);
  const css = (await Promise.all(cssFiles.map((file) => fs.readFile(path.join(outDir, file), 'utf8')))).join('\n');
  assert.match(css, /\.modal--utility/);
  assert.match(css, /--utility-text:\s*max\(var\(--t\),\s*64px\)/);
  assert.match(css, /\.sp-rotatable \.rotate-hint\s*\{\s*display:\s*grid/);
  assert.doesNotMatch(css, /\.sp-rotatable:(?:not|is)\(/);
  assert.match(css, /data-viewport-docked/);
  assert.match(css, /--combat-available-height/);
  assert.match(css, /--combat-viewport-height/);
  assert.match(css, /\.room-screen--coop/);
  assert.match(css, /\.room-topbar__tools/);
  assert.match(css, /grid-template-areas:[^;}]*controls title invite/);
  assert.ok(css.lastIndexOf('.settings-modal .set-row--fps') > css.indexOf('.set-row--fps'),
    'compact overrides follow original settings styles');
  assert.ok(css.lastIndexOf('.combat-metrics__body') > css.indexOf('.combat-metrics__body'),
    'compact scroll override follows short-screen fallback');
});

test('built HTML, hashed assets, runtime CDN and data routes preserve the production contracts', async () => {
  for (const route of ['/', '/index.html', '/build/index.html']) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    const html = await response.text();
    assert.match(html, /src="\/build\/assets\/index-[\w-]+\.js"/);
    assert.match(html, /onerror="window\.__spBootFail/);
    assert.doesNotMatch(html, /type="importmap"|href="\/css\//);
    for (const [, url] of html.matchAll(/(?:src|href)="(\/build\/[^" ]+)"/g)) {
      const asset = await fetch(origin + url);
      assert.equal(asset.status, 200, url);
      assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable', url);
      const stat = await fs.stat(path.join(outDir, url.slice('/build/'.length)));
      const compressed = COMPRESSIBLE.has(path.extname(url)) && stat.size >= 512;
      assert.equal(asset.headers.get('content-encoding'), compressed ? 'gzip' : null, url);
      assert.equal((await fetch(origin + url, { headers: { 'If-None-Match': asset.headers.get('etag') } })).status, 304);
      await asset.arrayBuffer();
    }
  }
  const allJs = await Promise.all(Object.values(manifest).filter((m) => m.file.endsWith('.js'))
    .map((m) => fs.readFile(path.join(outDir, m.file), 'utf8')));
  assert.ok(allJs.some((s) => /from["']\/js\/asset-cdn\.js["']/.test(s)), 'CDN module stays external');
  assert.ok(allJs.every((s) => !/node:fs|node:path|nodeData\.js|__vite-browser-external/.test(s)), 'no Node-only imports');
  const config = await fetch(origin + '/js/asset-cdn.js');
  assert.equal(config.headers.get('cache-control'), 'no-cache');
  const configText = await config.text();
  assert.match(configText, /export const ASSETS_CDN = "https:\/\/art\.example\.com\/game"/);
  assert.match(configText, /export const DATA_CDN = "https:\/\/data\.example\.com\/game"/);
  assert.ok(allJs.some((s) => /DATA_CDN/.test(s)), 'built loaders consume the runtime data CDN');
  const data = await fetch(origin + '/data/chess.json', { redirect: 'manual' });
  assert.equal(data.status, 200);
  assert.equal(data.headers.get('location'), null);
  assert.equal(data.headers.get('cache-control'), 'no-cache');
  assert.deepEqual(await data.json(), JSON.parse(await fs.readFile(path.join(root, 'data/chess.json'), 'utf8')));
  // Explicit source mode works even with built files present.
  const source = createStaticHandler({ publicDir, dataDir: path.join(root, 'data'), sharedDir: path.join(root, 'shared'), clientBuild: false });
  const srv = http.createServer((req, res) => source(req, res, '/', ''));
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  try { assert.equal(await (await fetch(`http://127.0.0.1:${srv.address().port}/`)).text(), '<html>source client</html>'); }
  finally { await new Promise((resolve) => srv.close(resolve)); }
});

test('rendering, simulation and Three.js remain outside the initial static import graph', () => {
  const seen = new Set();
  function visit(key) {
    if (seen.has(key)) return;
    seen.add(key);
    for (const dependency of manifest[key].imports || []) visit(dependency);
  }
  visit('index.html');
  const initial = [...seen].map((key) => manifest[key].name);
  for (const name of ['simulation', 'app', 'three', 'archive', 'announcementMarkdown', 'sweep']) assert.ok(!initial.includes(name), `${name} loads lazily`);
  assert.ok(Object.values(manifest).some((entry) => entry.name === 'archive' && entry.isDynamicEntry), 'ZIP library is available on demand');
  assert.ok(Object.values(manifest).some((entry) => entry.name === 'announcementMarkdown' && entry.isDynamicEntry), 'popup Markdown is available on demand');
  assert.ok(Object.values(manifest).some((entry) => entry.name === 'sweep' && entry.isDynamicEntry), 'S.W.E.E.P. report is available on demand');
});

test('built simulation retains operator kits and domain mechanics: same deterministic battle results as Node', async () => {
  const simulation = Object.values(manifest).find((m) => m.name === 'simulation');
  const namespaces = Object.values(await import(pathToFileURL(path.join(outDir, simulation.file)).href));
  const spec = namespaces.find((n) => typeof n?.createBattleFromSpec === 'function');
  const simdata = namespaces.find((n) => typeof n?.setSimData === 'function');
  assert.ok(spec && simdata, 'simulation entry namespaces exist');
  const raw = getData({ log: { warn() {} } });
  simdata.setSimData(raw);
  const ids = Object.keys(raw.chess).filter((id) => id.endsWith('_a'));
  assert.ok(ids.length > 20);
  for (const seed of [17, 29, 53]) {
    const units = ids.slice((seed % 5) * 6, (seed % 5) * 6 + 6).map((chessId, i) => ({
      uid: i + 1, chessId, row: 9 + Math.floor(i / 3), col: 4 + i % 3,
    }));
    const input = nativeSpec.buildBattleSpec({ kind: 'normal', seed, round: 3, stageId: Object.keys(raw.stages)[0], timeLimit: 30,
      players: [{ playerId: 'p', units, bonds: {} }],
      spawns: [{ enemyKey: Object.keys(raw.enemies)[0], count: 4, time: 1 }], flags: { layerGainsEnabled: true } });
    const options = { quiet: true, recordEvents: false };
    const native = nativeSpec.createBattleFromSpec(input, new DataSource(raw), options);
    const built = spec.createBattleFromSpec(input, new simdata.DataSource(raw), options);
    native.runToEnd(100);
    built.runToEnd(100);
    assert.ok(native.finished && built.finished);
    assert.equal(native.errors.length, 0);
    assert.equal(built.errors.length, 0);
    assert.deepEqual(spec.compactResult(built.result()), nativeSpec.compactResult(native.result()), `seed ${seed}`);
    assert.deepEqual(built.allyUnits.map((u) => Object.keys(u.kit || {})), native.allyUnits.map((u) => Object.keys(u.kit || {})));
  }
});

test('built simulation carries owner skins without changing deterministic combat outcomes', async () => {
  const simulation = Object.values(manifest).find(m => m.name === 'simulation');
  const namespaces = Object.values(await import(pathToFileURL(path.join(outDir, simulation.file)).href));
  const spec = namespaces.find(n => typeof n?.createBattleFromSpec === 'function');
  const simdata = namespaces.find(n => typeof n?.setSimData === 'function');
  const raw = getData({ log: { warn() {} } }); simdata.setSimData(raw);
  const unit = { uid: 1, chessId: 'chess_char_1_01_a', row: 9, col: 5, dir: 'UP' };
  const input = nativeSpec.buildBattleSpec({ seed: 29, kind: 'normal', stageId: Object.keys(raw.stages)[0],
    players: [{ playerId: 'OTHER', units: [{ ...unit, skin: 'char_498_inside@kitchen#2' }] }],
    spawns: [{ enemyKey: 'enemy_1007_slime', count: 2, time: 1 }], timeLimit: 50 });
  const native = nativeSpec.createBattleFromSpec(input, new DataSource(raw), { quiet: true });
  const built = spec.createBattleFromSpec(input, new simdata.DataSource(raw), { quiet: true });
  native.start(); built.start();
  assert.equal(built.fieldMeta().units.find(u => u.ownerId === 'OTHER')?.skin, 'char_498_inside@kitchen#2');
  assert.deepEqual(built.fieldMeta(), native.fieldMeta());
  native.runToEnd(100); built.runToEnd(100);
  assert.deepEqual(spec.compactResult(built.result()), nativeSpec.compactResult(native.result()));
  const plainInput = structuredClone(input);
  for (const player of plainInput.players) for (const u of player.units) delete u.skin;
  const plain = nativeSpec.createBattleFromSpec(plainInput, new DataSource(raw), { quiet: true });
  plain.runToEnd(100);
  assert.deepEqual(nativeSpec.compactResult(plain.result()), nativeSpec.compactResult(native.result()));
});

test('built simulation matches Node for sleep, Egir, stand-ins, self-selected kits and 0.2.5 funnels', async () => {
  const simulation = Object.values(manifest).find((m) => m.name === 'simulation');
  const namespaces = Object.values(await import(pathToFileURL(path.join(outDir, simulation.file)).href));
  const spec = namespaces.find((n) => typeof n?.createBattleFromSpec === 'function');
  const simdata = namespaces.find((n) => typeof n?.setSimData === 'function');
  const raw = getData({ log: { warn() {} } });
  simdata.setSimData(raw);
  const selected = [
    ...scenariosOf('roster').filter((sc) => ['roster-004', 'roster-005', 'roster-007', 'roster-009', 'roster-039', 'roster-042'].includes(sc.id)),
    ...scenariosOf('bonds').filter((sc) => ['bond-egirShip-high', 'bond-raidShip-high', 'bond-steadShip-high'].includes(sc.id)),
    ...scenariosOf('standins').filter((sc) => ['standin-01', 'standin-09'].includes(sc.id)),
    ...scenariosOf('diy').filter((sc) => ['diy-001', 'diy-019', 'diy-048', 'diy-100', 'diy-135', 'diy-136'].includes(sc.id)),
  ];
  assert.equal(selected.length, 17, 'includes Rockrock/Kjera/Vulpis in both forms, Clementia and Raid/Steadfastness');
  for (const sc of selected) {
    const input = nativeSpec.buildBattleSpec({ ...sc, battleId: sc.id, fieldId: sc.fieldId ?? 'g', content: 'full' });
    const options = { quiet: true, recordEvents: true };
    const native = nativeSpec.createBattleFromSpec(input, new DataSource(raw), options);
    const built = spec.createBattleFromSpec(input, new simdata.DataSource(raw), options);
    native.runToEnd(sc.cap ?? 300);
    built.runToEnd(sc.cap ?? 300);
    assert.ok(native.finished && built.finished, sc.id);
    assert.equal(native.errors.length, 0, sc.id);
    assert.equal(built.errors.length, 0, sc.id);
    assert.deepEqual(spec.compactResult(built.result()), nativeSpec.compactResult(native.result()), sc.id);
    assert.deepEqual(built.snapshot(), native.snapshot(), `${sc.id}: final state`);
    assert.deepEqual(built.drainEvents(), native.drainEvents(), `${sc.id}: battle events`);
  }
});

test('built 0.3.0 collider/block ranges and catapult multihits match Node results, state and events', async () => {
  const simulation = Object.values(manifest).find(m => m.name === 'simulation');
  const ns = Object.values(await import(pathToFileURL(path.join(outDir, simulation.file)).href));
  const spec = ns.find(n => typeof n?.createBattleFromSpec === 'function');
  const simdata = ns.find(n => typeof n?.setSimData === 'function');
  const raw = getData({ log: { warn() {} } }); simdata.setSimData(raw);
  for (const enemyKey of ['enemy_1001_bigbo', 'enemy_10162_mnctpt']) {
    const input = nativeSpec.buildBattleSpec({ seed: 41, kind: 'normal', stageId: 'act1autochess_m01', timeLimit: 40,
      rect: { r0: 9, r1: 12, c0: 0, c1: 10 },
      players: [{ playerId: 'p', units: [
        { uid: 1, chessId: 'chess_char_4_25_a', row: 9, col: 4, dir: 'RIGHT' },
        { uid: 2, chessId: 'chess_char_4_13_a', row: 10, col: 5, dir: 'RIGHT' },
      ], bonds: {} }], routes: [{ motion: 'WALK', start: [9, 8], end: [9, 0] }],
      spawns: [{ enemyKey, count: 3, time: 0, routeIndex: 0 }] });
    const native = nativeSpec.createBattleFromSpec(input, new DataSource(raw), { quiet: true, recordEvents: true });
    const built = spec.createBattleFromSpec(input, new simdata.DataSource(raw), { quiet: true, recordEvents: true });
    native.runToEnd(100); built.runToEnd(100);
    assert.ok(native.finished && built.finished);
    assert.equal(native.errors.length, 0); assert.equal(built.errors.length, 0);
    assert.deepEqual(spec.compactResult(built.result()), nativeSpec.compactResult(native.result()), enemyKey);
    assert.deepEqual(built.snapshot(), native.snapshot(), enemyKey);
    const events = native.drainEvents();
    assert.ok(events.length > 0, 'the representative battle produces events');
    assert.deepEqual(built.drainEvents(), events, enemyKey);
  }
});

test('built Wisdel shadows obey boss/hidden field ownership exactly like Node, including solo empty halves', async () => {
  const simulation = Object.values(manifest).find(m => m.name === 'simulation');
  const namespaces = Object.values(await import(pathToFileURL(path.join(outDir, simulation.file)).href));
  const spec = namespaces.find(n => typeof n?.createBattleFromSpec === 'function');
  const simdata = namespaces.find(n => typeof n?.setSimData === 'function');
  const raw = getData({ log: { warn() {} } });
  simdata.setSimData(raw);
  for (const kind of ['boss', 'hidden']) for (const side of ['L', 'R']) for (const pair of [false, true]) {
    const units = [{ uid: 1, chessId: 'chess_char_6_diy1_a', diy: { charId: 'char_1035_wisdel', skillIndex: 0 }, row: 10, col: 8, dir: 'RIGHT' },
      ...[[9, 8], [11, 8], [12, 8], [9, 9]].map(([row, col], i) => ({ uid: 2 + i, chessId: 'chess_char_1_01_a', row, col }))];
    const players = [{ playerId: 'p1', side, units }];
    if (pair) players.push({ playerId: 'p2', side: side === 'L' ? 'R' : 'L',
      units: [{ uid: 11, chessId: 'chess_char_1_01_a', row: 12, col: 2 }] });
    const input = nativeSpec.buildBattleSpec({ kind, seed: 557, round: 14, stageId: 'act2autochess_m02', players, timeLimit: 45 });
    const native = nativeSpec.createBattleFromSpec(input, new DataSource(raw), { quiet: true, recordEvents: true });
    const built = spec.createBattleFromSpec(input, new simdata.DataSource(raw), { quiet: true, recordEvents: true });
    native.start(); built.start();
    const shadows = b => b.allyUnits.filter(u => u.defId === 'token_10035_wisdel_wward').map(u => [u.tileR, u.tileC]);
    assert.deepEqual(shadows(native), pair ? [[2, side === 'L' ? 11 : 9]] : [], `${kind}/${side}/${pair}: production field rule`);
    assert.deepEqual(shadows(built), shadows(native), `${kind}/${side}/${pair}: bundled shadows`);
    assert.deepEqual(built.snapshot(), native.snapshot());
    assert.deepEqual(built.drainEvents(), native.drainEvents());
    assert.equal(built.errors.length, 0);
  }
});

test('build detection follows built files and separately served worker modules', async () => {
  const initial = computeBuildTag(temp);
  await fs.writeFile(path.join(publicDir, 'index.html'), 'source-only change');
  assert.equal(computeBuildTag(temp), initial, 'unserved source shell does not change the production tag');
  await fs.writeFile(path.join(outDir, manifest['index.html'].file), '// new built code');
  assert.notEqual(computeBuildTag(temp), initial);
  const updated = computeBuildTag(temp);
  await fs.writeFile(path.join(publicDir, 'resource-sw.js'), '// new worker');
  assert.notEqual(computeBuildTag(temp), updated);
  const workerUpdated = computeBuildTag(temp);
  await fs.mkdir(path.join(temp, 'shared'), { recursive: true });
  await fs.writeFile(path.join(temp, 'shared/i18n.js'), '// resource categories used by the worker');
  assert.notEqual(computeBuildTag(temp), workerUpdated);
  const sharedUpdated = computeBuildTag(temp);
  await fs.writeFile(path.join(temp, 'shared/resourcePaths.js'), '// resource path rules used by the worker');
  assert.notEqual(computeBuildTag(temp), sharedUpdated);
  for (const file of ['public/js/battle/simWorker.js', 'server/sim/spec.js', 'shared/plugins/scriptLoad.js', 'shared/resourcePackRoutes.js']) {
    const previous = computeBuildTag(temp);
    await fs.mkdir(path.dirname(path.join(temp, file)), { recursive: true });
    await fs.writeFile(path.join(temp, file), '// changed raw Worker dependency');
    assert.notEqual(computeBuildTag(temp), previous, file);
  }

});
