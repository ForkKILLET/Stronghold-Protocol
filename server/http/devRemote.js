// Explicit source-development gateway. No Lobby, SQLite, Redis or game Workers are started here.
// Local UI/HMR and presentation resources; remote accounts, gameplay data, simulation/shared and WS.
import http from 'node:http';
import https from 'node:https';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ROOT } from './config.js';
import { MIME } from './files.js';
import { createDevReload } from './devReload.js';
import { createDevResources, isDevResourcePath } from './devResources.js';

const REQUEST_HEADERS = new Set(['accept', 'accept-encoding', 'accept-language', 'user-agent', 'content-type',
  'content-length', 'if-none-match', 'if-modified-since', 'range', 'if-range', 'cache-control', 'pragma']);
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te',
  'trailer', 'transfer-encoding', 'upgrade']);
const LOCAL_PREFIXES = ['/js/', '/css/', '/vendor/', '/i18n/', '/icons/'];
const REMOTE_PREFIXES = ['/api/', '/data/', '/shared/', '/sim/', '/assets/', '/fonts/', '/media/',
  '/packs/', '/plugins/', '/cs/', '/vs/', '/p/', '/x/', '/resource-packs/', '/downloads/'];
const INDEX_HEAD = '<script src="/__dev/remote.js"></script>\n';

export function parseRemoteTarget(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('--remote requires an HTTP(S) server origin'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/'
      || url.search || url.hash || /[\s\\]/.test(value)) {
    throw new Error('--remote requires an HTTP(S) origin without credentials, path, query or fragment');
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Remote servers require HTTPS; HTTP is only allowed for local test servers');
  }
  return url;
}

export function remoteTargetFromArgv(argv = process.argv.slice(2), env = process.env) {
  let value = env.SP_DEV_REMOTE || null, seen = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--remote' && !argv[i].startsWith('--remote=')) continue;
    if (seen) throw new Error('Specify --remote only once');
    seen = true;
    value = argv[i] === '--remote' ? argv[++i] : argv[i].slice('--remote='.length);
    if (!value || value.startsWith('--')) throw new Error('--remote requires a server origin');
  }
  if (!value) return null;
  if (!argv.includes('--source-client')) throw new Error('--remote / SP_DEV_REMOTE is only available in source development mode');
  return parseRemoteTarget(value).origin;
}

// Each target gets its own loopback host, not merely a port: cookies ignore ports, while storage/SW use origins.
// The whole 127/8 block is loopback; keep it separate from ordinary localhost / 127.0.0.1 development.
export function remoteDevHost(target) {
  const bytes = createHash('sha256').update(parseRemoteTarget(target).origin).digest();
  return `127.${64 + bytes[0] % 64}.${bytes[1]}.${bytes[2]}`;
}

function fail(res, status, message) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(message);
}

function requestPath(req) {
  const raw = req.url || '/';
  if (raw.length > 4096 || !raw.startsWith('/') || raw.startsWith('//')) return null;
  let pathname;
  try { pathname = decodeURIComponent(raw.split('?')[0]); } catch { return null; }
  if (/[\\\x00-\x1f\x7f]/.test(pathname) || pathname.split('/').some(p => p === '.' || p === '..')) return null;
  return pathname;
}

function localRequest(req, origin) {
  return req.headers.host === new URL(origin).host
    && (!req.headers.origin || req.headers.origin === origin)
    && (!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']));
}

function upstreamHeaders(req, target, upgrade) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) if (REQUEST_HEADERS.has(name)) headers[name] = value;
  headers.host = target.host;
  headers.origin = target.origin;
  headers['sec-fetch-site'] = 'same-origin';
  // Deliberately do not forward admin cookies, Authorization or caller-supplied proxy/client-IP headers.
  const cookies = (req.headers.cookie || '').split(';').map(c => c.trim()).filter(c => c.startsWith('sp_user='));
  if (cookies.length === 1) headers.cookie = cookies[0];
  if (upgrade) {
    headers.connection = 'Upgrade'; headers.upgrade = 'websocket';
    for (const name of ['sec-websocket-key', 'sec-websocket-version', 'sec-websocket-extensions', 'sec-websocket-protocol']) {
      if (req.headers[name]) headers[name] = req.headers[name];
    }
  }
  return headers;
}

function responseHeaders(upstream, target, origin, upgrade = false) {
  const headers = {}, connection = new Set((upstream.connection || '').toLowerCase().split(/\s*,\s*/));
  for (const [name, value] of Object.entries(upstream)) {
    if (!HOP_HEADERS.has(name) && !connection.has(name) && !['set-cookie', 'location', 'refresh'].includes(name)) headers[name] = value;
  }
  if (upstream['set-cookie']) {
    const cookies = upstream['set-cookie'].filter(c => c.startsWith('sp_user='));
    if (cookies.length) headers['set-cookie'] = cookies.map(c => c.split(';')
      .filter((part, i) => i === 0 || !/^\s*(?:domain\s*=|secure\s*$)/i.test(part)).join(';'));
  }
  if (upstream.location) {
    const location = new URL(upstream.location, target);
    if (location.origin !== target.origin || location.username || location.password) throw new Error('External redirect blocked');
    headers.location = origin + location.pathname + location.search + location.hash;
  }
  if (upgrade) { headers.connection = 'Upgrade'; headers.upgrade = 'websocket'; }
  return headers;
}

export async function startRemoteDev({ target, port = process.env.PORT ? Number(process.env.PORT) : 3000,
  hot = true, publicDir = path.join(ROOT, 'public'), dataDir = path.join(ROOT, 'data'), log = console } = {}) {
  const remote = parseRemoteTarget(target), host = remoteDevHost(remote.origin);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid remote development PORT');
  const publicRoot = await realpath(publicDir);
  const resources = await createDevResources({ publicDir, dataDir, log });
  const transport = remote.protocol === 'https:' ? https : http;
  const agent = new transport.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 8 });
  const sockets = new Set();
  let origin, closed = false;
  const dev = hot ? createDevReload({ publicDir, log, indexHead: INDEX_HEAD }) : null;

  const proxy = (req, res, head) => {
    const upgrade = head !== undefined;
    const outgoing = transport.request(remote, { method: req.method, path: req.url, agent,
      headers: upstreamHeaders(req, remote, upgrade) });
    const abort = () => outgoing.destroy();
    outgoing.setTimeout(30_000, () => outgoing.destroy(new Error('Remote timeout')));
    req.once('aborted', abort);
    res.once('close', abort);
    outgoing.on('error', () => {
      if (upgrade) { res.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); }
      else fail(res, 502, 'Remote development target unavailable; no local backend fallback.');
    });
    outgoing.on('response', upstream => {
      try {
        const headers = responseHeaders(upstream.headers, remote, origin);
        if (upgrade) {
          res.end(`HTTP/1.1 ${upstream.statusCode} Connection refused\r\nConnection: close\r\n\r\n`);
          upstream.destroy();
        } else {
          res.writeHead(upstream.statusCode, headers);
          upstream.on('error', () => res.destroy());
          upstream.pipe(res);
        }
      } catch {
        upstream.destroy();
        if (upgrade) res.destroy(); else fail(res, 502, 'Remote redirect rejected.');
      }
    });
    outgoing.on('upgrade', (upstream, socket, rest) => {
      outgoing.setTimeout(0);
      if (closed || res.destroyed || !upgrade) {
        socket.destroy();
        if (!upgrade) fail(res, 502, 'Unexpected remote upgrade');
        return;
      }
      sockets.add(socket); socket.once('close', () => { sockets.delete(socket); res.destroy(); });
      res.once('close', () => socket.destroy());
      socket.on('error', () => res.destroy());
      res.on('error', () => socket.destroy());
      let headers;
      try { headers = responseHeaders(upstream.headers, remote, origin, true); }
      catch { socket.destroy(); res.destroy(); return; }
      res.write('HTTP/1.1 101 Switching Protocols\r\n' + Object.entries(headers)
        .flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).map(v => `${name}: ${v}\r\n`)).join('') + '\r\n');
      if (rest.length) res.write(rest);
      if (head.length) socket.write(head);
      socket.pipe(res); res.pipe(socket);
    });
    if (upgrade) outgoing.end(); else req.pipe(outgoing);
  };

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (!localRequest(req, origin)) { fail(res, 403, 'Remote development is loopback and same-origin only.'); return; }
      const pathname = requestPath(req);
      if (!pathname) { fail(res, 400, 'Invalid path'); return; }
      const read = ['GET', 'HEAD'].includes(req.method);
      if (isDevResourcePath(pathname, (req.url || '').split('?').slice(1).join('?'))) {
        if (!read) { fail(res, 405, 'GET / HEAD only'); return; }
        await resources(req, res, (req.url || '').split('?')[0]); return;
      }
      if (pathname.startsWith('/api/') || read && (REMOTE_PREFIXES.some(p => pathname.startsWith(p))
          || ['/healthz', '/data.js', '/js/asset-cdn.js', '/js/battle/operatorTraits.js'].includes(pathname))) {
        proxy(req, res); return;
      }
      if (!read) { fail(res, 405, 'GET / HEAD only'); return; }
      if (pathname === '/js/ws-config.js') {
        res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : 'export const WS_URL = "";\n'); return;
      }
      if (pathname === '/__dev/remote.js') {
        res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : `window.__SP_DEV_REMOTE__ = Object.freeze(${JSON.stringify({ target: remote.origin })});\ndocument.title = ${JSON.stringify(`[REMOTE ${remote.host}] `)} + document.title;\nconsole.warn(${JSON.stringify(`[dev] Remote backend: ${remote.origin}. Account changes and games affect this server. Local UI and presentation resources; simulation/shared/game data come from the remote server.`)});\n`); return;
      }
      if (dev && await dev.handle(req, res, pathname)) return;
      if (pathname === '/' || pathname === '/index.html') {
        const source = await readFile(path.join(publicRoot, 'index.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : source.replace('</head>', `${INDEX_HEAD}</head>`)); return;
      }
      if (!LOCAL_PREFIXES.some(p => pathname.startsWith(p)) && !['/manifest.json', '/resource-sw.js'].includes(pathname)) {
        fail(res, 404, 'Not found'); return;
      }
      const file = await realpath(path.join(publicRoot, pathname));
      if (!file.startsWith(publicRoot + path.sep) || pathname.split('/').some(p => p.startsWith('.'))) {
        fail(res, 404, 'Not found'); return;
      }
      const info = await stat(file);
      if (!info.isFile()) { fail(res, 404, 'Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store', 'Content-Length': info.size });
      if (req.method === 'HEAD') res.end(); else await pipeline(createReadStream(file), res);
    } catch (err) {
      fail(res, err.code === 'ENOENT' ? 404 : 500, 'Cannot serve development file');
    }
  });
  server.on('connection', socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    if (!localRequest(req, origin) || requestPath(req) !== '/ws' || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    proxy(req, socket, head);
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(port, host, resolve);
    });
  } catch (err) { dev?.close(); await resources.close(); agent.destroy(); throw err; }
  origin = `http://${host}:${server.address().port}`;
  log.log?.(`\n[dev] REMOTE ${remote.origin}\n[dev] Real remote accounts/games; separate browser identity at ${origin}\n[dev] Frontend code and presentation resources are local. Shared simulation and game data are remote. HOST / SP_WS_URL / local database settings are not used.`);
  return { url: origin, host, port: server.address().port, server, target: remote.origin,
    async close() {
      closed = true; dev?.close(); await resources.close(); agent.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
