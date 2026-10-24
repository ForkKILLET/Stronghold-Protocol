// Serialization-only benchmark: repeat a real four-seat R4 state; FakeBattle only advances the fixture quickly.
// No browser, Redis traffic, or concurrent battle CPU is included.
import { performance } from 'node:perf_hooks';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { makeMatch } from '../test/match/harness.js';
import { canSnapshot, snapshotMatch } from '../server/match/snapshot.js';
import { Persister } from '../server/persist.js';
import { PersistenceWorker } from '../server/workers/persistenceClient.js';

// Synthetic metadata load, separate from the real-match fixture below. No Redis or live service is contacted.
if (process.argv.includes('--metadata')) {
  const sessions = Array.from({ length: 3000 }, (_, i) => ({ playerId: `p${i}`, token: `token${i}`,
    loadout: Object.fromEntries(Array.from({ length: 300 }, (_, j) => [`char_${j}`, { skill: 1, potential: 6, module: 0 }])) }));
  const rooms = Array.from({ length: 1000 }, (_, i) => ({ code: `R${i}`,
    seats: sessions.slice(i * 3, i * 3 + 3).map(s => ({ playerId: s.playerId, loadout: s.loadout })) }));
  const doc = { v: 1, sessions, rooms, recovery: {} };
  const documentBytes = Buffer.byteLength(JSON.stringify(doc));
  const worker = new PersistenceWorker();
  try {
    await worker.serialize({ v: 1 }, []); // exclude thread startup
    for (let round = 0; round < 3; round++) {
      let longestGap = 0, previous = performance.now();
      const heartbeat = setInterval(() => {
        const now = performance.now();
        longestGap = Math.max(longestGap, now - previous); previous = now;
      }, 1);
      try {
        await nextTurn();
        const start = performance.now();
        const result = await worker.serialize(doc, []);
        await new Promise(resolve => setTimeout(resolve, 5));
        console.log(JSON.stringify({ fixture: 'synthetic-metadata', round, documentBytes,
          totalMs: +(performance.now() - start).toFixed(2), postMs: +result.postMs.toFixed(2),
          postMaxMs: result.postMaxMs, postBatches: result.postBatches,
          largestHeartbeatGapMs: +longestGap.toFixed(2) }));
      } finally { clearInterval(heartbeat); }
    }
  } finally { await worker.close(); }
  process.exit(0);
}

const h = makeMatch({ humans: 1, bots: 3, seed: 42, fake: true, captureFrames: false });
h.start();
if (!h.drive(() => h.m.round === 4 && h.m.phase === 'PREP' && canSnapshot(h.m), { maxSteps: 1e6 })) {
  throw new Error('could not reach benchmark prep');
}
const fixtureBytes = Buffer.byteLength(JSON.stringify(snapshotMatch(h.m)));
for (const count of [1, 50, 250]) {
  const items = Array.from({ length: count }, (_, i) => ({ key: `queue:M${i}`, match: h.m }));
  let baselineMs = 0;
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    const matches = Object.fromEntries(items.map(({ key, match }) => [key, snapshotMatch(match)]));
    JSON.stringify({ matches });
    baselineMs += performance.now() - start;
    await nextTurn();
  }
  let bytes = 0;
  const persister = new Persister({ registry: { all: () => [] },
    lobby: { rooms: new Map(), persistenceMatches: () => items },
    store: { async saveSerialized(buffer) { bytes = buffer.byteLength; return true; } },
  });
  let heartbeat;
  try {
    await persister.flush('warmup');
    let mainMs = 0, copyMaxMs = 0;
    const request = persister.encoder.request.bind(persister.encoder);
    persister.encoder.request = (...args) => {
      const start = performance.now();
      const result = request(...args);
      const duration = performance.now() - start;
      mainMs += duration;
      copyMaxMs = Math.max(copyMaxMs, duration);
      return result;
    };
    let longestGap = 0, previous = performance.now();
    heartbeat = setInterval(() => {
      const now = performance.now();
      longestGap = Math.max(longestGap, now - previous);
      previous = now;
    }, 1);
    const start = performance.now();
    for (let i = 0; i < 5; i++) {
      if (!await persister.flush('bench')) throw new Error('benchmark save failed');
      await nextTurn();
    }
    clearInterval(heartbeat);
    console.log(JSON.stringify({ matches: count, fixtureBytes, documentBytes: bytes,
      synchronousBaselineMs: +(baselineMs / 5).toFixed(2),
      averageSaveMs: +((performance.now() - start) / 5).toFixed(2),
      averageMainPostMs: +(mainMs / 5).toFixed(2), largestPostMs: +copyMaxMs.toFixed(2),
      largestHeartbeatGapMs: +longestGap.toFixed(2) }));
  } finally { clearInterval(heartbeat); await persister.encoder.close(); }
}
h.m.dispose();
