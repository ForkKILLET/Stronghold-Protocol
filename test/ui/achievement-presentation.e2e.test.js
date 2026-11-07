// Desktop Firefox, isolated records and server; opt in with SP_E2E=1 through check:local.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';

test('achievement title counts drive independent wedges and official record art has fallbacks', {
  skip: process.env.SP_E2E !== '1', timeout: 90000,
}, async () => {
  const out = path.resolve(process.env.SP_E2E_OUT || '.state/achievement-stage2-20261107');
  await mkdir(out, { recursive: true });
  const source = await readFile('public/index.html', 'utf8');
  const fixture = JSON.parse(await readFile(new URL('./fixtures/stats-versions.json', import.meta.url)));
  // Keep the real import map and styles, without starting a networking/game session.
  const head = source.slice(0, source.indexOf('</head>'))
    .replace(/<link[^>]+(?:modulepreload|prefetch)[^>]*>/g, '')
    .replace(/<script(?![^>]*type="importmap")[\s\S]*?<\/script>/g, '');
  const server = await startServer({ host: '127.0.0.1', port: 0, workers: 0, quiet: true,
    userFile: ':memory:', assetIndex: false, announcementsFile: null, clientBuild: false, hotReload: false });
  let browser;
  try {
    browser = await puppeteer.launch({ browser: 'firefox', executablePath: process.env.FIREFOX_PATH || '/run/current-system/sw/bin/firefox', headless: true,
      extraPrefsFirefox: { 'dom.ipc.processCount': 2, 'dom.ipc.processCount.webIsolated': 1,
        'dom.ipc.processPrelaunch.enabled': false, 'fission.autostart': false } });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1536, height: 864 });
    await page.setRequestInterception(true);
    page.on('request', r => {
      const url = new URL(r.url());
      const response = url.hostname === 'fonts.googleapis.com' ? { status: 200, contentType: 'text/css', body: '' }
        : r.url() === server.url + '/' ? { status: 200, contentType: 'text/html', body: head + '</head><body><div id="app"></div></body></html>' } : null;
      void (response ? r.respond(response) : r.continue()).catch(() => {});
    });
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async fixture => {
      localStorage.setItem('sp.pref.stats', JSON.stringify(fixture));
      const [{ render }, { html, UiHosts }, { StatsHost, openStats }, device, { store }] = await Promise.all([
        import('/vendor/preact.module.js'), import('/js/ui/components.js'), import('/js/screens/stats.js'),
        import('/js/ui/device.js'), import('/js/store.js'),
      ]);
      device.installDeviceSupport(); store.set({ me: { playerId: 'fixture', name: '界面调试博士' } });
      render(html`<div class="app-root"><${StatsHost}/><${UiHosts}/></div>`, document.querySelector('#app'));
      openStats('achievements');
    }, fixture);
    await page.waitForSelector('.doctor-achievements .ach-hex');
    const shot = async (name, selector) => {
      await page.evaluate(async () => {
        await document.fonts.ready;
        for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish();
        await new Promise(requestAnimationFrame);
      });
      const target = selector ? await page.$(selector) : page;
      await target.screenshot({ path: path.join(out, name + '.png') });
    };
    await page.waitForSelector('.st-titlehex.has-reference-mask');
    assert.equal(await page.$$eval('.st-titlehex__active', es => es.length), 0, 'zero records must not draw filled awards');
    assert.equal(await page.$$eval('.st-titlehex__base', es => es.length), 6);
    await shot('overview-zero');
    await page.evaluate(() => [...document.querySelectorAll('.ach-bar')].find(e => e.textContent.includes('成就进度')).scrollIntoView({ block: 'start' }));
    await shot('achievement-progress');
    await page.evaluate(() => [...document.querySelectorAll('.ach-bar')].find(e => e.textContent.includes('单局纪录')).scrollIntoView({ block: 'start' }));
    await page.waitForFunction(() => [...document.querySelectorAll('img.ach-max__glyph')].filter(e => e.complete && e.naturalWidth > 0).length === 3);
    await shot('single-match-records');
    await shot('record-icons', '.ach-maxima');

    const reopen = async () => {
      await page.evaluate(async () => {
        const { profileStore } = await import('/js/ui/profile.js');
        profileStore.set({ open: false });
        await new Promise(requestAnimationFrame);
        profileStore.set({ open: true, tab: 'achievements' });
      });
      await page.waitForSelector('.doctor-achievements .ach-hex');
    };
    // Reopen the real archive with new stored records; preserve counts beyond the visual cap.
    const counts = [0, 1, 5, 19, 20, 25];
    await page.evaluate(async ({ counts, record }) => {
      const ids = ['comment_4', 'comment_5', 'comment_6', 'comment_1', 'comment_2', 'comment_3'];
      const records = counts.flatMap((n, i) => Array.from({ length: n }, (_, j) => ({ ...record,
        id: `award-${i}-${j}`, players: record.players.map(p => ({ ...p, title: { id: ids[i] } })),
      })));
      const { saveStats } = await import('/js/ui/stats.js');
      if (!saveStats({ v: 3, records })) throw new Error('fixture stats save failed');
    }, { counts, record: fixture.records[1] });
    await reopen();
    await page.waitForFunction(() => document.querySelectorAll('.st-titlehex__active').length === 5);
    const wedges = await page.$$eval('.st-titlehex__label', labels => labels.map(label => {
      const wedge = document.querySelector(`.st-titlehex__wedge[data-title-id="${label.dataset.titleId}"]`);
      const sector = wedge.querySelector('.st-titlehex__sector');
      return { count: Number(label.querySelector('b').textContent), bright: label.querySelector('b').classList.contains('is-bright'),
        clip: sector ? getComputedStyle(sector).clipPath : null };
    }));
    assert.deepEqual(wedges.map(e => e.count), counts);
    assert.deepEqual(wedges.map(e => e.bright), [false, false, false, false, true, true]);
    assert.equal(wedges[0].clip, null);
    assert.equal(new Set(wedges.slice(1, 5).map(e => e.clip)).size, 4, 'unequal counts must produce different fill levels');
    assert.equal(wedges[4].clip, wedges[5].clip, '20 and 25 share a full wedge, not a truncated label');
    await page.$eval('.ach-hex', e => e.scrollIntoView({ block: 'center' }));
    const containedLabels = await page.$eval('.ach-hex', e => {
      const box = e.getBoundingClientRect();
      return [...e.querySelectorAll('.st-titlehex__label')].every(label => {
        const r = label.getBoundingClientRect();
        return r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom;
      });
    });
    assert.ok(containedLabels, 'readable title labels fit inside the chart');
    await shot('overview-mixed');
    await shot('chart-mixed', '.ach-hex');

    // Actual failed loads, not intercepted image bytes (Firefox can mishandle intercepted binary responses).
    await page.evaluate(async () => {
      const { data } = await import('/js/data.js');
      for (const key of ['titleMask', 'countGlow', 'decoration', 'recordFunds', 'recordPromotions', 'recordDefeats']) {
        data.get('assets').ui[`statistics/${key}`] = `/assets/missing-test-art/${key}.png`;
      }
      const { saveStats } = await import('/js/ui/stats.js');
      saveStats({ v: 3, records: [] });
    });
    await reopen();
    await page.$eval('.ach-maxima', e => e.scrollIntoView({ block: 'center' }));
    await page.waitForFunction(() => !document.querySelector('.has-reference-mask') && !document.querySelectorAll('img.ach-max__glyph').length);
    assert.equal(await page.$$eval('.st-titlehex__active', es => es.length), 0, 'refresh removes previous fills');
    assert.equal(await page.$$eval('svg.ach-max__glyph', es => es.length), 3, 'each failed icon keeps a fallback');
    const fallback = await page.$$eval('.st-titlehex__base', es => es.map(e => getComputedStyle(e).clipPath));
    assert.equal(fallback.length, 6);
    assert.ok(fallback.every(clip => clip.startsWith('polygon(')), 'missing masks must not erase the hexagon');
    await page.$eval('.ach-hex', e => e.scrollIntoView({ block: 'center' }));
    await shot('chart-fallback', '.ach-hex');
    await page.$eval('.ach-maxima', e => e.scrollIntoView({ block: 'center' }));
    await shot('record-icons-fallback', '.ach-maxima');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});
