// RENDER_E2E=1 CHROME_PATH=/path/to/chrome node --test test/render/oxi-visibility.browser.test.js
// Also supports RENDER_BROWSER=firefox with CHROME_PATH=/path/to/firefox.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { newScenario } from '../../shared/studio/scenario.js';

const browserName = process.env.RENDER_BROWSER || 'chrome';
const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const skip = process.env.RENDER_E2E !== '1' || !existsSync(executablePath);

test('paused studio loads a visible Talulah model; cached idle, S1 and restart keep it visible', { skip, timeout: 90000 }, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workers:0, assetIndex: false, userFile: ':memory:' });
  let browser, page;
  const out = 'test/e2e/out'; mkdirSync(out, { recursive: true });
  try {
    browser = await puppeteer.launch({ browser: browserName, executablePath, headless: true,
      ...(browserName === 'firefox' ? { args:[], extraPrefsFirefox: {
        'dom.ipc.processCount': 1, 'dom.ipc.processCount.webIsolated': 1, 'dom.ipc.processPrelaunch.enabled': false,
      } }
        : { args: ['--no-first-run', '--no-sandbox'] }) });
    page = await browser.newPage();
    // Firefox's initial about:blank may have a privileged BiDi realm; establish the ordinary origin first.
    if (browserName === 'firefox') await page.goto(`http://127.0.0.1:${srv.port}/`);
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
    const scene = newScenario(); scene.seed = 4247;
    scene.players[0].units.push({ uid: 1, kind: 'chess', chessId: 'chess_char_6_diy1_b', row: 12, col: 3,
      dir: 'RIGHT', items: [], diy: { charId: 'char_4247_oxi', skillIndex: 0, uniEquipId: null } });
    await page.evaluateOnNewDocument(scene => localStorage.setItem('sp.studio.console.v1', JSON.stringify(scene)), scene);
    const key = srv.studio.key;
    await page.goto(`http://127.0.0.1:${srv.port}/studio/console.html#key=${key}`);
    const waitModel = async () => {
      await page.waitForFunction(() => window.__console?.ready &&
        [...window.__console.view.debug.views.values()].some(v => v.info.diy?.charId === 'char_4247_oxi' && v.spineReady), { timeout: 30000 });
      // A lone, unclipped model normally renders directly. Exercise the real crowd/LOD atlas path deterministically,
      // including after restart; keep its actual skeleton, bounds, rendering and texture pixels untouched.
      await page.evaluate(() => { window.__console.view.debug.ctx.impostorInterval = () => 2; });
    };
    await waitModel();
    await new Promise(resolve => setTimeout(resolve, 400));
    const preview = await page.evaluate(() => {
      const c = window.__console, u = [...c.view.debug.views.values()].find(v => v.info.diy?.charId === 'char_4247_oxi');
      return { time: c.runner.battle.time, playing: c.runner.playing, fade: u.fadeIn, swap: u.swapT, clock: u.actor.clock };
    });
    assert.equal(preview.playing, false); assert.equal(preview.time, 0.5);
    assert.equal(preview.clock, 0, 'loading the model must not advance its battle animation');
    assert.equal(preview.swap, 1, 'a paused battle must not strand its loaded model behind the avatar');
    assert.equal(preview.fade, 1, 'spawn opacity must not strand a paused preview at zero');
    const pixels = async label => {
      await page.waitForFunction(() => [...window.__console.view.debug.views.values()].some(v =>
        v.info.diy?.charId === 'char_4247_oxi' && v.imp?.slot), { timeout: 15000 });
      const sample = await page.evaluate(() => {
        const c = window.__console, v = c.view, u = [...v.debug.views.values()].find(v => v.info.diy?.charId === 'char_4247_oxi');
        const s = u.imp.slot, atlas = v.debug.ctx.impostors, res = atlas.res;
        const data = v.debug.app.renderer.extract.pixels(s.page.rt), width = Math.round(s.page.size * res);
        let opaque = 0;
        for (let y = Math.floor(s.y * res); y < Math.ceil((s.y + s.h) * res); y++) {
          for (let x = Math.floor(s.x * res); x < Math.ceil((s.x + s.w) * res); x++) if (data[(y * width + x) * 4 + 3] > 32) opaque++;
        }
        return { opaque, clip: u.actor.current, alpha: u.imp.sprite.worldAlpha, swap: u.swapT,
          skills: c.runner.battle.allyUnits[0].skill.activations, errors: [...c.errors, ...c.runner.battle.errors] };
      });
      assert.ok(sample.opaque > 100, `${label}: native model occupies its cached texture`);
      assert.equal(sample.swap, 1); assert.ok(sample.alpha > 0.99, `${label}: cached model stays visible`);
      assert.deepEqual(sample.errors, []);
      await page.screenshot({ path: `${out}/talulah-visibility-${browserName}-${label}.png` });
      return sample;
    };
    await pixels('preview');
    await page.evaluate(async () => {
      for (let i = 0; i < 6; i++) { window.__console.runner.step(30); await new Promise(requestAnimationFrame); }
    });
    assert.equal((await pixels('idle')).clip, 'Idle');
    await page.evaluate(async () => {
      const c = window.__console, b = c.runner.battle, u = b.allyUnits[0];
      const enemy = b.spawnEnemy('enemy_1007_slime', { pos: [12, 4], routeIndex: 0, mods: { hpMul: 100000, speedMul: 0 } });
      enemy.profile.noAttack = true; u.skill.gainSp(999, 'init');
      for (let i = 0; i < 5; i++) { c.runner.step(30); await new Promise(requestAnimationFrame); }
    });
    assert.ok((await pixels('after-s1')).skills > 0, 'S1 actually cast');
    await page.evaluate(() => {
      window.__oxiOldView = window.__console.view;
      [...document.querySelectorAll('button')].find(b => b.textContent === '同种子重启').click();
    });
    await page.waitForFunction(() => window.__console?.ready && window.__console.view !== window.__oxiOldView);
    await waitModel();
    await pixels('restart');
  } catch (e) {
    await page?.screenshot({ path: `${out}/talulah-visibility-${browserName}-failure.png` }).catch(() => {});
    throw e;
  } finally { await browser?.close(); await srv.close(); }
});
