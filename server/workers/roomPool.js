// Room-pinned simulation lanes.
//
// The WebSocket and Match object remain on the main thread in this first phase. A room's battle/rehearsal work is
// pinned to one lane instead of contending in one global simulation queue.
import { SimulationPool, workerSettings } from './pool.js';

export class RoomWorkerPool {
  constructor({ data, lanes = 1, totalWorkers = 1, maxQueue = 256, timeoutMs = 120000, workerUrl } = {}) {
    if (!Number.isInteger(lanes) || lanes < 1 || lanes > 32) throw new RangeError('room worker lanes must be 1..32');
    if (!Number.isInteger(totalWorkers) || totalWorkers < lanes || totalWorkers > 32) {
      throw new RangeError('room worker total must be between lanes and 32');
    }
    this.lanes = Array.from({ length: lanes }, (_, i) => ({
      id: i,
      rooms: new Set(),
      pool: new SimulationPool({
        data,
        size: Math.max(1, Math.ceil((totalWorkers - i) / lanes)),
        maxQueue,
        timeoutMs,
        ...(workerUrl ? { workerUrl } : {}),
      }),
    }));
    this.assignments = new Map();
    this.closed = false;
  }

  /** Pin a room or standalone match key to the least-loaded lane. */
  assign(key) {
    const id = String(key || '');
    const existing = this.assignments.get(id);
    if (existing != null) return this.lanes[existing].pool;
    const lane = this.lanes.reduce((best, current) => current.rooms.size < best.rooms.size ? current : best, this.lanes[0]);
    lane.rooms.add(id);
    this.assignments.set(id, lane.id);
    return lane.pool;
  }

  has(key) { return this.assignments.has(String(key || '')); }

  /** Unpinned callers share one of the existing lanes, never allocate another pool. */
  submit(type, payload, options) {
    const lane = this.lanes.reduce((a, b) => {
      const x = a.pool.stats(), y = b.pool.stats();
      return y.busy + y.queued < x.busy + x.queued ? b : a;
    });
    return lane.pool.submit(type, payload, options);
  }

  release(key) {
    const id = String(key || '');
    const laneId = this.assignments.get(id);
    if (laneId == null) return;
    this.assignments.delete(id);
    this.lanes[laneId]?.rooms.delete(id);
  }

  stats() {
    const lanes = this.lanes.map((lane) => ({ id: lane.id, rooms: lane.rooms.size, ...lane.pool.stats() }));
    const sum = (field) => lanes.reduce((n, item) => n + (Number(item[field]) || 0), 0);
    return {
      kind: 'room-lanes',
      size: sum('size'), threads: sum('threads'), busy: sum('busy'), queued: sum('queued'),
      maxQueue: sum('maxQueue'), timeoutMs: Math.max(...lanes.map((s) => s.timeoutMs)),
      submitted: sum('submitted'), completed: sum('completed'), failed: sum('failed'),
      cancelled: sum('cancelled'), rejected: sum('rejected'), queueMs: sum('queueMs'), computeMs: sum('computeMs'),
      avgComputeMs: sum('completed') ? sum('computeMs') / sum('completed') : 0,
      lanes,
    };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await Promise.all(this.lanes.map((lane) => lane.pool.close()));
  }
}

export function createRoomWorkerPool({ data, env = process.env, workerUrl } = {}) {
  const { size, maxQueue, timeoutMs } = workerSettings(env);
  if (!size) return null;
  const requested = Number(env.SP_ROOM_WORKERS || 1);
  const lanes = Math.min(size, Number.isInteger(requested) && requested > 0 ? requested : 1);
  return new RoomWorkerPool({ data, totalWorkers: size, lanes, maxQueue, timeoutMs, workerUrl });
}
