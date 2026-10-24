// Dedicated to persistence so a save never waits behind battle simulation or AI rehearsal.
import { parentPort, workerData } from 'node:worker_threads';
import { encodeMatchCapture } from '../match/snapshot.js';
import { memorySample } from './memory.js';
import { deserialize } from 'node:v8';
import { performance } from 'node:perf_hooks';

const checkpoints = new Map();
const recovery = new Map();
let staged = null;
let stagedValues = [];
// Immutable after publication. A restarted Worker can reuse the last successful snapshot without synchronously
// structured-cloning tens of MB from the game thread in its workerData. Redis still receives the same UTF-8 JSON.
function encodeDocument(doc) {
  const json = JSON.stringify(doc);
  const bytes = new Uint8Array(new SharedArrayBuffer(Buffer.byteLength(json)));
  new TextEncoder().encodeInto(json, bytes);
  return bytes;
}
function unpack({ scalar, references, seats }) {
  const row = { ...scalar };
  for (const [key, id] of references) {
    if (!Number.isInteger(id) || id < 0 || id >= stagedValues.length) throw new Error('missing persistence profile');
    Object.defineProperty(row, key, { value: stagedValues[id], enumerable: true, configurable: true, writable: true });
  }
  if (seats) row.seats = seats.map(unpack);
  return row;
}
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
      const bytes = encodeDocument(payload.doc);
      parentPort.postMessage({ id, bytes, memory: memorySample() });
    } else if (type === 'checkpoint' || type === 'checkpointBytes') {
      const capture = type === 'checkpointBytes' ? deserialize(payload.bytes) : payload.capture;
      const checkpoint = encodeMatchCapture(capture);
      if (!checkpoint) throw new Error('match checkpoint could not be encoded');
      // Concurrent lane captures can finish after a new Match reused the room key.
      if (!checkpoints.has(payload.key) || checkpoints.get(payload.key).generation <= payload.generation) {
        checkpoints.set(payload.key, { generation: payload.generation, checkpoint });
      }
      parentPort.postMessage({ id, memory: memorySample() });
    } else if (type === 'documentStart') {
      staged = { ...payload.doc, ...(payload.sessions ? { sessions: [] } : {}), ...(payload.rooms ? { rooms: [] } : {}),
        ...(payload.userResultOutbox ? { userResultOutbox: [] } : {}) };
      stagedValues = [];
      parentPort.postMessage({ id });
    } else if (type === 'documentBatch') {
      if (!staged) throw new Error('missing persistence document');
      stagedValues.push(...payload.values);
      if (payload.field === 'recoveryUpdates') {
        for (const [key, entry] of payload.rows) recovery.set(key, entry);
      } else if (['sessions', 'rooms', 'userResultOutbox'].includes(payload.field) && Array.isArray(staged[payload.field])) {
        staged[payload.field].push(...payload.rows.map(unpack));
      } else throw new Error('invalid persistence document batch');
      parentPort.postMessage({ id });
    } else if (type === 'serialize') {
      const started = performance.now();
      if (payload.staged && !staged) throw new Error('missing persistence document');
      const active = new Map(payload.entries.map(({ key, generation }) => [key, generation]));
      const matches = {};
      for (const [key, entry] of checkpoints) {
        if (active.get(key) !== entry.generation) {
          // A new match can start while metadata batches yield. Keep its checkpoint for the next save.
          if (entry.generation <= (payload.generationLimit ?? Infinity)) checkpoints.delete(key);
          continue;
        }
        matches[key] = entry.checkpoint;
      }
      let doc = payload.staged ? staged : payload.doc;
      if (payload.staged) { staged = null; stagedValues = []; }
      if (payload.recoveryKeys) {
        const activeRecovery = new Set(payload.recoveryKeys);
        for (const key of recovery.keys()) if (!activeRecovery.has(key)) recovery.delete(key);
        for (const [key, entry] of payload.recoveryUpdates || []) if (activeRecovery.has(key)) recovery.set(key, entry);
        for (const key of activeRecovery) if (!recovery.has(key)) throw new Error('missing retained recovery checkpoint');
        doc = { ...doc, recovery: Object.fromEntries(recovery) };
      }
      const bytes = encodeDocument({ ...doc, matches });
      parentPort.postMessage({ id, bytes, keys: Object.keys(matches), encodeMs: performance.now() - started,
        memory: memorySample() });
    } else throw new Error(`unknown persistence task: ${type}`);
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
