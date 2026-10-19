// SP_E2E=1: real module Service Worker and CacheStorage in Chrome and Firefox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';

for (const [browser, executablePath] of [['chrome', '/run/current-system/sw/bin/google-chrome-stable'], ['firefox', '/run/current-system/sw/bin/firefox']]) {
  test(`${browser}: cached model reads respect current cache, legacy fallback and clear`, {
    skip: process.env.SP_E2E !== '1' || !existsSync(executablePath), timeout: 60000,
  }, async () => {
    const srv = await startServer({ host: '127.0.0.1', port: 0, workers: 0, quiet: true,
      clientBuild: false, userFile: ':memory:', announcementsFile: null, assetIndex: false });
    let instance;
    try {
      instance = await puppeteer.launch({ browser, executablePath, headless: true,
        args: browser === 'chrome' ? ['--no-sandbox', '--no-proxy-server'] : [] });
      const page = await instance.newPage();
      await page.goto(`${srv.url}/healthz`);
      await page.evaluate(async () => {
        await navigator.serviceWorker.register('/resource-sw.js', { type: 'module', scope: '/', updateViaCache: 'none' });
        await navigator.serviceWorker.ready;
      });
      await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
      const result = await page.evaluate(async () => {
        const url = `${location.origin}/assets/cache-probe/model.skel`;
        const current = 'stronghold-resources-v1-all', legacy = 'stronghold-resources-v1-old';
        await (await caches.open(legacy)).put(url, new Response('legacy-model'));
        await (await caches.open('unrelated-cache')).put(url, new Response('unrelated-model'));
        await (await caches.open(current)).put(url, new Response('current-model'));
        const fresh = await (await fetch(url)).text();
        const partial = await fetch(url, { headers: { Range: 'bytes=0-6' } });
        const range = { status: partial.status, body: await partial.text() };
        await caches.delete(current);
        const old = await (await fetch(url)).text();
        await caches.delete(legacy);
        const cleared = await fetch(url);
        return { fresh, range, old, cleared: cleared.status, currentExists: (await caches.keys()).includes(current) };
      });
      assert.deepEqual(result, { fresh: 'current-model', range: { status: 206, body: 'current' },
        old: 'legacy-model', cleared: 404, currentExists: false });
    } finally {
      await instance?.close();
      await srv.close();
    }
  });
}
