// 「同盟盟约速查」 flyout in the mock harness (PR #922, §37.347): a teammate's bond popup steps ‹ › through THAT
// teammate's row and keeps the flyout open, the teammates' operators arrive through g.peek (with the elite frame),
// no g.peek is sent before the flyout was ever opened, avatars open then navigate, and on a short viewport
// the window stays clear of 冻结 / 刷新.
// Unit counterparts: test/ui/team-flyout.test.js (bondPopupNav, flyOpsFor), test/match/peek.test.js (the channel).
//
//   SP_E2E=1 CHROME_PATH=/path/to/chrome node --test test/ui/team-flyout.e2e.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIREFOX = process.env.SP_FLYOUT_BROWSER === 'firefox';
const CHROME = (FIREFOX ? process.env.FIREFOX_PATH : process.env.CHROME_PATH) || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const OUT = fileURLToPath(new URL('../e2e/out/', import.meta.url));
const URL_FLYOUT = '/dev/game-mock.html?shot=1&render=fallback&phase=PREP&variant=flyout';

describe('同盟盟约速查 flyout (PR #922)', { skip: !ENABLED && 'set SP_E2E=1 and CHROME_PATH to run' }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, clientBuild: false, workers: 0,
      roomWorkers: 0, matchWorkers: 0, userFile: ':memory:', assetIndex: false, announcementsFile: null, serverConfigFile: false });
    browser = await puppeteer.launch({ browser: FIREFOX ? 'firefox' : 'chrome', executablePath: CHROME, headless: true,
      args: FIREFOX ? [] : ['--no-sandbox', '--no-proxy-server'],
      extraPrefsFirefox: { 'dom.ipc.processCount': 2, 'dom.ipc.processPrelaunch.enabled': false, 'fission.autostart': false } });
    // Keep a tab open between cases: Firefox exits when its last tab closes.
    if (FIREFOX) await browser.newPage();
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  test('a teammate\'s bond popup walks that teammate\'s row and keeps the flyout open; operators arrive by g.peek', async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.setViewport({ width: 1600, height: 900 });
      await page.goto(`${srv.url}${URL_FLYOUT}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.team__fly-window');
      // the mock answers g.peek like the server: the teammates' rows fill in, the elite one framed
      await page.waitForSelector('.team__fly-row:nth-child(2) .team__fly-ops .uthumb');
      const peeks = await page.evaluate(() => globalThis.__MOCK__.S().requests.filter(([t]) => t === 'g.peek'));
      assert.deepEqual(peeks, [['g.peek', { open: true }]], 'one open, no mount-time { open: false }');
      assert.ok(await page.$('.team__fly-row:nth-child(2) .team__fly-ops .uthumb.is-golden'), 'the teammate\'s elite operator keeps its frame');
      assert.equal(await page.$('.team__bonds-toggle'), null, 'avatars replace the vertical toggle');
      assert.equal(await page.$eval('.team__row:not(.is-self) .team__btn', e => e.getAttribute('aria-expanded')), 'true');

      const row = 2;
      const mate = await page.$eval(`.team__row:nth-child(${row}) .team__name`, (el) => el.textContent.trim());
      const discNames = await page.$$eval(`.team__fly-row:nth-child(${row}) .team__fly-bonds .bond`,
        (els) => els.map((el) => (el.getAttribute('title') || '').split(' ')[0]));
      assert.ok(discNames.length >= 3, `the teammate has bonds to walk (${discNames.length})`);
      const popup = () => page.evaluate(() => ({
        flyout: !!document.querySelector('.team__fly-window'),
        name: document.querySelector('.bpop .bpop__name')?.textContent.trim() ?? null,
        label: document.querySelector('.bpop')?.getAttribute('aria-label') ?? null,
        arrows: document.querySelectorAll('.bpop-nav__arrow').length,
      }));
      const discs = await page.$$(`.team__fly-row:nth-child(${row}) .team__fly-bonds .bond`);
      await discs[0].click();
      await page.waitForSelector('.bpop');
      let s = await popup();
      assert.deepEqual([s.flyout, s.name, s.arrows], [true, discNames[0], 2]);
      assert.ok(s.label.includes(mate), `the popup names the teammate (${s.label})`);
      await page.screenshot({ path: `${OUT}/team-flyout-bond-1600.png` });

      await page.click('.bpop-nav__arrow--next');
      await page.waitForFunction((n) => document.querySelector('.bpop .bpop__name')?.textContent.trim() === n, { timeout: 3000 }, discNames[1]);
      s = await popup();
      assert.equal(s.flyout, true, '› keeps the flyout open (the arrows sit outside .bpop)');
      assert.ok(s.label.includes(mate), '› stays on the teammate\'s bonds, never the viewer\'s strip');

      await page.click('.bpop-nav__arrow--prev');
      await page.click('.bpop-nav__arrow--prev');
      await page.waitForFunction((n) => document.querySelector('.bpop .bpop__name')?.textContent.trim() === n, { timeout: 3000 }, discNames.at(-1));
      s = await popup();
      assert.equal(s.flyout, true);
      assert.ok(s.label.includes(mate), '‹ wraps inside the teammate\'s row');

      // another flyout disc switches the popup; a second tap on it closes the popup (like the strip's discs); the
      // flyout stays open throughout (the centred popup covers the row's later discs, so the first one is tapped)
      const first = () => page.$(`.team__fly-row:nth-child(${row}) .team__fly-bonds .bond`);
      await (await first()).click();
      await page.waitForFunction((n) => document.querySelector('.bpop .bpop__name')?.textContent.trim() === n, { timeout: 3000 }, discNames[0]);
      await (await first()).click();
      await page.waitForFunction(() => !document.querySelector('.bpop'), { timeout: 3000 });
      assert.ok(await page.$('.team__fly-window'), 'the flyout is still open');
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  test('first avatar click opens information, second click watches and one home click returns without changing row heights', async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      for (const combatMode of ['client', 'server']) {
        await page.setViewport({ width: 1600, height: 900 });
        await page.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.team__btn');
        await page.evaluate(mode => { globalThis.__MOCK__.S().pub.combatMode = mode; globalThis.__MOCK__.pushPublic(); }, combatMode);
        await page.evaluate(() => document.fonts.ready);
        const rows = () => page.$$eval('.team__row', es => es.map(e => ({ top: e.getBoundingClientRect().top, height: e.getBoundingClientRect().height })));
        const before = await rows();
        const stable = async () => {
          const after = await rows();
          assert.equal(after.length, before.length);
          for (let i = 0; i < before.length; i++) {
            assert.ok(Math.abs(after[i].height - before[i].height) < 1, `${combatMode} row ${i} height changed`);
            assert.ok(Math.abs(after[i].top - before[i].top) < 1, `${combatMode} row ${i} moved`);
          }
        };
        for (const pid of ['p1', 'ai_2', 'p3', 'p4']) {
          await page.click(`.team__row[data-pid="${pid}"] .team__btn`);
          await page.waitForSelector('.team__fly-window');
          await stable();
        }
        assert.equal(await page.$('.team__bonds-toggle,.team__ob,.team__back'), null);
        assert.equal(await page.evaluate(() => globalThis.__MOCK__.S().requests.filter(([t]) => t === 'g.watch').length), 0);
        const mate = '.team__row[data-pid="ai_2"] .team__btn';
        await page.click('.team__row.is-self .team__btn');
        await page.waitForSelector('.team__fly-window', { hidden: true });
        assert.equal(await page.evaluate(() => globalThis.__MOCK__.S().requests.filter(([t]) => t === 'g.watch').length), 0);
        await page.click(mate);
        assert.ok(await page.$(`${mate} .team__avatar-action.is-view`));
        assert.ok(await page.$('.team__row.is-self .team__avatar-action.is-return'));
        assert.equal(await page.$$eval('.team__avatar-action.is-view', es => es.length), 1);
        await page.screenshot({ path: `${OUT}/team-flyout-avatar-${FIREFOX ? 'firefox' : 'chrome'}-${combatMode}-selected.png` });
        if (combatMode === 'client') { await page.focus(mate); await page.keyboard.press(' '); }
        else await page.click(mate);
        await page.waitForSelector('.team__row.is-watched:not(.is-self)');
        await page.waitForSelector('.team__fly-window', { hidden: true });
        await stable();
        assert.ok(await page.$('.team__row.is-self .team__avatar-action.is-return'));
        assert.equal(await page.$('.team__eye'), null, 'the watched row has no trailing eye marker');
        await page.screenshot({ path: `${OUT}/team-flyout-avatar-${FIREFOX ? 'firefox' : 'chrome'}-${combatMode}-watching.png` });
        const home = '.team__row.is-self .team__btn';
        await page.click(home);
        await page.waitForSelector('.team__row.is-watched:not(.is-self)', { hidden: true });
        await page.waitForSelector('.team__fly-window', { hidden: true });
        assert.equal(await page.$('.team__avatar-action'), null, 'home restores the plain avatars');
        await stable();
        await page.click(mate);
        await page.keyboard.press('Escape');
        await page.waitForSelector('.team__fly-window', { hidden: true });
        assert.equal(await page.evaluate(() => document.activeElement?.closest('.team__row')?.dataset.pid), 'ai_2');
        await page.keyboard.press('Enter');
        await page.waitForSelector('.team__fly-window');
        const wasFrozen = await page.evaluate(() => globalThis.__MOCK__.S().priv.shop.frozen);
        await page.click('.shopbar__tools .toolbtn');
        await page.waitForSelector('.team__fly-window', { hidden: true });
        await page.waitForFunction(was => globalThis.__MOCK__.S().priv.shop.frozen !== was, {}, wasFrozen);
        // A physical double-click is the same two-click gesture, with no extra dblclick navigation handler.
        const count = await page.evaluate(() => globalThis.__MOCK__.S().requests.filter(([t]) => t === 'g.watch').length);
        await page.click(mate, { count: 2 });
        await page.waitForSelector('.team__row.is-watched:not(.is-self)');
        await page.waitForSelector('.team__fly-window', { hidden: true });
        // The eye updates optimistically; wait for the asynchronous watch request to reach the mock server.
        await page.waitForFunction(n => globalThis.__MOCK__.S().requests.filter(([t]) => t === 'g.watch').length === n, {}, count + 1);
        assert.equal(await page.evaluate(() => globalThis.__MOCK__.S().requests.filter(([t]) => t === 'g.watch').length), count + 1);
        assert.equal(await page.evaluate(() => globalThis.__MOCK__.S().requests.filter(([t]) => t === 'g.pause' || t === 'g.ready').length), 0);
      }
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('flyout opacity fades in and out and reverses on reopening', async () => {
    const page = await browser.newPage();
    await page.bringToFront();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await page.setViewport({ width: 1600, height: 900 });
      await page.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.team__row[data-pid="ai_2"] .team__btn');
      await page.evaluate(() => document.fonts.ready);
      const enter = await page.evaluate(async () => {
        document.querySelector('.team__row[data-pid="ai_2"] .team__btn').click();
        await new Promise(requestAnimationFrame);
        const el = document.querySelector('.team__fly-window');
        const animation = el.getAnimations().find(a => a.playState !== 'finished');
        if (!animation) return { animation: false };
        animation.pause(); animation.currentTime = 60;
        return { animation: true, opacity: Number(getComputedStyle(el).opacity), duration: animation.effect.getTiming().duration };
      });
      assert.equal(enter.animation, true, 'opening creates an opacity transition');
      assert.equal(enter.duration, 200);
      assert.ok(enter.opacity > 0 && enter.opacity < 1, JSON.stringify(enter));
      await page.screenshot({ path: `${OUT}/team-fade-${FIREFOX ? 'firefox' : 'chrome'}-enter.png` });
      await page.$eval('.team__fly-window', el => el.getAnimations().forEach(a => a.play()));
      await page.waitForFunction(() => {
        const el = document.querySelector('.team__fly-window');
        return getComputedStyle(el).opacity === '1' && el.getAnimations().every(a => a.playState === 'finished');
      });
      const reverse = await page.evaluate(async () => {
        const el = document.querySelector('.team__fly-window');
        const left = el.getBoundingClientRect().left;
        const closedAt = performance.now();
        document.querySelector('.team__row.is-self .team__btn').click();
        await Promise.resolve();
        const animation = el.getAnimations().find(a => a.playState !== 'finished');
        if (!animation) return { animation: false, connected: el.isConnected, opacity: getComputedStyle(el).opacity, visibility: document.visibilityState, class: el.parentElement?.className, elapsed: performance.now() - closedAt };
        animation.pause(); animation.currentTime = 100;
        const opacity = Number(getComputedStyle(el).opacity);
        const inactive = el.inert && el.getAttribute('aria-hidden') === 'true' && getComputedStyle(el).pointerEvents === 'none';
        const anchored = Math.abs(left - el.getBoundingClientRect().left) < 1;
        document.querySelector('.team__row[data-pid="ai_2"] .team__btn').click();
        await Promise.resolve();
        return { animation: true, opacity, inactive, anchored, same: el === document.querySelector('.team__fly-window'), resumed: Number(getComputedStyle(el).opacity) };
      });
      assert.equal(reverse.animation, true, `closing retains the element for its opacity transition: ${JSON.stringify(reverse)}`);
      assert.ok(reverse.opacity > 0 && reverse.opacity < 1, JSON.stringify(reverse));
      assert.ok(reverse.inactive && reverse.anchored && reverse.same, JSON.stringify(reverse));
      assert.ok(reverse.resumed >= reverse.opacity - .01, 'reopening continues from the current opacity');
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.team__fly-window')).opacity) > .99);
      await new Promise(r => setTimeout(r, 240));
      assert.ok(await page.$('.team__fly-window'), 'the cancelled exit cannot remove a reopened flyout');
      await page.screenshot({ path: `${OUT}/team-fade-${FIREFOX ? 'firefox' : 'chrome'}-open.png` });
      const frozen = await page.evaluate(() => globalThis.__MOCK__.S().priv.shop.frozen);
      await page.click('.shopbar__tools .toolbtn');
      await page.waitForFunction(was => globalThis.__MOCK__.S().priv.shop.frozen !== was, {}, frozen);
      await page.waitForSelector('.team__fly-window', { hidden: true });
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('own avatar keeps information accessible with one player', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.team__btn');
      await page.evaluate(() => { const s = globalThis.__MOCK__.S(); s.pub.players = s.pub.players.filter(p => p.playerId === 'p1'); globalThis.__MOCK__.pushPublic(); });
      await page.click('.team__row.is-self .team__btn');
      await page.waitForSelector('.team__fly-window');
      assert.equal(await page.$$eval('.team__fly-row', es => es.length), 1);
      assert.equal(await page.evaluate(() => globalThis.__MOCK__.S().requests.filter(([t]) => t === 'g.watch').length), 0);
      await page.click('.team__row.is-self .team__btn');
      await page.waitForSelector('.team__fly-window', { hidden: true });
    } finally { await page.close(); }
  });

  test('Escape closes upper dialogs and strategy details before the flyout', async () => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1600, height: 900 });
      await page.goto(`${srv.url}${URL_FLYOUT}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.team__fly-band.is-clickable');
      // Keyboard activation has no outside pointerdown: the settings dialog must own Escape above the flyout.
      await page.focus('.gm__gear[aria-label="设置"]');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.modal, .st');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.modal, .st', { hidden: true });
      assert.ok(await page.$('.team__fly-window'), 'Escape belongs to the upper settings dialog');
      await page.click('.team__fly-band.is-clickable');
      await page.waitForSelector('.team__fly-bandpop');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.team__fly-bandpop', { hidden: true });
      assert.ok(await page.$('.team__fly-window'));
      await page.keyboard.press('Escape');
      await page.waitForSelector('.team__fly-window', { hidden: true });
    } finally { await page.close(); }
  });

  test('strategy hover stays to the right, supports reading and keyboard focus, and closes on leave', async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      for (const [width, height] of [[1600, 900], [640, 360], [320, 240]]) {
        await page.setViewport({ width, height });
        await page.goto(`${srv.url}${URL_FLYOUT}`, { waitUntil: 'domcontentloaded' });
        const trigger = '.team__fly-row:nth-child(2) .team__fly-band.is-clickable';
        await page.waitForSelector(trigger);
        await page.evaluate(() => document.fonts.ready);
        await page.hover(trigger);
        await page.waitForSelector('.team__fly-bandpop', { visible: true });
        await page.waitForFunction(sel => {
          const a = document.querySelector(sel).getBoundingClientRect();
          const b = document.querySelector('.team__fly-bandpop').getBoundingClientRect();
          return b.width >= Math.min(80, innerWidth * .4) && b.left >= a.right + 7 && b.right <= innerWidth - 7 && b.top >= 7 && b.bottom <= innerHeight - 7;
        }, {}, trigger);
        assert.match(await page.$eval('.team__fly-bandpop', e => e.textContent), /华法琳/);
        assert.equal(await page.$eval('.team__fly-bandpop', e => e.getAttribute('role')), 'tooltip');
        await page.screenshot({ path: `${OUT}/team-hover-${FIREFOX ? 'firefox' : 'chrome'}-${width}.png` });
        const tip = await page.$eval('.team__fly-bandpop', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        await page.mouse.move(tip.x, tip.y);
        await new Promise(r => setTimeout(r, 220));
        assert.ok(await page.$('.team__fly-bandpop'), 'moving into the description keeps it readable');
        await page.mouse.move(width / 2, height - 2);
        await page.waitForSelector('.team__fly-bandpop', { hidden: true });
        await page.focus(trigger);
        await page.waitForSelector('.team__fly-bandpop', { visible: true });
        await page.keyboard.press(' ');
        assert.equal(await page.$('.modal'), null, 'Space reads the strategy without readying the player');
        await page.keyboard.press('Escape');
        await page.waitForSelector('.team__fly-bandpop', { hidden: true });
        assert.ok(await page.$('.team__fly-window'));
      }
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('640×360: the open flyout leaves 冻结 / 刷新 reachable', async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.setViewport({ width: 640, height: 360, isMobile: true, hasTouch: true });
      await page.goto(`${srv.url}${URL_FLYOUT}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.team__fly-window');
      await page.waitForSelector('.shopbar__tools .toolbtn');
      await new Promise((r) => setTimeout(r, 400));
      const hits = await page.evaluate(() => [...document.querySelectorAll('.shopbar__tools .toolbtn')].flatMap((btn) => {
        const r = btn.getBoundingClientRect();
        return [0.25, 0.5, 0.75].map((f) => {
          const el = document.elementFromPoint(r.left + r.width * f, r.top + r.height / 2);
          return !!el && btn.contains(el);
        });
      }));
      assert.ok(hits.length >= 6, 'both buttons sampled');
      assert.ok(hits.every(Boolean), `every sampled point reaches its button (${JSON.stringify(hits)})`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 640, 'no horizontal page scroll');
      await page.screenshot({ path: `${OUT}/team-flyout-640.png` });
      await page.tap('.team__fly-band.is-clickable');
      await page.waitForSelector('.team__fly-bandpop', { visible: true });
      await page.tap('.team__fly-band.is-clickable');
      await page.waitForSelector('.team__fly-bandpop', { hidden: true });
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  test('temporary-only bonds stay visible and their totals stay yellow in the strip and flyout', async () => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1600, height: 900 });
      await page.goto(`${srv.url}${URL_FLYOUT}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.team__fly-row:nth-child(2) .team__fly-ops .uthumb');
      const id = await page.evaluate(async () => {
        const { data } = await import('/js/data.js');
        const mock = globalThis.__MOCK__, state = mock.store.get(), match = state.match;
        const bond = match.private.bonds.find(b => !b.off && !data.lookup('bonds', b.bondId)?.noStack);
        if (!bond) throw new Error('fixture needs a stacking bond');
        const bonds = [{ ...bond, count: 0, tier: 0, active: false, layers: 0, tempLayers: 20 }];
        mock.store.set({ match: { ...match, private: { ...match.private, bonds },
          public: { ...match.public, players: match.public.players.map(p => ({ ...p, bonds })) } } });
        return bond.bondId;
      });
      const strip = `.gm__bonds [data-bond="${id}"] .bond__count`;
      const fly = '.team__fly-row:nth-child(2) .bond.has-temp-layers .bond__count';
      await page.waitForSelector(fly);
      assert.equal(await page.$eval(strip, e => e.textContent), '20');
      assert.equal(await page.$eval(fly, e => e.textContent), '20');
      assert.equal(await page.$eval(strip, e => e.closest('.bslot').classList.contains('has-temp-layers')), true);
      const colors = await page.evaluate(({ strip, fly }) => [strip, fly].map(s => getComputedStyle(document.querySelector(s)).color), { strip, fly });
      assert.equal(colors[0], colors[1], 'the strip and flyout use the same temporary-layer colour');
      await page.evaluate(() => {
        const mock = globalThis.__MOCK__, { match } = mock.store.get();
        const total = bonds => bonds.map(b => ({ ...b, layers: 100 }));
        mock.store.set({ match: { ...match, private: { ...match.private, bonds: total(match.private.bonds) },
          public: { ...match.public, players: match.public.players.map(p => ({ ...p, bonds: total(p.bonds) })) } } });
      });
      await page.waitForFunction(s => document.querySelector(s)?.textContent === '120', {}, fly);
      assert.equal(await page.$eval(strip, e => e.textContent), '120');
      await new Promise(resolve => setTimeout(resolve, 400));
      await page.screenshot({ path: `${OUT}/team-flyout-temporary-1600.png` });
    } finally {
      await page.close();
    }
  });

  test('320px: every strategy square stays inside the viewport and can be tapped', async () => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 320, height: 568, isMobile: true, hasTouch: true });
      await page.goto(`${srv.url}${URL_FLYOUT}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.team__fly-row:nth-child(2) .team__fly-ops .uthumb');
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: `${OUT}/team-flyout-320.png` });
      const state = await page.evaluate(() => ({
        edge: document.querySelector('.team__fly-window').getBoundingClientRect().right,
        width: innerWidth,
        strategies: [...document.querySelectorAll('.team__fly-band.is-clickable')].map(e => {
          const r = e.getBoundingClientRect();
          return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        }),
      }));
      assert.ok(state.edge <= state.width, `flyout edge ${state.edge} exceeds ${state.width}`);
      assert.equal(state.strategies.length, 4);
      assert.ok(state.strategies.every(Boolean));
      await page.click('.team__fly-band.is-clickable');
      await page.waitForSelector('.team__fly-bandpop');
      const popup = await page.$eval('.team__fly-bandpop', e => e.getBoundingClientRect().toJSON());
      assert.ok(popup.left >= 0 && popup.right <= state.width);
    } finally {
      await page.close();
    }
  });

  test('an arriving regulation command stays reachable while the flyout is open', async () => {
    const { getVersionData } = await import('../../server/data.js');
    const { makeMatch } = await import('../match/harness.js');
    const raw = getVersionData('act3autochess@V3_1', { log: { warn() {}, error() {}, info() {} } });
    const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, data: raw, fake: true }).start();
    let priv;
    try {
      h.toPrep(1, { band: 'band_survive' });
      priv = h.ps('p_0').privateView();
    } finally {
      h.m.dispose();
    }
    assert.ok(priv.command && priv.effects.some(e => e.id === priv.command.effectId));
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1600, height: 900 });
      await page.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&version=regulation&phase=PREP`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!globalThis.__MOCK__);
      await page.evaluate(async raw => {
        const { data } = await import('/js/data.js');
        data.setContent({ id: 'act3autochess@V3_1', values: raw });
        const mock = globalThis.__MOCK__;
        mock.setPhase('PREP');
        mock.S().pub.players.forEach((p, i) => {
          p.bandId = ['band_survive', 'band_amiya', 'band_price', 'band_transfer'][i];
        });
        mock.S().priv.bandId = 'band_survive';
        mock.pushPublic();
      }, raw);
      await page.waitForSelector('.team__row:not(.is-self) .team__btn');
      await page.click('.team__row:not(.is-self) .team__btn');
      await page.waitForSelector('.team__fly-window');
      await page.evaluate(({ command, effects }) => {
        const mock = globalThis.__MOCK__, { match } = mock.store.get();
        Object.assign(mock.S().priv, { command, effects });
        mock.store.patch('match', { private: { ...match.private, bandId: command.bandId, command, effects } });
      }, { command: priv.command, effects: priv.effects });
      await page.waitForSelector('.band-command');
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${OUT}/team-flyout-command-arrived-1600.png` });
      await page.waitForFunction(() => {
        const fly = document.querySelector('.team__fly-window').getBoundingClientRect();
        const effects = document.querySelector('.gm__effects').getBoundingClientRect();
        return fly.right <= effects.left - 6;
      }, { timeout: 3000 });
      const hit = await page.$eval('.band-command', e => {
        const r = e.getBoundingClientRect();
        return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      });
      assert.equal(hit, true, 'the flyout must leave the actual command control reachable');
      assert.ok(await page.$('.team__fly-window'), 'layout updates keep the flyout open');
      await page.screenshot({ path: `${OUT}/team-flyout-command-arrived-1600.png` });
    } finally {
      await page.close();
    }
  });

  test('flyout reduced motion skips opacity transitions', async () => {
    // Firefox BiDi has no media-emulation command; use a separate profile with its native preference.
    if (FIREFOX) {
      await browser.close();
      browser = await (await import('puppeteer-core')).default.launch({
        browser: 'firefox', executablePath: CHROME, headless: true,
        extraPrefsFirefox: { 'ui.prefersReducedMotion': 1, 'dom.ipc.processCount': 2,
          'dom.ipc.processPrelaunch.enabled': false, 'fission.autostart': false },
      });
      await browser.newPage(); // Keep a tab open until the suite's cleanup.
    }
    const page = await browser.newPage();
    try {
      if (!FIREFOX) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.setViewport({ width: 640, height: 360 });
      await page.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.team__row[data-pid="ai_2"] .team__btn');
      assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
      await page.click('.team__row[data-pid="ai_2"] .team__btn');
      await page.waitForSelector('.team__fly-window');
      assert.deepEqual(await page.$eval('.team__fly-window', el => ({ opacity: getComputedStyle(el).opacity, animations: el.getAnimations().length })), { opacity: '1', animations: 0 });
      await page.click('.team__row.is-self .team__btn');
      await page.waitForSelector('.team__fly-window', { hidden: true });
    } finally { await page.close(); }
  });

});
