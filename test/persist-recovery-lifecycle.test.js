import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { SessionRegistry } from '../server/net.js';
import { Lobby } from '../server/lobby.js';
import { restoreServer, snapshotServer, Persister, PERSIST_VERSION, SAVE_MS } from '../server/persist.js';
import { PersistenceWorker } from '../server/workers/persistenceClient.js';
import { shutdownTimeoutMs } from '../server/http/boot.js';

function fixture(t, mode = 'solo') {
  let now = 1_000_000;
  const create = () => {
    const registry = new SessionRegistry({ now: () => now });
    const lobby = new Lobby({ registry, now: () => now, getData: () => ({}) });
    t.after(() => lobby.shutdown());
    return { registry, lobby };
  };
  const player = { playerId: 'p_owner', isBot: false, left: false, name: 'Owner', seat: 0 };
  const doc = { v: PERSIST_VERSION, savedAt: now, sessions: [{ ...player, token: 'original-token',
    connected: true, disconnectedAt: now, resumeWindowMs: null, roomCode: 'ABCD' }],
    rooms: [{ code: 'ABCD', mode, difficulty: 'NORMAL', hostId: player.playerId, seats: [player] }],
    matches: { ABCD: { mode, roomCode: 'ABCD', phase: 'PREP', seed: 42, savedAt: 0, players: [player] } } };
  const restore = async (document) => {
    const env = create();
    const stats = restoreServer({ doc: document, ...env, now });
    if (stats.ready) await stats.ready;
    return { ...env, stats };
  };
  return { doc, restore, create, now: () => now, advance: ms => { now += ms; } };
}

test('expired legacy solo checkpoints are omitted at load, subsequent saves, and another restart', async t => {
  const f = fixture(t);
  f.doc.sessions[0].connected = false;
  f.doc.sessions[0].resumeWindowMs = 24 * 3600_000;
  f.advance(7 * 3600_000);
  const env = await f.restore(f.doc);
  assert.equal(env.registry.size, 0);
  assert.equal(env.lobby.rooms.size, 0);
  assert.equal(env.lobby.recoveryDocs.size, 0);
  const saved = snapshotServer({ ...env, now: f.now() });
  assert.deepEqual(saved.recovery, {});
  assert.equal((await f.restore(saved)).lobby.recoveryDocs.size, 0);
});

test('deferred solo identities keep six hours and repeated saves/restarts never renew their deadline', async t => {
  const f = fixture(t);
  const first = await f.restore(f.doc);
  assert.equal(first.lobby.recoveryDocs.size, 1, 'missing game data keeps a valid identity');
  assert.equal(first.registry.byId('p_owner').resumeWindowMs, 6 * 3600_000);
  f.advance(5 * 3600_000);
  const saved = snapshotServer({ ...first, now: f.now() });
  assert.equal(saved.recovery.ABCD.sessions[0].connected, false);
  assert.equal(saved.recovery.ABCD.sessions[0].disconnectedAt, 1_000_000);
  const second = await f.restore(saved);
  assert.equal(second.lobby.recoveryDocs.size, 1);
  f.advance(3600_000 + 1);
  const expired = snapshotServer({ ...second, now: f.now() });
  assert.deepEqual(expired.recovery, {});
  assert.equal(second.lobby.recoveryRemoved.expired, 1);
  assert.equal((await f.restore(expired)).lobby.recoveryDocs.size, 0);
});

test('co-op recovery lasts until the last original human expires and never uses a simulation timestamp', async t => {
  const f = fixture(t, 'coop');
  f.doc.sessions[0].connected = false;
  const env = await f.restore(f.doc);
  assert.equal(env.lobby.recoveryDocs.size, 1);
  const companion = env.registry.create('Companion');
  const entry = env.lobby.recoveryDocs.get('ABCD');
  entry.checkpoint.players.push({ playerId: companion.playerId, isBot: false, left: false });
  companion.connected = true;
  f.advance(10 * 60_000 + 1);
  assert.ok(snapshotServer({ ...env, now: f.now() }).recovery.ABCD, 'one online teammate keeps recovery');
  companion.connected = false;
  companion.disconnectedAt = f.now();
  f.advance(10 * 60_000 + 1);
  assert.deepEqual(snapshotServer({ ...env, now: f.now() }).recovery, {});
});

test('legacy superseded archives are discarded, while an unrelated unexpired recovery is retained', async t => {
  const f = fixture(t);
  f.doc.recovery = { 'superseded:OLD': { checkpoint: { players: [{ playerId: 'old' }] }, superseded: true } };
  const env = await f.restore(f.doc);
  assert.equal(env.lobby.recoveryRemoved.superseded, 1);
  assert.deepEqual([...env.lobby.recoveryDocs.keys()], ['ABCD']);
});

test('recovery only counts original human owners; bot, spectator, departed and replacement tokens cannot retain it', async t => {
  const f = fixture(t);
  const env = await f.restore(f.doc);
  const entry = env.lobby.recoveryDocs.get('ABCD');
  env.registry.byId('p_owner').token = 'different-identity';
  const spectator = env.registry.create('Spectator');
  spectator.connected = true;
  env.lobby.recoveryDocs.set('ABCD', { ...entry, sessions: [...entry.sessions,
    { playerId: spectator.playerId, token: spectator.token, connected: true }] });
  assert.deepEqual(snapshotServer({ ...env, now: f.now() }).recovery, {});
  env.lobby.recoveryDocs.set('ABCD', { ...entry, departedPlayerIds: ['p_owner'] });
  assert.deepEqual(snapshotServer({ ...env, now: f.now() }).recovery, {});
  env.lobby.recoveryDocs.set('ABCD', { checkpoint: { players: [{ playerId: 'bot', isBot: true }] }, sessions: [null] });
  assert.deepEqual(snapshotServer({ ...env, now: f.now() }).recovery, {});
});

test('unchanged recovery is not cloned on every save; replacements, removal and Worker restart stay lossless', async t => {
  const worker = new PersistenceWorker();
  t.after(() => worker.close());
  let reads = 0;
  const entry = { get checkpoint() { reads++; return { payload: 'x'.repeat(100_000) }; } };
  let doc = { v: 1, recovery: { ABCD: entry } };
  const first = await worker.serialize(doc, []);
  worker.remember(first.bytes, []);
  assert.equal(reads, 1);
  const second = await worker.serialize(doc, []);
  assert.equal(reads, 1, 'large checkpoint is not walked again on the main thread');
  assert.deepEqual(second.bytes, first.bytes);
  worker.drop(worker.worker, new Error('test restart'));
  assert.deepEqual((await worker.serialize(doc, [])).bytes, first.bytes);
  assert.equal(reads, 2, 'changed Worker receives the retained checkpoint again');
  doc = { v: 1, recovery: { ABCD: { checkpoint: { seed: 2 } } } };
  const replaced = await worker.serialize(doc, []);
  assert.equal(JSON.parse(Buffer.from(replaced.bytes).toString()).recovery.ABCD.checkpoint.seed, 2);
  const removed = await worker.serialize({ v: 1, recovery: {} }, []);
  assert.deepEqual(JSON.parse(Buffer.from(removed.bytes).toString()).recovery, {});
  assert.equal(worker.recoveryRefs.size, 0);
});

test('periodic checks use thirty seconds and shutdown always forces a final save before closing', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  assert.equal(SAVE_MS, 30_000);
  const writer = new Persister({ registry: { all: () => [] }, lobby: { rooms: new Map(), persistenceMatches: () => [] },
    store: { async saveSerialized() { return true; } } });
  t.after(() => writer.encoder.close());
  const reasons = [];
  const flush = writer.flush.bind(writer);
  writer.flush = async reason => { reasons.push(reason); return true; };
  writer.start();
  t.mock.timers.tick(29_999);
  assert.deepEqual(reasons, []);
  t.mock.timers.tick(1);
  assert.deepEqual(reasons, ['interval']);
  writer.flush = flush;
  assert.equal(await writer.shutdown(), true);
  assert.equal(writer.writes, 1);
  assert.equal(writer.lastTiming.reason, 'shutdown');
  assert.ok(writer.lastTiming.totalMs >= 0);
  assert.ok(writer.lastTiming.encodeMs >= 0);
  assert.equal(writer.encoder.closed, true);
});

test('graceful process exit allows final saving longer than the former five-second cutoff', { timeout: 15_000 }, async () => {
  assert.equal(shutdownTimeoutMs(undefined), 60_000);
  assert.equal(shutdownTimeoutMs('invalid'), 60_000);
  assert.equal(shutdownTimeoutMs('120000'), 120_000);
  const script = `import { runMain } from './server/http/boot.js';
    await runMain(async () => ({ url: 'http://127.0.0.1:0', host: '127.0.0.1', port: 0,
      close: async () => { await new Promise(r => setTimeout(r, 5500)); console.log('FINAL_SAVE_COMPLETE'); } }));
    process.emit('SIGTERM');`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script],
    { cwd: new URL('..', import.meta.url), env: { ...process.env, SP_SHUTDOWN_TIMEOUT_MS: '60000' }, windowsHide: true });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 0, output);
  assert.match(output, /FINAL_SAVE_COMPLETE/);
});
