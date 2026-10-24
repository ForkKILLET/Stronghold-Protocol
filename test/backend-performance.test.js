import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkerStateEncoder } from '../server/workers/stateEncoder.js';
import { attachWorkerState, negotiateStateDelta, prepareStateFrame, resetStateDelta } from '../server/stateTransport.js';
import { StateReceiver } from '../shared/stateDelta.js';
import { MatchWorkerPool, encodedMessage } from '../server/workers/matchPool.js';
import { Persister } from '../server/persist.js';
import { createPluginRegistry } from '../server/plugins/registry.js';
import { BackgroundClient } from '../server/workers/backgroundClient.js';
import { rewriteAssetPaths } from '../shared/cdn.js';

test('worker deltas preserve private ownership, skipped sends, reconnects and replacement Matches without main JSON parsing', () => {
  const encoder = new WorkerStateEncoder(), owner = {}, ws = {}, receiver = new StateReceiver();
  negotiateStateDelta(ws, 1);
  const prepare = (value, player = 'a', match = owner) => {
    const encoded = JSON.stringify(value);
    const frame = encoder.encode(value.t, encoded, player);
    const msg = attachWorkerState(encodedMessage(value.t, encoded), encoded, frame, match);
    const parse = JSON.parse;
    JSON.parse = () => { throw new Error('main thread parsed worker state'); };
    try { return prepareStateFrame(ws, msg, encoded); } finally { JSON.parse = parse; }
  };
  const value = (n) => ({ t: 'm.private', n, padding: 'x'.repeat(2048) });
  const deliver = (frame, expected, full) => {
    const wire = JSON.parse(frame.data);
    assert.equal(Object.hasOwn(wire, 'full'), full);
    assert.deepEqual(receiver.receive(wire).message, expected);
    frame.commit();
  };
  deliver(prepare(value(1)), value(1), true);
  deliver(prepare(value(2)), value(2), false);
  prepare(value(3)); // failed socket send: do not commit
  deliver(prepare(value(4)), value(4), true);
  deliver(prepare(value(5), 'b'), value(5), true);
  deliver(prepare(value(6), 'a'), value(6), true);
  resetStateDelta(ws);
  deliver(prepare(value(7)), value(7), true);
  deliver(prepare(value(8), 'a', {}), value(8), true);
  const legacy = prepareStateFrame({}, { t: 'm.private' }, JSON.stringify(value(9)));
  assert.deepEqual(JSON.parse(legacy.data), value(9));
});

test('new Matches avoid loaded or stale lanes without moving existing assignments', async (t) => {
  const pool = new MatchWorkerPool({ data: {}, lanes: 2 });
  t.after(() => pool.close());
  const [busy, idle] = pool.lanes;
  busy.matches.set('busy', {}); idle.matches.set('idle', {});
  pool.onMessage(busy, { type: 'load', load: { utilization: .95, workQueued: 20, delayP99Ms: 100 } });
  pool.onMessage(idle, { type: 'load', load: { utilization: .1, workQueued: 0, delayP99Ms: 0 } });
  assert.equal(pool.laneFor('new'), idle);
  idle.load.utilization = .99;
  assert.equal(pool.laneFor('new'), idle, 'existing ownership is stable');
  idle.load.utilization = .1;
  busy.load = { utilization: 0 }; busy.loadAt = Date.now() - 10000;
  assert.equal(pool.laneFor('next'), idle, 'stalled heartbeat is not interpreted as idle');
  assert.equal(pool.stats().lanes[0].loadAgeMs >= 10000, true);
  busy.matches.clear(); idle.matches.clear();
});

test('checkpoint collection advances healthy lanes while a lane is blocked, with bounded capture concurrency', async (t) => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const seen = [], laneA = {}, laneB = {}, laneC = {};
  const entries = [laneA, laneA, laneB, laneB, laneC].map((lane, i) => ({ key: String(i), match: { lane } }));
  const persister = new Persister({ registry: {}, lobby: { persistenceMatches: () => entries }, checkpointConcurrency: 2 });
  t.after(() => persister.encoder.close());
  let active = 0, max = 0;
  persister.captureCheckpoint = async ({ key }) => {
    seen.push(key); active++; max = Math.max(max, active);
    if (key === '0') await blocked;
    active--;
    return true;
  };
  const save = persister.checkpointMatches();
  await new Promise(setImmediate);
  assert.deepEqual(seen, ['0', '2', '3', '4']);
  assert.equal(max, 2);
  release(); await save;
  assert.deepEqual(seen, ['0', '2', '3', '4', '1']);
});

test('background plugin rescans atomically replace snapshots and do no synchronous main-thread file I/O', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-background-test-'));
  const dirs = Object.fromEntries(['public', 'data', 'packs', 'plugins'].map((name) => [`${name}Dir`, path.join(root, name)]));
  await fsp.mkdir(path.join(dirs.publicDir, 'i18n'), { recursive: true });
  const file = path.join(dirs.publicDir, 'i18n', 'en.json');
  await fsp.writeFile(file, JSON.stringify({ _meta: { name: 'English' }, start: 'Start' }));
  const registry = createPluginRegistry(dirs, { background: true, recheckMs: 0 });
  t.after(async () => { await registry.close(); await fsp.rm(root, { recursive: true, force: true }); });
  await registry.refresh(true);
  const before = registry.index();
  let scans = 0; registry.onScan(() => scans++);
  for (const method of ['readFileSync', 'statSync', 'readdirSync', 'opendirSync']) {
    t.mock.method(fs, method, () => { throw new Error(`main-thread ${method}`); });
  }
  await fsp.writeFile(file, JSON.stringify({ _meta: { name: 'Renamed' }, start: 'Start' }));
  await registry.rescan();
  assert.notDeepEqual(registry.index(), before);
  assert.ok(scans > 0);
  assert.ok(registry.vanillaAssets());
});

test('a stalled checkpoint cannot hold healthy lanes or accumulate duplicate capture requests across saves', async (t) => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const lane = {}, entries = [{ key: 'slow', match: { lane } }, { key: 'same-lane', match: { lane } },
    { key: 'healthy', match: { lane: {} } }];
  const persister = new Persister({ registry: {}, lobby: { persistenceMatches: () => entries }, checkpointWaitMs: 10 });
  t.after(async () => { release(); await persister.encoder.close(); });
  const seen = [];
  persister.captureCheckpoint = async ({ key }) => { seen.push(key); if (key === 'slow') await blocked; return true; };
  await persister.checkpointMatches();
  await persister.checkpointMatches();
  assert.deepEqual(seen, ['slow', 'healthy', 'healthy']);
  assert.equal(persister.checkpointStats().timeouts, 2);
  release();
});

test('background manifest encoding preserves CDN output and transfers owned bytes', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sp-manifest-test-'));
  const client = new BackgroundClient(new URL('../server/workers/manifestEncode.js', import.meta.url));
  t.after(async () => { await client.close(); await fsp.rm(root, { recursive: true, force: true }); });
  const file = path.join(root, 'assets.json'), value = { chars: { a: { avatar: '/assets/a.png' } } };
  await fsp.writeFile(file, JSON.stringify(value));
  const bytes = await client.request({ file, cdn: 'https://cdn.example' });
  assert.deepEqual(JSON.parse(Buffer.from(bytes).toString()), rewriteAssetPaths(value, 'https://cdn.example'));
  await fsp.writeFile(file, 'broken');
  await assert.rejects(client.request({ file, cdn: '' }));
  await fsp.writeFile(file, '{}');
  assert.equal(Buffer.from(await client.request({ file, cdn: '' })).toString(), '{}');
});

test('failed account-store startup closes the newly introduced background scanner', async t => {
  const { startServer } = await import('../server/index.js');
  const { BackgroundClient } = await import('../server/workers/backgroundClient.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-startup-cleanup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const clients = new Set(), request = BackgroundClient.prototype.request;
  t.mock.method(BackgroundClient.prototype, 'request', function (...args) { clients.add(this); return request.apply(this, args); });
  await assert.rejects(startServer({ host: '127.0.0.1', port: 0, workers: 0, quiet: true, userFile: root }), /unable to open database/);
  assert.ok(clients.size > 0, 'startup actually created a background client');
  assert.ok([...clients].every(client => client.closed && !client.worker), 'a failed start owns no idle scanner thread');
});
