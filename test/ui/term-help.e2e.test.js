// SP_E2E=1: local real components, plus the compiled encyclopedia. Never uses production players.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';
for (const [engine, executablePath] of [['chrome', '/run/current-system/sw/bin/google-chrome-stable'], ['firefox', '/run/current-system/sw/bin/firefox']]) test(`${engine}: term preview, pin, related terms, modal and card boundaries`, {
  skip: process.env.SP_E2E !== '1' || !existsSync(executablePath), timeout: 90000,
}, async () => {
  const srv = await startServer({ host: '127.0.0.1', port: 0, workers: 0, quiet: true, clientBuild: false, userFile: ':memory:', announcementsFile: null, assetIndex: false });
  let browser;
  const out = new URL('../e2e/out/', import.meta.url); mkdirSync(out, { recursive: true });
  try {
    browser = await puppeteer.launch({ browser: engine, executablePath, headless: true, args: engine === 'chrome' ? ['--no-sandbox', '--mute-audio', '--no-proxy-server'] : [] });
    const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1366, height: 768, hasTouch: true });
    await page.goto(srv.url + '/dev/simcheck/ui.js');
    await page.setContent('<html><head><link rel="stylesheet" href="/css/theme.css"><link rel="stylesheet" href="/css/components.css"><link rel="stylesheet" href="/css/screens/game-panels.css"></head><body><main id="fixture"></main></body></html>');
    await page.evaluate(async () => {
      const { h, render } = await import('/vendor/preact.module.js');
      const { useState } = await import('/vendor/hooks.module.js');
      const { RichText } = await import('/js/ui/gameComponents.js');
      const { TermHelpHost } = await import('/js/ui/termHelp.js');
      const { Modal, UiHosts } = await import('/js/ui/components.js');
      const { data } = await import('/js/data.js');
      document.documentElement.style.cssText = 'font-size:80px;--t:80px';
      window.actions = 0;
      function Fixture() {
        const [modal, setModal] = useState(false);
        return h('div', { style: 'padding:32px;font-size:18px' },
          h('div', { id: 'term-anchor', style: 'position:fixed;top:35%;left:40%' }, h(RichText, { text: '<$ba.cold>寒冷</>' })),
          h('div', { id: 'unknown' }, h(RichText, { text: '<$missing.term>未提供说明</>' })),
          h('button', { id: 'card', style: 'padding:20px', onClick: () => window.actions++, onDblClick: () => window.actions++ }, h(RichText, { text: '<$ba.cold>寒冷</>' })),
          h('button', { id: 'open-modal', onClick: () => setModal(true) }, 'modal'),
          h(Modal, { open: modal, title: 'Modal fixture', onClose: () => setModal(false) }, h(RichText, { text: '<$ba.cold>寒冷</>' })),
          h(UiHosts), h(TermHelpHost));
      }
      render(h(Fixture), document.getElementById('fixture')); await data.loadAll('terms');
    });
    await page.waitForSelector('#term-anchor .rt-term');
    assert.equal(await page.$eval('#term-anchor .rt-term', e => e.getAttribute('aria-expanded')), 'false');
    assert.equal(await page.$('#unknown .rt-term'), null, 'missing definitions never look like a link');
    await page.hover('#term-anchor .rt-term'); await page.waitForSelector('#term-help[role=tooltip]');
    assert.match(await page.$eval('#term-help-body', e => e.textContent), /攻击速度下降30/);
    const preview = await page.$eval('#term-help', e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return { width: r.width, height: r.height, borders: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth] }; });
    assert.deepEqual(preview.borders, ['1px', '1px', '1px', '1px']);
    await page.click('#term-anchor .rt-term'); await page.waitForSelector('#term-help[data-pinned=true]');
    const pinned = await page.$eval('#term-help', e => { const r = e.getBoundingClientRect(); return { width: r.width, height: r.height }; });
    assert.equal(pinned.width, preview.width);
    assert.equal(pinned.height, preview.height, 'pinning keeps the same content and height');
    await page.mouse.move(1, 1);
    await page.click('#term-help-body .rt-term');
    assert.equal(await page.$eval('#term-help-title', e => e.textContent), '冻结');
    assert.equal((await page.$$('#term-help')).length, 1);
    assert.ok(await page.$('#term-help button[aria-label="返回"] svg'), 'related-term back action has its icon');
    await page.click('#term-help button[aria-label="返回"]');
    assert.equal(await page.$eval('#term-help-title', e => e.textContent), '寒冷');
    for (const [width, height, large] of [[1366, 768, false], [844, 390, false], [320, 720, false], [844, 390, true]]) {
      await page.setViewport({ width, height, hasTouch: true });
      await page.evaluate(large => document.documentElement.style.setProperty('--t', large ? '150px' : '80px'), large);
      await page.waitForFunction(() => { const e = document.getElementById('term-help'), r = e.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; });
      const r = await page.$eval('#term-help', e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, overflow: e.scrollWidth - e.clientWidth }; });
      assert.ok(r.left >= 0 && r.top >= 0 && r.right <= width + 1 && r.bottom <= height + 1 && r.overflow <= 1, JSON.stringify(r));
      await page.screenshot({ path: new URL(`term-help-${engine}-${width}-${large ? 'large' : 'normal'}.png`, out).pathname });
    }
    await page.keyboard.press('Escape'); await page.waitForSelector('#term-help', { hidden: true });
    await page.waitForFunction(() => document.activeElement?.matches('#term-anchor .rt-term'));
    await page.setViewport({ width: 1366, height: 768, hasTouch: true });
    await page.evaluate(() => document.documentElement.style.setProperty('--t', '80px'));
    await page.click('#card .rt-term'); await page.waitForSelector('#term-help');
    assert.equal(await page.evaluate(() => window.actions), 0, 'term click must not select or confirm its parent card');
    assert.equal(await page.$('#card button'), null, 'no nested native buttons');
    assert.equal(await page.$eval('#card .rt-term', e => e.getAttribute('role')), null, 'native card keeps its own keyboard semantics');
    await page.keyboard.press('Escape'); await page.waitForSelector('#term-help', { hidden: true });
    await page.click('#open-modal'); await page.waitForSelector('.modal .rt-term');
    await page.click('.modal .rt-term'); await page.waitForSelector('#term-help[data-pinned=true]');
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => !!document.activeElement?.closest('#term-help')), 'focus stays in the pinned explanation above the modal');
    await page.keyboard.press('Escape'); await page.waitForSelector('#term-help', { hidden: true });
    assert.ok(await page.$('.modal'), 'first Escape does not close the source modal');
    await page.keyboard.press('Escape'); await page.waitForSelector('.modal', { hidden: true });
    await page.setViewport({ width: 844, height: 390, hasTouch: true });
    await page.touchscreen.tap(...await page.$eval('#term-anchor .rt-term', e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
    await page.waitForSelector('#term-help[data-pinned=true]');
    await page.touchscreen.tap(5, 5); await page.waitForSelector('#term-help', { hidden: true });
    await page.evaluate(async () => { const { data } = await import('/js/data.js'); await data.setLocale('en'); });
    await page.click('#term-anchor .rt-term'); await page.waitForFunction(() => document.querySelector('#term-help-title')?.textContent === 'Cold');
    assert.match(await page.$eval('#term-help-body', e => e.textContent), /ASPD/);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await srv.close(); }
});
