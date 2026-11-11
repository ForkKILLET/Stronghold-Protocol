import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, writeFile, copyFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { parseRemoteTarget, remoteTargetFromArgv, remoteDevHost, startRemoteDev } from '../server/http/devRemote.js';

const quiet = { log() {}, warn() {} };

async function fixture(t, { hot = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-dev-remote-')), publicDir = path.join(root, 'public');
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ['js', 'css', 'i18n', 'vendor']) await mkdir(path.join(publicDir, dir), { recursive: true });
  await writeFile(path.join(publicDir, 'index.html'), '<!doctype html><html><head><title>Fixture</title><link rel="stylesheet" href="/css/test.css"></head><body><p id="sample">Local UI</p><script src="/js/test.js"></script></body></html>');
  await writeFile(path.join(publicDir, 'css/test.css'), '#sample { color: rgb(10, 20, 30); }');
  await writeFile(path.join(publicDir, 'js/test.js'), 'window.fixtureVersion=1; window.fixtureSession=Math.random();');
  await copyFile('public/js/devReload.js', path.join(publicDir, 'js/devReload.js'));
  const requests = [], wsRequests = [], peers = new Set();
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, headers: req.headers, method: req.method, body: Buffer.concat(chunks).toString() });
    if (req.url === '/api/user') {
      if (!req.headers.cookie) res.setHeader('Set-Cookie', ['sp_user=remote-token; Path=/; Secure; HttpOnly; SameSite=Strict; Domain=production.invalid', 'admin=do-not-copy; Path=/']);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ user: { name: 'Remote', cookie: req.headers.cookie || null } })); return;
    }
    if (req.url === '/api/redirect') {
      res.writeHead(302, { Location: `http://${req.headers.host}/api/user` }); res.end(); return;
    }
    if (req.url === '/api/external') {
      res.writeHead(302, { Location: 'https://other.invalid/' }); res.end(); return;
    }
    if (req.url === '/api/refused') { res.writeHead(403); res.end('Refused by remote'); return; }
    res.end(`remote:${req.url}`);
  });
  const wss = new WebSocketServer({ server: upstream, perMessageDeflate: true });
  wss.on('connection', (ws, req) => {
    wsRequests.push(req.headers); peers.add(ws); ws.on('close', () => peers.delete(ws));
    ws.on('message', (data, binary) => ws.send(data, { binary }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const target = `http://127.0.0.1:${upstream.address().port}`;
  let stopped = false;
  const stopUpstream = async () => {
    if (stopped) return;
    stopped = true;
    for (const ws of peers) ws.terminate();
    await new Promise(resolve => { upstream.close(resolve); upstream.closeAllConnections(); });
    wss.close();
  };
  t.after(stopUpstream);
  const gateway = await startRemoteDev({ target, port: 0, hot, publicDir, log: quiet });
  t.after(() => gateway.close());
  return { gateway, target, publicDir, requests, wsRequests, peers, stopUpstream };
}

function rawRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject); req.end();
  });
}

test('remote mode is explicit, source-only, and validates a fixed credential-free server origin', () => {
  assert.equal(remoteTargetFromArgv([], {}), null);
  assert.equal(remoteTargetFromArgv(['--source-client'], {}), null);
  assert.throws(() => remoteTargetFromArgv([], { SP_DEV_REMOTE: 'https://game.example' }), /source development/);
  const argv = ['--source-client', '--hot', '--remote', 'https://game.example:7999/'];
  assert.equal(remoteTargetFromArgv(argv, {}), 'https://game.example:7999');
  assert.equal(remoteTargetFromArgv(['--source-client', '--remote=https://b.example'], { SP_DEV_REMOTE: 'https://a.example' }), 'https://b.example');
  for (const value of ['', '--hot']) assert.throws(() => remoteTargetFromArgv(['--source-client', '--remote', value], {}));
  assert.throws(() => remoteTargetFromArgv([...argv, '--remote=https://b.example'], {}), /only once/);
  for (const value of ['wss://game.example', 'https://user:secret@game.example', 'https://game.example/path',
    'https://game.example/?token=secret', 'https://game.example/#x', 'http://game.example', ' https://game.example']) {
    assert.throws(() => parseRemoteTarget(value));
  }
  assert.equal(parseRemoteTarget('http://127.0.0.1:1234').origin, 'http://127.0.0.1:1234');
  assert.match(remoteDevHost('https://game.example'), /^127\./);
  assert.notEqual(remoteDevHost('https://game.example'), '127.0.0.1');
  assert.equal(remoteDevHost('https://game.example/'), remoteDevHost('https://game.example'));
  assert.notEqual(remoteDevHost('https://game.example'), remoteDevHost('https://other.example'));
});

test('local source/HMR and remote data, simulation, accounts and pinned traits have separate owners', { timeout: 20000 }, async t => {
  const { gateway, requests } = await fixture(t), base = gateway.url;
  const page = await (await fetch(base + '/?room=AB12')).text();
  assert.match(page, /Local UI/); assert.match(page, /__dev\/remote.js/); assert.match(page, /\/js\/devReload.js/);
  for (const file of ['/js/test.js', '/css/test.css']) {
    const res = await fetch(base + file); assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await res.text(), /^remote:/);
  }
  assert.equal(await (await fetch(base + '/js/ws-config.js')).text(), 'export const WS_URL = "";\n');
  assert.match(await (await fetch(base + '/__dev/remote.js')).text(), /Real|affect this server/);
  for (const file of ['/healthz', '/data/resource-manifest.json', '/data/versions/v3/chess.json', '/shared/constants.js',
    '/sim/spec.js', '/cs/abc/index.json', '/assets/a.webp', '/resource-packs/a.zip', '/downloads/a.zip',
    '/packs/index.json', '/api/user/stats', '/api/user/replays', '/js/asset-cdn.js', '/js/battle/operatorTraits.js?v=hash']) {
    assert.equal(await (await fetch(base + file)).text(), `remote:${file}`);
  }
  assert.ok(requests.every(req => req.headers.host === new URL(gateway.target).host));
  assert.ok(requests.every(req => req.headers.origin === gateway.target));
  for (const file of ['/admin', '/admin/api/players', '/studio/', '/metrics', '/.state/users.sqlite']) {
    assert.equal((await fetch(base + file)).status, 404);
  }
  const head = await fetch(base + '/js/test.js', { method: 'HEAD' }); assert.equal(await head.text(), '');
});

test('account cookies survive HTTP/WS while unrelated cookies and proxy credentials never leave the gateway', { timeout: 20000 }, async t => {
  const { gateway, requests, wsRequests } = await fixture(t), base = gateway.url;
  const initial = await fetch(base + '/api/user');
  const cookies = initial.headers.getSetCookie(); assert.equal(cookies.length, 1);
  assert.match(cookies[0], /^sp_user=remote-token/); assert.match(cookies[0], /HttpOnly; SameSite=Strict/);
  assert.doesNotMatch(cookies[0], /Secure|Domain|admin=/);
  const headers = { cookie: 'admin=secret; sp_user=remote-token; other=secret', origin: base,
    authorization: 'Bearer secret', 'x-forwarded-for': '8.8.8.8', 'x-real-ip': '8.8.4.4',
    'content-type': 'application/json' };
  const saved = await fetch(base + '/api/user/profile', { method: 'POST', headers, body: '{"name":"debug"}' });
  assert.equal(saved.status, 200);
  const req = requests.at(-1);
  assert.equal(req.body, '{"name":"debug"}'); assert.equal(req.headers.cookie, 'sp_user=remote-token');
  for (const name of ['authorization', 'x-forwarded-for', 'x-real-ip']) assert.equal(req.headers[name], undefined);
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws', { headers });
  t.after(() => ws.terminate()); await once(ws, 'open');
  assert.match(ws.extensions, /permessage-deflate/);
  assert.equal(wsRequests[0].cookie, 'sp_user=remote-token'); assert.equal(wsRequests[0].origin, gateway.target);
  assert.equal(wsRequests[0].host, new URL(gateway.target).host); assert.equal(wsRequests[0].authorization, undefined);
  const message = once(ws, 'message'); ws.send(Buffer.from([1, 2, 3]));
  const [body, binary] = await message; assert.equal(binary, true); assert.deepEqual([...body], [1, 2, 3]);
  const compressed = once(ws, 'message'); ws.send('compressed'.repeat(2000));
  assert.equal((await compressed)[0].toString(), 'compressed'.repeat(2000));
  const closed = once(ws, 'close'); ws.close(1000, 'done');
  assert.deepEqual(await closed, [1000, Buffer.from('done')]);
});

test('loopback Host, Origin, Fetch Metadata and paths are checked before HTTP and WS forwarding', async t => {
  const { gateway, requests, wsRequests } = await fixture(t), base = gateway.url;
  for (const headers of [{ host: 'attacker.invalid' }, { origin: 'https://attacker.invalid' },
    { origin: base + '/' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) {
    assert.equal((await rawRequest(base + '/api/user', { headers })).status, 403);
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws', { headers });
    await assert.rejects(once(ws, 'open'), /403/);
  }
  for (const p of ['/js/%2e%2e/secret', '/js/%00bad', '/js/%5cbad', '//example.invalid/api/user']) {
    assert.equal((await rawRequest(base, { path: p })).status, 400);
  }
  assert.equal(requests.length, 0); assert.equal(wsRequests.length, 0);
});

test('remote refusals and redirects preserve errors; outages never fall back to a local game', async t => {
  const { gateway, stopUpstream } = await fixture(t), base = gateway.url;
  const refused = await fetch(base + '/api/refused'); assert.equal(refused.status, 403);
  assert.equal(await refused.text(), 'Refused by remote');
  const redirected = await fetch(base + '/api/redirect', { redirect: 'manual' });
  assert.equal(redirected.status, 302); assert.equal(redirected.headers.get('location'), base + '/api/user');
  assert.equal((await fetch(base + '/api/external', { redirect: 'manual' })).status, 502);
  await stopUpstream();
  assert.equal((await fetch(base + '/healthz')).status, 502);
  assert.equal((await fetch(base + '/api/user')).status, 502);
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws');
  await assert.rejects(once(ws, 'open'), /502/);
  assert.equal((await fetch(base + '/js/test.js')).status, 200);
});

test('source-only remote mode omits HMR and refuses symlinks outside public', async t => {
  const { gateway, publicDir } = await fixture(t, { hot: false });
  const index = await (await fetch(gateway.url)).text();
  assert.doesNotMatch(index, /devReload.js/); assert.match(index, /__dev\/remote.js/);
  assert.equal((await fetch(gateway.url + '/__dev/events')).status, 404);
  try { await symlink(path.join(publicDir, '../secret.js'), path.join(publicDir, 'js/leak.js'), 'file'); }
  catch (err) {
    if (process.platform === 'win32' && err.code === 'EPERM') { t.diagnostic('Symlink fixture needs Windows developer mode'); return; }
    throw err;
  }
  await writeFile(path.join(publicDir, '../secret.js'), 'secret');
  assert.equal((await fetch(gateway.url + '/js/leak.js')).status, 404);
});

test('real backend uses the same account for HTTP and WS without relaxing production Origin checks', { timeout: 20000 }, async t => {
  const { startServer } = await import('../server/index.js');
  const { TestClient } = await import('./helpers/wsClient.js');
  const backend = await startServer({ host: '127.0.0.1', port: 0, workers: 0, roomWorkers: 0, matchWorkers: 0,
    quiet: true, assetIndex: false, serverConfigFile: false, announcementsFile: null, nameModeration: null,
    clientBuild: false, userFile: ':memory:', studio: false });
  t.after(() => backend.close());
  const gateway = await startRemoteDev({ target: backend.url, port: 0, log: quiet });
  t.after(() => gateway.close());
  const first = await fetch(gateway.url + '/api/user'), { user } = await first.json();
  const cookie = first.headers.getSetCookie()[0].split(';')[0];
  const save = await fetch(gateway.url + '/api/user/profile', { method: 'POST', headers: {
    cookie, origin: gateway.url, 'content-type': 'application/json',
  }, body: JSON.stringify({ name: '远程开发测试', avatarId: 'avatar:Avatar_dyn_01' }) });
  assert.equal(save.status, 200);
  assert.equal((await save.json()).user.name, '远程开发测试');
  const client = await TestClient.connect(gateway.url.replace('http:', 'ws:') + '/ws', {
    wsOptions: { headers: { Cookie: cookie, Origin: gateway.url } },
  });
  t.after(() => client.close());
  const welcome = await client.hello('远程开发测试');
  assert.equal(backend.registry.byId(welcome.playerId).userId, user.id);
  const direct = await fetch(backend.url + '/api/user', { headers: { cookie, origin: gateway.url } });
  assert.equal(direct.status, 403, 'remote browser Origin remains forbidden at the real server');
  assert.equal((await fetch(gateway.url + '/healthz')).status, 200);
  assert.equal(await (await fetch(gateway.url + '/sim/spec.js')).text(), await (await fetch(backend.url + '/sim/spec.js')).text());
  assert.equal((await fetch(gateway.url + '/api/user/stats', { headers: { cookie } })).status, 200);
  assert.equal((await fetch(gateway.url + '/shared/constants.js')).status, 200);
});

test('source CLI selects the remote gateway without opening a local user database', { timeout: 20000 }, async t => {
  const { target, publicDir } = await fixture(t);
  const userFile = path.join(publicDir, 'must-not-be-created.sqlite');
  const child = spawn(process.execPath, ['server/index.js', '--source-client', '--hot', '--remote', target], {
    env: { ...process.env, PORT: '0', HOST: '0.0.0.0', SP_USER_DB: userFile, SP_WS_URL: 'wss://wrong.invalid/ws' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  t.after(async () => { if (child.exitCode === null && !child.signalCode) child.kill(); await closed; });
  let output = '';
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Remote CLI startup timeout')), 10000);
    child.stdout.on('data', data => {
      output += data;
      const match = output.match(/Local:\s+(http:\/\/127\.[\d.]+:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('exit', () => { clearTimeout(timer); reject(new Error('Remote CLI exited before startup')); });
  });
  assert.equal(await (await fetch(base + '/healthz')).text(), 'remote:/healthz');
  assert.equal(await (await fetch(base + '/js/ws-config.js')).text(), 'export const WS_URL = "";\n');
  assert.match(output, /\[dev\] REMOTE/); assert.doesNotMatch(output, /Internet:|LAN:/);
  await assert.rejects(access(userFile), { code: 'ENOENT' });
  child.kill();
  const [code] = await closed;
  if (process.platform !== 'win32') assert.equal(code, 0, 'CLI shutdown releases the development gateway');
});

test('Firefox: isolated remote identity, HTTP/WS, secure loopback storage and local HMR work together', {
  skip: process.env.SP_E2E !== '1', timeout: 60000,
}, async t => {
  const { gateway, publicDir } = await fixture(t);
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ browser: 'firefox', executablePath: '/run/current-system/sw/bin/firefox', headless: true,
    extraPrefsFirefox: { 'dom.ipc.processCount': 2, 'dom.ipc.processCount.webIsolated': 1,
      'dom.ipc.processPrelaunch.enabled': false, 'fission.autostart': false } });
  t.after(() => browser.close());
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(gateway.url, { waitUntil: 'networkidle0' });
  assert.match(await page.title(), /^\[REMOTE /);
  const result = await page.evaluate(async () => {
    const first = await (await fetch('/api/user')).json();
    const second = await (await fetch('/api/user')).json();
    const echoed = await new Promise((resolve, reject) => {
      const ws = new WebSocket(location.origin.replace('http:', 'ws:') + '/ws');
      ws.onopen = () => ws.send('browser'); ws.onerror = reject;
      ws.onmessage = e => { ws.close(); resolve(e.data); };
    });
    localStorage.setItem('fixture', 'remote');
    return { first, second, echoed, secure: isSecureContext, sw: !!navigator.serviceWorker };
  });
  assert.equal(result.first.user.cookie, null); assert.equal(result.second.user.cookie, 'sp_user=remote-token');
  assert.equal(result.echoed, 'browser'); assert.equal(result.secure, true); assert.equal(result.sw, true);
  const session = await page.evaluate(() => window.fixtureSession);
  await writeFile(path.join(publicDir, 'css/test.css'), '#sample { color: rgb(40, 50, 60); }');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#sample')).color === 'rgb(40, 50, 60)');
  assert.equal(await page.evaluate(() => window.fixtureSession), session);
  await writeFile(path.join(publicDir, 'js/test.js'), 'window.fixtureVersion=2; window.fixtureSession=Math.random();');
  await page.waitForFunction(() => window.fixtureVersion === 2);
  assert.notEqual(await page.evaluate(() => window.fixtureSession), session);
  assert.equal(await page.evaluate(() => localStorage.getItem('fixture')), 'remote');
  assert.deepEqual(errors, []);
});
