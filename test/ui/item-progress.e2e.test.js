// SP_E2E=1: real equipment details + Pixi/fallback field labels, in isolated background browsers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';

for (const [engine, executablePath] of [['chrome', '/run/current-system/sw/bin/google-chrome-stable'], ['firefox', '/run/current-system/sw/bin/firefox']]) {
  test(`${engine}: equipment counter on the carrier and in live descriptions`, {
    skip: process.env.SP_E2E !== '1' || !existsSync(executablePath), timeout: 120000,
  }, async () => {
    const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, workers: 0, userFile: ':memory:', clientBuild: false, assetIndex: false, announcementsFile: null });
    const out = new URL('../e2e/out/item-progress/', import.meta.url); mkdirSync(out, { recursive: true });
    let browser;
    try {
      browser = await puppeteer.launch({ browser: engine, executablePath, headless: true,
        args: engine === 'chrome' ? ['--no-sandbox', '--mute-audio', '--no-proxy-server', '--enable-unsafe-swiftshader'] : [] });
      for (const render of ['engine', 'fallback']) {
        const page = await browser.newPage(), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.setViewport({ width: 1484, height: 864 });
        await page.goto(`${srv.url}/dev/game-mock.html?render=${render}&shot=1&phase=PREP`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.__MOCK__ && !!window.__SP_VIEW__);
        if (render === 'engine') await page.waitForFunction(() => !!window.__SP_VIEW__.raw.debug?.views);
        await page.evaluate(async () => {
          const { updateSettings } = await import('/js/ui/settings.js'); updateSettings({ muted: true, officialFx: 'off' });
          window.__MOCK__.mutate(s => {
            s.priv.board = [{ uid: 9901, kind: 'chess', id: 'chess_char_1_01_a', tier: 1, row: 10, col: 5,
              items: [{ uid: 9902, id: 'chess_item_5_07_e_a', progress: { current: 3, total: 8 } }] }];
            s.priv.hand = [{ uid: 9903, kind: 'item', id: 'chess_item_5_07_e_b', tier: 5, golden: true, progress: { current: 2, total: 7 } }];
            s.priv.temp = []; s.priv.nextEnemies = [];
          });
        });
        const label = async expected => {
          await page.waitForFunction((render, expected) => render === 'engine'
            ? [...window.__SP_VIEW__.raw.debug.views.values()].some(v => v.itemProgressText?.visible && v.itemProgressText.text === expected)
            : [...document.querySelectorAll('.ff-progress')].some(e => e.textContent === expected), {}, render, expected);
        };
        const clickCarrier = async () => {
          const point = await page.evaluate(() => window.__SP_VIEW__.tileScreen(10, 5));
          assert.ok(point); await page.mouse.click(point.x, point.y, { button: 'right' });
          await page.waitForSelector('.dpanel');
          await page.$eval('.dsec--equip', e => e.scrollIntoView({ block: 'nearest' }));
        };
        await label('3 / 8'); await clickCarrier();
        assert.match(await page.$eval('.dsec--equip', e => e.textContent), /商业包装方案.*3 \/ 8/s);
        await page.screenshot({ path: new URL(`${engine}-${render}-prep.png`, out).pathname });
        for (const n of [7, 0]) {
          await page.evaluate(n => window.__MOCK__.mutate(s => { s.priv.board[0].items[0].progress.current = n; }), n);
          await label(`${n} / 8`);
          await page.waitForFunction(n => document.querySelector('.ditem__progress')?.textContent.includes(`${n} / 8`), {}, n);
        }
        await page.click('.dpanel__close');
        // An unequipped item keeps its own progress in the equipment text.
        const handPoint = await page.evaluate(() => window.__SP_VIEW__.tileScreen(7, 0));
        await page.mouse.click(handPoint.x, handPoint.y, { button: 'right' });
        await page.waitForSelector('.dpanel--item .ditem__progress');
        assert.match(await page.$eval('.dpanel--item', e => e.textContent), /2 \/ 7/);
        await page.click('.dpanel__close');
        // Remove the equipment: an existing view must clear its former label.
        await page.evaluate(() => window.__MOCK__.mutate(s => { s.priv.board[0].items = []; }));
        await page.waitForFunction(render => render === 'engine'
          ? !window.__SP_VIEW__.raw.debug.views.get('p:9901')?.itemProgressText?.visible
          : !document.querySelector('.ff-progress'), {}, render);
        // A teammate/scouted combat unit has no own piece: its metadata supplies both labels and details.
        await page.evaluate(async () => {
          const { store } = await import('/js/store.js');
          const field = { t: 'm.field', fieldId: 'n:p3', kind: 'normal', rect: { r0: 7, r1: 12, c0: 0, c1: 10 }, stageId: 'act2autochess_m01',
            units: [{ id: 9910, uid: 9911, kind: 'op', side: 'ally', ownerId: 'p3', defId: 'chess_char_1_01_a', x: 5, y: 10, maxHp: 1000,
              items: ['chess_item_5_07_e_b'], itemProgress: [{ uid: 9912, id: 'chess_item_5_07_e_b', current: 6, total: 7 }] }] };
          const pub = store.get().match.public;
          store.patch('match', { public: { ...pub, phase: 'COMBAT', fields: [{ fieldId: field.fieldId, players: ['p3'] }] }, field });
          await new Promise(resolve => setTimeout(resolve, 250));
          const { net } = await import('/js/net.js');
          net._emit('b.snap', { fieldId: field.fieldId, t: 0, units: [[9910, 5, 10, 1000, 1000, 0, 0, 0, 0]], total: 1, killed: 0, dp: 0 });
        });
        await label('6 / 7'); await clickCarrier();
        assert.match(await page.$eval('.dsec--equip', e => e.textContent), /6 \/ 7/);
        await page.screenshot({ path: new URL(`${engine}-${render}-combat.png`, out).pathname });
        await page.evaluate(async () => {
          const { store } = await import('/js/store.js');
          const field = store.get().match.field;
          store.patch('match', { field: { ...field, units: field.units.map(u => ({ ...u, itemProgress: u.itemProgress.map(p => ({ ...p, current: 2 })) })) } });
          await new Promise(resolve => setTimeout(resolve, 250));
          const { net } = await import('/js/net.js');
          net._emit('b.snap', { fieldId: field.fieldId, t: 1, units: [[9910, 5, 10, 1000, 1000, 0, 0, 0, 0]], total: 1, killed: 0, dp: 0 });
        });
        await label('2 / 7');
        await page.waitForFunction(() => document.querySelector('.ditem__progress')?.textContent.includes('2 / 7'));
        assert.deepEqual(errors, []); await page.close();
      }
    } finally { await browser?.close(); await srv.close(); }
  });
}
