// Real UI and server: cancel/confirm, operator switching, persistence and the prep/battle skin path.
// SP_E2E=1 CHROME_PATH=/path/to/chrome node --test test/ui/diy-skins.e2e.test.js
// Optional SP_DIY_SKIN_FIXTURE: temporary directory with skins.json and the corresponding assets/ from this deployment.
// Without a fixture, reuse installed default art as the skin's test files; never download or install game assets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, hasChrome, startRealServer } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();
const SLOT = 'chess_char_5_diy1_a', CHAR = 'char_112_siege';
const SKIN = `${CHAR}@striker#2`, OTHER = `${CHAR}@wild#2`;
const picker = '[data-testid="diy-picker"]';
const fixture = process.env.SP_DIY_SKIN_FIXTURE;

async function installArt(page) {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));
  const c = manifest.chars[CHAR];
  c.skins = fixture ? JSON.parse(readFileSync(path.join(fixture, 'skins.json'), 'utf8'))
    : { [SKIN]: { spine: c.spine, avatar: c.avatar, portrait: c.portrait },
      [OTHER]: { spine: c.spine, avatar: c.avatarE2, portrait: c.portraitE2 } };
  await page.setBypassServiceWorker(true);
  await page.setCacheEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', request => {
    const rel = new URL(request.url()).pathname;
    if (rel === '/data/assets.json') {
      void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(manifest) }); return;
    }
    // Only this test operator's skin files, never arbitrary request paths.
    if (fixture && rel.startsWith('/assets/') && rel.includes('char_112_siege_')) {
      const file = path.join(fixture, rel);
      if (existsSync(file)) {
        const contentType = rel.endsWith('.png') ? 'image/png' : 'application/octet-stream';
        void request.respond({ status: 200, contentType, body: readFileSync(file) }); return;
      }
    }
    void request.continue();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
}

for (const [w, h] of [[1280, 720], [844, 390]]) {
  test(`DIY skins: real picker and server at ${w}x${h}`, { skip: !ENABLED, timeout: 150000 }, async t => {
    const srv = await startRealServer({ fast: { startRound: 1, kit: 0, chess: [SLOT], autoPlace: true, timerScale: 1 } });
    t.after(() => srv.stop());
    const P = (await import('puppeteer-core')).default;
    const c = new Client(P, srv.base, 'diy-skins', { w, h, prefix: `diy-skins-${w}` });
    t.after(() => c.close());
    const saved = () => c.page.evaluate(id => JSON.parse(localStorage.getItem('sp.pref.skins') || '{}')[id] || null, SLOT);
    const openDiy = async () => {
      await c.click('.lobby-screen [data-testid="loadout-open"]');
      const entry = '.lo-op--diy[data-diy-tier="5"]';
      await c.page.waitForSelector(entry);
      await c.page.$eval(entry, e => e.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
      await c.click(entry);
    };
    const open = async () => {
      await c.click(`.diy-slot[data-slot="${SLOT}"] :is(.diy-slot__fill, [data-testid="diy-change"])`);
      await c.page.waitForSelector(picker, { visible: true });
      const option = `${picker} .diy-opt[data-char="${CHAR}"]`;
      await c.page.$eval(option, e => e.scrollIntoView({ block: 'nearest' }));
      await c.click(option);
    };
    const select = async skin => {
      const selector = `${picker} [data-skin="${skin}"]`;
      await c.page.waitForSelector(selector, { visible: true });
      await c.page.$eval(selector, e => e.scrollIntoView({ block: 'nearest' }));
      await c.click(selector);
      await c.page.waitForFunction(sel => document.querySelector(sel)?.getAttribute('aria-checked') === 'true', {}, selector);
    };
    try {
      await c.open(); await installArt(c.page); await c.enter('自选皮肤验证');
      await openDiy(); await open();
      await c.page.$eval(`${picker} .lo-sec--skin button`, e => e.scrollIntoView({ block: 'nearest' }));
      await c.click(`${picker} .lo-sec--skin button`, '启用皮肤');
      await select(SKIN);
      assert.equal(await saved(), null, 'draft must not change preferences');
      await c.shot('draft');
      // Browsing another operator must not carry a skin, but returning retains the draft.
      const otherOption = `${picker} .diy-opt[data-char="char_003_kalts"]`;
      await c.page.$eval(otherOption, e => e.scrollIntoView({ block: 'nearest' })); await c.click(otherOption);
      assert.equal(await c.page.$(`${picker} [data-skin="${SKIN}"]`), null);
      await c.page.$eval(`${picker} .diy-opt[data-char="${CHAR}"]`, e => e.scrollIntoView({ block: 'nearest' }));
      await c.click(`${picker} .diy-opt[data-char="${CHAR}"]`);
      assert.equal(await c.page.$eval(`${picker} [data-skin="${SKIN}"]`, e => e.getAttribute('aria-checked')), 'true');
      await c.click(`${picker} .diy-pick__foot button`, '取消');
      assert.equal(await saved(), null);
      await open(); await select(SKIN); await c.click('[data-testid="diy-confirm"]');
      await c.page.waitForSelector(picker, { hidden: true }); assert.equal(await saved(), SKIN);
      if (fixture) {
        await c.page.waitForFunction(slot => document.querySelector(`.diy-slot[data-slot="${slot}"] .diy-slot__art img`)?.src.includes('striker_2'), {}, SLOT);
      }
      await c.shot('saved');
      await open(); await select(OTHER); await c.page.keyboard.press('Escape');
      await c.page.waitForSelector(picker, { hidden: true }); assert.equal(await saved(), SKIN, 'Esc discards the cosmetic draft');
      await c.page.reload({ waitUntil: 'domcontentloaded' });
      await c.page.waitForSelector('.lobby-screen');
      await openDiy(); await open();
      assert.equal(await c.page.$eval(`${picker} [data-skin="${SKIN}"]`, e => e.getAttribute('aria-checked')), 'true');
      await c.page.$eval(`${picker} [data-skin="${SKIN}"]`, e => e.scrollIntoView({ block: 'nearest' }));
      const bounds = await c.page.$eval(picker, e => ({ width: e.clientWidth, scrollWidth: e.scrollWidth,
        controls: [...e.querySelectorAll('.lo-skin')].map(b => ({ w: b.clientWidth, h: b.clientHeight })) }));
      assert.ok(bounds.scrollWidth <= bounds.width + 1, 'no unintended horizontal scroll');
      assert.ok(bounds.controls.every(b => b.w >= 40 && b.h >= 40), 'usable skin controls');
      await c.shot('reloaded');
      await select(''); await c.click('[data-testid="diy-confirm"]');
      await c.page.waitForSelector(picker, { hidden: true }); assert.equal(await saved(), null, 'default clears the slot choice');
      await open(); await select(SKIN); await c.click('[data-testid="diy-confirm"]');
      await c.page.waitForSelector(picker, { hidden: true });
      await c.page.keyboard.press('Escape');
      if (w === 1280) {
        await c.page.evaluate(async () => {
          const { net } = globalThis.__SP__;
          await net.request('room.create', { mode: 'solo', difficulty: 'NORMAL' });
          await net.request('room.start', {});
        });
        await c.waitFor(s => s.phase === 'INFO_CHECK', 'briefing');
        const synced = await c.page.evaluate(slot => {
          const s = globalThis.__SP__.store.get();
          return s.match.public.players.find(p => p.playerId === s.me.playerId)?.skins?.[slot];
        }, SLOT);
        assert.equal(synced, SKIN, 'real server accepted and published the DIY slot');
        await c.page.evaluate(() => globalThis.__SP__.net.request('g.infoReady', {}));
        await c.waitFor(s => s.phase === 'BAND_DRAFT', 'draft');
        await c.page.waitForSelector('.dband');
        const bandId = await c.page.$eval('.dband', e => e.dataset.band);
        await c.page.evaluate(bandId => globalThis.__SP__.net.request('g.band', { bandId }), bandId);
        await c.waitFor(s => s.phase === 'PREP' && s.board > 0, 'prep board');
        await c.page.waitForFunction((slot, skin) => {
          const views = globalThis.__SP_VIEW__?.raw?.debug?.views;
          return views && [...views.values()].some(v => v.info?.defId === slot && v.info.skin === skin && v.spineReady);
        }, { timeout: 30000 }, SLOT, SKIN);
        await c.shot('prep');
        await c.page.evaluate(() => globalThis.__SP__.net.request('g.ready', { ready: true }));
        await c.waitFor(s => s.phase === 'COMBAT', 'combat');
        await c.page.waitForFunction((slot, skin) => {
          const entries = globalThis.__SP_RUNNER__?._entries;
          const entry = entries && [...entries.values()].find(e => e.own && e.battle);
          const u = entry?.battle.allyUnits.find(u => u.def?.id === slot);
          const views = globalThis.__SP_VIEW__?.raw?.debug?.views;
          return u?.skin === skin && views && [...views.values()].some(v => v.info?.defId === slot && v.info.skin === skin && v.spineReady);
        }, { timeout: 30000 }, SLOT, SKIN);
        await c.shot('combat');
      }
      assert.deepEqual(c.problems.filter(p => p.startsWith('pageerror:')), []);
    } finally {
      if (c.page) await c.shot('final').catch(() => {});
      console.log(JSON.stringify({ viewport: [w, h], problems: c.problems.filter(p => p.includes('skin') || p.startsWith('pageerror:')) }));
    }
  });
}
