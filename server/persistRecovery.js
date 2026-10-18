// Recovery ownership uses wall-clock session deadlines, never a checkpoint's simulation clock.
import { NET_DEFAULTS } from './net.js';

/** Current retention policy applied to both old documents and retained identities. */
export function resumeWindowMs(session, registry, lobby, solo = false) {
  const base = registry.reconnectWindowMs ?? NET_DEFAULTS.reconnectWindowMs;
  const extension = Number.isFinite(session.resumeWindowMs) && session.resumeWindowMs > 0
    ? Math.min(session.resumeWindowMs, lobby.soloResumeWindowMs())
    : solo ? lobby.soloResumeWindowMs() : null;
  return { extension, window: Math.max(base, extension || 0) };
}

export function countRecoveryRemoval(lobby, reason) {
  lobby.recoveryRemoved ||= { expired: 0, superseded: 0, departed: 0 };
  lobby.recoveryRemoved[reason]++;
}

/** Whether an original human can still claim this checkpoint. Spectators and departed players cannot. */
export function recoveryRemovalReason(key, entry, registry, lobby, now) {
  if (entry?.superseded) return 'superseded';
  const players = Array.isArray(entry?.checkpoint?.players) ? entry.checkpoint.players
    : Array.isArray(entry?.room?.seats) ? entry.room.seats : [];
  const departed = new Set(Array.isArray(entry?.departedPlayerIds) ? entry.departedPlayerIds : []);
  const humans = players.filter(p => p && !p.isBot && !p.left && !departed.has(p.playerId));
  if (!humans.length) return 'departed';
  const saved = new Map((Array.isArray(entry.sessions) ? entry.sessions : []).filter(s => s && typeof s.playerId === 'string')
    .map(s => [s.playerId, s]));
  const solo = (entry.checkpoint?.mode || entry.room?.mode) === 'solo';
  for (const player of humans) {
    const recorded = saved.get(player.playerId);
    const live = registry.byId?.(player.playerId);
    if (live && recorded?.token && live.token !== recorded.token) continue;
    const owner = live?.activeMatchCtx;
    if (owner?.match && !owner.ended && !owner.disposed) {
      const ownerKey = owner.queue && !owner.room ? `queue:${owner.match.roomCode}`
        : owner.room?.code || live.roomCode || owner.match.roomCode;
      if (ownerKey !== key) continue;
    }
    const session = live || recorded;
    if (!session || typeof session.token !== 'string' || !session.token) continue;
    if (live?.connected) return null;
    // Legacy recovery records may still say connected. Freeze them at first retention, not every restart.
    const since = session.connected === false && Number.isFinite(session.disconnectedAt)
      ? session.disconnectedAt : entry.retainedAt;
    if (Number.isFinite(since) && now - since <= resumeWindowMs(session, registry, lobby, solo).window) return null;
  }
  return 'expired';
}

/** Called before every save; immutable replacements also invalidate the Worker recovery cache. */
export function pruneRecovery(registry, lobby, now) {
  for (const [key, original] of lobby.recoveryDocs || []) {
    const entry = Number.isFinite(original?.retainedAt) ? original : { ...original, retainedAt: now };
    const reason = recoveryRemovalReason(key, entry, registry, lobby, now);
    if (reason) {
      lobby.recoveryDocs.delete(key);
      countRecoveryRemoval(lobby, reason);
    } else if (entry !== original) lobby.recoveryDocs.set(key, entry);
  }
}
