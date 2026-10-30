import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';
import { TestClient } from './helpers/wsClient.js';
import { startServer } from '../server/index.js';
import { parseWsUrl } from '../server/http/config.js';
import { defaultWsUrl } from '../public/js/net.js';

test('WS endpoint parsing accepts complete URLs and rejects unusable configurations', () => {
  for (const value of [undefined, '', '  ', '/ws', 'example.com/ws', 'https://example.com/ws',
    'ws://', 'wss://user:secret@example.com/ws', 'wss://example.com/ws#fragment', 'wss://example.com:99999/ws']) {
    assert.equal(parseWsUrl(value), '', String(value));
  }
  assert.equal(parseWsUrl(' wss://example.com/game/ws?route=2 '), 'wss://example.com/game/ws?route=2');
  assert.equal(parseWsUrl('ws://[::1]:3000/ws'), 'ws://[::1]:3000/ws');
  assert.equal(defaultWsUrl({ protocol: 'http:', host: 'site.test:3000' }), 'ws://site.test:3000/ws');
  assert.equal(defaultWsUrl({ protocol: 'https:', host: 'site.test' }), 'wss://site.test/ws');
  assert.equal(defaultWsUrl(null), 'ws://localhost:3000/ws');
});

// Execute the client with the exact runtime module the HTTP server returned, using Node for the other ESM imports.
async function clientWithRuntime(body) {
  const sourceUrl = new URL('../public/js/net.js', import.meta.url);
  const runtimeUrl = 'data:text/javascript,' + encodeURIComponent(body);
  const source = (await fs.readFile(sourceUrl, 'utf8')).replace(/from '([^']+)'/g, (_match, specifier) => {
    const target = specifier === './ws-config.js' ? runtimeUrl : new URL(specifier, sourceUrl).href;
    return `from ${JSON.stringify(target)}`;
  });
  return import('data:text/javascript,' + encodeURIComponent(source));
}

test('SP_WS_URL reaches sockets without page context; empty options and invalid settings use defaults', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-ws-url-'));
  const previous = process.env.SP_WS_URL;
  t.after(async () => {
    if (previous === undefined) delete process.env.SP_WS_URL;
    else process.env.SP_WS_URL = previous;
    await fs.rm(dir, { recursive: true, force: true });
  });
  const expected = 'wss://backend.example.com/custom/ws?route=2';
  process.env.SP_WS_URL = ` ${expected} `;
  let previousTag;
  for (const [wsUrl, endpoint, warning] of [[undefined, expected, false], ['', '', false],
    ['ws://127.0.0.1:9000/ws', 'ws://127.0.0.1:9000/ws', false], ['https://bad.example/ws', '', true]]) {
    const warnings = [];
    const srv = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir, packsDir: path.join(dir, 'packs'),
      pluginsDir: path.join(dir, 'plugins'), wsUrl, store: null, workers: 0, roomWorkers: 0, matchWorkers: 0,
      studio: false, announcementsFile: null, log: { info() {}, warn: (msg) => warnings.push(msg), error() {}, debug() {} } });
    try {
      const url = `${srv.url}/js/ws-config.js`;
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /javascript/);
      assert.equal(response.headers.get('cache-control'), 'no-cache');
      const body = await response.text();
      const runtime = await import('data:text/javascript,' + encodeURIComponent(body));
      assert.equal(runtime.WS_URL, endpoint);
      const tag = response.headers.get('etag');
      if (previousTag) assert.notEqual(tag, previousTag, 'a changed endpoint changes the ETag');
      previousTag = tag;
      assert.equal((await fetch(url, { headers: { 'If-None-Match': tag } })).status, 304);
      const head = await fetch(url, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), '');
      assert.equal(Number(head.headers.get('content-length')), Buffer.byteLength(body));
      assert.equal(warnings.some(msg => msg.includes('SP_WS_URL ignored')), warning);

      const { Net, defaultWsUrl: resolvedUrl } = await clientWithRuntime(body);
      assert.equal(resolvedUrl({ protocol: 'https:', host: 'frontend.test' }), endpoint || 'wss://frontend.test/ws');
      const sockets = [];
      class Socket {
        constructor(address) { this.url = address; this.readyState = 0; sockets.push(this); }
        close() { this.readyState = 3; }
      }
      const net = new Net({ WebSocket: Socket });
      try {
        net.connect();
        assert.equal(sockets[0].url, endpoint || 'ws://localhost:3000/ws');
        sockets[0].readyState = 3;
        sockets[0].onclose({ code: 1006 });
        net.retryNow();
        assert.equal(sockets.length, 2);
        assert.equal(sockets[1].url, sockets[0].url);
      } finally { net.close(); }
      const explicit = new Net({ url: 'ws://explicit.test/ws', WebSocket: Socket });
      try {
        explicit.connect();
        assert.equal(explicit.ws.url, 'ws://explicit.test/ws');
      } finally { explicit.close(); }
    } finally { await srv.close(); }
  }
});

async function endpointClient(t, { endpoint = 'wss://backend.example.com/ws',
  location = { protocol: 'https:', host: 'page.example.com:8443' }, url, throwPrimary = false } = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: location });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'location', previous);
    else delete globalThis.location;
  });
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1_000_000 });
  t.mock.method(console, 'warn', () => {});
  const client = await clientWithRuntime(`export const WS_URL = ${JSON.stringify(endpoint)};\n`);
  const sockets = [], attempts = [];
  class Socket {
    constructor(address) {
      attempts.push(address);
      if (throwPrimary && address === endpoint) throw new Error('SecurityError');
      this.url = address;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    send(data) { this.sent.push(JSON.parse(data)); }
    close(code) { this.readyState = 3; this.closedWith = code; this.onclose?.({ code }); }
    open() { this.readyState = 1; this.onopen?.(); }
    drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
    recv(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
    last(type) { return this.sent.findLast(message => message.t === type); }
  }
  const net = new client.Net({ url, WebSocket: Socket, random: () => 0.5, getToken: () => 'saved-token',
    getTokenClaim: () => ({ noReplace: true, claimAt: 123 }) });
  t.after(() => net.close());
  return { ...client, net, sockets, attempts, Socket, ws: () => sockets.at(-1) };
}

function welcome(socket) {
  socket.recv({ t: 'welcome', rid: socket.last('hello').rid, playerId: 'player-1',
    token: 'saved-token', name: '博士', serverNow: Date.now() });
}

test('failed configured endpoint falls back to page /ws, preserving hello identity and sticking until reload', async t => {
  const { net, sockets, ws, Net, Socket } = await endpointClient(t);
  net.setName('博士');
  const primary = ws(), lateOpen = primary.onopen, lateClose = primary.onclose;
  primary.drop();
  t.mock.timers.tick(500);
  assert.equal(ws().url, 'wss://page.example.com:8443/ws');
  ws().open();
  const hello = ws().last('hello');
  assert.equal(hello.name, '博士');
  assert.equal(hello.token, 'saved-token');
  assert.equal(hello.noReplace, true);
  assert.equal(hello.claimAt, 123);
  welcome(ws());
  assert.equal(net.status, 'online');
  lateOpen(); lateClose({ code: 1006 });
  assert.equal(net.status, 'online', 'old socket callbacks cannot affect the fallback');
  ws().drop();
  net.retryNow();
  assert.equal(ws().url, 'wss://page.example.com:8443/ws');
  assert.equal(sockets.length, 3);
  net.close();
  const reloaded = new Net({ WebSocket: Socket });
  try {
    reloaded.connect();
    assert.equal(ws().url, 'wss://backend.example.com/ws', 'a new page starts with the configured endpoint');
  } finally { reloaded.close(); }
});

test('constructor failure and a stalled upgrade both reach the page endpoint', async t => {
  await t.test('constructor throws', async t => {
    const { net, attempts } = await endpointClient(t, { throwPrimary: true });
    net.connect();
    t.mock.timers.tick(500);
    assert.deepEqual(attempts, ['wss://backend.example.com/ws', 'wss://page.example.com:8443/ws']);
  });
  await t.test('upgrade stays CONNECTING', async t => {
    const { net, ws, sockets, CONNECT_TIMEOUT_MS } = await endpointClient(t);
    net.connect();
    t.mock.timers.tick(CONNECT_TIMEOUT_MS - 1);
    assert.equal(sockets.length, 1);
    t.mock.timers.tick(1);
    assert.equal(sockets[0].closedWith, 4000);
    t.mock.timers.tick(500);
    assert.equal(ws().url, 'wss://page.example.com:8443/ws');
  });
});

test('hello and heartbeat timeouts trigger fallback with the existing reconnect protocol', async t => {
  await t.test('hello never answers', async t => {
    const { net, ws, HELLO_TIMEOUT_MS } = await endpointClient(t);
    net.setName('博士'); ws().open();
    t.mock.timers.tick(HELLO_TIMEOUT_MS);
    net.retryNow();
    assert.equal(ws().url, 'wss://page.example.com:8443/ws');
  });
  await t.test('title socket never answers a ping', async t => {
    const { net, ws, DEAD_AFTER_MS } = await endpointClient(t);
    net.connect(); ws().open();
    t.mock.timers.setTime(Date.now() + DEAD_AFTER_MS + 1);
    net.probe(); net.retryNow();
    assert.equal(ws().url, 'wss://page.example.com:8443/ws');
  });
});

for (const code of [1001, 1012, 1006]) test(`working endpoint gets recovery grace after close ${code}`, async t => {
  const { net, ws, RECONNECT_GRACE_MS, RESTART_GRACE_MS } = await endpointClient(t);
  net.setName('博士'); ws().open(); welcome(ws());
  const grace = code === 1006 ? RECONNECT_GRACE_MS : RESTART_GRACE_MS;
  const started = Date.now();
  ws().drop(code);
  net.retryNow();
  assert.equal(ws().url, 'wss://backend.example.com/ws');
  t.mock.timers.setTime(started + grace - 1);
  ws().drop(code); net.retryNow();
  assert.equal(ws().url, 'wss://backend.example.com/ws', 'failed retries do not end grace early');
  t.mock.timers.setTime(started + grace);
  ws().drop(code); net.retryNow();
  assert.equal(ws().url, 'wss://page.example.com:8443/ws', 'repeated failures do not extend the outage deadline');
});

test('a successful restart recovery stays on the primary and resets grace for the next outage', async t => {
  const { net, ws, RESTART_GRACE_MS } = await endpointClient(t);
  net.setName('博士'); ws().open(); welcome(ws());
  ws().drop(1001);
  t.mock.timers.tick(500);
  ws().open(); welcome(ws());
  assert.equal(net.status, 'online');
  assert.equal(ws().url, 'wss://backend.example.com/ws');
  const started = Date.now();
  ws().drop(1012);
  t.mock.timers.setTime(started + RESTART_GRACE_MS - 1);
  net.retryNow(); ws().drop(); net.retryNow();
  assert.equal(ws().url, 'wss://backend.example.com/ws');
});

test('a later restart signal widens the original outage window without renewing it', async t => {
  const { net, ws, RECONNECT_GRACE_MS, RESTART_GRACE_MS } = await endpointClient(t);
  net.setName('博士'); ws().open(); welcome(ws());
  const started = Date.now();
  ws().drop(); net.retryNow();
  t.mock.timers.setTime(started + RECONNECT_GRACE_MS - 1);
  ws().open(); ws().drop(1012); net.retryNow();
  t.mock.timers.setTime(started + RESTART_GRACE_MS - 1);
  ws().drop(1012); net.retryNow();
  assert.equal(ws().url, 'wss://backend.example.com/ws');
  t.mock.timers.setTime(started + RESTART_GRACE_MS);
  ws().drop(); net.retryNow();
  assert.equal(ws().url, 'wss://page.example.com:8443/ws');
});

test('an explicit restart close also grants grace before the first welcome', async t => {
  const { net, ws } = await endpointClient(t);
  net.setName('博士'); ws().open(); ws().drop(1012); net.retryNow();
  assert.equal(ws().url, 'wss://backend.example.com/ws');
});

test('title pong confirms a working endpoint and idle close 4002 keeps its route', async t => {
  const { net, ws, RECONNECT_GRACE_MS } = await endpointClient(t);
  net.connect(); ws().open();
  ws().recv({ t: 'pong', c: Date.now(), s: Date.now() });
  t.mock.timers.setTime(Date.now() + 6000);
  ws().drop(4002);
  assert.equal(ws().url, 'wss://backend.example.com/ws');
  ws().open(); ws().drop(); net.retryNow();
  assert.equal(ws().url, 'wss://backend.example.com/ws');
  t.mock.timers.setTime(Date.now() + RECONNECT_GRACE_MS);
  ws().drop(); net.retryNow();
  assert.equal(ws().url, 'wss://page.example.com:8443/ws');
});

test('business refusals, policy closes and manual close cannot select a fallback', async t => {
  for (const action of ['capacity-message', 'capacity-close', 'replaced', 'policy', 'name', 'version', 'manual']) {
    await t.test(action, async t => {
      const { net, ws, sockets } = await endpointClient(t);
      net.setName('博士'); ws().open();
      if (action === 'capacity-message') ws().recv({ t: 'error', rid: ws().last('hello').rid, code: 'SERVER_FULL' });
      else if (action === 'capacity-close') ws().drop(4003);
      else if (action === 'replaced') ws().drop(4001);
      else if (action === 'policy') ws().drop(1008);
      else if (action === 'manual') net.close();
      else ws().recv({ t: 'error', rid: ws().last('hello').rid,
        code: action === 'name' ? 'NAME_REJECTED' : 'BAD_MSG', detail: 'version mismatch' });
      // Stay inside the heartbeat deadline: an actual silent transport is a separate failure.
      t.mock.timers.tick(1000);
      assert.ok(sockets.every(socket => socket.url === 'wss://backend.example.com/ws'));
      if (action.startsWith('capacity')) {
        net.retryNow(); net.reconnectNow(); net.connect(); net.setName('Other');
        t.mock.timers.tick(120_000);
        assert.equal(sockets.length, 1);
        assert.equal(net.status, 'closed');
      }
    });
  }
});

test('unconfigured, same-origin and explicit URLs retain a single route; HTTP pages fall back to ws', async t => {
  for (const [settings, expected] of [
    [{ endpoint: '' }, 'wss://page.example.com:8443/ws'],
    [{ endpoint: 'wss://page.example.com:8443/ws' }, 'wss://page.example.com:8443/ws'],
    [{ endpoint: 'wss://page.example.com:443/ws', location: { protocol: 'https:', host: 'page.example.com' } }, 'wss://page.example.com:443/ws'],
    [{ url: 'ws://fixed.example.com/ws' }, 'ws://fixed.example.com/ws'],
    [{ location: { protocol: 'http:', host: 'page.example.com:3000' } }, 'ws://page.example.com:3000/ws'],
  ]) await t.test(expected, async t => {
    const { net, ws } = await endpointClient(t, settings);
    net.connect(); ws().drop(); net.retryNow();
    assert.equal(ws().url, expected);
  });
});

test('real WS fallback from a failed upgrade resumes the existing server identity', { timeout: 15000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-ws-fallback-'));
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  let srv, seed, net;
  const primary = http.createServer((_req, res) => { res.writeHead(503); res.end(); });
  primary.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  t.after(async () => {
    net?.close();
    await seed?.close();
    await srv?.close();
    await new Promise(resolve => primary.close(resolve));
    if (previous) Object.defineProperty(globalThis, 'location', previous);
    else delete globalThis.location;
    await fs.rm(dir, { recursive: true, force: true });
  });
  await new Promise(resolve => primary.listen(0, '127.0.0.1', resolve));
  const endpoint = `ws://127.0.0.1:${primary.address().port}/ws`;
  srv = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir, packsDir: path.join(dir, 'packs'),
    pluginsDir: path.join(dir, 'plugins'), wsUrl: endpoint, store: null, workers: 0, roomWorkers: 0, matchWorkers: 0,
    studio: false, announcementsFile: null, quiet: true });
  const pageEndpoint = srv.url.replace('http:', 'ws:') + '/ws';
  seed = await TestClient.connect(pageEndpoint);
  const original = await seed.hello('博士');
  await seed.close();
  Object.defineProperty(globalThis, 'location', { configurable: true,
    value: { protocol: 'http:', host: new URL(srv.url).host } });
  const { Net } = await clientWithRuntime(await (await fetch(`${srv.url}/js/ws-config.js`)).text());
  const attempts = [];
  class RecordingSocket extends WebSocket {
    constructor(address) { super(address); attempts.push(address); }
  }
  net = new Net({ WebSocket: RecordingSocket, getToken: () => original.token, random: () => 0.5 });
  const resumed = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fallback welcome timeout')), 5000);
    t.after(() => clearTimeout(timer));
    net.on('welcome', message => { clearTimeout(timer); resolve(message); });
    net.on('helloError', error => { clearTimeout(timer); reject(error); });
    net.setName('博士');
  });
  assert.deepEqual(attempts, [endpoint, pageEndpoint]);
  assert.equal(resumed.playerId, original.playerId);
  assert.equal(resumed.token, original.token);
  assert.equal(resumed.resumed, true);
  assert.equal(net.status, 'online');
});

test('a configured WS URL does not broaden account Origin checks or replace a live profile session', async t => {
  const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, workers: 0, matchWorkers: 0,
    userFile: ':memory:', wsUrl: 'wss://alternate.example/ws', assetIndex: false, announcementsFile: null, nameModeration: null });
  let client;
  t.after(async () => { await client?.close(); await srv.close(); });
  const profile = await fetch(srv.url + '/api/user');
  const cookie = profile.headers.get('set-cookie').split(';')[0];
  const endpoint = srv.url.replace('http:', 'ws:') + '/ws';
  client = await TestClient.connect(endpoint, { wsOptions: { headers: { Cookie: cookie, Origin: srv.url } } });
  const original = await client.hello('Origin test');
  assert.ok(srv.registry.byId(original.playerId).userId);
  for (const headers of [{ Origin: 'https://alternate.example' }, { Origin: srv.url, 'Sec-Fetch-Site': 'cross-site' }]) {
    await assert.rejects(TestClient.connect(endpoint, { wsOptions: { headers: { Cookie: cookie, ...headers } } }), /403/);
  }
  assert.equal((await client.request({ t: 'ping', c: Date.now() })).t, 'pong');
  assert.equal(srv.registry.byId(original.playerId).connected, true);
});
