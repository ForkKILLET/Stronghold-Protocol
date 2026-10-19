// SP_E2E=1: actual Firefox/Chrome Cache Storage, SW and built game UI.
// SP_RESOURCE_CACHE_ENTRIES=25000 reproduces the production cache entry count;
// filler files deliberately contain one byte, while the exercised model is real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';

for (const [engine, executablePath] of [['firefox', '/run/current-system/sw/bin/firefox'], ['chrome', '/run/current-system/sw/bin/google-chrome-stable']]) {
  test(`${engine}: indexed idle verification avoids resource reads and the game uses its cached model`, {
    skip: process.env.SP_E2E !== '1' || !existsSync(executablePath), timeout: 300000,
  }, async () => {
    const srv = await startServer({ host: '127.0.0.1', port: 0, workers: 0, quiet: true,
      clientBuild: true, userFile: ':memory:', announcementsFile: null, store: null });
    const out = new URL('../e2e/out/resource-idle/', import.meta.url); mkdirSync(out, { recursive: true });
    let browser;
    try {
      browser = await puppeteer.launch({ browser: engine, executablePath, headless: true,
        args: engine === 'chrome' ? ['--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader'] : [] });
      const page = await browser.newPage(); await page.setViewport({ width: 1366, height: 768 });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(srv.url + '/healthz');
      const count = Math.min(50000, Math.max(1, Number(process.env.SP_RESOURCE_CACHE_ENTRIES) || 128));
      const inventory = await page.evaluate(async count => {
        const { ResourceStore } = await import('/js/resources/store.js');
        const { CACHE_NAME, indexUrl } = await import('/js/resources/common.js');
        const cache = await caches.open(CACHE_NAME), files = [], index = {};
        // Constant verified one-byte content; one index write after all puts.
        const bytes = 'x', hash = '11f6ad8ec52a'; let next = 0;
        for (let i = 0; i < count; i++) {
          const url = `/assets/idle-fixture/${i}.png`;
          files.push({ url, hash, size: 1, tier: 1 }); index[new URL(url, location.href).href] = hash;
        }
        await Promise.all(Array.from({ length: 8 }, async () => {
          for (let i = next++; i < files.length; i = next++) await cache.put(files[i].url,
            new Response(bytes, { headers: { 'Content-Length': '1', 'X-SP-Resource': '1' } }));
        }));
        await cache.put(indexUrl(location.origin), new Response(JSON.stringify({ version: 1, manifest: 'idle-fixture', files: index })));
        const original = Cache.prototype.match; let reads = 0;
        Cache.prototype.match = function (key) {
          if (String(typeof key === 'string' ? key : key.url).includes('/assets/')) reads++;
          return original.apply(this, arguments);
        };
        try {
          const store = new ResourceStore({ version: 'idle-fixture', files });
          const start = performance.now();
          const status = await store.status({ headers: 'unindexed', background: true, signal: new AbortController().signal });
          return { count: status.count, reads, ms: performance.now() - start, verified: status.cacheVerified };
        } finally { Cache.prototype.match = original; }
      }, count);
      assert.equal(inventory.count, count); assert.equal(inventory.reads, 0); assert.equal(inventory.verified, true);
      const text = async label => {
        await page.waitForFunction(label => [...document.querySelectorAll('button')].some(e => e.textContent.trim() === label && !e.disabled), {}, label);
        await page.evaluate(label => [...document.querySelectorAll('button')].find(e => e.textContent.trim() === label && !e.disabled).click(), label);
      };
      await page.goto(srv.url, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('.title-screen input');
      await page.type('.title-screen input', '缓存验证'); await text('开始'); await page.waitForSelector('.lobby-hub');
      await page.evaluate(() => [...document.querySelectorAll('.hub-entry')].find(e => e.textContent.includes('独立模拟')).click());
      await page.waitForSelector('.protocol-screen'); await page.click('.proto-start'); await page.waitForSelector('.room-screen');
      await text('立即开始'); await page.waitForSelector('.brief'); await text('准备就绪'); await page.waitForSelector('.draft');
      await text('确认选择');
      await page.waitForFunction(() => window.__SP_VIEW__?.kind === 'engine' && window.__SP__.store.get().match?.public?.phase === 'PREP', { timeout: 60000 });
      const model = await page.evaluate(async () => {
        const s = window.__SP__.store.get(), slot = s.match.private.shop.slots.findIndex(e => e.kind === 'chess');
        const rec = window.__SP__.data.lookup('chess', s.match.private.shop.slots[slot].id);
        const assets = window.__SP_VIEW__.raw.debug.ctx.assets;
        const entry = assets.spineEntry(rec.charId);
        if (!entry) throw Error('no model entry for chosen shop operator');
        const cache = await caches.open('stronghold-resources-v1-all');
        for (const url of [entry.skel, entry.atlas || entry.skel.replace(/\.skel$/, '.atlas'),
          ...(entry.textures || [entry.skel.replace(/\.skel$/, '.png')])].filter(Boolean)) {
          const r = await fetch(url), body = await r.arrayBuffer();
          if (!r.ok) throw Error('model fixture failed: ' + url);
          await cache.put(url, new Response(body, { headers: { 'Content-Type': r.headers.get('content-type'),
            'Content-Length': String(body.byteLength), 'X-SP-Resource': '1' } }));
        }
        window.__idleQA = { reads: [], slot, skel: entry.skel };
        const fetcher = window.fetch;
        window.fetch = async function (input) {
          const url = String(typeof input === 'string' ? input : input.url), start = performance.now();
          const r = await fetcher.apply(this, arguments);
          if (url.includes('/spine/')) window.__idleQA.reads.push({ url, ms: performance.now() - start, marker: r.headers.get('x-sp-resource') });
          return r;
        };
        const start = performance.now(); await window.__SP__.net.request('g.buy', { slot });
        return { charId: rec.charId, skel: entry.skel, start };
      });
      await page.waitForFunction(charId => [...window.__SP_VIEW__.raw.debug.views.values()].some(v => v.info?.spine === charId && v.actor && !v.fallback.visible), {}, model.charId);
      const loaded = await page.evaluate(() => ({ elapsed: performance.now(), reads: window.__idleQA.reads,
        spine: window.__SP_VIEW__.raw.stats().spine }));
      assert.ok(loaded.reads.length >= 3, 'real operator loaded its skel, atlas and texture');
      assert.ok(loaded.reads.every(r => r.marker === '1'), JSON.stringify(loaded.reads));
      assert.equal(loaded.spine.failed, 0);
      await page.screenshot({ path: new URL(`${engine}-cached-model.png`, out).pathname });
      await page.click('.gm__gear[aria-label="设置"]'); await page.waitForSelector('.settings-modal');
      await page.evaluate(() => {
        window.__idlePanelReads = { keys: 0, headers: 0 };
        const match = Cache.prototype.match, keys = Cache.prototype.keys;
        Cache.prototype.match = function (key) {
          if (String(typeof key === 'string' ? key : key.url).includes('/assets/')) window.__idlePanelReads.headers++;
          return match.apply(this, arguments);
        };
        Cache.prototype.keys = function () { window.__idlePanelReads.keys++; return keys.apply(this, arguments); };
      });
      await text('资源管理'); await page.waitForSelector('.resource-modal');
      await page.waitForFunction(() => {
        const text = document.querySelector('.resource-tier__summary')?.innerText || '';
        return Number(text.match(/\/\s*(\d+)/)?.[1]) > 0;
      });
      const blocked = await page.evaluate(() => ({ message: document.querySelector('.resource-manager')?.innerText,
        reads: window.__idlePanelReads,
        checking: [...document.querySelectorAll('.resource-modal button')].some(e => e.textContent.trim() === '暂停下载') }));
      assert.ok(blocked.message.includes('完整检查请返回大厅后进行。')); assert.equal(blocked.checking, false);
      assert.deepEqual(blocked.reads, { keys: 0, headers: 0 });
      await page.screenshot({ path: new URL(`${engine}-prep-manager.png`, out).pathname });
      writeFileSync(new URL(`${engine}-measurements.json`, out), JSON.stringify({ inventory, model, loaded, blocked, errors }, null, 2));
      assert.deepEqual(errors, []);
    } finally { await browser?.close(); await srv.close(); }
  });
}
