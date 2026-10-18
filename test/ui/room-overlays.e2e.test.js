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
  describe(`${engine} room overlay stacking`, {
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

    test('human and AI removal controls stay behind settings, nested panels, announcements and guide', async () => {
      const host = await browser.createBrowserContext(), guest = await browser.createBrowserContext();
      try {
        const page = await host.newPage(), other = await guest.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await enter(page, server.url, '层级验证');
        await page.evaluate(() => [...document.querySelectorAll('.hub-entry')].find(e => e.textContent.includes('创建同盟')).click());
        await page.locator('.proto-start').click();
        await page.waitForSelector('.room-screen');
        const code = await page.evaluate(async () => (await import('/js/store.js')).store.get().room.code);
        await enter(other, server.url, '队友');
        await other.evaluate(async code => (await import('/js/net.js')).net.request('room.join', {code}), code);
        await page.bringToFront();
        await page.waitForSelector('.rseat__kick[aria-label="移出该博士"]');
        await page.evaluate(() => [...document.querySelectorAll('.rseat__actions button')]
          .find(e => e.textContent.includes('添加 AI') && !e.disabled).click());
        await page.waitForSelector('.rseat__kick[aria-label="移除 AI 队友"]');
        // The entrance animation temporarily creates a stacking context; reproduce after it finishes.
        await new Promise(resolve => setTimeout(resolve, 500));
        const verifyCover = async (overlay, label) => {
          await page.waitForSelector(overlay);
          await new Promise(resolve => setTimeout(resolve, 250));
          // Finish finite overlay fades before capture; headless Firefox may defer compositor animation frames.
          await page.evaluate(() => {
            for (const animation of document.getAnimations()) {
              if (animation.effect?.target?.closest?.('.modal, .guide') && animation.effect.getComputedTiming().iterations !== Infinity) animation.finish();
            }
          });
          const hits = await page.$$eval('.rseat__kick, .communication-dock .ewheel__btn', (buttons, selector) => buttons.map(button => {
            const r = button.getBoundingClientRect();
            const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return {label:button.getAttribute('aria-label'), covered:!!top?.closest(selector), top:top?.className?.baseVal ?? top?.className};
          }), overlay);
          await page.screenshot({path:path.join(out, `${engine}-room-${label}.png`)});
          assert.equal(hits.length, 3);
          assert.ok(hits.every(hit => hit.covered), JSON.stringify(hits));
        };
        await page.locator('.app-header [data-testid="settings-btn"]').click();
        await verifyCover('.modal', 'settings');
        await page.locator('.set-personalization [aria-label="大厅背景"]').click();
        await verifyCover('.modal', 'background');
        await page.keyboard.press('Escape');
        await page.waitForSelector('.hub-backdrop-panel', {hidden:true});
        await page.keyboard.press('Escape');
        await page.waitForSelector('.settings-modal', {hidden:true});
        await page.locator('.app-header .topbar-announcement').click();
        await verifyCover('.modal', 'announcement');
        await page.keyboard.press('Escape');
        await page.waitForSelector('.announcement-modal', {hidden:true});
        await page.locator('.app-header [aria-label="玩法说明"]').click();
        await verifyCover('.guide', 'guide');
        await page.keyboard.press('Escape');
        await page.waitForSelector('.guide', {hidden:true});
        assert.equal(await page.$$eval('.rseat__kick', buttons => buttons.every(button => {
          const r = button.getBoundingClientRect();
          return !!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.rseat__kick');
        })), true, 'removal controls remain reachable after closing overlays');
        assert.deepEqual(errors, []);
      } finally { await guest.close(); await host.close(); }
    });

  });
}
