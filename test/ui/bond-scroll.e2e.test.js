import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { CHROME } from '../e2e/client.mjs';
import { localFontsOnly } from '../helpers/localFonts.js';
const engine = process.env.SP_E2E_BROWSER || 'chrome';
const executablePath = engine === 'firefox' ? process.env.FIREFOX_PATH || '/run/current-system/sw/bin/firefox' : CHROME;
test(`${engine}: bond arrows appear only on overflow and all bonds remain reachable`, { skip: process.env.SP_E2E !== '1' || !existsSync(executablePath), timeout: 90000 }, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workers: 0,
    clientBuild: false, userFile: ':memory:', assetIndex: false, announcementsFile: null });
  let browser;
  try {
    browser = await puppeteer.launch({ browser: engine, executablePath, headless: true,
      args: engine === 'chrome' ? ['--no-sandbox', '--no-proxy-server'] : [],
      extraPrefsFirefox: { 'dom.ipc.processCount': 2, 'dom.ipc.processCount.webIsolated': 1,
        'dom.ipc.processPrelaunch.enabled': false, 'fission.autostart': false } });
    const sizes = [[1920, 1080, false], ...(process.env.SP_E2E_DESKTOP === '1' ? [] : [[844, 390, true]])];
    for (const [width, height, touch] of sizes) {
      const page = await browser.newPage();
      await localFontsOnly(page);
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.evaluateOnNewDocument(() => {
        globalThis.__bondResizeErrors = [];
        // Native observer delivery errors reach window.error, rather than Puppeteer's pageerror event.
        addEventListener('error', e => { if (e.message.includes('ResizeObserver')) globalThis.__bondResizeErrors.push(e.message); });
      });
      await page.setViewport({ width, height, isMobile: touch, hasTouch: touch });
      await page.goto(srv.url + '/dev/game-mock.html?shot=1&render=fallback&phase=PREP');
      await page.waitForSelector('.bstrip .bond');
      await page.evaluate(() => {
        const mock = globalThis.__MOCK__, state = mock.store.get();
        mock.store.set({ match: { ...state.match, private: { ...state.match.private, bonds: state.match.private.bonds.slice(0, 1) } } });
      });
      await page.waitForFunction(() => document.querySelectorAll('.bslot').length === 1 &&
        [...document.querySelectorAll('.bstrip-scroll__arrow')].every(el => el.hidden));
      assert.equal(await page.$eval('.bonds-toggle', el => getComputedStyle(el).display !== 'none'), true, 'the collapse control remains available');
      assert.equal(await page.$eval('.bstrip', el => {
        const r = el.getBoundingClientRect();
        return !!document.elementFromPoint(r.right - 2, r.top + 2)?.closest('.gm__bonds');
      }), false, 'unused strip space must not block battlefield input');
      const screenshot = async name => {
        if (!process.env.SP_E2E_OUT) return;
        mkdirSync(process.env.SP_E2E_OUT, { recursive: true });
        await page.evaluate(async () => {
          await document.fonts.ready;
          for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish();
        });
        await page.screenshot({ path: `${process.env.SP_E2E_OUT}/${engine}-${width}-${name}.png` });
      };
      await screenshot('one-bond');
      const count = await page.evaluate(async () => {
        const { data } = await import('/js/data.js');
        const mock = globalThis.__MOCK__, state = mock.store.get();
        const bonds = data.list('bonds').map((b, i) => ({ bondId: b.bondId, count: 1, tier: 0, active: false, layers: i }));
        mock.store.set({ match: { ...state.match, private: { ...state.match.private, bonds } } });
        return bonds.length;
      });
      await page.waitForFunction(n => document.querySelectorAll('.bslot').length === n, {}, count);
      await page.waitForFunction(() => [...document.querySelectorAll('.bstrip-scroll__arrow')].every(el => !el.hidden));
      const bounds = await page.$eval('.bstrip', el => ({ width: el.clientWidth, all: el.scrollWidth }));
      assert.ok(bounds.all > bounds.width);
      const arrows = await page.$$eval('.bstrip-scroll__arrow', els => els.map(el => {
        const r = el.getBoundingClientRect(), css = getComputedStyle(el);
        return { y: r.y, width: r.width, height: r.height, radius: css.borderRadius };
      }));
      assert.equal(arrows[0].y, arrows[1].y, 'arrows share one horizontal row');
      assert.ok(arrows.every(a => a.width >= 44 && a.height >= 44 && a.radius === '0px'));
      await screenshot('overflow');
      await page.click('.bstrip-scroll__arrow:last-child');
      await page.waitForFunction(() => document.querySelector('.bstrip').scrollLeft > 0);
      await page.$eval('.bstrip', el => { el.scrollLeft = el.scrollWidth; });
      await page.waitForFunction(() => document.querySelector('.bstrip-scroll__arrow:last-child').disabled);
      const last = '.bslot:last-child .bond';
      await page.click(last); await page.waitForSelector('.bpop');
      await page.click('.bpop__close');
      // Reset native scroll separately; only ArrowRight below is a keyboard assertion.
      await page.$eval('.bstrip', el => { el.scrollLeft = 0; });
      await page.waitForFunction(() => document.querySelector('.bstrip-scroll__arrow:first-child').disabled);
      await page.focus('.bstrip');
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('.bstrip').scrollLeft > 0);
      await page.click('.bonds-toggle');
      assert.equal(await page.$eval('.gm__bond-list', el => el.hidden), true);
      const frozen = await page.evaluate(async () => {
        const { data } = await import('/js/data.js');
        const { render } = await import('/vendor/preact.module.js');
        const { html } = await import('/js/ui/components.js');
        const { BondStrip } = await import('/js/ui/bondStrip.js');
        const host = document.createElement('div'); host.id = 'frozen-bonds';
        host.className = 'gm__bonds'; host.style.width = '300px'; document.body.appendChild(host);
        const bonds = data.list('bonds').map(b => ({ bondId: b.bondId, count: 1, tier: 0, layers: 0 }));
        const NativeObserver = globalThis.ResizeObserver;
        let created = 0, disconnected = 0;
        globalThis.ResizeObserver = class extends NativeObserver {
          constructor(callback) { super(callback); created++; }
          disconnect() { disconnected++; super.disconnect(); }
        };
        try {
          const draw = async entries => {
            render(html`<div class="gm__bond-list"><${BondStrip} bonds=${entries} layersDisabled=${true} onOpen=${() => {}} /></div>`, host);
            await new Promise(r => setTimeout(r, 100));
          };
          await draw(bonds);
          const initial = created;
          await draw(bonds.map(b => ({ ...b, layers: b.layers + 1 })));
          const afterUpdate = { created, disconnected };
          const strip = host.querySelector('.bstrip');
          const result = { all: strip.querySelectorAll('.bslot').length, width: strip.clientWidth, scroll: strip.scrollWidth,
            initial, afterUpdate };
          await draw(bonds.slice(0, 1));
          const measure = () => ({ hidden: [...host.querySelectorAll('.bstrip-scroll__arrow')].every(el => el.hidden),
            content: strip.scrollWidth, row: strip.parentElement.clientWidth, width: strip.clientWidth, host: host.clientWidth });
          const waitForHidden = async hidden => {
            const deadline = performance.now() + 3000;
            while (measure().hidden !== hidden && performance.now() < deadline) await new Promise(r => setTimeout(r, 25));
          };
          await waitForHidden(true);
          result.fit = measure();
          host.style.width = `${strip.querySelector('.bslot').getBoundingClientRect().width / 2}px`;
          await waitForHidden(false);
          result.narrow = measure();
          host.style.width = '300px';
          await waitForHidden(true);
          result.expanded = measure();
          render(null, host);
          return { ...result, afterUnmount: disconnected };
        } finally {
          globalThis.ResizeObserver = NativeObserver;
          render(null, host); host.remove();
        }
      });
      assert.equal(frozen.all, count); assert.ok(frozen.width <= 300 && frozen.scroll > frozen.width);
      assert.equal(frozen.initial, 1);
      assert.deepEqual(frozen.afterUpdate, { created: 1, disconnected: 0 }, 'layer updates reuse the observer');
      assert.ok(frozen.fit.hidden && !frozen.narrow.hidden && frozen.expanded.hidden, `frozen tooltip strips track content and width changes: ${JSON.stringify(frozen)}`);
      assert.equal(frozen.afterUnmount, 2, 'count changes and unmount disconnect their observers');
      assert.deepEqual(await page.evaluate(() => globalThis.__bondResizeErrors), [], 'resizing the strip must not loop during observer delivery');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser?.close(); await srv.close(); }
});
