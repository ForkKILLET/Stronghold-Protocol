// Connection-local monotonic sequences. Content-only patches may be shared by immutable snapshots.
// Worker source sequence numbers stay separate from wire numbers, even across room/identity changes.
import { diffState, isStateKind, STATE_DELTA_VERSION } from '../shared/stateDelta.js';

// This fork also compresses isolated private streams; snapshots are never shared across players.
export const DELTA_KINDS = new Set(['m.public', 'm.private']);
const connections = new WeakMap();
const snapshots = new WeakMap();
const workerFrames = new WeakMap();
const fullFrame = (kind, seq, encoded) =>
  `{"t":"m.state","kind":${JSON.stringify(kind)},"seq":${seq},"full":${encoded}}`;

export function attachWorkerState(msg, encoded, frame, owner) {
  if (frame) workerFrames.set(msg, { encoded, frame, owner });
  return msg;
}
export function negotiateStateDelta(ws, version) {
  if (version === STATE_DELTA_VERSION) {
    if (!connections.has(ws)) connections.set(ws, { seq: 0, kinds: new Map() });
  } else connections.delete(ws);
}
export function stateDeltaVersion(ws) { return connections.has(ws) ? STATE_DELTA_VERSION : undefined; }
export function resetStateDelta(ws) { connections.get(ws)?.kinds.clear(); }
export function setStateDeltaRoom(ws, roomCode) {
  const connection = connections.get(ws);
  if (!connection || connection.roomCode === roomCode) return;
  connection.roomCode = roomCode;
  connection.kinds.clear();
}

/** Commit only after queueing the reliable frame. Bad pre-encoded bytes request the caller's full fallback. */
export function prepareStateFrame(ws, msg, encoded) {
  const connection = connections.get(ws);
  if (!connection || !isStateKind(msg?.t) || !DELTA_KINDS.has(msg.t)) {
    return { data: encoded, commit() {}, usable: true };
  }
  const previous = connection.kinds.get(msg.t);
  const prepared = workerFrames.get(msg);
  if (prepared?.encoded === encoded) {
    const { frame, owner } = prepared;
    const seq = ++connection.seq;
    let data = fullFrame(msg.t, seq, encoded);
    if (previous?.owner === owner && previous?.stream === frame.stream
        && previous.workerSeq === frame.base && frame.delta) {
      // StateEncoder owns this envelope. Rewrap its patch without decoding a full view on the main thread.
      const marker = ',"patch":';
      const offset = frame.delta.indexOf(marker);
      if (offset >= 0) {
        const patch = frame.delta.slice(offset + marker.length, -1);
        const delta = `{"t":"m.state","kind":${JSON.stringify(msg.t)},"seq":${seq},"base":${previous.seq},"patch":${patch}}`;
        if (Buffer.byteLength(delta) < Buffer.byteLength(data)) data = delta;
      }
    }
    return { data, usable: true, commit() {
      connection.kinds.set(msg.t, { owner, stream: frame.stream, workerSeq: frame.seq, seq });
    } };
  }
  let snapshot = snapshots.get(msg);
  if (!snapshot || snapshot.encoded !== encoded) {
    let view;
    try { view = JSON.parse(encoded); } catch { view = null; }
    if (view === null || typeof view !== 'object' || Array.isArray(view)) {
      return { data: encoded, commit() {}, usable: false };
    }
    snapshot = { encoded, view, patches: new WeakMap() };
    snapshots.set(msg, snapshot);
  }
  const seq = ++connection.seq;
  let data = fullFrame(msg.t, seq, encoded);
  if (previous?.snapshot && previous.snapshot !== snapshot) {
    let patch = snapshot.patches.get(previous.snapshot);
    if (patch === undefined) {
      const ops = diffState(previous.snapshot.view, snapshot.view);
      patch = ops ? JSON.stringify(ops) : false;
      snapshot.patches.set(previous.snapshot, patch);
    }
    if (patch) {
      const delta = `{"t":"m.state","kind":${JSON.stringify(msg.t)},"seq":${seq},"base":${previous.seq},"patch":${patch}}`;
      if (Buffer.byteLength(delta) < Buffer.byteLength(data)) data = delta;
    }
  }
  return { data, usable: true, commit() { connection.kinds.set(msg.t, { snapshot, seq }); } };
}
