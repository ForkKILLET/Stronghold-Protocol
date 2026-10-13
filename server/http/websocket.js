// server/http/websocket.js — the real-time side of the server:
//
//   * session wiring: SessionRegistry (reconnect tokens) → Lobby (rooms, server/lobby.js) → Network (the socket
//     protocol, server/net.js), built from the startServer() options (config.js decides which go where);
//   * WebSocket (ws) at /ws, maxPayload 64 KB, permessage-deflate (WS_DEFLATE) → Network.handleConnection. Refused at
//     the upgrade: any other path 404; per-network socket limit for internet clients (maxConnectionsPerAddr, see net.js
//     clientAddress; local/LAN peers are exempt) 429; server full (maxConnections) or shutting down 503.

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
 * …) is compressed on its own — no context is kept from one message to the next (`serverNoContextTakeover`) — with a
 * 2 KB window and zlib memLevel 7, so a connection holds about 72 KB of zlib state; smaller frames (pong, ok) go out
 * as they are. Measured on a solo session (rounds 3–5, the server's own counters, traffic.js): 173 KB of payload →
 * 60 KB on the wire; replaying a session's frames with larger windows gained nothing on these messages. Browsers
 * negotiate it by themselves; a client that offers none gets plain frames. The inflated size of a client frame still
 * counts against WS_MAX_PAYLOAD.
 */
export const WS_DEFLATE = Object.freeze({
  threshold: 1024,
  serverNoContextTakeover: true,
  serverMaxWindowBits: 11,
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

/**
 * The session stack of one server.
 * @param {{ MatchClass?: Function, seedFn?: () => number, [option: string]: any }} opts startServer() options
 * @param {{ data: object, log: object }} deps the game data the lobby's matches use, the logger
 * @returns {{ registry: SessionRegistry, lobby: Lobby, network: Network }}
 */
export function createSessionStack(opts, { data, log, workerPool, matchWorkerPool = null }) {
  const netOptions = netOptionsFrom(opts);
  const lobbyOptions = lobbyOptionsFrom(opts);
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
  for (const [target, key, env, fallback] of envLimits) {
    if (target[key] == null) target[key] = parseEnvLimit(process.env[env], fallback, env, log);
  }
  log.info(`[http] limits: rooms ${lobbyOptions.maxRooms} (${perNetwork(lobbyOptions.maxRoomsPerAddr)}/network), matches ${perNetwork(lobbyOptions.maxMatchesPerAddr)}/network, sockets ${netOptions.maxConnections} (${perNetwork(netOptions.maxConnectionsPerAddr)}/network)`);
  log.info(`[match] tuning: combat ${parseCombat(process.env.SP_COMBAT)}, verify ${parseVerify(process.env.SP_VERIFY)}, bot rehearsal ${parseBotRehearsal(process.env.SP_BOT_REHEARSAL)} (docs/DEPLOY.md §3.4)`);
  const registry = new SessionRegistry({ reconnectWindowMs: netOptions.reconnectWindowMs ?? NET_DEFAULTS.reconnectWindowMs });
  const lobby = new Lobby({
    registry, log, MatchClass: opts.MatchClass, getData: () => data, seedFn: opts.seedFn, options: lobbyOptions,
    workerPool, matchWorkerPool, nameModeration: opts.nameModeration,
  });
  const network = new Network({ registry, handler: lobby, log, options: netOptions, nameModeration: opts.nameModeration });
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

/**
 * Serve the WebSocket endpoint /ws on `server` (its 'upgrade' event).
 * @param {import('node:http').Server} server
 * @param {{ network: Network, log: object, traffic?: ReturnType<typeof import('./traffic.js').createTrafficCounter> }} deps
 * @returns {WebSocketServer}
 */
export function attachWebSocket(server, { network, log, wsCompression = parseWsCompression(process.env.SP_WS_COMPRESSION), announcements = null, traffic = null }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD, perMessageDeflate: wsCompression ? { ...WS_DEFLATE, clientNoContextTakeover: true } : false, clientTracking: false });
  wss.on('connection', (ws, req) => { if (traffic) meterSocket(ws, req, traffic); network.handleConnection(ws, req); if (announcements) { announcements.refresh(); send(ws, announcements.message()); send(ws, announcements.message('popup')); } });
  wss.on('error', (e) => log.error('[ws] server error', e));

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const parts = splitUrl(req.url || '/');
    const reject = (status, text) => {
      try { socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { socket.destroy(); }
    };
    if (!parts || parts.rawPath !== '/ws') { reject(404, 'Not Found'); return; }
    const refused = network.admission(req);
    if (refused === 'per-address') { reject(429, 'Too Many Requests'); return; }
    if (refused) { reject(503, 'Service Unavailable'); return; }
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
