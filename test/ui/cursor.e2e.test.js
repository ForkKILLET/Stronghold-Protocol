// Canvas hand geometry, native semantic fallback and persisted settings in an isolated desktop browser.
// Canvas screenshots now include the real rendered hand; export idle/pressed pixels as well.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, mkdtemp, readdir, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { startRemoteDev } from '../../server/http/devRemote.js';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';
import { localFontsOnly } from '../helpers/localFonts.js';

test('desktop canvas hand opt-in, rapid clicks, semantic cursors and native fallback', {
  skip: process.env.SP_E2E !== '1', timeout: 90000,
}, async t => {
  const out = path.resolve(process.env.SP_CURSOR_OUTPUT || '.state/cursor-20261112/firefox');
  await mkdir(out, { recursive: true });
  const remote = process.env.SP_CURSOR_REMOTE === '1';
  let dataDir;
  if (remote) {
    dataDir = await mkdtemp(path.join(tmpdir(), 'sp-cursor-remote-'));
    t.after(() => rm(dataDir, { recursive: true, force: true }));
    for (const entry of await readdir('data')) {
      if (entry !== 'local-assets.json') await symlink(path.resolve('data', entry), path.join(dataDir, entry));
    }
    await writeFile(path.join(dataDir, 'local-assets.json'), JSON.stringify({ version: 1, groups: {} }));
  }
  const server = await startServer({ dataDir, developmentResources: !remote, port: 0, host: '127.0.0.1', quiet: true, workers: 0,
    roomWorkers: 0, matchWorkers: 0, userFile: '', assetIndex: false, clientBuild: false,
    serverConfigFile: false, studio: false, announcementsFile: null });
  const chrome = process.env.SP_CURSOR_BROWSER === 'chrome';
  let browser, gateway;
  try {
    if (remote) gateway = await startRemoteDev({ target: server.url, port: 0, hot: false, log: { log() {} } });
    browser = await puppeteer.launch(chrome ? {
      executablePath: '/run/current-system/sw/bin/google-chrome-stable', headless: true, dumpio: process.env.SP_CURSOR_DUMP === '1',
      args: ['--no-sandbox', '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--renderer-process-limit=1'],
    } : {
      browser: 'firefox', executablePath: '/run/current-system/sw/bin/firefox', headless: true, dumpio: process.env.SP_CURSOR_DUMP === '1',
      extraPrefsFirefox: { 'dom.ipc.processCount': 2, 'dom.ipc.processCount.webIsolated': 1,
        'dom.ipc.processPrelaunch.enabled': false, 'fission.autostart': false },
    });
    t.diagnostic('browser started');
    browser.on('disconnected', () => t.diagnostic('browser disconnected'));
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await localFontsOnly(page);
    await page.setViewport({ width: 1920, height: 1080 });
    const openSettings = async () => {
      await page.waitForSelector('[data-testid="settings-btn"]', { visible: true });
      await page.click('[data-testid="settings-btn"]');
      await page.waitForSelector('[data-settings-tab="appearance"]');
      await page.click('[data-settings-tab="appearance"]');
      await page.waitForSelector('[data-testid="arknights-cursor"]', { visible: true });
    };
    const enabled = () => page.$eval('[data-testid="arknights-cursor"]', e => e.getAttribute('aria-checked'));
    await page.goto(gateway?.url || server.url, { waitUntil: 'domcontentloaded' });
    if (remote) {
      const upstream = await (await fetch(server.url + '/data/local-assets.json')).json();
      assert.equal(Object.hasOwn(upstream.groups, 'ui/cursor'), false, 'remote has no new art');
      const local = await (await fetch(gateway.url + '/data/local-assets.json')).json();
      assert.equal(Object.hasOwn(local.groups, 'ui/cursor'), true, 'development consistently uses local presentation data');
    }
    await page.waitForSelector('.title-login input');
    await page.$eval('.title-login input', e => { e.value = 'CursorTest'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('.title-login .btn--primary');
    await openSettings();
    assert.equal(await enabled(), 'false');
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--sp-cursor-pointer')), '');
    await page.click('[data-testid="arknights-cursor"]');
    assert.equal(await enabled(), 'true');
    const pointAtProbe = async () => {
      const point = await page.evaluate(() => {
        let target = document.querySelector('#cursor-press-probe');
        if (!target) {
          target = document.createElement('div'); target.id = 'cursor-press-probe';
          target.style.cssText = 'position:absolute;left:8px;bottom:8px;width:32px;height:32px;z-index:99;cursor:var(--sp-cursor-pointer,pointer)';
          target.onclick = () => { window.__cursorClicks = (window.__cursorClicks || 0) + 1; };
          document.querySelector('[data-testid="arknights-cursor"]').closest('.modal__box').append(target);
        }
        const rect = target.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
      await page.mouse.move(point.x, point.y);
      await page.waitForFunction(() => {
        const canvas = document.querySelector('canvas.sp-cursor-canvas');
        return canvas && !canvas.hidden && canvas.dataset.pose === '0';
      });
      return point;
    };
    const point = await pointAtProbe();
    const dimensions = await page.$eval('canvas.sp-cursor-canvas', e => ({
      pixels: [e.width, e.height], css: [parseFloat(e.style.width), parseFloat(e.style.height)], dpr: devicePixelRatio,
    }));
    assert.deepEqual(dimensions.css, [90, 102]);
    assert.deepEqual(dimensions.pixels, dimensions.css.map(v => Math.round(v * Math.min(4, Math.max(1, dimensions.dpr)))));
    const fresh = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      const { CACHE_NAME } = await import('/js/resources/common.js');
      const url = '/assets/local/ui/cursor/prts_hand.png';
      const cache = await caches.open(CACHE_NAME);
      await cache.put(url, new Response('stale-resource', { headers: { 'X-SP-Resource': '1' } }));
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const stored = await (await cache.match(url)).text(); await cache.delete(url);
      return { signature: [...bytes.slice(0, 8)], stored, worker: !!reg.active };
    });
    assert.deepEqual(fresh.signature, [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(fresh.stored, 'stale-resource'); assert.equal(fresh.worker, true);
    const nativeCursor = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--sp-cursor-pointer'));
    const idleCursor = await nativeCursor();
    assert.match(idleCursor, /sp-hand-blank/);
    const saveCursor = async name => {
      const png = await page.$eval('canvas.sp-cursor-canvas', e => e.toDataURL('image/png').split(',')[1]);
      await writeFile(path.join(out, name), Buffer.from(png, 'base64'));
    };
    await saveCursor('cursor-idle.png');
    await page.mouse.down();
    await page.waitForFunction(() => document.querySelector('canvas.sp-cursor-canvas')?.dataset.pose === '10');
    assert.equal(await nativeCursor(), idleCursor, 'pressing does not replace a native image');
    await saveCursor('cursor-pressed.png');
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('canvas.sp-cursor-canvas')?.dataset.pose === '0');
    const clickCount = await page.evaluate(() => window.__cursorClicks || 0);
    for (let i = 0; i < 8; i++) { await page.mouse.down(); await page.mouse.up(); }
    await page.waitForFunction(() => document.querySelector('canvas.sp-cursor-canvas')?.dataset.pose === '0');
    assert.equal(await nativeCursor(), idleCursor);
    assert.equal(await page.evaluate(() => window.__cursorClicks), clickCount + 8, 'canvas and backdrop do not intercept clicks');
    assert.equal(await page.$$eval('canvas.sp-cursor-canvas', e => e.length), 1);
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point), 'cursor-press-probe');
    for (const cursor of ['text', 'grab', 'grabbing', 'ew-resize', 'not-allowed', 'none']) {
      await page.$eval('#cursor-press-probe', (e, value) => { e.style.cursor = value; }, cursor);
      await page.mouse.move(point.x + 1, point.y);
      await page.waitForFunction(() => document.querySelector('canvas.sp-cursor-canvas')?.hidden === true);
      assert.equal(await page.$eval('#cursor-press-probe', e => getComputedStyle(e).cursor), cursor);
      assert.equal(await nativeCursor(), '');
      await page.mouse.move(point.x, point.y);
    }
    await page.$eval('#cursor-press-probe', e => { e.style.cursor = 'var(--sp-cursor-pointer,pointer)'; });
    await page.mouse.move(point.x + 2, point.y);
    await page.waitForFunction(() => document.querySelector('canvas.sp-cursor-canvas')?.hidden === false);
    await page.evaluate(() => {
      for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish();
    });
    await page.screenshot({ path: path.join(out, 'settings-appearance.png') });
    const evidence = await page.$eval('canvas.sp-cursor-canvas', e => ({
      ariaHidden: e.getAttribute('aria-hidden'), inert: e.inert, pointerEvents: getComputedStyle(e).pointerEvents,
      native: document.documentElement.style.getPropertyValue('--sp-cursor-pointer'),
    }));
    assert.equal(evidence.ariaHidden, 'true'); assert.equal(evidence.inert, true); assert.equal(evidence.pointerEvents, 'none');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openSettings(); assert.equal(await enabled(), 'true'); await pointAtProbe();
    await page.click('[data-testid="arknights-cursor"]');
    assert.equal(await enabled(), 'false');
    assert.equal(await page.$eval('[data-testid="arknights-cursor"]', e => getComputedStyle(e).cursor), 'pointer');
    assert.equal(await page.$$eval('canvas.sp-cursor-canvas', e => e.length), 0);
    assert.equal(await nativeCursor(), '');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openSettings(); assert.equal(await enabled(), 'false');
    assert.equal(await page.$$eval('canvas.sp-cursor-canvas', e => e.length), 0);
    assert.deepEqual(errors, []);
    await writeFile(path.join(out, 'verification.json'), JSON.stringify({
      browser: await browser.version(), dimensions, ...evidence, rapidClicks: 8, errors,
    }, null, 2));
  } finally {
    await browser?.close();
    await gateway?.close();
    await server.close();
  }
});
