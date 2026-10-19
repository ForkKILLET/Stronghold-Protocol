// SP_E2E=1: the real match UI with local, deterministic read-only view fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';

for (const [engine, executablePath] of [['chrome', '/run/current-system/sw/bin/google-chrome-stable'], ['firefox', '/run/current-system/sw/bin/firefox']]) {
  test(`${engine}: one dismissible viewing hint, navigation stays available`, {
    skip: process.env.SP_E2E !== '1' || !existsSync(executablePath), timeout: 90000,
  }, async () => {
    const srv = await startServer({ host: '127.0.0.1', port: 0, workers: 0, quiet: true, clientBuild: false, userFile: ':memory:', announcementsFile: null, assetIndex: false });
    const out = new URL('../e2e/out/', import.meta.url); mkdirSync(out, { recursive: true });
    let browser;
    try {
      browser = await puppeteer.launch({ browser: engine, executablePath, headless: true, args: engine === 'chrome' ? ['--no-sandbox', '--mute-audio', '--no-proxy-server'] : [] });
      const page = await browser.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const open = async (phase = 'PREP', variant = '') => {
        await page.setViewport({ width: 1366, height: 768 });
        await page.goto(`${srv.url}/dev/game-mock.html?render=fallback&shot=1&phase=${phase}&variant=${variant}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__MOCK__ && !!document.querySelector('.gtop'));
        await page.waitForFunction(() => window.__SP_VIEW__?.kind === 'fallback');
      };
      const scout = async () => {
        await page.click('.team__row:nth-child(3) .team__btn');
        if (await page.$('.team__ob')) await page.click('.team__ob');
        await page.waitForFunction(() => document.querySelector('.team__row:nth-child(3)')?.classList.contains('is-watched'));
        await page.waitForFunction(() => window.__MOCK__.store.get().match.field?.fieldId === 'n:p3');
      };
      const requests = () => page.evaluate(() => window.__MOCK__.S().requests.length);
      const dismiss = async (keyboard = false) => {
        const before = await requests();
        if (keyboard) { await page.focus('.watch-hint__close'); await page.keyboard.press(' '); }
        else await page.click('.watch-hint__close');
        await page.waitForSelector('.watch-hint__close', { hidden: true });
        assert.equal(await requests(), before, 'closing is local; no ready, pause, watch or leave intent');
      };

      // Pure spectators used to get both a centre banner and the bottom read-only viewing bar.
      await open();
      await page.evaluate(() => {
        const { store } = window.__MOCK__, s = store.get();
        store.set({ room: { ...s.room, spectators: [{ playerId: s.me.playerId, name: s.me.name }] }, match: { ...s.match, private: null } });
      });
      await scout();
      assert.equal(await page.$('.gm__dead'), null);
      assert.equal((await page.$$('.gm__watching')).length, 1);
      assert.equal(await page.$('.gm__watching .btn'), null, 'a spectator has no own board to return to');
      for (const [width, height] of [[1366, 768], [844, 390]]) {
        await page.setViewport({ width, height });
        await page.evaluate(async () => { await document.fonts.ready; document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a => a.finish()); });
        const r = await page.$eval('.gm__watching', e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
        assert.ok(r.left >= 0 && r.right <= width + 1 && r.top > height * .8 && r.bottom <= height, 'one hint stays at the bottom, inside the viewport');
        await page.screenshot({ path: new URL(`spectator-hint-${engine}-${width}.png`, out).pathname });
      }
      await dismiss(true);
      assert.equal(await page.$('.gm__watching'), null);
      assert.equal(await page.evaluate(() => window.__MOCK__.store.get().match.private), null);
      await page.evaluate(() => {
        const { store } = window.__MOCK__, s = store.get();
        store.patch('match', { public: { ...s.match.public, phase: 'COMBAT', combatMode: 'client' } });
      });
      await page.waitForSelector('.chud');
      assert.equal(await page.$('.watch-hint__close'), null, 'phase changes do not restore a dismissed explanation');
      await page.evaluate(() => {
        const { store } = window.__MOCK__, s = store.get();
        store.patch('match', { public: { ...s.match.public, phase: 'PREP', round: s.match.public.round + 1 } });
      });
      await scout();
      assert.equal(await page.$('.watch-hint__close'), null, 'the next round and another view keep it hidden');

      // An eliminated player without a selected board still gets just one hint, at the bottom.
      await open('PREP', 'dead');
      await page.waitForSelector('.gm__dead .watch-hint__close');
      assert.equal(await page.$('.gm__watching'), null);
      await dismiss();
      assert.equal(await page.$('.gm__dead'), null);

      // Alive players can hide the label while retaining a working return action.
      await open(); await scout();
      await page.waitForSelector('.gm__watching .watch-hint__close');
      await dismiss();
      assert.equal((await page.$eval('.gm__watching', e => e.textContent)).trim(), '返回自己');
      await page.click('.gm__watching .btn');
      await page.waitForSelector('.gm__watching', { hidden: true });
      assert.ok(await page.$('.shopbar'), 'returning still restores the editable board and shop');

      // The client-combat target label follows the same state, without removing 返回战场.
      await open('COMBAT');
      await page.evaluate(() => {
        const { store } = window.__MOCK__, s = store.get();
        store.patch('match', { public: { ...s.match.public, combatMode: 'client' } });
      });
      await page.click('.team__row:nth-child(3) .team__btn');
      await page.waitForSelector('.team__ob'); await page.click('.team__ob');
      await page.waitForSelector('.chud__observe .watch-hint__close');
      await page.waitForFunction(() => window.__MOCK__.store.get().match.field?.fieldId === 'n:p3');
      await dismiss();
      assert.equal((await page.$eval('.chud__observe', e => e.textContent)).trim(), '返回战场');
      await page.click('.chud__observe .chud__back');
      await page.waitForSelector('.chud__observe', { hidden: true });
      assert.deepEqual(errors, []);
    } finally { await browser?.close(); await srv.close(); }
  });
}
