// SP_E2E=1: the seven additional prep strategies, real server views + shared sidebar and strategy text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';
import { makeMatch } from '../match/harness.js';

for (const [engine, executablePath] of [['chrome', '/run/current-system/sw/bin/google-chrome-stable'], ['firefox', '/run/current-system/sw/bin/firefox']]) {
  test(`${engine}: prep strategy counters, limits and localized compact layouts`, {
    skip: process.env.SP_E2E !== '1' || !existsSync(executablePath), timeout: 90000,
  }, async () => {
    const h = makeMatch({ mode: 'solo', seed: 17, fake: true }).start(); h.toPrep(1);
    const ps = h.ps('p_0');
    const view = (bandId, counters = {}, refreshes = 0) => {
      ps.bandId = bandId; ps.counters = counters; ps.round.refreshes = refreshes;
      return structuredClone(ps.effectsView()[0]);
    };
    const cases = [
      [view('band_paganini', { 'band:paganini:spent': 54 }), '54 / 55', '未获得'],
      [view('band_paganini', { 'band:paganini:spent': 56 }), '55 / 55', '未获得'],
      [view('band_paganini', { 'band:paganini:spent': 56, 'band:paganini:done': 1 }), '已完成', '已获得'],
      [view('band_kirara', { 'band:kirara:acc': 19 }), '19 / 20', '累计消费'],
      [view('band_kirara', { 'band:kirara:acc': 5 }), '5 / 20', '累计消费'],
      [view('band_duyaoy', {}, 1), '1 / 2', '本回合特殊刷新'],
      [view('band_duyaoy', {}, 2), '本回合已用尽', '2 / 2'],
      [view('band_mlynar', { 'band:mlynar:r': h.m.round, 'band:mlynar': 2 }), '2 / 3', '下回合追加资金'],
      [view('band_mlynar', { 'band:mlynar:r': h.m.round, 'band:mlynar': 3 }), '本回合已满', '3 / 3'],
      [view('band_vodfox'), '0 / 1', '本回合交换'],
      [view('band_vodfox', { 'band:vodfox:r': h.m.round, 'band:vodfox': 1 }), '本回合已用尽', '1 / 1'],
      [view('band_sciurus'), '0 / 1', '本回合优惠'],
      [view('band_sciurus', { 'band:sciurus:r': h.m.round }), '本回合已用尽', '1 / 1'],
      [view('band_pepe', { 'band:pepe:special': 2 }), '剩余 2 次', '待用特殊刷新'],
      [view('band_pepe'), '剩余 0 次', '待用特殊刷新'],
    ];
    const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, workers: 0, userFile: ':memory:', clientBuild: false, assetIndex: false, announcementsFile: null });
    const out = new URL('../e2e/out/strategy-progress/', import.meta.url); mkdirSync(out, { recursive: true });
    let browser;
    try {
      browser = await puppeteer.launch({ browser: engine, executablePath, headless: true,
        args: engine === 'chrome' ? ['--no-sandbox', '--mute-audio', '--no-proxy-server'] : [] });
      const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.setViewport({ width: 1484, height: 864 });
      await page.goto(`${srv.url}/dev/game-mock.html?render=fallback&shot=1&phase=PREP`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.__MOCK__ && !!window.__SP_VIEW__);
      const show = async ([effect, badge]) => {
        await page.evaluate(async effect => {
          const { data } = await import('/js/data.js');
          const band = data.list('bands').find(b => b.effectId === effect.id);
          window.__MOCK__.mutate(s => {
            s.priv.bandId = band.bandId; s.pub.players[0].bandId = band.bandId;
            s.priv.effects = [effect, ...s.priv.effects.filter(e => e.iconKind !== 'band')];
          });
        }, effect);
        await page.waitForFunction(badge => document.querySelector('.effect__progress')?.textContent === badge, {}, badge);
      };
      const geometry = () => page.$eval('.effect--band', el => {
        const icon = el.getBoundingClientRect(), badge = el.querySelector('.effect__progress').getBoundingClientRect();
        return { gap: icon.left - badge.right, center: Math.abs((icon.top + icon.bottom - badge.top - badge.bottom) / 2), left: badge.left };
      });
      for (let i = 0; i < cases.length; i++) {
        const [effect, , text] = cases[i]; await show(cases[i]);
        await page.hover('.effect--band');
        await page.waitForFunction(({ name, text, progress }) => {
          const tip = document.querySelector('.tooltip.is-shown .efftip');
          return tip?.textContent.includes(name) && tip.textContent.includes(text) && (!progress || tip.textContent.includes(progress))
            && Number(getComputedStyle(tip.closest('.tooltip')).opacity) > .95;
        }, {}, { name: effect.name, text, progress: effect.progress ? `${effect.progress.current} / ${effect.progress.total}` : null });
        const g = await geometry(); assert.ok(g.gap >= 2 && g.center < 1 && g.left >= 0);
        if ([2, 3, 13].includes(i)) await page.screenshot({ path: new URL(`${engine}-${i}-tooltip.png`, out).pathname });
        await page.mouse.move(5, 400); await page.click('[data-testid="check-player"]');
        await page.waitForFunction(text => document.querySelector('.iband .strategy-progress')?.textContent.includes(text), {}, text);
        if (i === 2) await page.screenshot({ path: new URL(`${engine}-paganini-details.png`, out).pathname });
        await page.click('.edrawer__close');
      }
      await page.setViewport({ width: 844, height: 390 }); await show(cases[6]);
      await page.hover('.effect--band');
      await page.waitForFunction(() => {
        const tip = document.querySelector('.tooltip.is-shown .efftip');
        return tip?.textContent.includes('本回合特殊刷新') && Number(getComputedStyle(tip.closest('.tooltip')).opacity) > .95;
      });
      await page.screenshot({ path: new URL(`${engine}-compact-limit.png`, out).pathname });
      const language = await page.evaluate(async () => {
        const { loadLangIndex, switchLang } = await import('/js/ui/lang.js'); await loadLangIndex();
        const lang = await switchLang('en');
        // The dev harness mounts GameScreen directly, without production App's useLang render subscription.
        window.__MOCK__.mutate(() => {});
        return lang;
      });
      assert.equal(language, 'en');
      await page.waitForFunction(() => document.querySelector('.effect__progress')?.textContent === 'Used up this round');
      const compact = await geometry(); assert.ok(compact.gap >= 2 && compact.left >= 0);
      await page.screenshot({ path: new URL(`${engine}-compact-en.png`, out).pathname });
      assert.deepEqual(errors, []);
    } finally { await browser?.close(); await srv.close(); h.m.dispose(); }
  });
}
