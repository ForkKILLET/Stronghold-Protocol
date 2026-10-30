// SP_E2E=1: real browser sockets, one same-origin proxy and one account-backed game instance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';

for (const [engine, executablePath] of [['chrome', process.env.CHROME_PATH || '/run/current-system/sw/bin/google-chrome-stable'], ['firefox', process.env.FIREFOX_PATH || '/run/current-system/sw/bin/firefox']]) {
  test(`${engine}: same-origin fallback preserves account, match and independent tab identities`, {
    skip: process.env.SP_E2E !== '1' || !existsSync(executablePath), timeout: 90000,
  }, async () => {
    let server, browser, primary = true;
    const sockets = new Set(), attempts = [];
    const proxy = http.createServer((req, res) => {
      const upstream = http.request(server.url + req.url, { method: req.method, headers: req.headers }, reply => {
        res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
      });
      upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
    });
    proxy.on('upgrade', (req, client, head) => {
      attempts.push(req.url);
      if (req.url === '/ws-primary' && !primary) {
        client.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
      }
      const upstream = http.request(server.url + '/ws', { headers: req.headers });
      upstream.on('upgrade', (reply, remote, pending) => {
        sockets.add(client); sockets.add(remote);
        const headers = reply.rawHeaders.map((value, i, all) => i % 2 ? null : `${value}: ${all[i + 1]}`).filter(Boolean);
        client.write(`HTTP/1.1 101 Switching Protocols\r\n${headers.join('\r\n')}\r\n\r\n`);
        if (head.length) remote.write(head); if (pending.length) client.write(pending);
        client.on('error', () => remote.destroy()); remote.on('error', () => client.destroy());
        client.on('close', () => { sockets.delete(client); remote.destroy(); });
        remote.on('close', () => { sockets.delete(remote); client.destroy(); });
        remote.pipe(client); client.pipe(remote);
      });
      upstream.on('response', reply => { client.end(`HTTP/1.1 ${reply.statusCode} Refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); reply.resume(); });
      upstream.on('error', () => client.destroy()); upstream.end();
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${proxy.address().port}`;
    const out = new URL('../e2e/out/ws-fallback/', import.meta.url); mkdirSync(out, { recursive: true });
    try {
      server = await startServer({ host: '127.0.0.1', port: 0, quiet: true, workers: 0, matchWorkers: 0,
        userFile: ':memory:', wsUrl: origin.replace('http:', 'ws:') + '/ws-primary',
        clientBuild: process.env.SP_E2E_BUILD === '1', assetIndex: false, announcementsFile: null, nameModeration: null });
      browser = await puppeteer.launch({ browser: engine, executablePath, headless: true,
        args: engine === 'chrome' ? ['--no-sandbox', '--mute-audio', '--no-proxy-server'] : [] });
      const context = await browser.createBrowserContext(), errors = [];
      const open = async () => {
        const page = await context.newPage(); page.on('pageerror', e => {
          // Firefox reports the deliberately rejected native upgrade as a page error.
          if (engine === 'firefox' && e.message === `Firefox can’t establish a connection to the server at ${origin.replace('http:', 'ws:')}/ws-primary.`) return;
          errors.push(e.message);
        });
        await page.setViewport({ width: 1366, height: 768 });
        await page.evaluateOnNewDocument(() => {
          localStorage.setItem('sp.name', '网络回归'); sessionStorage.setItem('sp.entered', '1');
          const realNow = Date.now; window.__clockShift = 0;
          Date.now = () => realNow() + window.__clockShift;
        });
        await page.setRequestInterception(true);
        page.on('request', request => {
          const url = new URL(request.url());
          if (url.hostname === 'fonts.googleapis.com' || (url.pathname === '/fonts/fonts.css'
              && !existsSync(new URL('../../public/fonts/fonts.css', import.meta.url)))) {
            void request.respond({ status: 200, contentType: 'text/css', body: '/* System fonts in isolated QA. */' }).catch(() => {});
          } else void request.continue().catch(() => {});
        });
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__SP__?.store.get().connection.status === 'online');
        return page;
      };
      const startSolo = page => page.evaluate(async () => {
        const { net, store } = window.__SP__;
        await net.request('room.create', { mode: 'solo', difficulty: 'NORMAL' });
        await net.request('room.start', {});
        return { playerId: store.get().me.playerId, code: store.get().room.code };
      });
      const a = await open(), first = await startSolo(a);
      assert.equal(await a.evaluate(() => new URL(window.__SP__.net.ws.url).pathname), '/ws-primary');
      const userId = server.registry.byId(first.playerId).userId; assert.ok(userId);
      primary = false; server.registry.byId(first.playerId).ws.close(1001, 'isolated restart');
      await a.waitForFunction(() => window.__SP__.net.attempt >= 2);
      assert.ok(attempts.length >= 2 && attempts.every(path => path === '/ws-primary'), 'restart grace preserves the original route');
      // A new tab initially fails the primary and immediately falls back. Its account is shared, its match is not.
      const b = await open(), second = await startSolo(b);
      assert.equal(await b.evaluate(() => new URL(window.__SP__.net.ws.url).pathname), '/ws');
      assert.notEqual(first.playerId, second.playerId); assert.notEqual(first.code, second.code);
      assert.equal(server.registry.byId(second.playerId).userId, userId);
      // Advance only this page's clock across the real grace boundary; sockets/HTTP/hello stay native.
      await a.bringToFront();
      await a.evaluate(() => { window.__clockShift = 61000; window.__SP__.net.retryNow(); });
      await a.waitForFunction(id => window.__SP__.store.get().connection.status === 'online'
        && window.__SP__.store.get().me.playerId === id && new URL(window.__SP__.net.ws.url).pathname === '/ws', {}, first.playerId);
      await a.waitForFunction(code => window.__SP__.store.get().room?.code === code && !!window.__SP__.store.get().match.public, {}, first.code);
      assert.equal(await b.evaluate(() => window.__SP__.store.get().room.code), second.code);
      primary = true;
      await a.reload({ waitUntil: 'domcontentloaded' });
      await a.waitForFunction(id => window.__SP__?.store.get().connection.status === 'online'
        && window.__SP__.store.get().me.playerId === id && new URL(window.__SP__.net.ws.url).pathname === '/ws-primary', {}, first.playerId);
      // A short restart recovers before the deadline and never needs the fallback route.
      primary = false; server.registry.byId(first.playerId).ws.close(1012, 'isolated restart');
      await a.waitForFunction(() => window.__SP__.net.attempt >= 2);
      primary = true; await a.evaluate(() => window.__SP__.net.retryNow());
      await a.waitForFunction(() => window.__SP__.store.get().connection.status === 'online');
      assert.equal(await a.evaluate(() => new URL(window.__SP__.net.ws.url).pathname), '/ws-primary');
      assert.equal(server.registry.byId(first.playerId).userId, userId);
      assert.ok(attempts.includes('/ws') && attempts.includes('/ws-primary'));
      await a.screenshot({ path: new URL(`${engine}-recovered.png`, out).pathname });
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close(); for (const socket of sockets) socket.destroy();
      await new Promise(resolve => proxy.close(resolve)); await server?.close();
    }
  });
}
