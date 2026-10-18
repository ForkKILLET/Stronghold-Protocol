// Opt-in real Chrome/Firefox regression for room overlay stacking and engine-specific scrollbar styling.
import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';

const out = process.env.SP_E2E_OUT || '/tmp/stronghold-ui-overlays';
const engines = [
  ['chrome', process.env.CHROME_PATH || '/run/current-system/sw/bin/google-chrome-stable'],
  ['firefox', process.env.FIREFOX_PATH || '/run/current-system/sw/bin/firefox'],
];
async function text(page, label) {
  await page.waitForFunction(label => [...document.querySelectorAll('button')]
    .some(e => e.textContent.trim() === label && !e.disabled), {}, label);
  await page.evaluate(label => [...document.querySelectorAll('button')]
    .find(e => e.textContent.trim() === label && !e.disabled).click(), label);
}
async function enter(page, url, name) {
  await page.bringToFront();
  await page.setViewport({width:1366, height:768});
  await page.goto(url, {waitUntil:'networkidle0'});
  await page.type('.title-screen input', name);
  await text(page, '开始');
  await page.waitForSelector('.lobby-hub');
}

for (const [engine, executablePath] of engines) {
  describe(`${engine} themed scrollbars`, {
    skip:process.env.SP_E2E !== '1' || !existsSync(executablePath), timeout:90000,
  }, () => {
    let server, browser;
    before(async () => {
      mkdirSync(out, {recursive:true});
      server = await startServer({port:0, host:'127.0.0.1', quiet:true, workers:0, clientBuild:false});
      browser = await puppeteer.launch({browser:engine, executablePath, headless:true,
        ignoreDefaultArgs:['--hide-scrollbars'],
        args:engine === 'chrome' ? ['--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader'] : []});
    });
    after(async () => { await browser?.close(); await server?.close(); });

    test('settings, textarea and both scrollbar axes use the theme while hidden tabs stay hidden', async () => {
      const context = await browser.createBrowserContext();
      try {
        const page = await context.newPage();
        await enter(page, server.url, '滚动条验证');
        await page.locator('.app-header [data-testid="settings-btn"]').click();
        await page.waitForSelector('.settings-modal > .modal__body');
        await new Promise(resolve => setTimeout(resolve, 250));
        // Finish finite overlay fades before capture; headless Firefox may defer compositor animation frames.
        await page.evaluate(() => {
          for (const animation of document.getAnimations()) {
            if (animation.effect?.target?.closest?.('.modal, .guide') && animation.effect.getComputedTiming().iterations !== Infinity) animation.finish();
          }
        });
        await page.screenshot({path:path.join(out, `${engine}-scrollbar-settings.png`)});
        const style = await page.$eval('.settings-modal > .modal__body', e => ({
          width:getComputedStyle(e).scrollbarWidth, color:getComputedStyle(e).scrollbarColor,
          overflow:e.scrollHeight > e.clientHeight,
        }));
        assert.ok(style.overflow, 'settings has a real scroll range');
        if (engine === 'firefox') {
          assert.equal(style.width, 'thin');
          assert.equal(style.color, 'rgb(88, 103, 95) rgb(12, 15, 14)');
        } else {
          assert.equal(style.width, 'auto');
          assert.equal(style.color, 'auto');
          const thumb = await page.$eval('.modal__body', e => {
            const s = getComputedStyle(e, '::-webkit-scrollbar-thumb');
            return {color:s.backgroundColor, radius:s.borderRadius};
          });
          assert.deepEqual(thumb, {color:'rgb(88, 103, 95)', radius:'0px'});
        }
        await page.$eval('.settings-modal > .modal__body', e => e.scrollTop = 120);
        assert.ok(await page.$eval('.settings-modal > .modal__body', e => e.scrollTop) > 0);
        await page.keyboard.press('Escape');
        await page.waitForSelector('.settings-modal', {hidden:true});
        await page.locator('.stats-entry').click();
        await page.waitForSelector('.st-tabs');
        assert.equal(await page.$eval('.st-tabs', e => getComputedStyle(e).scrollbarWidth), 'none');
        const probe = await context.newPage();
        await probe.setViewport({width:900, height:600});
        await probe.goto(server.url + '/dev/uikit.html', {waitUntil:'networkidle0'});
        await probe.evaluate(() => {
          document.body.innerHTML = '<main style="padding:40px;display:flex;gap:30px"><div id="axes" style="width:300px;height:220px;overflow:auto;border:1px solid var(--line)"><div style="width:800px;height:900px;padding:20px">横向与纵向滚动</div></div><textarea style="width:300px;height:220px;overflow:auto;white-space:pre;background:var(--bg-1)"></textarea></main>';
          document.querySelector('textarea').value = Array.from({length:30}, (_,i) => i+' 配置日志 '.repeat(30)).join('\n');
        });
        for (const selector of ['#axes', 'textarea']) {
          const result = await probe.$eval(selector, e => {
            e.scrollTop = 120; e.scrollLeft = 100;
            const s = getComputedStyle(e);
            return {x:e.scrollLeft,y:e.scrollTop,width:s.scrollbarWidth,color:s.scrollbarColor};
          });
          assert.ok(result.x > 0 && result.y > 0, JSON.stringify(result));
          assert.equal(result.width, style.width);
          assert.equal(result.color, style.color);
        }
        await probe.screenshot({path:path.join(out, `${engine}-scrollbar-axes.png`)});
      } finally { await context.close(); }
    });
  });
}
