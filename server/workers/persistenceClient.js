import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

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
  }

  remember(bytes, entries) { this.seed = { bytes, entries }; }
  rememberDocument(doc, entries) { this.seed = { doc, entries }; }

  /** Unchanged recovery checkpoints stay in the Worker; periodic saves send only identities and replacements. */
  async serialize(document, entries) {
    const { recovery = {}, ...doc } = document;
    const refs = new Map(Object.entries(recovery));
    const recoveryUpdates = [...refs].filter(([key, entry]) => this.recoveryRefs.get(key) !== entry);
    const pending = this.request('serialize', { doc, entries, recoveryKeys: [...refs.keys()], recoveryUpdates });
    const worker = this.worker;
    const result = await pending;
    if (this.worker === worker) this.recoveryRefs = refs;
    return result;
  }

  request(type, payload, transfer = []) {
    if (this.closed) return Promise.reject(new Error('persistence worker closed'));
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
        const started = performance.now();
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
