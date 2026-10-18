// Dedicated to persistence so a save never waits behind battle simulation or AI rehearsal.
import { parentPort, workerData } from 'node:worker_threads';
import { encodeMatchCapture } from '../match/snapshot.js';
import { memorySample } from './memory.js';
import { deserialize } from 'node:v8';
import { performance } from 'node:perf_hooks';

const checkpoints = new Map();
const recovery = new Map();
function seed(doc, entries) {
  recovery.clear();
  for (const [key, entry] of Object.entries(doc.recovery || {})) recovery.set(key, entry);
  for (const { key, generation } of entries) {
    const checkpoint = doc.matches?.[key];
    if (checkpoint) checkpoints.set(key, { generation, checkpoint });
  }
}
if (workerData?.seed) {
  const { doc, bytes, entries } = workerData.seed;
  seed(doc || JSON.parse(new TextDecoder().decode(bytes)), entries);
}

parentPort.on('message', ({ id, type, payload }) => {
  try {
    if (type === 'seed') {
      seed(payload.doc, payload.entries);
      const bytes = new TextEncoder().encode(JSON.stringify(payload.doc));
      parentPort.postMessage({ id, bytes, memory: memorySample() }, [bytes.buffer]);
    } else if (type === 'checkpoint' || type === 'checkpointBytes') {
      const capture = type === 'checkpointBytes' ? deserialize(payload.bytes) : payload.capture;
      const checkpoint = encodeMatchCapture(capture);
      if (!checkpoint) throw new Error('match checkpoint could not be encoded');
      // Concurrent lane captures can finish after a new Match reused the room key.
      if (!checkpoints.has(payload.key) || checkpoints.get(payload.key).generation <= payload.generation) {
        checkpoints.set(payload.key, { generation: payload.generation, checkpoint });
      }
      parentPort.postMessage({ id, memory: memorySample() });
    } else if (type === 'serialize') {
      const started = performance.now();
      const active = new Map(payload.entries.map(({ key, generation }) => [key, generation]));
      const matches = {};
      for (const [key, entry] of checkpoints) {
        if (active.get(key) !== entry.generation) { checkpoints.delete(key); continue; }
        matches[key] = entry.checkpoint;
      }
      let doc = payload.doc;
      if (payload.recoveryKeys) {
        const activeRecovery = new Set(payload.recoveryKeys);
        for (const key of recovery.keys()) if (!activeRecovery.has(key)) recovery.delete(key);
        for (const [key, entry] of payload.recoveryUpdates || []) if (activeRecovery.has(key)) recovery.set(key, entry);
        for (const key of activeRecovery) if (!recovery.has(key)) throw new Error('missing retained recovery checkpoint');
        doc = { ...doc, recovery: Object.fromEntries(recovery) };
      }
      const bytes = new TextEncoder().encode(JSON.stringify({ ...doc, matches }));
      parentPort.postMessage({ id, bytes, keys: Object.keys(matches), encodeMs: performance.now() - started,
        memory: memorySample() }, [bytes.buffer]);
    } else throw new Error(`unknown persistence task: ${type}`);
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
