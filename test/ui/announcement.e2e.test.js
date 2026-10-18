import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';

const chrome = process.env.CHROME_PATH || '/run/current-system/sw/bin/google-chrome-stable';
test('announcement sections: lazy history, retry, responsive layout and automatic notices', {
  skip: process.env.SP_E2E !== '1' || !existsSync(chrome),
}, async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workers: 0, clientBuild: false, announcementsFile: null });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--mute-audio', '--no-proxy-server'] });
    const page = await browser.newPage();
    const errors = [];
    let reads = 0, fail = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/changelog') {
        reads++;
        if (fail) { request.respond({ status: 503, contentType: 'application/json', body: '{}' }); return; }
      }
      request.continue();
    });
    await page.setViewport({ width: 1366, height: 768 });
    await page.goto(srv.url, { waitUntil: 'networkidle0' });
    assert.equal(reads, 0, 'history is absent from boot requests');
    const open = () => page.evaluate(async () => { (await import('/js/ui/announcement.js')).openAnnouncement(); });
    const tab = name => page.evaluate(name => [...document.querySelectorAll('.announcement-sections [role=tab]')].find(button => button.textContent === name).click(), name);
    await open();
    await page.waitForSelector('.announcement-markdown');
    assert.equal(await page.$eval('.announcement-sections [aria-selected=true]', element => element.textContent), '更新日志');
    assert.ok(reads > 0);
    const latest = await page.$eval('.announcement-changelog__day', element => ({ open: element.open, text: element.textContent }));
    assert.equal(latest.open, true);
    const history = await (await fetch(srv.url + '/api/changelog')).json();
    assert.ok(latest.text.includes(history.entries[0].date));
    assert.ok(latest.text.includes(history.entries[0].title));
    const out = new URL('../e2e/out/', import.meta.url);
    mkdirSync(out, { recursive: true });
    for (const [width, height] of [[1366, 768], [844, 390], [390, 844]]) {
      await page.setViewport({ width, height });
      await new Promise(resolve => setTimeout(resolve, 200));
      const bounds = await page.$eval('.announcement-modal', element => {
        const rect = element.getBoundingClientRect();
        const body = element.querySelector('.modal__body');
        const close = element.querySelector('.modal__actions button').getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          width: innerWidth, height: innerHeight, overflow: body.scrollWidth - body.clientWidth,
          closeBottom: close.bottom, closeRight: close.right };
      });
      assert.ok(bounds.left >= -1 && bounds.right <= bounds.width + 1 && bounds.top >= -1 && bounds.bottom <= bounds.height + 1, JSON.stringify(bounds));
      assert.ok(bounds.overflow <= 1 && bounds.closeBottom <= bounds.height + 1 && bounds.closeRight <= bounds.width + 1, JSON.stringify(bounds));
      await page.screenshot({ path: new URL(`announcement-${width}x${height}.png`, out).pathname });
    }
    await page.setViewport({ width: 1366, height: 768 });
    await tab('服务器公告');
    assert.equal(await page.$eval('.announcement-sections [role=tabpanel]', element => element.textContent), '暂无公告');
    fail = true;
    await tab('更新日志');
    await page.waitForFunction(() => document.querySelector('.announcement-sections').textContent.includes('更新日志加载失败'));
    fail = false;
    await page.evaluate(() => [...document.querySelectorAll('.announcement-sections button')].find(button => button.textContent === '重试').click());
    await page.waitForSelector('.announcement-markdown');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.announcement-modal', { hidden: true });
    await page.evaluate(async () => {
      const { store } = await import('/js/store.js');
      store.set({ popupAnnouncement: { id: 'sections-test', type: 'popup', title: '维护通知', text: '测试服务器公告', startAt: 0, endAt: null, level: 'info', autoPopup: true } });
    });
    await page.waitForSelector('.announcement-content__title');
    assert.equal(await page.$eval('.announcement-sections [aria-selected=true]', element => element.textContent), '服务器公告');
    assert.equal(await page.$eval('.announcement-content__title', element => element.textContent), '维护通知');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await srv.close();
  }
});
