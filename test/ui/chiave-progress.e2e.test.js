// SP_E2E=1: real server counters displayed by the shared game UI; isolated background Chrome / Firefox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';
import { makeMatch } from '../match/harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';

for (const [engine, executablePath] of [['chrome', '/run/current-system/sw/bin/google-chrome-stable'], ['firefox', '/run/current-system/sw/bin/firefox']]) {
  test(`${engine}: Chiave sidebar and strategy text show live refresh progress`, {
    skip: process.env.SP_E2E !== '1' || !existsSync(executablePath), timeout: 60000,
  }, async () => {
    const h = makeMatch({ mode: 'solo', seed: 17, fake: true, registry: createRegistry({ log: { info() {}, warn() {}, error() {} } }) }).start();
    h.toPrep(1); const ps = h.ps('p_0'); ps.bandId = 'band_chiave'; ps.shop.level = 4; ps.funds = 200;
    const states = [structuredClone(ps.effectsView()[0])];
    for (let i = 1; i <= 15; i++) {
      assert.deepEqual(h.m.handle('p_0', { t: 'g.refresh' }), { ok: true });
      if ([5, 6, 12, 15].includes(i)) states.push(structuredClone(ps.effectsView()[0]));
    }
    h.m.round++;
    const nextRound = structuredClone(ps.effectsView()[0]);
    const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, workers: 0, userFile: ':memory:', clientBuild: false, assetIndex: false, announcementsFile: null });
    const out = new URL('../e2e/out/chiave-progress/', import.meta.url); mkdirSync(out, { recursive: true });
    let browser;
    try {
      browser = await puppeteer.launch({ browser: engine, executablePath, headless: true,
        args: engine === 'chrome' ? ['--no-sandbox', '--mute-audio', '--no-proxy-server'] : [] });
      const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
      const settleTip = async text => {
        await page.waitForFunction(text => {
          const tip = document.querySelector('.tooltip.is-shown');
          return tip?.textContent.includes(text) && Number(getComputedStyle(tip).opacity) > .95;
        }, {}, text);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      };
      await page.setViewport({ width: 1484, height: 864 });
      await page.goto(`${srv.url}/dev/game-mock.html?render=fallback&shot=1&phase=PREP`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.__MOCK__ && window.__SP_VIEW__?.kind === 'fallback');
      const show = async effect => {
        await page.evaluate(effect => window.__MOCK__.mutate(s => {
          s.priv.bandId = 'band_chiave'; s.pub.players[0].bandId = 'band_chiave';
          s.priv.effects = [effect, ...s.priv.effects.filter(e => e.iconKind !== 'band')];
        }), effect);
        const label = effect.roundProgress.current >= effect.roundProgress.total ? '本回合已满' : `${effect.progress.current} / ${effect.progress.total}`;
        await page.waitForFunction(label => document.querySelector('.effect__progress')?.textContent === label, {}, label);
      };
      await show(states[0]); await page.hover('.effect--band');
      await page.waitForSelector('.efftip .strategy-progress');
      for (const effect of states.slice(1)) {
        await show(effect);
        await page.waitForFunction(effect => {
          const text = document.querySelector('.efftip .strategy-progress')?.textContent || '';
          return text.includes(`${effect.progress.current} / 6`) && text.includes(`${effect.roundProgress.current} / 2`);
        }, {}, effect);
      }
      const geometry = () => page.$eval('.effect--band', el => {
        const i = el.getBoundingClientRect(), n = el.querySelector('.effect__progress').getBoundingClientRect();
        return { gap: i.left - n.right, centerError: Math.abs((i.top + i.bottom - n.top - n.bottom) / 2), left: n.left };
      });
      const desktop = await geometry(); assert.ok(desktop.gap >= 2 && desktop.centerError < 1 && desktop.left >= 0);
      await settleTip('3 / 6');
      await page.screenshot({ path: new URL(`${engine}-sidebar-tooltip.png`, out).pathname });
      await page.mouse.move(5, 400); await page.click('[data-testid="check-player"]');
      await page.waitForSelector('.iband .strategy-progress');
      assert.match(await page.$eval('.iband', e => e.textContent), /贾维.*3 \/ 6.*2 \/ 2/s);
      await page.screenshot({ path: new URL(`${engine}-strategy-text.png`, out).pathname });
      await show(states[0]);
      await page.waitForFunction(() => document.querySelector('.iband .strategy-progress')?.textContent.includes('0 / 6'));
      await page.click('.edrawer__close');
      await show(nextRound);
      assert.equal(await page.$eval('.effect__progress', e => e.textContent), '3 / 6', 'new round restores the carried refresh remainder');
      await page.setViewport({ width: 844, height: 390 }); await show(states.at(-1));
      await page.hover('.effect--band'); await page.waitForSelector('.efftip .strategy-progress');
      await settleTip('3 / 6');
      const mobile = await geometry(); assert.ok(mobile.gap >= 2 && mobile.centerError < 1 && mobile.left >= 0);
      await page.screenshot({ path: new URL(`${engine}-compact-tooltip.png`, out).pathname });
      assert.deepEqual(errors, []);
    } finally { await browser?.close(); await srv.close(); h.m.dispose(); }
  });
}
