// Source HUD with controlled public vote snapshots; server voting contracts live in ai-takeover/global-pause tests.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIREFOX = process.env.SP_BROWSER === 'firefox';
const EXECUTABLE = (FIREFOX ? process.env.FIREFOX_PATH : process.env.CHROME_PATH) || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(EXECUTABLE);
const OUT = process.env.SP_VOTE_SCREENSHOTS || fileURLToPath(new URL('../e2e/out/room-votes/', import.meta.url));
const PANEL = '.room-vote-panel:popover-open';
const AI = '[data-testid="ai-collaboration"]', PAUSE = '[data-testid="pause"]';

describe('room vote controls', { skip: !ENABLED && 'set SP_E2E and browser path' }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, clientBuild: false,
      workers: 0, roomWorkers: 0, matchWorkers: 0, userFile: ':memory:', assetIndex: false, serverConfigFile: false, announcementsFile: null });
    browser = await puppeteer.launch({ browser: FIREFOX ? 'firefox' : 'chrome', executablePath: EXECUTABLE, headless: true,
      args: FIREFOX ? [] : ['--no-sandbox', '--no-proxy-server'],
      extraPrefsFirefox: { 'dom.ipc.processCount': 2, 'dom.ipc.processPrelaunch.enabled': false, 'fission.autostart': false } });
    if (FIREFOX) await browser.newPage();
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  async function pageFor(width = 1600, height = 900, touch = false) {
    const page = await browser.newPage();
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    await page.setViewport({ width, height, hasTouch: touch, isMobile: touch });
    await page.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!globalThis.__MOCK__);
    await page.evaluate(async () => {
      await document.fonts.ready; await import('/sim/content/index.js');
      const { net } = await import('/js/net.js');
      const original = net.request;
      globalThis.__voteRequests = [];
      net.request = async (type, body) => {
        globalThis.__voteRequests.push({ type, body });
        if (type === 'room.aiVote') {
          const { store } = globalThis.__MOCK__, room = store.get().room, me = store.get().me.playerId;
          const votes = room.aiTakeoverVotes.map(v => v.id !== body.voteId ? v : {
            ...v, yes: [...v.yes.filter(id => id !== me), ...(body.approve ? [me] : [])],
            no: [...v.no.filter(id => id !== me), ...(!body.approve ? [me] : [])],
          });
          store.set({ room: { ...room, aiTakeoverVotes: votes } });
          return {};
        }
        if (type === 'room.aiRequest') return {};
        return original(type, body);
      };
      const state = globalThis.__MOCK__.S();
      state.pub.pauseMode = 'vote'; state.pub.pauseRequests = [];
      state.pub.pauseRequired = state.pub.players.filter(p => !p.isBot && p.alive).map(p => p.playerId);
      globalThis.__MOCK__.pushPublic();
      const { store } = globalThis.__MOCK__;
      store.set({ room: { ...store.get().room, aiTakeoverEnabled: true, aiTakeoverVotes: [] } });
      globalThis.__seedAiVote = () => {
        const room = store.get().room, me = store.get().me.playerId;
        store.set({ room: { ...room, aiTakeoverVotes: [{ id: 'vote-1', botId: 'ai_2', applicantId: 'sp_1', applicantName: '观战博士',
          eligible: [me, 'p3', 'p4'], yes: [], no: [], expiresAt: Date.now() + 30000 }] } });
      };
    });
    return { page, errors };
  }

  test('pause has explicit request/withdraw, full consent, and native light dismiss', async () => {
    const { page, errors } = await pageFor();
    try {
      assert.equal(await page.$(AI), null, 'no irrelevant AI entry');
      await page.click(PAUSE); await page.waitForSelector(`${PANEL}[data-positioned]`, { visible: true });
      assert.equal(await page.$eval(PANEL, el => el.getAttribute('aria-modal')), null);
      assert.equal(await page.evaluate(() => globalThis.__voteRequests.filter(r => r.type === 'g.pause').length), 0, 'opening does not vote');
      await page.click(`${PANEL} .room-vote-card__actions button`);
      await page.waitForFunction(() => globalThis.__MOCK__.S().pub.pauseRequests.length === 1);
      assert.match(await page.$eval(PANEL, el => el.textContent), /已同意/);
      await page.screenshot({ path: `${OUT}/pause-pending.png` });
      await page.click(`${PANEL} .room-vote-card__actions button`);
      await page.waitForFunction(() => globalThis.__MOCK__.S().pub.pauseRequests.length === 0);
      await page.keyboard.press('Escape'); await page.waitForSelector(PANEL, { hidden: true });
      await page.focus(PAUSE); await page.keyboard.press(FIREFOX ? ' ' : 'Space'); await page.waitForSelector(`${PANEL}[data-positioned]`);
      assert.equal(await page.evaluate(() => globalThis.__MOCK__.S().priv.ready), false, 'Space on the entry never readies');
      await page.click('.gm__gear[aria-label="设置"]');
      await page.waitForSelector('.settings-modal', { visible: true });
      assert.equal(await page.$(PANEL), null, 'outside click also activates Settings');
      await page.keyboard.press('Escape'); await page.waitForSelector('.settings-modal', { hidden: true });
      await page.evaluate(() => {
        const { store, S, pushPublic } = globalThis.__MOCK__;
        S().pub.pauseRequests = S().pub.pauseRequired.filter(id => id !== store.get().me.playerId);
        pushPublic();
      });
      await page.click(PAUSE); await page.waitForSelector(`${PANEL}[data-positioned]`);
      await page.click(`${PANEL} .room-vote-card__actions button`);
      await page.waitForSelector('[data-testid="paused"]');
      assert.equal(await page.$(PANEL), null, 'passed vote yields to the pause overlay');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('solo and veto controls keep direct pause/resume actions', async () => {
    const { page, errors } = await pageFor();
    try {
      await page.evaluate(() => { globalThis.__MOCK__.S().pub.pauseMode = 'veto'; globalThis.__MOCK__.pushPublic(); });
      await page.click(PAUSE);
      await page.waitForFunction(() => globalThis.__voteRequests.some(r => r.type === 'g.pause' && r.body.on));
      await page.waitForFunction(() => globalThis.__MOCK__.S().pub.pauseRequests.includes(globalThis.__MOCK__.store.get().me.playerId));
      assert.equal(await page.$(PANEL), null, 'veto mode does not open a consent vote');
      await page.evaluate(() => { const pub = globalThis.__MOCK__.S().pub; pub.paused = true; pub.pauseRequests = []; globalThis.__MOCK__.pushPublic(); });
      await page.waitForSelector('[data-testid="paused"]');
      assert.match(await page.$eval('[data-testid="paused"]', el => el.textContent), /拒绝暂停/);
      await page.click('[data-testid="paused"] .btn--primary');
      await page.waitForFunction(() => !globalThis.__MOCK__.S().pub.paused);
      await page.evaluate(() => {
        const state = globalThis.__MOCK__.S();
        state.pub.pauseMode = 'vote';
        state.pub.players.forEach(p => { if (p.playerId !== globalThis.__MOCK__.store.get().me.playerId) p.alive = false; });
        state.pub.pauseRequired = [globalThis.__MOCK__.store.get().me.playerId]; state.pub.pauseRequests = [];
        globalThis.__MOCK__.pushPublic();
      });
      await page.click(PAUSE); await page.waitForSelector('[data-testid="paused"]');
      assert.equal(await page.$(PANEL), null, 'a single eligible voter pauses directly');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('AI votes show consent, rejection, expiry and observed transfer results', async () => {
    const { page, errors } = await pageFor();
    try {
      await page.evaluate(() => globalThis.__seedAiVote());
      await page.waitForSelector(AI); await page.click(AI); await page.waitForSelector(`${PANEL}[data-positioned]`);
      assert.match(await page.$eval(PANEL, el => el.textContent), /剩余 \d+ 秒/);
      await page.click(`${PANEL} .room-vote-card__actions button:first-child`);
      await page.waitForFunction(() => document.querySelector('.room-vote-card__actions button')?.getAttribute('aria-pressed') === 'true');
      await page.click(`${PANEL} .room-vote-card__actions button:last-child`);
      await page.waitForFunction(() => document.querySelector('.room-vote-card__actions button:last-child')?.getAttribute('aria-pressed') === 'true');
      assert.match(await page.$eval(PANEL, el => el.textContent), /已拒绝/);
      await page.evaluate(() => {
        const { store } = globalThis.__MOCK__, room = store.get().room;
        store.set({ room: { ...room, aiTakeoverVotes: room.aiTakeoverVotes.map(v => ({ ...v, expiresAt: Date.now() - 1 })) } });
      });
      await page.waitForFunction(() => document.querySelector('.room-vote-card__actions button')?.disabled);
      assert.match(await page.$eval(PANEL, el => el.textContent), /申请已过期/);
      await page.screenshot({ path: `${OUT}/ai-expired.png` });
      await page.evaluate(() => { const { store } = globalThis.__MOCK__; store.set({ room: { ...store.get().room, aiTakeoverVotes: [] } }); });
      await page.waitForFunction(() => document.querySelector('.room-vote-result')?.textContent.includes('申请已过期'));
      await page.keyboard.press('Escape'); await page.waitForSelector(AI, { hidden: true });
      await page.evaluate(() => globalThis.__seedAiVote());
      await page.click(AI); await page.waitForSelector(`${PANEL}[data-positioned]`);
      await page.evaluate(() => {
        Object.assign(globalThis.__MOCK__.S().pub.players.find(p => p.playerId === 'ai_2'), { isBot: false, name: '观战博士' });
        globalThis.__MOCK__.pushPublic();
        const { store } = globalThis.__MOCK__;
        store.set({ room: { ...store.get().room, aiTakeoverVotes: [] } });
      });
      await page.waitForFunction(() => document.querySelector('.room-vote-result')?.textContent.includes('接替成功'));
      assert.match(await page.$eval('.room-vote-result', el => el.textContent), /→ P\d+ · 接替成功/);
      await page.keyboard.press('Escape'); await page.waitForSelector(AI, { hidden: true });
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('the Canvas hand remains above an opened vote popover', {
    skip: !existsSync(fileURLToPath(new URL('../../public/assets/local/ui/cursor/prts_hand.png', import.meta.url))),
  }, async () => {
    const { page, errors } = await pageFor();
    try {
      await page.evaluate(async () => {
        const { data } = await import('/js/data.js'); await data.load('local');
        const { applyCursor } = await import('/js/ui/cursor.js'); applyCursor(true);
      });
      await page.hover(PAUSE);
      try { await page.waitForFunction(() => document.querySelector('canvas.sp-cursor-canvas')?.matches(':popover-open')); }
      catch (error) {
        console.log(await page.evaluate(async () => {
          const { data, localAsset } = await import('/js/data.js');
          return { cursor: data.get('local')?.groups?.['ui/cursor'], url: localAsset('ui/cursor', 'prts_hand'),
            canvases: [...document.querySelectorAll('canvas.sp-cursor-canvas')].map(c => ({ hidden: c.hidden, style: c.style.cssText })), hidden: document.hidden };
        }), errors);
        throw error;
      }
      await page.evaluate(() => {
        const canvas = document.querySelector('canvas.sp-cursor-canvas'), show = canvas.showPopover.bind(canvas);
        globalThis.__cursorRaised = 0;
        canvas.showPopover = (...args) => { globalThis.__cursorRaised++; return show(...args); };
      });
      await page.click(PAUSE); await page.waitForSelector(`${PANEL}[data-positioned]`);
      await page.waitForFunction(() => globalThis.__cursorRaised > 0);
      const button = await page.$(`${PANEL} .room-vote-card__actions button`), box = await button.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.screenshot({ path: `${OUT}/cursor-over-vote.png` });
      assert.equal(await page.$$eval('canvas.sp-cursor-canvas', els => els.length), 1);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('voice captions stay visible and clear of vote popovers', async () => {
    const { page, errors } = await pageFor();
    try {
      await page.click(PAUSE); await page.waitForSelector(`${PANEL}[data-positioned]`);
      await page.evaluate(async () => {
        const { updateSettings } = await import('/js/ui/settings.js');
        const { loadLangIndex } = await import('/js/ui/lang.js'); await loadLangIndex();
        updateSettings({ voiceSubtitles: true, voiceSubtitleMode: 'ui' });
        const { audio } = await import('/js/audio.js'); audio._unlock(); await audio.ctx.resume();
        audio.getManifest = () => ({ audio: { voice: { char_263_skadi: { select: '/assets/audio/voice/cn/char_263_skadi/cn_021.mp3' } } } });
        audio._buffer = async () => audio.ctx.createBuffer(1, audio.ctx.sampleRate * 90, audio.ctx.sampleRate);
        audio.setVolumes({ muted: false, voice: .8 }); audio.previewVoice('char_263_skadi', 'cn');
      });
      await page.waitForFunction(() => {
        const caption = document.querySelector('.voice-subtitles'), panel = document.querySelector('.room-vote-panel:popover-open');
        if (!caption || !panel || getComputedStyle(caption).visibility === 'hidden') return false;
        const a = caption.getBoundingClientRect(), b = panel.getBoundingClientRect();
        return a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom;
      });
      await page.screenshot({ path: `${OUT}/caption-clearance.png` });
      await page.keyboard.press('Escape'); await page.waitForSelector(PANEL, { hidden: true });
      assert.equal(await page.$eval('.voice-subtitles', el => getComputedStyle(el).visibility), 'visible');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('responsive entries stay aligned; spectators can request an AI seat', async () => {
    const { page, errors } = await pageFor();
    try {
      for (const [width, height] of [[1600, 900], [640, 360], [320, 568]]) {
        await page.setViewport({ width, height });
        const pauseX = await page.$eval(PAUSE, el => el.getBoundingClientRect().x);
        await page.evaluate(() => globalThis.__seedAiVote()); await page.waitForSelector(AI);
        const entries = await page.$$eval('.room-vote-entry', els => els.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
        assert.equal(entries.length, 2);
        assert.ok(Math.abs(entries[0].height - entries[1].height) < .1 && Math.abs(entries[0].y - entries[1].y) < .1);
        assert.ok(Math.abs(entries[1].x - pauseX) < .2, 'pause stays at the right edge');
        const overlaps = await page.$eval('.gtop__center', el => {
          const center = el.getBoundingClientRect();
          return [...document.querySelectorAll('.room-vote-entry')].some(button => {
            const r = button.getBoundingClientRect();
            return r.left < center.right && r.right > center.left && r.top < center.bottom && r.bottom > center.top;
          });
        });
        assert.equal(overlaps, false, 'coordination entries stay clear of the round bar');
        await page.screenshot({ path: `${OUT}/${width}-entries.png` });
        for (const selector of [AI, PAUSE]) {
          await page.click(selector); await page.waitForSelector(`${PANEL}[data-positioned]`, { visible: true });
          const box = await page.$eval(PANEL, el => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right, bottom: r.bottom }; });
          assert.ok(box.x >= 11 && box.right <= width - 11 && box.bottom <= height - 11, JSON.stringify(box));
          await page.screenshot({ path: `${OUT}/${width}-${selector === AI ? 'ai' : 'pause'}.png` });
        }
        await page.keyboard.press('Escape'); await page.waitForSelector(PANEL, { hidden: true });
        await page.evaluate(() => { const { store } = globalThis.__MOCK__; store.set({ room: { ...store.get().room, aiTakeoverVotes: [] } }); });
        await page.waitForSelector(AI, { hidden: true });
      }
      await page.evaluate(() => {
        const { store } = globalThis.__MOCK__;
        store.set({ me: { ...store.get().me, playerId: 'sp_1' }, room: { ...store.get().room, spectators: [{ playerId: 'sp_1', connected: true }] } });
      });
      await page.waitForSelector(AI); await page.click(AI); await page.waitForSelector(`${PANEL}[data-positioned]`);
      await page.click(`${PANEL} .room-vote-requests button`);
      await page.waitForFunction(() => globalThis.__voteRequests.some(r => r.type === 'room.aiRequest' && r.body.botId === 'ai_2'));
      assert.equal(await page.$(PAUSE), null, 'spectators cannot pause');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('touch entries retain separate 44px hit areas', { skip: FIREFOX }, async () => {
    const { page, errors } = await pageFor(640, 360, true);
    try {
      await page.evaluate(() => globalThis.__seedAiVote()); await page.waitForSelector(AI);
      await page.waitForFunction(() => document.documentElement.classList.contains('sp-coarse'));
      const targets = await page.$$eval('.room-vote-entry', els => els.map(el => {
        const r = el.getBoundingClientRect(), hit = getComputedStyle(el, '::before');
        return { center: r.x + r.width / 2, width: parseFloat(hit.width), height: parseFloat(hit.height) };
      }));
      assert.ok(targets.every(t => t.width >= 44 && t.height >= 44));
      assert.ok(targets[1].center - targets[0].center >= (targets[0].width + targets[1].width) / 2);
      await page.tap(AI); await page.waitForSelector(`${PANEL}[data-positioned]`);
      await page.tap(PAUSE);
      await page.waitForFunction(() => document.querySelector('.room-vote-panel:popover-open')?.getAttribute('aria-label') === '暂停投票');
      await page.screenshot({ path: `${OUT}/touch-pause.png` });
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
});
