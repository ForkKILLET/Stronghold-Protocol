// Read-only operational projections. Never serialize a Session, Room, Match or checkpoint wholesale.
import {performance} from 'node:perf_hooks';
import {APP_VERSION} from '../../shared/constants.js';
import {buildTag} from '../http/buildTag.js';

const finite = value => Number.isFinite(value) ? value : null;
const worker = pool => {
  if (!pool) return null;
  const s = pool.stats();
  return Object.fromEntries(['size','threads','busy','queued','rooms','failedLanes','completed','failed','rejected']
    .filter(key => Number.isFinite(s[key])).map(key => [key, s[key]]));
};

export function createAdminSnapshot({health, diagnostics, data, now = Date.now}) {
  const {lobby, registry, network, startedAt} = health;
  const publicCache = new WeakMap();
  let cached, cachedAt = -Infinity, previous = null;
  const history = [];
  function sample() {
    const at = now();
    // A refresh and the timer may fire together; keep rate deltas over a useful interval.
    if (history.length && at-history.at(-1).at < 2500) return history.at(-1);
    const tick = performance.now(), cpu = process.cpuUsage();
    const used = cpu.user + cpu.system;
    const memory = process.memoryUsage();
    const net = network.diagnostics.stats();
    const persist = diagnostics.persister;
    const point = {
      at, cpuPercent:previous && tick > previous.tick ? Math.max(0, (used-previous.used)/(tick-previous.tick)/10) : null,
      rss:memory.rss, heapUsed:memory.heapUsed, heapTotal:memory.heapTotal,
      eventLoopP99Ms:finite(net.recentEventLoop?.p99Ms), eventLoopMaxMs:finite(net.recentEventLoop?.maxMs),
      eventLoopSampledAt:finite(net.recentEventLoop?.sampledAt),
      sendBytesPerSec:previous && tick > previous.tick ? Math.max(0,(net.sentBytes-previous.sent)*1000/(tick-previous.tick)) : null,
      receiveBytesPerSec:previous && tick > previous.tick ? Math.max(0,(net.receivedBytes-previous.received)*1000/(tick-previous.tick)) : null,
      socketBufferedBytes:network.bufferedBytes().total || 0,
      workers:worker(diagnostics.workerPool), matchWorkers:worker(diagnostics.matchWorkerPool),
      persistence:persist ? {enabled:true,writes:persist.writes,failures:persist.failures,
        checkpoints:persist.checkpointKeys.size,recovery:lobby.recoveryDocs.size,
        pendingResults:lobby.userOutbox?.size || 0} : {enabled:false},
    };
    previous = {tick,used,sent:net.sentBytes,received:net.receivedBytes};
    history.push(point);
    while (history.length > 101 || history[0]?.at < at-300000) history.shift();
    return point;
  }
  function publicState(ctx) {
    const raw = ctx.lastPublic;
    if (typeof raw !== 'string') return {};
    const old = publicCache.get(ctx);
    if (old?.raw === raw) return old.value;
    let value = {};
    try {
      const parsed = JSON.parse(raw);
      value = {matchId:parsed.matchId,phase:parsed.phase,round:parsed.round,difficulty:parsed.difficulty,paused:parsed.paused,
        players:Array.isArray(parsed.players)?parsed.players.map(p=>({playerId:p.playerId,name:p.name,avatarId:p.avatarId,
          seat:p.seat,isBot:p.isBot,left:p.left,ready:p.ready,alive:p.alive,lp:p.lp})):undefined};
    } catch {}
    publicCache.set(ctx, {raw,value});
    return value;
  }
  const avatar = id => {
    const entry = data.assets?.profileAvatars?.[id];
    const url = typeof entry === 'string' ? entry : entry?.url;
    return typeof url === 'string' && url.startsWith('/assets/profile-avatars/') && !url.includes('..') ? url : null;
  };
  function member(p) {
    const session = registry.byId(p.playerId);
    return {playerId:p.playerId, name:p.name || '', seat:Number.isInteger(p.seat)?p.seat:null,
      isBot:!!p.isBot,connected:p.isBot ? true : !!session?.connected,
      left:!!p.left,ready:!!p.ready,alive:typeof p.alive==='boolean'?p.alive:null,lp:finite(p.lp),
      avatar:avatar(session?.avatarId || p.avatarId)};
  }
  function view() {
    const at = now();
    if (cached && at-cachedAt < 1000) return cached;
    const matches = [], rooms = [], queues = [], players = [], contexts = new Map();
    const locations = new Map(), bots = new Set();
    for (const room of lobby.rooms.values()) {
      if (room.disposed) continue;
      if (room.match && !room.match.ended && !room.match.disposed) contexts.set(room.match, {ctx:room.matchCtx || {},room});
      const seats = room.seats.filter(p => p && !p.left).map(member);
      for (const p of seats) if (p.isBot) bots.add(p.playerId);
      rooms.push({id:room.code,roomCode:room.code,mode:room.mode,difficulty:room.difficulty,
        createdAt:room.createdAt,host:registry.byId(room.hostId)?.name || '',
        state:room.match?'match':room.matching?'queue':'waiting',players:seats,
        spectators:room.spectators.map(member),battleSpeed:room.battleSpeed,
        prepMultiplier:room.prepMultiplier,prepSeconds:room.prepSeconds,modded:!!room.modded});
      for (const p of [...room.seats,...room.spectators]) if (p && !p.isBot && !p.left) {
        locations.set(p.playerId,{roomCode:room.code,state:room.spectators.includes(p)?'spectating':'waiting'});
      }
    }
    for (const ctx of lobby.activeQueueMatches) {
      if (ctx.match && !ctx.ended && !ctx.disposed && !ctx.match.ended) contexts.set(ctx.match,{ctx,room:ctx.room || null});
    }
    for (const [match,{ctx,room}] of contexts) {
      const state = publicState(ctx);
      const source = state.players || ctx.members || match.order || room?.seats?.filter(Boolean) || [];
      const members = source.map(member);
      const id = state.matchId || match.userMatchId || `${room?.code || match.roomCode}:${match.battlePrefix || match.seed || 'active'}`;
      const row = {id,roomCode:room?.code || null,mode:room?.mode || match.mode || 'coop',
        difficulty:state.difficulty || room?.difficulty || match.difficulty || null,
        phase:state.phase || match.phase || null,round:finite(state.round ?? match.round),
        startedAt:finite(match.startedAt),paused:!!(state.paused ?? match.paused),
        players:members,modded:!!room?.modded,hosted:!!match.hosted,remote:!!match.remote};
      matches.push(row);
      for (const p of members) {
        if (p.isBot) { bots.add(p.playerId); continue; }
        if (!p.left) locations.set(p.playerId,{...locations.get(p.playerId),state:'match',matchId:id,roomCode:row.roomCode});
      }
      for (const p of room?.spectators || []) locations.set(p.playerId,{state:'spectating',matchId:id,roomCode:row.roomCode});
    }
    for (const entry of new Set(lobby.queueByPlayer.values())) {
      if (entry.removed) continue;
      const members = entry.players.filter(p=>!p.left).map(member);
      queues.push({id:entry.queueId,roomCode:entry.room?.code || null,mode:entry.mode,difficulty:entry.difficulty,
        queuedAt:entry.queuedAt,players:members});
      for (const p of members) if (!p.isBot) locations.set(p.playerId,{state:'queue',queueId:entry.queueId,roomCode:entry.room?.code || null});
    }
    const groups = new Map();
    for (const session of registry.all()) {
      if (registry.isExpired(session,at)) continue;
      const key = session.userId || session.playerId;
      if (!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(session);
    }
    for (const sessions of groups.values()) {
      sessions.sort((a,b)=>Number(b.connected)-Number(a.connected) || b.lastSeen-a.lastSeen);
      const s = sessions[0], connected = sessions.some(s=>s.connected);
      const places = sessions.map(s=>locations.get(s.playerId)).filter(Boolean);
      const place = places.find(p=>p.state==='match') || places.find(p=>p.state==='queue') || places[0];
      players.push({id:s.playerId,name:s.name,avatar:avatar(s.avatarId),connected,
        state:connected ? place?.state || 'lobby' : 'disconnected',lastSeen:s.lastSeen,
        disconnectedAt:connected?null:Math.max(...sessions.map(s=>s.disconnectedAt || 0)),
        sessionCount:sessions.length,locations:places,roomCode:place?.roomCode || null,matchId:place?.matchId || null});
    }
    players.sort((a,b)=>Number(b.connected)-Number(a.connected) || b.lastSeen-a.lastSeen);
    matches.sort((a,b)=>(b.startedAt||0)-(a.startedAt||0));
    queues.sort((a,b)=>a.queuedAt-b.queuedAt);
    rooms.sort((a,b)=>b.createdAt-a.createdAt);
    const queuedPeople = new Set();
    for (const row of queues) for (const p of row.players) if (!p.isBot) queuedPeople.add(registry.byId(p.playerId)?.userId || p.playerId);
    cached = {at,counts:{online:players.filter(p=>p.connected).length,disconnected:players.filter(p=>!p.connected).length,
      rooms:rooms.length,matches:matches.length,queuedTeams:queues.length,queuedPlayers:queuedPeople.size,
      bots:bots.size,spectators:players.filter(p=>p.connected && p.state==='spectating').length},matches,rooms,queue:queues,players};
    cachedAt = at;
    return cached;
  }
  return {
    sample,
    overview() {
      const current = view();
      if (!history.length || now()-history.at(-1).at >= 3000) sample();
      return {at:now(),server:{version:APP_VERSION,build:buildTag(),uptimeSec:Math.max(0,(now()-startedAt)/1000)},
        counts:current.counts,resources:history.at(-1),history};
    },
    list(kind,{page=1,query='',status='all'}={}) {
      let rows = view()[kind];
      if (!Array.isArray(rows)) throw new Error('Invalid list kind');
      if (status !== 'all') rows = rows.filter(r=>status==='online'?r.connected:status==='disconnected'?!r.connected:r.state===status);
      if (query) {
        const q = query.toLocaleLowerCase();
        rows = rows.filter(row=>[row.id,row.roomCode,row.name,row.host,...(row.players || []).flatMap(p=>[p.name,p.playerId])]
          .some(value=>typeof value==='string' && value.toLocaleLowerCase().includes(q)));
      }
      const pages = Math.max(1,Math.ceil(rows.length/50));
      page = Math.min(page,pages);
      return {at:now(),items:rows.slice((page-1)*50,page*50),total:rows.length,page,pages};
    },
  };
}
