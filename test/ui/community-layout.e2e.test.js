import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/run/current-system/sw/bin/google-chrome-stable';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const results = JSON.parse(readFileSync(new URL('../fixtures/stats-results.json', import.meta.url)));

describe('settlement shared navigation under enlarged text (#458)', { skip: !ENABLED }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, clientBuild: false });
    const P = (await import('puppeteer-core')).default;
    browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    mkdirSync(new URL('../e2e/out/', import.meta.url), { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });
  for (const [width, height] of [[1366, 768], [844, 390]]) for (const textSize of ['md', 'lg', 'xl']) {
    test(`${width}×${height}, ${textSize}: return is inside the viewport and clickable`, async () => {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width, height });
        await page.evaluateOnNewDocument(ts => localStorage.setItem('sp.pref.settings', JSON.stringify({ textSize: ts })), textSize);
        await page.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.title-screen');
        // Mount the production settlement flow with a captured result, skipping only the observer's absent personal page.
        await page.evaluate(async res => {
          const { render, h } = await import('/vendor/preact.module.js');
          const { SettleFlow } = await import('/js/screens/settle.js');
          render(h(SettleFlow, { res, myId: null, backLabel: '返回同盟', onBack: () => { window.__returned = true; } }), document.getElementById('app'));
          await document.fonts.ready;
        }, results['coop4-hard']);
        await page.waitForSelector('.steam__detail');
        await page.waitForFunction(() => document.querySelector('.steam__detail').getBoundingClientRect().height > 0);
        await page.evaluate(() => { for (const a of document.getAnimations()) if (a.effect.getComputedTiming().iterations !== Infinity) a.finish(); });
        assert.equal(await page.$$eval('.result-page .app-header', e => e.length), 1);
        assert.equal(await page.$('.settle__back, .result__foot'), null);
        await page.click('.steam__detail');
        await page.waitForSelector('[data-testid="settle-detail"]');
        await page.screenshot({ path: new URL(`../e2e/out/result-text-${width}-${textSize}.png`, import.meta.url).pathname });
        const bounds = await page.$eval('.result-page > .app-header .app-back', b => {
          const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, reachable: !!hit && (hit === b || b.contains(hit)) };
        });
        assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= width && bounds.bottom <= height, JSON.stringify(bounds));
        assert.equal(bounds.reachable, true);
        assert.equal(await page.$('.result__foot'), null);
        assert.equal(await page.$eval('[data-testid="settle-team"]', e => e.inert), true);
        await page.click('.result-page > .app-header .app-back');
        await page.waitForSelector('[data-testid="settle-detail"]', {hidden:true});
        assert.equal(await page.evaluate(() => window.__returned), undefined, 'detail back keeps the settlement open');
        await page.waitForFunction(() => document.activeElement?.matches('.steam__detail'));
        await page.click('.result-page > .app-header .app-back'); assert.equal(await page.evaluate(() => window.__returned), true);
      } finally { await page.close(); }
    });
  }
});
