// Real source-client pages, WS and inputs. Standalone seat/card-counter components use real data, not a played match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';

for (const [engine, executablePath] of [['chrome', process.env.CHROME_PATH || '/run/current-system/sw/bin/google-chrome-stable'],
  ['firefox', process.env.FIREFOX_PATH || '/run/current-system/sw/bin/firefox']]) {
  for (const part of ['management', 'pickers']) test(`${engine}: ${part}: operator pinyin search`, {
    skip: process.env.SP_E2E !== '1' || !existsSync(executablePath), timeout: 150000,
  }, async () => {
    const out = new URL('../e2e/out/operator-search/', import.meta.url); mkdirSync(out, { recursive: true });
    const errors = [], observations = [], browserDiagnostics = [];
    const srv = await startServer({ host: '127.0.0.1', port: 0, workers: 0, matchWorkers: 0, quiet: true, userFile: ':memory:',
      clientBuild: false, announcementsFile: null, assetIndex: false, versions: { default: 'act3autochess@V3_1' } });
    let browser, page;
    try {
      browser = await puppeteer.launch({ browser: engine, executablePath, headless: true,
        args: engine === 'chrome' ? ['--no-sandbox', '--mute-audio', '--no-proxy-server'] : [],
        extraPrefsFirefox: { 'dom.ipc.processCount': 2, 'dom.ipc.processCount.webIsolated': 1, 'dom.ipc.processPrelaunch.enabled': false, 'fission.autostart': false } });
      browser.process()?.stderr?.on('data', chunk => { browserDiagnostics.push(String(chunk)); if (browserDiagnostics.length > 30) browserDiagnostics.shift(); });
      browser.process()?.on('exit', (code, signal) => browserDiagnostics.push({ exitCode: code, signal }));
      page = await browser.newPage(); page.setDefaultTimeout(15000);
      await page.setViewport({ width: 1366, height: 768 });
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem('sp.name', '拼音搜索验证'); sessionStorage.setItem('sp.entered', '1');
        localStorage.setItem('sp.pref.lobby.version', JSON.stringify('act3autochess@V3_1'));
      });
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
      page.on('requestfailed', request => { if (!/fonts\.(googleapis|gstatic)/.test(request.url())) errors.push(`${request.url()} ${request.failure()?.errorText}`); });
      await page.setRequestInterception(true);
      page.on('request', request => { void (new URL(request.url()).hostname === 'fonts.googleapis.com'
        ? request.respond({ status: 200, contentType: 'text/css', body: '' }) : request.continue()).catch(error => errors.push(error.message)); });
      await page.goto(srv.url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && document.querySelector('.lobby-screen'));
      await page.waitForFunction(() => globalThis.__SP__.data.get('config')?.version?.id === 'act3autochess@V3_1');
      const click = async selector => {
        await page.waitForSelector(selector, { visible: true });
        // Firefox BiDi coordinate clicks can resolve to a browser-internal context on this host; keep DOM handlers + real keyboard input.
        if (engine === 'firefox') await page.$eval(selector, element => { element.focus(); element.click(); });
        else await page.click(selector);
      };
      const type = async (selector, query) => {
        await click(selector); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
        await page.keyboard.press('Backspace'); await page.type(selector, query);
      };
      const settled = () => page.waitForFunction(() => [...document.getAnimations()].every(animation =>
        animation.playState !== 'running' || animation.effect?.getComputedTiming().iterations === Infinity));
      const shot = async name => { await settled(); await page.screenshot({ path: new URL(`${engine}-${name}.png`, out).pathname }); };
      if (part === 'management') {
      await page.evaluate(async () => { (await import('/js/ui/loadoutSync.js')).openLoadout('lobby', null, 'loadout'); });
      await page.waitForSelector('.lo .lo-search input', { visible: true });
      for (const [width, height] of [[1366, 768], [844, 390]]) {
        await page.setViewport({ width, height });
        for (const view of ['list', 'deck']) {
          await click(`[data-loadout-view="${view}"]`);
          for (const query of ['缪尔赛思', 'miu er sai si', 'mess']) {
            await type('.lo .lo-search input', query);
            await page.waitForFunction(() => [...document.querySelectorAll('.lo [data-chess]')].some(e => globalThis.__SP__.data.lookup('chess', e.dataset.chess)?.charId === 'char_249_mlyss'));
          }
          await click('.lo .lo-chip--t1');
          await page.waitForFunction(() => !document.querySelector('.lo-op[data-chess]'));
          await click('.lo .lo-chip--t1');
          await shot(`loadout-${view}-${width}`); observations.push({ page: 'loadout', view, width, query: 'mess' });
        }
        await click('.lo [data-tab="diy"]'); await click('.diy-slot__fill');
        await type('.diy-pick .lo-search input', 'tjzw');
        await page.waitForSelector('.diy-opt[data-char="char_112_siege"]');
        await shot(`diy-${width}`); await page.keyboard.press('Escape'); await page.waitForSelector('.diy-pick', { hidden: true });
        await click('.lo [data-tab="loadout"]');
      }
      await page.evaluate(async () => { (await import('/js/ui/loadoutSync.js')).closeLoadout(); (await import('/js/ui/profile.js')).openProfile('profile'); });
      await page.waitForSelector('.doctor-editor');
      await type('.doctor-editor input:not([maxlength])', 'ttxyx');
      await page.waitForFunction(() => document.querySelector('.profile-avatars button')?.textContent.includes('兔兔许愿星'));
      await page.$eval('.profile-avatars button', element => element.scrollIntoView({ block: 'center' }));
      await shot('profile-844');
      await page.keyboard.press('Escape'); await page.waitForSelector('.doctor-editor', { hidden: true });
      } else {
      await page.setViewport({ width: 844, height: 390 });
      await page.evaluate(async () => { await (await import('/js/data.js')).data.loadAll('chess', 'bonds', 'backups', 'items'); });
      // Production components and handlers on the real app, with an explicit UI-only mount. No inventory or probabilities are fabricated.
      await page.evaluate(async () => {
        const [{ render, h }, { AvatarPicker }, { cardOperators }, { data }] = await Promise.all([
          import('/vendor/preact.module.js'), import('/js/ui/opPicker.js'), import('/js/ui/seatArt.js'), import('/js/data.js')]);
        const mount = document.createElement('div'); mount.id = 'pinyin-picker-fixture'; document.body.append(mount);
        window.__pinyinUnmount = () => { render(null, mount); mount.remove(); };
        render(h(AvatarPicker, { current: '', list: cardOperators(data.list('chess')), m: data.get('assets'), onPick() {}, onClose: window.__pinyinUnmount }), mount);
      });
      await type('.cardpick__search input', 'mess');
      await page.waitForSelector('.cardpick__op[data-operator="char_249_mlyss"]');
      await shot('seat-avatar-844'); await page.evaluate(() => window.__pinyinUnmount());
      await page.evaluate(async () => {
        const [{ render, h }, { CardCounterPanel }, { data }] = await Promise.all([
          import('/vendor/preact.module.js'), import('/js/ui/cardCounter.js'), import('/js/data.js')]);
        const mount = document.createElement('div'); document.body.append(mount);
        window.__pinyinUnmount = () => { render(null, mount); mount.remove(); };
        const target = data.list('chess').find(c => c.charId === 'char_249_mlyss' && !c.isGolden);
        render(h(CardCounterPanel, { myId: 'fixture', connected: false, pub: { bannedChess: [target.chessId] }, onClose: window.__pinyinUnmount }), mount);
      });
      await click('.card-counter__target'); await type('.card-picker .lo-search input', 'mess');
      await page.waitForSelector('.card-picker__operator');
      assert.match(await page.$eval('.card-picker__operator', e => e.textContent), /缪尔赛思/);
      assert.match(await page.$eval('.card-picker__operator', e => e.textContent), /本局禁用/);
      await shot('card-counter-banned-844'); await page.evaluate(() => window.__pinyinUnmount());
      }
      assert.deepEqual(errors, []);
    } catch (error) {
      const diagnostic = await page?.evaluate(() => ({ url: location.href, title: document.title, body: document.body.innerText.slice(-3000) }))
        .catch(error => ({ error: error.message }));
      writeFileSync(new URL(`${engine}-${part}-failure.json`, out), JSON.stringify({ error: error.message, diagnostic }, null, 2));
      await page?.screenshot({ path: new URL(`${engine}-${part}-failure.png`, out).pathname }).catch(error => console.log('Failure screenshot: ' + error.message));
      throw error;
    } finally {
      writeFileSync(new URL(`${engine}-${part}-results.json`, out), JSON.stringify({ errors, observations, browserDiagnostics }, null, 2));
      await browser?.close(); await srv.close();
    }
  });
}
