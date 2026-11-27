import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';

const OUT = process.env.SP_ARCHIVE_SCREENSHOTS || 'test/e2e/out/archive-bands';
const REGULATION = 'act3autochess@V3_1';

for (const engine of ['chrome', 'firefox']) test(`${engine}: archive all-version strategy names and avatars`, {
  skip: process.env.SP_E2E !== '1' || (process.env.SP_ARCHIVE_BROWSER && process.env.SP_ARCHIVE_BROWSER !== engine), timeout: 60000,
}, async () => {
  const executablePath = engine === 'firefox' ? '/run/current-system/sw/bin/firefox' : '/run/current-system/sw/bin/google-chrome-stable';
  assert.ok(existsSync(executablePath));
  const server = await startServer({ host: '127.0.0.1', port: 0, quiet: true, clientBuild: false, workers: 0,
    roomWorkers: 0, matchWorkers: 0, userFile: ':memory:', assetIndex: false, serverConfigFile: false, announcementsFile: null,
    versions: { enabled: 'all', default: REGULATION } });
  let browser;
  try {
    browser = await puppeteer.launch({ browser: engine, executablePath, headless: true,
      args: engine === 'firefox' ? [] : ['--no-sandbox', '--no-proxy-server'],
      extraPrefsFirefox: { 'dom.ipc.processCount': 2, 'dom.ipc.processPrelaunch.enabled': false, 'fission.autostart': false } });
    const page = await browser.newPage(), errors = [];
    page.setDefaultTimeout(7000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(`${server.url}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!globalThis.__MOCK__);
    for (const name of ['navigation', 'screens/stats', 'profile']) await page.addStyleTag({ url: `${server.url}/css/${name}.css` });
    await page.evaluate(async versions => {
      const { render } = await import('/vendor/preact.module.js');
      const { html } = await import('/js/ui/components.js');
      const { data } = await import('/js/data.js');
      const { store } = await import('/js/store.js');
      const { saveStats, buildRecord } = await import('/js/ui/stats.js');
      const { StatsHost, openStats } = await import('/js/screens/stats.js');
      render(null, document.getElementById('app'));
      const values = {};
      await Promise.all(['config', 'bands', 'chess', 'bonds', 'items', 'backups'].map(async name => {
        values[name] = await (await fetch(`/data/versions/act3autochess-v3_1/${name}.json`)).json();
      }));
      data.setContent({ id: 'archive-regulation', values });
      store.set({ versions, room: null, lobbyVersion: 'act3autochess@V3_1' });
      const cases = [
        ['band_chiave', null], ['band_bldsk', null], ['band_duyaoy', null], ['band_orchid', null],
        ['band_zumama', 'act1autochess'], ['band_survive', 'act3autochess@V3_1'],
        ['band_amiya', null], ['band_amiya', 'act3autochess@V3_1'],
      ];
      saveStats({ records: cases.map(([bandId, version], i) => buildRecord({ seed: i + 1, victory: true,
        roundsPassed: 14, difficulty: 'HARD', modeId: 'mode_multi_hard',
        players: [{ playerId: 'archive-player', bandId, alive: true, victory: true, roundsPassed: 14, stats: {} }],
      }, { myId: 'archive-player', version, now: 1795824000000 + i })) });
      render(html`<${StatsHost} />`, document.getElementById('app'));
      openStats('bands');
      await document.fonts.ready;
    }, server.versions.welcome());
    const choose = async label => {
      await page.click('.st-verfilter [role="combobox"]');
      await page.waitForSelector('[role="option"]');
      for (const option of await page.$$('[role="option"]')) if (await option.evaluate(e => e.textContent.trim()) === label) {
        await option.click(); return;
      }
      assert.fail(`missing version option: ${label}`);
    };
    await page.waitForSelector('.st-table tbody tr');
    await choose('全部版本');
    await page.waitForFunction(() => document.querySelectorAll('.st-table tbody tr').length === 7);
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/${engine}-all.png` });
    const expected = ['阿米娅', '贾维', '华法琳', '杜遥夜', '梓兰', '森蚺', '百炼嘉维尔'];
    await page.waitForFunction(names => {
      const cells = [...document.querySelectorAll('.st-band')];
      return names.every(name => cells.some(e => e.textContent.trim() === name && e.querySelector('img')?.naturalWidth > 0));
    }, {}, expected);
    await page.screenshot({ path: `${OUT}/${engine}-all.png` });
    const ami = await page.$$eval('.st-table tbody tr', rows => rows.find(r => r.querySelector('.st-band').textContent.trim() === '阿米娅')?.children[1].textContent.trim());
    assert.equal(ami, '2', 'cross-version usage counts stay aggregated');
    await choose('第二期下半');
    await page.waitForFunction(() => document.querySelectorAll('.st-table tbody tr').length === 5);
    await page.screenshot({ path: `${OUT}/${engine}-second.png` });
    await choose('规程·序列Ⅰ');
    await page.waitForFunction(() => document.querySelectorAll('.st-table tbody tr').length === 2);
    assert.deepEqual(await page.evaluate(async () => {
      const { data } = await import('/js/data.js');
      return [data.contentId(), data.get('config').version.id, data.lookup('bands', 'band_chiave')];
    }), ['archive-regulation', REGULATION, null], 'archive display never replaces the active game data');
    await page.screenshot({ path: `${OUT}/${engine}-regulation.png` });
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});
