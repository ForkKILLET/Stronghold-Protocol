// SP_E2E=1: compiled application, actual S.W.E.E.P. navigation and keyword definitions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';
for (const [engine, executablePath] of [['chrome', '/run/current-system/sw/bin/google-chrome-stable'], ['firefox', '/run/current-system/sw/bin/firefox']]) test(`${engine}: production encyclopedia keywords open without leaving the page`, {
  skip: process.env.SP_E2E !== '1' || !existsSync(executablePath), timeout: 90000,
}, async () => {
  const srv = await startServer({ host: '127.0.0.1', port: 0, workers: 0, quiet: true, clientBuild: true, userFile: ':memory:', announcementsFile: null, assetIndex: false });
  const out = new URL('../e2e/out/', import.meta.url); mkdirSync(out, { recursive: true });
  let browser;
  try {
    browser = await puppeteer.launch({ browser: engine, executablePath, headless: true, args: engine === 'chrome' ? ['--no-sandbox', '--mute-audio', '--no-proxy-server'] : [] });
    const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1366, height: 768 });
    await page.goto(srv.url, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => !!window.__SP__);
    assert.ok(await page.evaluate(() => [...document.scripts].some(s => s.src.includes('/build/assets/index-'))));
    // Use the real guest entry on this isolated server; no room or match is created.
    await page.type('.title-screen input', '术语验证');
    await page.evaluate(() => [...document.querySelectorAll('.title-screen button')].find(e => e.textContent.trim() === '开始').click());
    await page.waitForFunction(() => window.__SP__.store.get().connection.status === 'online');
    await page.waitForSelector('.hub-plate--sweep'); await page.click('.hub-plate--sweep');
    await page.waitForSelector('.sw-tab');
    await page.evaluate(() => [...document.querySelectorAll('.sw-tab')].find(e => e.textContent.includes('敌方资料')).click());
    await page.waitForSelector('.sw-allcodex'); await page.click('.sw-allcodex');
    await page.waitForSelector('.sw-search input'); await page.type('.sw-search input', '冰爆源石虫');
    await page.waitForSelector('.sw-eth[title="冰爆源石虫"]'); await page.click('.sw-eth[title="冰爆源石虫"]');
    await page.waitForFunction(() => [...document.querySelectorAll('.sw-cd .rt-term')].some(e => e.textContent === '寒冷'));
    const cold = await page.$('.sw-cd .rt-term'); await cold.click();
    await page.waitForFunction(() => document.getElementById('term-help-title')?.textContent === '寒冷');
    assert.equal(await page.$eval('#term-help', e => e.getAttribute('data-pinned')), 'true');
    await page.click('#term-help-body .rt-term');
    assert.equal(await page.$eval('#term-help-title', e => e.textContent), '冻结');
    await page.screenshot({ path: new URL(`term-help-codex-${engine}-1366.png`, out).pathname });
    await page.keyboard.press('Escape'); await page.waitForSelector('#term-help', { hidden: true });
    assert.ok(await page.$('.sw-codex'), 'Escape closes the explanation, keeping the encyclopedia and selection');
    await page.focus('.sw-search input');
    await page.focus('.sw-cd .rt-term'); await page.waitForSelector('#term-help[role=tooltip]');
    await page.keyboard.press('Escape'); await page.waitForSelector('#term-help', { hidden: true });
    assert.ok(await page.$('.sw-codex'), 'preview Escape also stays on this page');
    await page.setViewport({ width: 844, height: 390 });
    await page.click('.sw-cd .rt-term'); await page.waitForSelector('#term-help[data-pinned=true]');
    await page.waitForFunction(() => { const r = document.getElementById('term-help').getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; });
    await page.screenshot({ path: new URL(`term-help-codex-${engine}-844.png`, out).pathname });
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await srv.close(); }
});
