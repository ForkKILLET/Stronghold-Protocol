// Desktop Firefox check of framed content actions; real pages, isolated browser/account and local records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';
import { localFontsOnly } from '../helpers/localFonts.js';

test('desktop Firefox: content actions retain borders and device-record clearing uses danger confirmation', {
  skip: process.env.SP_E2E !== '1', timeout: 90000,
}, async () => {
  const out = path.resolve('.state/action-buttons-20261107');
  await mkdir(out, { recursive: true });
  const fixture = JSON.parse(await readFile(new URL('./fixtures/stats-versions.json', import.meta.url)));
  const server = await startServer({ host: '127.0.0.1', port: 0, quiet: true, workers: 0,
    userFile: ':memory:', assetIndex: false, announcementsFile: null, clientBuild: false });
  let browser;
  try {
    browser = await puppeteer.launch({ browser: 'firefox', executablePath: '/run/current-system/sw/bin/firefox', headless: true,
      extraPrefsFirefox: { 'dom.ipc.processCount': 2, 'dom.ipc.processCount.webIsolated': 1,
        'dom.ipc.processPrelaunch.enabled': false, 'fission.autostart': false } });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await localFontsOnly(page);
    await page.setViewport({ width: 1920, height: 1080 });
    await page.evaluateOnNewDocument(records => {
      localStorage.setItem('sp.pref.stats', JSON.stringify({ v: 3, records }));
    }, fixture.records);
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.title-login input');
    await page.type('.title-login input', '按钮样式验证');
    await page.click('.title-login .btn--primary');
    await page.waitForSelector('.lobby-hub');
    const framed = async selector => {
      await page.waitForSelector(selector, { visible: true });
      const styles = await page.$$eval(selector, nodes => nodes.map(e => {
        const s = getComputedStyle(e);
        return { text: e.textContent.trim(), border: s.borderTopWidth, style: s.borderTopStyle,
          color: s.borderTopColor, background: s.backgroundColor, radius: s.borderTopLeftRadius };
      }));
      assert.ok(styles.length);
      for (const s of styles) {
        assert.equal(s.border, '1px', s.text);
        assert.equal(s.style, 'solid', s.text);
        assert.doesNotMatch(s.color, /transparent|rgba\([^)]*,\s*0\)/, s.text);
        assert.equal(s.radius, '0px', s.text);
      }
      return styles;
    };
    const shot = async name => {
      await page.evaluate(async () => {
        await document.fonts.ready;
        for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish();
      });
      await page.screenshot({ path: path.join(out, name + '.png') });
    };
    await page.click('[data-testid="settings-btn"]');
    await framed('[data-testid="diag-copy"]');
    await page.$eval('[data-testid="diag-copy"]', e => e.scrollIntoView({ block: 'center' }));
    await page.hover('[data-testid="diag-copy"]');
    await framed('[data-testid="diag-copy"]');
    await shot('settings');
    await page.click('[data-testid="diag-copy"]');
    await page.waitForSelector('.set-diag [role="status"]');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.settings-modal', { hidden: true });
    await page.evaluate(async () => (await import('/js/screens/stats.js')).openStats('manage'));
    await page.waitForFunction(() => document.querySelector('[data-testid="stats-clear"]')?.disabled === false);
    const management = await framed('.doctor-actions .btn');
    assert.ok(await page.$eval('[data-testid="stats-clear"]', e => e.classList.contains('btn--danger')));
    const danger = management.find(s => s.text === '清空此设备记录');
    assert.match(danger.background, /^rgb\(163, 36, 26\)$/);
    await shot('archive-management');
    const count = await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.stats')).records.length);
    await page.click('[data-testid="stats-clear"]');
    await page.waitForSelector('.modal .btn--danger');
    await framed('.modal .btn--danger');
    await shot('clear-confirmation');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.modal', { hidden: true });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.stats')).records.length), count);
    await page.click('[data-tab="privacy"]');
    await framed('.doctor-share .btn');
    await page.click('[data-tab="profile"]');
    await framed('.profile-avatar-heading .btn');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.st', { hidden: true });
    await page.evaluate(async () => (await import('/js/screens/loadout.js')).openLoadout('lobby'));
    await page.waitForSelector('[data-loadout-view="list"]');
    await page.click('[data-loadout-view="list"]');
    await framed('[data-testid="loadout-import"]');
    await framed('[data-testid="loadout-export"]');
    await shot('loadout');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});
