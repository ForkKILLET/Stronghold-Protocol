import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { setImmediate as nextTurn } from 'node:timers/promises';

// Bound each structured clone, not just the asynchronous encoding time. Rooms contain at most four seats.
const DOCUMENT_BATCH_ROWS = 8;

/** Lazy, single dedicated Worker with bounded requests. Failures skip a save; never encode on the game thread. */
export class PersistenceWorker {
  constructor({ timeoutMs = 10_000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.worker = null;
    this.pending = new Map();
    this.nextId = 0;
    this.closed = false;
    this.seed = null;
    this.memory = null;
    this.stopping = new Set();
    this.recoveryRefs = new Map();
    this.serializing = false;
  }

  remember(bytes, entries) { this.seed = { bytes, entries }; }
  rememberDocument(doc, entries) { this.seed = { doc, entries }; }

  /** Unchanged recovery checkpoints stay in the Worker; periodic saves send only identities and replacements. */
  async serialize(document, entries, generationLimit = Infinity) {
    if (this.serializing) throw new Error('persistence document already in progress');
    const { recovery = {}, sessions, rooms, userResultOutbox, ...doc } = document;
    const refs = new Map(Object.entries(recovery));
    const recoveryUpdates = [...refs].filter(([key, entry]) => this.recoveryRefs.get(key) !== entry);
    // Session and seat profiles usually share the same immutable objects. Preserve this sharing across batches,
    // but rebuild the table each save so in-place changes in legacy/restored data cannot go unnoticed.
    const identities = new WeakMap();
    let nextIdentity = 0, values = [];
    const pack = (row, room = false) => {
      const scalar = {}, references = [];
      for (const [key, value] of Object.entries(row)) {
        if (room && key === 'seats') continue;
        if (value && typeof value === 'object') {
          if (!identities.has(value)) {
            identities.set(value, nextIdentity++);
            values.push(value);
          }
          references.push([key, identities.get(value)]);
        } else scalar[key] = value;
      }
      return { scalar, references, ...(room && Array.isArray(row.seats) ? { seats: row.seats.map(seat => pack(seat)) } : {}) };
    };
    let worker, postMs = 0, postMaxMs = 0, postBatches = 0;
    const send = async (type, payload) => {
      if (worker && this.worker !== worker) throw new Error('persistence worker changed during document transfer');
      const pending = this.request(type, payload);
      worker ||= this.worker;
      const result = await pending;
      if (this.worker !== worker) throw new Error('persistence worker changed during document transfer');
      postMs += result.postMs;
      postMaxMs = Math.max(postMaxMs, result.postMs);
      postBatches++;
      return result;
    };
    this.serializing = true;
    try {
      // The Worker assembles the same JSON document. Await each batch to bound its queue and let sockets/timers run.
      await send('documentStart', { doc, sessions: Array.isArray(sessions), rooms: Array.isArray(rooms),
        userResultOutbox: Array.isArray(userResultOutbox) });
      for (const [field, rows] of [['sessions', sessions], ['rooms', rooms], ['userResultOutbox', userResultOutbox], ['recoveryUpdates', recoveryUpdates]]) {
        if (!rows) continue;
        const size = ['recoveryUpdates', 'userResultOutbox'].includes(field) ? 1 : DOCUMENT_BATCH_ROWS;
        for (let offset = 0; offset < rows.length; offset += size) {
          const batch = rows.slice(offset, offset + size);
          const packed = field === 'recoveryUpdates' ? batch : batch.map(row => pack(row, field === 'rooms'));
          await send('documentBatch', { field, rows: packed, values });
          values = [];
          await nextTurn();
        }
      }
      const result = await send('serialize', { staged: true, entries, generationLimit, recoveryKeys: [...refs.keys()] });
      this.recoveryRefs = refs;
      return { ...result, postMs, postMaxMs, postBatches };
    } catch (error) {
      // Never finish a partially transferred document on a fresh Worker or reuse its recovery cache.
      if (worker) this.drop(worker, error);
      throw error;
    } finally { this.serializing = false; }
  }

  request(type, payload, transfer = []) {
    if (this.closed) return Promise.reject(new Error('persistence worker closed'));
    const started = performance.now();
    if (!this.worker) {
      const worker = new Worker(new URL('./persistence.js', import.meta.url), { workerData: { seed: this.seed } });
      this.worker = worker;
      worker.on('message', ({ id, error, ...value }) => {
        if (value.memory) this.memory = value.memory;
        const task = this.pending.get(id);
        if (!task) return;
        this.pending.delete(id);
        clearTimeout(task.timer);
        if (error) task.reject(new Error(error));
        else task.resolve({ ...value, postMs: task.postMs });
        if (this.pending.size === 0) worker.unref();
      });
      worker.on('error', (err) => this.drop(worker, err));
      worker.on('exit', (code) => this.drop(worker, new Error(`persistence worker exited (${code})`)));
      worker.unref();
    }
    const worker = this.worker;
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.drop(worker, new Error('persistence worker timed out')), this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      worker.ref();
      try {
        worker.postMessage({ id, type, payload }, transfer);
        this.pending.get(id).postMs = performance.now() - started;
      }
      catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e);
        if (this.pending.size === 0) worker.unref();
      }
    });
  }

  drop(worker, err) {
    if (this.worker !== worker) return;
    this.worker = null;
    this.recoveryRefs.clear();
    for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(err); }
    this.pending.clear();
    const stopped = worker.terminate().catch(() => {}).finally(() => this.stopping.delete(stopped));
    this.stopping.add(stopped);
  }

  async close() {
    this.closed = true;
    if (this.worker) this.drop(this.worker, new Error('persistence worker closed'));
    await Promise.all([...this.stopping]);
    this.seed = null;
    this.memory = null;
  }
}
