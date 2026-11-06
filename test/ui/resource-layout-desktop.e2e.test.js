import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';

test('desktop Firefox: preload panels use a bounded grid, internal headings and a status action area', {
  skip: process.env.SP_E2E !== '1', timeout: 60000,
}, async () => {
  const out = path.resolve('.state/resource-layout-20261107');
  await mkdir(out, { recursive: true });
  const paths = ['map/test.png', 'char/portrait/test.png', 'spine/test.skel', 'ui/test.png',
    'profile-avatars/test.png', 'char/portrait/skin/test.png', 'voice/cn/test.mp3', 'voice/jp/test.mp3',
    'voice/en/test.mp3', 'voice/kr/test.mp3', 'voice/test.mp3', 'local/fx/test.png', 'sfx/test.mp3', 'bgm/test.mp3', 'other/test.png'];
  const manifest = { format: 1, version: 'layout-test', files: paths.map((p, i) => ({
    url: '/assets/' + p, tier: i < 4 ? 1 : 2, size: 1024, hash: '0123456789ab',
  })) };
  const server = await startServer({ host: '127.0.0.1', port: 0, quiet: true, workers: 0,
    userFile: ':memory:', assetIndex: false, announcementsFile: null, clientBuild: false });
  let browser;
  try {
    browser = await puppeteer.launch({ browser: 'firefox', executablePath: '/run/current-system/sw/bin/firefox', headless: true,
      extraPrefsFirefox: { 'dom.ipc.processCount': 2, 'dom.ipc.processCount.webIsolated': 1,
        'dom.ipc.processPrelaunch.enabled': false, 'fission.autostart': false } });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = new URL(r.url());
      if (u.pathname === '/data/resource-manifest.json') void r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(manifest) }).catch(() => {});
      else if (u.hostname === 'fonts.googleapis.com') void r.respond({ status: 200, contentType: 'text/css', body: '' }).catch(() => {});
      else void r.continue().catch(() => {});
    });
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.res-pill');
    await page.click('.res-pill');
    await page.waitForFunction(() => document.querySelectorAll('.resource-tier__list li').length >= 14);
    for (const [width, height] of [[1920, 1080], [1536, 864]]) {
      await page.setViewport({ width, height });
      await page.evaluate(async () => {
        await document.fonts.ready;
        for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish();
      });
      const geometry = await page.evaluate(() => {
        const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, h: r.height }; };
        const modal = document.querySelector('.resource-modal'), body = modal.querySelector('.modal__body');
        return { modal: rect(modal), body: rect(body), overflow: body.scrollHeight - body.clientHeight,
          panels: [...modal.querySelectorAll('.resource-manager__grid > *')].map(e => ({ ...rect(e), background: getComputedStyle(e).backgroundColor,
            heading: rect(e.querySelector('h3')) })),
          lists: [...modal.querySelectorAll('.resource-tier__list')].map(e => ({ ...rect(e), scroll: getComputedStyle(e).overflowY, excess: e.scrollHeight - e.clientHeight })),
          top: [...modal.querySelectorAll('.resource-manager__top > *')].map(rect) };
      });
      assert.ok(geometry.modal.y >= 0 && geometry.modal.bottom <= height);
      assert.ok(geometry.overflow <= 1, 'the manager body does not become one long page');
      assert.equal(await page.$('.resource-modal .modal__actions'), null);
      assert.equal(await page.$('.resource-modal legend'), null);
      assert.equal(geometry.panels.length, 4);
      const [voice, skin, required, optional] = geometry.panels;
      assert.ok(Math.abs(voice.y - skin.y) < 1 && Math.abs(required.y - optional.y) < 1);
      assert.ok(voice.right < skin.x && required.right < optional.x);
      assert.ok(required.y >= Math.max(voice.bottom, skin.bottom) + 10);
      assert.ok(Math.abs(required.bottom - geometry.body.bottom) < 32);
      assert.ok(geometry.panels.every(p => p.background === required.background && p.heading.y > p.y && p.heading.bottom < p.bottom));
      assert.ok(geometry.top.every(p => p.bottom < voice.y));
      assert.ok(geometry.lists.every(p => p.scroll === 'auto' && p.bottom <= geometry.body.bottom));
      assert.ok(geometry.lists[1].excess > 0, 'optional resources scroll within their panel');
      const labels = await page.$$eval('.resource-manager__status .btn', es => es.map(e => e.textContent.trim()));
      assert.deepEqual(labels, ['开始预载', '清理缓存', '关闭预载']);
      await page.screenshot({ path: path.join(out, `manager-${width}.png`) });
      await page.$eval('.resource-tier:last-child .resource-tier__list', e => { e.scrollTop = e.scrollHeight; });
      assert.ok(await page.$eval('.resource-tier:last-child .resource-tier__list', e => e.lastElementChild.getBoundingClientRect().bottom <= e.getBoundingClientRect().bottom + 1));
    }
    const voice = await page.$eval('[name="preload-voice-lang"][value="jp"]', e => e.checked);
    await page.click('[name="preload-voice-lang"][value="jp"]');
    assert.notEqual(await page.$eval('[name="preload-voice-lang"][value="jp"]', e => e.checked), voice);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.resource-modal', { hidden: true });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});
