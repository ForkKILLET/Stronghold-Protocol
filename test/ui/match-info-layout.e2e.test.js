// Real local solo -> strategy draft -> match-info dialog. No production or user browser state.
// SP_E2E=1; SP_E2E_BUILD=1 runs the same checks against the production client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';

for (const [engine, executablePath] of [
  ['chrome', process.env.CHROME_PATH || '/run/current-system/sw/bin/google-chrome-stable'],
  ['firefox', process.env.FIREFOX_PATH || '/run/current-system/sw/bin/firefox'],
]) test(`${engine}: strategy match-info keeps its wide layout and fits mobile`, {
  skip: process.env.SP_E2E !== '1' || !existsSync(executablePath), timeout: 90000,
}, async () => {
  const out = process.env.SP_E2E_OUT || '/tmp/sp-match-info-layout';
  mkdirSync(out, { recursive: true });
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workers: 0,
    clientBuild: process.env.SP_E2E_BUILD === '1', userFile: ':memory:', assetIndex: false, announcementsFile: null });
  let browser;
  try {
    browser = await puppeteer.launch({ browser: engine, executablePath, headless: true,
      args: engine === 'chrome' ? ['--no-sandbox', '--mute-audio', '--no-proxy-server'] : [] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1366, height: 768 });
    await page.evaluateOnNewDocument(() => { localStorage.setItem('sp.name', '盟约窗口验证'); sessionStorage.setItem('sp.entered', '1'); });
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__SP__?.store.get().connection.status === 'online');
    const request = (t, fields = {}) => page.evaluate(({ t, fields }) => window.__SP__.net.request(t, fields), { t, fields });
    await request('room.create', { mode: 'solo', difficulty: 'NORMAL' });
    await request('room.start'); await page.waitForSelector('.brief');
    await request('g.infoReady'); await page.waitForSelector('.draft');
    await page.locator('[data-testid="match-info-open"]').click(); await page.waitForSelector('.minfo-dlg .brief-banned');
    for (const size of [
      { width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 1024, height: 768 },
      { width: 844, height: 390, safe: true }, { width: 740, height: 360, text: 'xl' }, { width: 390, height: 844 },
    ]) {
      await page.setViewport({ width: size.width, height: size.height });
      await page.evaluate(async size => {
        const root = document.documentElement; root.dataset.text = size.text || 'md';
        for (const [key, value] of Object.entries({ '--sa-l': size.safe ? '44px' : '0px', '--sa-r': size.safe ? '44px' : '0px', '--sa-b': size.safe ? '21px' : '0px' })) root.style.setProperty(key, value);
        dispatchEvent(new Event('resize')); await document.fonts.ready;
        for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish();
        await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      }, size);
      const geometry = await page.$eval('.minfo-dlg', e => {
        const r = e.getBoundingClientRect(), style = getComputedStyle(e), unit = parseFloat(style.getPropertyValue('--sp-ui-unit'));
        const body = e.querySelector('.modal__body'), close = e.querySelector('[data-testid="match-info-close"]').getBoundingClientRect();
        return { width: r.width, expected: Math.min(Math.max(12 * unit, 600), innerWidth - .6 * unit),
          left: r.left, right: r.right, top: r.top, bottom: r.bottom, closeBottom: close.bottom,
          bodyOverflow: body.scrollWidth - body.clientWidth, pageOverflow: document.documentElement.scrollWidth - innerWidth };
      });
      await page.screenshot({ path: path.join(out, `${engine}-${size.width}-${size.height}${size.text ? '-xl' : ''}.png`) });
      if (size.width > 1000 && size.height > 600) assert.ok(Math.abs(geometry.width - geometry.expected) <= 1, 'desktop match info must retain its wide layout: ' + JSON.stringify(geometry));
      const safe = size.safe ? 44 : 0;
      assert.ok(geometry.left >= safe && geometry.right <= size.width - safe + 1 && geometry.top >= 0 && geometry.bottom <= size.height - (size.safe ? 21 : 0) + 1, JSON.stringify({ size, geometry }));
      assert.ok(geometry.closeBottom <= geometry.bottom && geometry.bodyOverflow <= 1 && geometry.pageOverflow <= 1, JSON.stringify({ size, geometry }));
    }
    await page.keyboard.press('Escape'); await page.waitForSelector('.minfo-dlg', { hidden: true });
    assert.equal(await page.evaluate(() => !!window.__SP__.store.get().match.private?.bandId), false, 'closing match info does not select a strategy');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});
