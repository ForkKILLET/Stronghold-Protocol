// Game-owned spectator-to-AI handover. No monitor or administrator API dependency.
import { ERR, PROTOCOL_VERSION } from '../shared/constants.js';
import { resetStateDelta, stateDeltaVersion } from './stateTransport.js';
const fail = detail => ({ error: ERR.BAD_TARGET, detail });
const pending = new WeakMap();
const playerOf = (m, id) => m?.players?.get(id) || m?.order?.find(p => p.playerId === id);
export function resetAiTakeover(room) {
  const votes = pending.get(room);
  if (votes) { for (const vote of votes.values()) clearTimeout(vote.timer); votes.clear(); }
  room.aiTakeoverVotes = [];
}
export function takeoverVoters(room) {
  const m = room.match;
  const seats = room.seats.filter(s => s && !s.isBot && !s.left && s.connected);
  const ids = seats.filter(s => !playerOf(m, s.playerId)?.autoplay).map(s => s.playerId);
  if (!ids.length && room.seatOf(room.hostId)?.connected) ids.push(room.hostId);
  return ids;
}
export function transferAiSeat(lobby, room, applicantId, botId) {
  const m = room.match, session = lobby.registry.byId(applicantId), spectator = room.spectatorOf(applicantId);
  const ps = playerOf(m, botId), seat = room.seatOf(botId);
  if (room.aiTakeoverEnabled !== true || room.mode !== 'coop') return fail('AI handover is disabled');
  if (!session?.connected || !session.ws || !spectator || !ps?.isBot || ps.left || !ps.alive || !seat || m.phase !== 'PREP' || m.ended || m.disposed || m.emergencyFrozen) return fail('AI handover unavailable');
  if (room.modded) return fail('AI handover is unavailable in isolated plugin matches');
  if (lobby.registry.byId(botId)) return fail('AI seat already has a session');
  const conn = lobby.network?.conns.get(session.ws);
  if (!conn || conn.closing) return fail('connection unavailable');
  const profile = { name: session.name, userId: session.userId || null, avatarId: session.avatarId || null, publicId: session.publicId || null };
  const commit = result => {
    if (result?.error) return result;
    if (room.disposed || room.match !== m) return fail('match ended during handover');
    lobby.removeMember(room, applicantId); lobby.clearResync(applicantId);
    lobby.registry.byPlayerId.delete(applicantId); session.playerId = botId; lobby.registry.byPlayerId.set(botId, session);
    session.roomCode = room.code; session.notice = null; session.pendingResult = null; session.resyncAt = -Infinity;
    Object.assign(seat, { isBot: false, connected: !!session.connected, left: false, ready: false, ...profile });
    session.aiTakeoverFrom = applicantId;
    if (room.matchCtx?.profileUsers) room.matchCtx.profileUsers[botId] = profile.userId;
    resetStateDelta(conn.ws);
    if (session.connected && session.ws === conn.ws && !conn.closing) {
      lobby.network.onHelloMsg(conn, { t: 'hello', version: PROTOCOL_VERSION, delta: stateDeltaVersion(conn.ws), name: session.name, token: session.token }, lobby.now());
    } else lobby.callMatch(room, 'onDisconnect', botId);
    lobby.broadcastState(room); return { ok: true };
  };
  // Match state is changed only by its owner; a Worker proxy's metadata is never mutable authority.
  const applied = m.remote
    ? m.invoke('takeoverAiSeat', applicantId, botId, profile, m.round)
    : m.hosted ? m.takeoverAiSeat(applicantId, botId, profile, m.round)
    : m.takeoverAiSeat(applicantId, botId, profile, m.round);
  return applied?.then ? applied.then(commit) : commit(applied);
}
// [ASSUMED] Any electorate change cancels rather than lowering the approval threshold.
function drop(votes, id) {
  clearTimeout(votes.get(id)?.timer);
  votes.delete(id);
}
function snapshot(room, votes) {
  room.aiTakeoverVotes = [...votes.values()].map(v => ({ id: v.id, applicantId: v.applicantId,
    applicantName: v.applicantName, botId: v.botId, expiresAt: v.expiresAt, eligible: v.eligible,
    yes: [...v.yes], no: [...v.no] }));
}
export function reconcileAiTakeover(lobby, room) {
  const votes = pending.get(room);
  if (!votes?.size) return false;
  const m = room.match;
  const eligible = m ? takeoverVoters(room) : [];
  let changed = false;
  for (const [id, v] of votes) {
    const applicant = lobby.registry.byId(v.applicantId), bot = playerOf(m, v.botId);
    if (room.aiTakeoverEnabled !== true || room.modded
      || m !== v.match || m.phase !== 'PREP' || m.round !== v.round || m.ended || m.disposed || m.emergencyFrozen
      || !room.spectatorOf(v.applicantId)?.connected || !applicant?.connected || applicant.roomCode !== room.code
      || !bot?.isBot || !bot.alive || bot.left || Date.now() >= v.expiresAt
      || eligible.length !== v.eligible.length || eligible.some((id, i) => id !== v.eligible[i])) {
      drop(votes, id); changed = true;
    }
  }
  if (changed) snapshot(room, votes);
  return changed;
}
export function aiTakeover(lobby, session, msg) {
  const room = lobby.roomOf(session), m = room?.match;
  if (room && reconcileAiTakeover(lobby, room)) lobby.broadcastState(room);
  if (!room || room.aiTakeoverEnabled !== true || room.mode !== 'coop' || !m || room.modded || m.phase !== 'PREP' || m.ended || m.disposed || m.emergencyFrozen) return fail('AI handover requires preparation in an original-content match');
  let votes = pending.get(room); if (!votes) pending.set(room, votes = new Map());
  const sync = () => { snapshot(room, votes); lobby.broadcastState(room); };
  if (msg.t === 'room.aiRequest') {
    const bot = playerOf(m, msg.botId);
    if (!room.spectatorOf(session.playerId) || !session.connected || !bot?.isBot || bot.left || !bot.alive) return fail('a spectator must select an active AI');
    if ([...votes.values()].some(v => v.applicantId === session.playerId || v.botId === msg.botId)) return fail('request already pending');
    const eligible = takeoverVoters(room);
    if (!eligible.length) return fail('no online voter available');
    const id = String(room.aiTakeoverSeq = (room.aiTakeoverSeq || 0) + 1);
    // [ASSUMED] A 30-second vote expires without approval; the whole room elects by strict majority.
    const vote = { id, applicantId: session.playerId, applicantName: session.name, botId: msg.botId,
      match: m, round: m.round, eligible, expiresAt: Date.now() + 30000, yes: new Set(), no: new Set() };
    votes.set(id, vote);
    vote.timer = setTimeout(() => { if (votes.get(id) === vote) { drop(votes, id); sync(); } }, 30000);
    vote.timer.unref?.(); sync(); return { ok: true };
  }
  const vote = votes.get(msg.voteId);
  if (!vote) return fail('request expired');
  if (!vote.eligible.includes(session.playerId)) return fail('only online human room teammates can vote');
  (msg.approve ? vote.no : vote.yes).delete(session.playerId);
  (msg.approve ? vote.yes : vote.no).add(session.playerId);
  const required = Math.floor(vote.eligible.length / 2) + 1;
  if (vote.no.size >= required) { drop(votes, vote.id); sync(); return { ok: true }; }
  if (vote.yes.size >= required) {
    drop(votes, vote.id);
    const result = transferAiSeat(lobby, room, vote.applicantId, vote.botId);
    if (result?.then) return result.then(value => { sync(); return value; });
    sync(); return result;
  }
  sync(); return { ok: true };
}
