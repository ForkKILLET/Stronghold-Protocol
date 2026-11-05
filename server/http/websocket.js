// server/http/websocket.js — the real-time side of the server:
//
//   * session wiring: SessionRegistry (reconnect tokens) → Lobby (rooms, server/lobby.js) → Network (the socket
//     protocol, server/net.js), built from the startServer() options (config.js decides which go where);
//   * WebSocket (ws) at /ws, maxPayload 64 KB, permessage-deflate (WS_DEFLATE) → Network.handleConnection. Refused at
//     the upgrade: any other path 404; per-network socket limit for internet clients (maxConnectionsPerAddr, see net.js
//     clientAddress; local/LAN peers are exempt) 429; unauthenticated socket cap or shutting down 503.
//     The online player cap (maxConnections) is checked at hello, allowing authenticated match recovery.

import {userToken,sameOrigin} from '../users/http.js';
import { WebSocketServer } from 'ws';
import { Network, SessionRegistry, NET_DEFAULTS, send } from '../net.js';
import { Lobby, LOBBY_DEFAULTS } from '../lobby.js';
import { splitUrl } from './common.js';
import { parseBotRehearsal, parseCombat, parseVerify } from '../match/Match.js';
import { netOptionsFrom, lobbyOptionsFrom, parseEnvLimit, parseWsCompression } from './config.js';

/** Inbound WebSocket frame limit (DESIGN §8). */
export const WS_MAX_PAYLOAD = 64 * 1024;
export const WS_DEFLATE_THRESHOLD = 1024;
const perNetwork = (n) => Number.isFinite(n) && n > 0 ? String(n) : 'unlimited';

/**
 * permessage-deflate (RFC 7692) for the JSON text frames. A message from 1 KB up (m.public, m.private, b.start, welcome
 * …) is compressed with an 8 KB window (serverMaxWindowBits 13) and zlib memLevel 7, and the window is KEPT from one
 * message to the next (context takeover, the ws default: the extension's `server_no_context_takeover` is not
 * negotiated) — the views repeat most of their keys and values (bonds, players, shop), so a frame costs a fraction of
 * its standalone deflate. A 4-player match's frames (3,339 KiB of payload, 1,127 frames, one client's stream, measured
 * over a real ws round trip): 809 KiB on the wire with per-message deflate and a 2 KB window, 284 KiB with the context
 * kept — a window of 15 would reach about 160 KiB at about 140 KiB more zlib state per connection, so 13 is the balance
 * (about 105 KiB of zlib state per connection); smaller frames (pong, ok) go out as they are. A connection that
 * negotiates no extension, or one that caps the server window below ours, gets plain frames. Context takeover is
 * negotiated per connection and reset with it: a client that offers `server_no_context_takeover` keeps getting
 * standalone messages.
 */
export const WS_DEFLATE = Object.freeze({
  threshold: 1024,
  serverMaxWindowBits: 13,
  zlibDeflateOptions: Object.freeze({ memLevel: 7 }),
});

/**
 * Does every permessage-deflate offer of this `Sec-WebSocket-Extensions` header cap the server window below
 * WS_DEFLATE.serverMaxWindowBits? ws cannot accept such an offer and refuses the whole handshake (400), so the upgrade
 * drops the header instead and the connection goes uncompressed. No browser sends `server_max_window_bits`.
 * @param {string | string[] | undefined} header
 */
export function narrowDeflateOffer(header) {
  if (typeof header !== 'string') return false;
  const offers = header.split(',').map((s) => s.trim()).filter((s) => /^permessage-deflate\b/i.test(s));
  if (!offers.length) return false;
  return offers.every((offer) => {
    const m = /(?:^|;)\s*server_max_window_bits\s*=\s*"?(\d+)"?/i.exec(offer);
    return !!m && Number(m[1]) < WS_DEFLATE.serverMaxWindowBits;
  });
}

/** A per-network cap, as printed on boot ('unlimited' for 0). */

/**
 * The session stack of one server.
 * @param {{ MatchClass?: Function, seedFn?: () => number, [option: string]: any }} opts startServer() options
 * @param {{ data: object, log: object, content?: { cs: string } | null,
 *   plugins?: ReturnType<typeof import('../plugins/roomSets.js').createRoomSets> | null,
 *   hosts?: ReturnType<typeof import('../match/host/index.js').createMatchHosts> | null,
 *   simPool?: ReturnType<typeof import('../workers/roomPool.js').createRoomWorkerPool> | null,
 *   versions?: ReturnType<typeof import('../versions.js').createVersionSets> | null,
 *   versionHosts?: ReturnType<typeof import('../match/host/index.js').createMatchHosts> | null }} deps the game data the lobby's
 *   matches use, the logger, the vanilla content (server/plugins/identity.js: welcome / room.state content, BattleSpec
 *   cs), the room sets a room's host chooses from (room.setPlugins: visual and content sets), the match hosts a room with
 *   gameplay plugins plays in (DESIGN §32.6), the official versions and their match hosts (DESIGN §35.23)
 * @returns {{ registry: SessionRegistry, lobby: Lobby, network: Network }}
 */
export function createSessionStack(opts, { data, log, workerPool, matchWorkerPool = null, content = null, plugins = null, hosts = null, versions = null, versionHosts = null, simPool = null }) {
  const netOptions = netOptionsFrom(opts, log);
  const lobbyOptions = lobbyOptionsFrom(opts, log);
  // Limit overrides (docs/DEPLOY.md §3.4): an explicit startServer option wins, then the environment, then the code
  // default. `0` means unlimited for the per-network caps; an unparsable value warns and keeps the default (a typo
  // must not silently remove a protection).
  const envLimits = [
    [lobbyOptions, 'maxRooms', 'SP_MAX_ROOMS', LOBBY_DEFAULTS.maxRooms],
    [lobbyOptions, 'maxRoomsPerAddr', 'SP_MAX_ROOMS_PER_ADDR', LOBBY_DEFAULTS.maxRoomsPerAddr],
    [lobbyOptions, 'maxMatchesPerAddr', 'SP_MAX_MATCHES_PER_ADDR', LOBBY_DEFAULTS.maxMatchesPerAddr],
    [netOptions, 'maxConnections', 'SP_MAX_CONNECTIONS', NET_DEFAULTS.maxConnections],
    [netOptions, 'maxConnectionsPerAddr', 'SP_MAX_CONNECTIONS_PER_ADDR', NET_DEFAULTS.maxConnectionsPerAddr],
  ];
  for (const [target, key, _env, fallback] of envLimits) {
    if (target[key] == null) target[key] = fallback;
  }
  netOptions.maxPendingConnections ??= NET_DEFAULTS.maxPendingConnections;
  log.info(`[http] limits: rooms ${lobbyOptions.maxRooms} (${perNetwork(lobbyOptions.maxRoomsPerAddr)}/network), matches ${perNetwork(lobbyOptions.maxMatchesPerAddr)}/network, online ${netOptions.maxConnections}, sockets ${perNetwork(netOptions.maxConnectionsPerAddr)}/network, pending ${netOptions.maxPendingConnections}`);
  log.info(`[match] tuning: combat ${parseCombat(process.env.SP_COMBAT)}, verify ${parseVerify(process.env.SP_VERIFY)}, bot rehearsal ${parseBotRehearsal(process.env.SP_BOT_REHEARSAL)} (docs/DEPLOY.md §3.4)`);
  const registry = new SessionRegistry({ reconnectWindowMs: netOptions.reconnectWindowMs ?? NET_DEFAULTS.reconnectWindowMs,
    maxSessions: opts.maxSessions ?? NET_DEFAULTS.maxSessions });
  const lobby = new Lobby({
    registry, log, MatchClass: opts.MatchClass, getData: () => data, seedFn: opts.seedFn, options: lobbyOptions,
    workerPool, matchWorkerPool, content, plugins, hosts, versions, versionHosts, simPool, nameModeration: opts.nameModeration,
  });
  const network = new Network({ registry, handler: lobby, log, options: netOptions, nameModeration: opts.nameModeration });
  lobby.network = network;
  return { registry, lobby, network };
}

/**
 * Count a socket in the traffic counters (traffic.js): its wire bytes from now until it closes, the payload of every
 * message it sends (ws.send wrapped) and receives.
 * @param {import('ws').WebSocket} ws
 * @param {import('node:http').IncomingMessage} req
 * @param {ReturnType<typeof import('./traffic.js').createTrafficCounter>} traffic
 */
function meterSocket(ws, req, traffic) {
  const socket = req.socket;
  traffic.wsOpen(socket);
  const send = ws.send;
  ws.send = function meteredSend(data, ...rest) {
    traffic.wsSent(data);
    return send.call(this, data, ...rest);
  };
  ws.on('message', (data) => traffic.wsReceived(data));
  ws.once('close', () => traffic.wsClose(socket));
}

/** The options of a frame that must go out uncompressed. */
const PLAIN = Object.freeze({ compress: false });

/**
 * Keep `WS_DEFLATE.threshold` true now that the window is kept.
 * ws applies its own threshold only when the extension negotiated `*_no_context_takeover` (sender.js: the check sits
 * behind that parameter) — with context takeover every message it is handed is compressed, so a pong or an `ok` would
 * be too. The decision is made here instead, on the UTF-8 byte length of text frames, and only for the small ones:
 * `compress: false` leaves the frame plain and the server's deflate window untouched.
 */
function applySendThreshold(ws) {
  const send = ws.send;
  ws.send = function sendWithThreshold(data, options, callback) {
    if (typeof options === 'function') { callback = options; options = null; }
    if (typeof data === 'string' && Buffer.byteLength(data, 'utf8') < WS_DEFLATE.threshold) {
      return send.call(this, data, options ? { ...options, compress: false } : PLAIN, callback);
    }
    return send.call(this, data, options, callback);
  };
}

/**
 * Serve the WebSocket endpoint /ws on `server` (its 'upgrade' event).
 * @param {import('node:http').Server} server
 * @param {{ network: Network, log: object, traffic?: ReturnType<typeof import('./traffic.js').createTrafficCounter> }} deps
 * @returns {WebSocketServer}
 */
export function attachWebSocket(server, { network, log, wsCompression = parseWsCompression(process.env.SP_WS_COMPRESSION), announcements = null, traffic = null, users = null }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD, perMessageDeflate: wsCompression ? { ...WS_DEFLATE, clientNoContextTakeover: true } : false, clientTracking: false });
  wss.on('connection', (ws, req) => { applySendThreshold(ws); if (traffic) meterSocket(ws, req, traffic); network.handleConnection(ws, req); if (announcements) { announcements.refresh(); send(ws, announcements.message()); send(ws, announcements.message('popup')); } });
  wss.on('error', (e) => log.error('[ws] server error', e));

  server.on('upgrade', async (req, socket, head) => {
    socket.on('error', () => {});
    const parts = splitUrl(req.url || '/');
    const reject = (status, text) => {
      try { socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { socket.destroy(); }
    };
    if (!parts || parts.rawPath !== '/ws') { reject(404, 'Not Found'); return; }
    const refused = network.admission(req);
    if (refused === 'per-address') { reject(429, 'Too Many Requests'); return; }
    if (refused) { reject(503, 'Service Unavailable'); return; }
    if(users){
      if(!sameOrigin(req)){reject(403,'Forbidden');return;}
      try{const token=userToken(req);req.userProfile=token?await users.call('authenticate',{token}):null;}
      catch{reject(503,'Service Unavailable');return;}
      if(socket.destroyed)return;
      // Account lookup yields: other handshakes may have consumed the pending budget.
      const afterAuth = network.admission(req);
      if (afterAuth) { reject(afterAuth === 'per-address' ? 429 : 503, afterAuth === 'per-address' ? 'Too Many Requests' : 'Service Unavailable'); return; }
    }
    if (narrowDeflateOffer(req.headers['sec-websocket-extensions'])) delete req.headers['sec-websocket-extensions'];
    try {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } catch (e) {
      log.error('[ws] upgrade failed', e);
      socket.destroy();
    }
  });
  return wss;
}
