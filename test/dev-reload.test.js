import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { createDevReload } from '../server/http/devReload.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'sp-dev-reload-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const publicDir = path.join(root, 'public'), sharedDir = path.join(root, 'shared'), simDir = path.join(root, 'sim');
  for (const dir of ['public/css', 'public/js', 'public/i18n', 'public/assets', 'shared', 'sim']) await mkdir(path.join(root, dir), { recursive: true });
  await writeFile(path.join(publicDir, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="/css/test.css"></head><body><p id="sample">Test</p><script src="/js/test.js"></script></body></html>');
  await writeFile(path.join(publicDir, 'css/test.css'), '#sample { color: rgb(10, 20, 30); }');
  await writeFile(path.join(publicDir, 'js/test.js'), 'window.fixtureVersion=1; window.fixtureSession=Math.random();');
  await copyFile('public/js/devReload.js', path.join(publicDir, 'js/devReload.js'));
  return { publicDir, sharedDir, simDir };
}

test('source development watches CSS and nested ESM, ignores assets, and releases streams on close', { timeout: 10000 }, async t => {
  const dirs = await fixture(t), dev = createDevReload(dirs);
  const server = http.createServer(async (req, res) => {
    if (!await dev.handle(req, res, req.url)) { res.writeHead(404); res.end(); }
  });
  t.after(() => new Promise(resolve => { dev.close(); server.close(resolve); server.closeAllConnections(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const index = await fetch(base);
  assert.equal(index.headers.get('cache-control'), 'no-store');
  assert.match(await index.text(), /src="\/js\/devReload.js"/);
  assert.equal((await fetch(base, { method: 'HEAD' })).status, 200);
  const stream = await fetch(base + '/__dev/events'), reader = stream.body.getReader();
  const next = async () => {
    let result = '';
    while (!result.includes('data: ')) result += new TextDecoder().decode((await reader.read()).value);
    return JSON.parse(result.split('data: ')[1].split('\n')[0]);
  };
  const hello = await next();
  assert.equal(hello.type, 'hello');
  assert.equal(stream.headers.get('content-type'), 'text/event-stream');
  await writeFile(path.join(dirs.publicDir, 'assets/ignored.js'), 'ignored');
  await writeFile(path.join(dirs.publicDir, 'css/test.css'), 'body { color: red; }');
  const css = await next();
  assert.equal(css.type, 'css');
  assert.deepEqual(css.paths, ['/css/test.css']);
  await mkdir(path.join(dirs.publicDir, 'js/nested'));
  await writeFile(path.join(dirs.publicDir, 'js/nested/module.js'), 'export const version=2;');
  const js = await next();
  assert.equal(js.type, 'reload');
  assert.ok(js.paths.includes('/js/nested/module.js'));
  assert.ok(js.revision > css.revision);
  dev.close();
  assert.equal((await reader.read()).done, true);
});

test('hot reload is opt-in and cannot override built-client mode', { timeout: 20000 }, async t => {
  const { startServer } = await import('../server/index.js');
  const dirs = await fixture(t);
  for (const clientBuild of [false, true]) {
    const srv = await startServer({ ...dirs, clientBuild, hotReload: clientBuild, port: 0, host: '127.0.0.1',
      workers: 0, userFile: ':memory:', announcementsFile: null, assetIndex: false, studio: false, quiet: true });
    try {
      assert.doesNotMatch(await (await fetch(srv.url)).text(), /devReload.js/);
      assert.equal((await fetch(srv.url + '/__dev/events')).status, 404);
    } finally { await srv.close(); }
  }
});

test('Firefox: CSS swaps without navigation, JS refreshes, and backend restart reconnects', {
  skip: process.env.SP_E2E !== '1', timeout: 60000,
}, async t => {
  const { startServer } = await import('../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const dirs = await fixture(t);
  const opts = { ...dirs, clientBuild: false, hotReload: true, port: 0, host: '127.0.0.1', workers: 0,
    userFile: ':memory:', announcementsFile: null, assetIndex: false, studio: false, quiet: true };
  let srv = await startServer(opts), browser;
  try {
    browser = await puppeteer.launch({ browser: 'firefox', executablePath: '/run/current-system/sw/bin/firefox', headless: true,
      extraPrefsFirefox: { 'dom.ipc.processCount': 2, 'dom.ipc.processCount.webIsolated': 1,
        'dom.ipc.processPrelaunch.enabled': false, 'fission.autostart': false } });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', err => errors.push(err.message));
    const connected = page.waitForResponse(res => res.url().endsWith('/__dev/events'));
    await page.goto(srv.url + '/?room=AB12');
    await connected;
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#sample')).color === 'rgb(10, 20, 30)');
    const session = await page.evaluate(() => window.fixtureSession);
    await writeFile(path.join(dirs.publicDir, 'css/test.css'), '#sample { color: rgb(40, 50, 60); }');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#sample')).color === 'rgb(40, 50, 60)');
    assert.equal(await page.evaluate(() => window.fixtureSession), session, 'CSS preserves page state');
    const reconnected = page.waitForResponse(res => res.url().endsWith('/__dev/events'));
    await writeFile(path.join(dirs.publicDir, 'js/test.js'), 'window.fixtureVersion=2; window.fixtureSession=Math.random();');
    await page.waitForFunction(() => window.fixtureVersion === 2);
    await reconnected;
    assert.notEqual(await page.evaluate(() => window.fixtureSession), session, 'JS loads a fresh native module graph');
    assert.equal(new URL(page.url()).searchParams.get('room'), 'AB12');
    assert.equal((await fetch(srv.url + '/healthz')).status, 200);
    await page.evaluate(() => new Promise((resolve, reject) => {
      const ws = new WebSocket(location.origin.replace('http', 'ws') + '/ws');
      ws.onopen = () => { ws.close(); resolve(); }; ws.onerror = reject;
    }));
    const beforeRestart = await page.evaluate(() => window.fixtureSession), port = srv.port;
    await srv.close();
    srv = await startServer({ ...opts, port });
    await page.waitForFunction(old => typeof window.fixtureSession === 'number' && window.fixtureSession !== old, {}, beforeRestart);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await srv.close(); }
});
