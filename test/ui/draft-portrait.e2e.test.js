// Strategy detail decorations stay centred on the portrait when the compact fork layout changes size or state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

test('strategy portrait, side brackets and corner marks share a centre in preview, confirmed and teammate views', {
  skip: !(process.env.SP_E2E === '1' && existsSync(CHROME)) && 'set SP_E2E=1 and CHROME_PATH to run',
}, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, clientBuild: false,
    workers: 0, roomWorkers: 0, matchWorkers: 0, userFile: ':memory:', assetIndex: false, announcementsFile: null });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const check = async () => {
      await page.waitForFunction(() => { const i = document.querySelector('.draft-detail__art img'); return i?.complete && i.naturalWidth > 0; });
      const g = await page.$eval('.draft-detail__art', (el) => {
        const a = el.getBoundingClientRect(), p = el.querySelector('.bandicon').getBoundingClientRect();
        const s = getComputedStyle(el, '::before'), hp = document.querySelector('.draft-detail__hp').getBoundingClientRect();
        const detail = el.closest('.draft-detail').getBoundingClientRect();
        return { dx: (a.left + a.right - p.left - p.right) / 2, dy: (a.top + a.bottom - p.top - p.bottom) / 2,
          contained: p.left >= a.left - 1 && p.right <= a.right + 1 && p.top >= a.top - 1 && p.bottom <= a.bottom + 1,
          flanks: a.left + parseFloat(s.left) < p.left && a.right - parseFloat(s.right) > p.right,
          clearHp: p.bottom <= hp.top + 1 || a.right <= hp.left + 1,
          hpContained: hp.left >= detail.left - 1 && hp.right <= detail.right + 1,
          corners: el.querySelectorAll('.draft-detail__corners .icon').length, hidden: el.querySelector('.draft-detail__corners')?.getAttribute('aria-hidden') };
      });
      assert.ok(Math.abs(g.dx) < 1 && Math.abs(g.dy) < 1, JSON.stringify(g));
      assert.ok(g.contained && g.flanks, JSON.stringify(g));
      assert.ok(g.clearHp && g.hpContained, JSON.stringify(g));
      assert.equal(g.corners, 4);
      assert.equal(g.hidden, 'true');
    };
    for (const [width, height] of [[1920, 1080], [1280, 720], [844, 390], [640, 360]]) {
      await page.setViewport({ width, height });
      await page.goto(`${srv.url}/dev/game-mock.html?phase=BAND_DRAFT&version=regulation&shot=1&render=fallback`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.dband[data-band="band_amiya"]');
      await page.evaluate(async () => {
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = '/css/utility-mobile.css';
        const ready = new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject; });
        document.head.insertBefore(link, document.querySelector('link[href="/css/ui-theme.css"]'));
        await ready;
      });
      await page.evaluate(async () => { const { initProfile } = await import('/js/ui/profile.js'); await initProfile(); });
      await page.waitForSelector('.draft-detail[data-stats-status="ready"]');
      if (await page.$('.echat__close')) await page.click('.echat__close');
      await page.click('.dband[data-band="band_amiya"]');
      await page.waitForFunction(() => document.querySelector('.draft-detail__name')?.textContent === '阿米娅');
      await check();
    }
    await page.click('.draft-confirm');
    await page.waitForFunction(() => globalThis.__MOCK__.S().priv.bandId === 'band_amiya');
    await check();
    await page.click('.dorder.is-done:not(.is-self) .dorder__box');
    await page.waitForFunction(() => document.querySelector('.draft-detail__name')?.textContent !== '阿米娅');
    await check();
    assert.equal(await page.evaluate(() => globalThis.__MOCK__.S().priv.bandId), 'band_amiya');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await srv.close();
  }
});
