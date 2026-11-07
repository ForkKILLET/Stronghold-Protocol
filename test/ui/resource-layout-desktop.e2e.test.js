import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';

test('desktop Firefox: preload panels use a bounded grid, internal headings and a status action area', {
  skip: process.env.SP_E2E !== '1', timeout: 60000,
}, async () => {
  const out = path.resolve('.state/resource-layout-20261107');
  await mkdir(out, { recursive: true });
  const paths = ['map/test.png', 'char/portrait/test.png', 'spine/test.skel', 'ui/test.png',
    'profile-avatars/test.png', 'char/portrait/skin/test.png', 'voice/cn/test.mp3', 'voice/jp/test.mp3',
    'voice/en/test.mp3', 'voice/kr/test.mp3', 'voice/test.mp3', 'local/fx/test.png', 'sfx/test.mp3', 'bgm/test.mp3', 'other/test.png'];
  const payload = 'x'.repeat(1024), assetRequests=[];
  const resourceHash = createHash('sha1').update(payload).digest('hex').slice(0,12);
  const manifest = { format: 1, version: 'layout-test', files: paths.map((p, i) => ({
    url: '/assets/' + p, tier: i < 4 ? 1 : 2, size: 1024, hash: resourceHash,
  })) };
  // Firefox's intercepted binary responses do not exercise native fetch/Cache Storage reliably.
  // Serve fixture bytes over HTTP while keeping all application sources unchanged.
  const publicDir = await mkdtemp(path.join(tmpdir(), 'sp-resource-ui-'));
  for (const entry of await readdir('public')) {
    if (entry !== 'assets') await symlink(path.resolve('public', entry), path.join(publicDir, entry));
  }
  for (const file of paths) {
    const target = path.join(publicDir, 'assets', file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, payload);
  }
  const server = await startServer({ host: '127.0.0.1', port: 0, quiet: true, workers: 0,
    publicDir, userFile: ':memory:', assetIndex: false, announcementsFile: null, clientBuild: false });
  let browser;
  try {
    browser = await puppeteer.launch({ browser: 'firefox', executablePath: '/run/current-system/sw/bin/firefox', headless: true,
      extraPrefsFirefox: { 'dom.ipc.processCount': 2, 'dom.ipc.processCount.webIsolated': 1,
        'dom.ipc.processPrelaunch.enabled': false, 'fission.autostart': false } });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = new URL(r.url());
      if (u.pathname === '/data/resource-manifest.json') void r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(manifest) }).catch(() => {});
      else if (paths.includes(u.pathname.replace('/assets/',''))) {
        assetRequests.push(u.pathname);
        void r.continue().catch(()=>{});
      }
      else if (u.hostname === 'fonts.googleapis.com') void r.respond({ status: 200, contentType: 'text/css', body: '' }).catch(() => {});
      else void r.continue().catch(() => {});
    });
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.res-pill');
    await page.click('.res-pill');
    await page.waitForFunction(() => document.querySelectorAll('.resource-tier__list li').length >= 14);
    for (const [width, height] of [[1920, 1080], [1536, 864]]) {
      await page.setViewport({ width, height });
      await page.evaluate(async () => {
        await document.fonts.ready;
        for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish();
      });
      const geometry = await page.evaluate(() => {
        const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, h: r.height }; };
        const modal = document.querySelector('.resource-modal'), body = modal.querySelector('.modal__body');
        return { modal: rect(modal), body: rect(body), overflow: body.scrollHeight - body.clientHeight,
          panels: [...modal.querySelectorAll('.resource-manager__grid > *')].map(e => ({ ...rect(e), background: getComputedStyle(e).backgroundColor,
            heading: rect(e.querySelector('h3')) })),
          lists: [...modal.querySelectorAll('.resource-tier__list')].map(e => ({ ...rect(e), scroll: getComputedStyle(e).overflowY, excess: e.scrollHeight - e.clientHeight })),
          top: [...modal.querySelectorAll('.resource-manager__top > *')].map(rect) };
      });
      assert.ok(geometry.modal.y >= 0 && geometry.modal.bottom <= height);
      assert.ok(geometry.overflow <= 1, 'the manager body does not become one long page');
      assert.equal(await page.$('.resource-modal .modal__actions'), null);
      assert.equal(await page.$('.resource-modal legend'), null);
      assert.equal(geometry.panels.length, 4);
      const [voice, skin, required, optional] = geometry.panels;
      assert.ok(Math.abs(voice.y - skin.y) < 1 && Math.abs(required.y - optional.y) < 1);
      assert.ok(Math.abs(voice.h - skin.h) < 1, 'voice and skin cards fill their shared grid row');
      assert.ok(await page.$eval('.resource-tier:last-child .resource-choice', e => getComputedStyle(e).color === getComputedStyle(e.closest('header').querySelector('h3')).color), 'optional preload label uses the normal white text color');
      assert.ok(voice.right < skin.x && required.right < optional.x);
      assert.ok(required.y >= Math.max(voice.bottom, skin.bottom) + 10);
      assert.ok(Math.abs(required.bottom - geometry.body.bottom) < 32);
      assert.ok(geometry.panels.every(p => p.background === required.background && p.heading.y > p.y && p.heading.bottom < p.bottom));
      assert.ok(geometry.top.every(p => p.bottom < voice.y));
      assert.ok(geometry.lists.every(p => p.scroll === 'auto' && p.bottom <= geometry.body.bottom));
      assert.ok(geometry.lists[1].excess > 0, 'optional resources scroll within their panel');
      const labels = await page.$$eval('.resource-manager__status .btn', es => es.map(e => e.textContent.trim()));
      assert.deepEqual(labels, ['删除本机游戏资源']);
      assert.equal(await page.$eval('[data-testid="preload-enabled"]',e=>e.checked),false);
      assert.ok(await page.$eval('.resource-status__actions .btn',e=>e.classList.contains('btn--danger')));
      const descriptions=await page.$$eval('.resource-description',es=>es.map(e=>({font:getComputedStyle(e).fontSize,color:getComputedStyle(e).color})));
      for(const d of descriptions)assert.deepEqual(d,descriptions[0],'all panel descriptions use the same typography');
      await page.screenshot({ path: path.join(out, `manager-${width}.png`) });
      await page.$eval('.resource-tier:last-child .resource-tier__list', e => { e.scrollTop = e.scrollHeight; });
      assert.ok(await page.$eval('.resource-tier:last-child .resource-tier__list', e => e.lastElementChild.getBoundingClientRect().bottom <= e.getBoundingClientRect().bottom + 1));
    }
    await page.setViewport({width:1920,height:1080});
    await page.click('[data-testid="preload-enabled"]');
    await page.waitForFunction(async()=> (await import('/js/resources/index.js')).resourceState().selectionComplete).catch(async err=>{
      console.log('preload failure',await page.evaluate(async()=> (await import('/js/resources/index.js')).resourceState()),assetRequests,errors);
      await page.screenshot({path:path.join(out,'control-failure.png')});throw err;
    });
    assert.equal(await page.$eval('[data-testid="preload-enabled"]',e=>e.checked),true);
    const saved=await page.evaluate(async()=> (await import('/js/resources/index.js')).resourceState().done);
    assert.equal(saved,4,'the real controller saved all required files');
    const fetched=assetRequests.length;
    await page.click('[data-testid="preload-enabled"]');
    await page.waitForFunction(async()=> !(await import('/js/resources/index.js')).resourceState().enabled);
    assert.equal(await page.evaluate(async()=> (await import('/js/resources/index.js')).resourceState().done),saved,'switching off keeps saved files');
    await page.click('[data-testid="preload-enabled"]');
    await page.waitForFunction(async()=> (await import('/js/resources/index.js')).resourceState().phase==='ready');
    assert.equal(assetRequests.length,fetched,'re-enabling reuses the saved files');
    await page.evaluate(()=>localStorage.setItem('sp.pref.stats',JSON.stringify({v:3,records:[]})));
    const records=await page.evaluate(()=>localStorage.getItem('sp.pref.stats'));
    await page.click('.resource-status__actions .btn--danger');
    await page.waitForSelector('.modal__actions .btn--danger');
    await page.evaluate(() => { for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); });
    await page.screenshot({path:path.join(out,'delete-confirmation.png')});
    await page.keyboard.press('Escape');
    await page.waitForSelector('.modal__actions',{hidden:true});
    assert.equal(await page.evaluate(async()=> (await import('/js/resources/index.js')).resourceState().done),saved,'cancelling confirmation changes no resources');
    await page.click('.resource-status__actions .btn--danger');
    await page.waitForSelector('.modal__actions .btn--danger');
    await page.evaluate(() => { for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); });
    await page.click('.modal__actions .btn--danger');
    await page.waitForFunction(async()=> (await import('/js/resources/index.js')).resourceState().done===0).catch(async err=>{
      console.log('delete failure',await page.evaluate(async()=> ({state:(await import('/js/resources/index.js')).resourceState(),text:document.querySelector('.resource-modal')?.textContent,dialogs:document.querySelectorAll('.modal__actions').length})),errors);
      await page.screenshot({path:path.join(out,'delete-failure.png')});throw err;
    });
    assert.equal(await page.$eval('[data-testid="preload-enabled"]',e=>e.checked),false,'deleting cannot immediately start another automatic download');
    assert.equal(await page.evaluate(()=>localStorage.getItem('sp.pref.stats')),records,'resource deletion preserves device records');
    const voice = await page.$eval('[name="preload-voice-lang"][value="jp"]', e => e.checked);
    await page.click('[name="preload-voice-lang"][value="jp"]');
    assert.notEqual(await page.$eval('[name="preload-voice-lang"][value="jp"]', e => e.checked), voice);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.resource-modal', { hidden: true });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
    await rm(publicDir, { recursive: true, force: true });
  }
});
