// SP_E2E=1: real HUD + Web Audio start/end, screenshots and collision checks in both supported desktop browsers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';

for (const [engine, executablePath] of [['chrome', '/run/current-system/sw/bin/google-chrome-stable'], ['firefox', '/run/current-system/sw/bin/firefox']]) {
  test(`${engine}: opt-in subtitles, language modes and HUD clearance`, {
    skip: process.env.SP_E2E !== '1' || !existsSync(executablePath), timeout: 120000,
  }, async () => {
    const srv = await startServer({ host: '127.0.0.1', port: 0, workers: 0, quiet: true, clientBuild: false,
      userFile: ':memory:', announcementsFile: null, assetIndex: false });
    const out = new URL('../e2e/out/voice-subtitles/', import.meta.url); mkdirSync(out, { recursive: true });
    let browser;
    try {
      browser = await puppeteer.launch({ browser: engine, executablePath, headless: true,
        args: engine === 'chrome' ? ['--no-sandbox', '--mute-audio', '--no-proxy-server', '--autoplay-policy=no-user-gesture-required'] : [] });
      const page = await browser.newPage(), errors = [], captionRequests = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.url().includes('/data/voice-captions/')) captionRequests.push(r.url()); });
      await page.setViewport({ width: 1366, height: 768 });
      await page.goto(`${srv.url}/dev/game-mock.html?render=fallback&shot=1&phase=PREP`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.__MOCK__ && window.__SP_VIEW__?.kind === 'fallback');
      await page.evaluate(async () => { const { loadLangIndex } = await import('/js/ui/lang.js'); await loadLangIndex(); });
      assert.equal(await page.$('.voice-subtitles'), null);
      assert.equal(captionRequests.length, 0, 'default-off does not fetch subtitle tables');

      // Exercise actual settings controls and browser-local persistence.
      await page.click('.gm__gear[aria-label="设置"]'); await page.waitForSelector('.settings-modal');
      assert.equal(await page.$eval('[data-testid=voice-subtitle-mode]', e => e.disabled), true);
      await page.evaluate(() => [...document.querySelectorAll('.set-row')].find(e => e.querySelector('.set-row__label')?.textContent.startsWith('显示字幕')).querySelector('[role=switch]').click());
      await page.click('[data-testid=voice-subtitle-mode]'); await page.waitForSelector('.game-select-popover');
      await page.evaluate(() => [...document.querySelectorAll('[role=option]')].find(e => e.textContent.trim() === '双语').click());
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.settings')).voiceSubtitleMode), 'dual');
      await page.screenshot({ path: new URL(`${engine}-settings.png`, out).pathname });
      await page.keyboard.press('Escape'); await page.waitForSelector('.settings-modal', { hidden: true });

      // Generate a local silent AudioBuffer, preserving the real manager, voice selection and source lifecycle.
      await page.evaluate(async () => {
        const { audio } = await import('/js/audio.js');
        audio._unlock(); await audio.ctx.resume();
        const bank = lang => Object.fromEntries(['char_263_skadi', 'char_102_texas'].map(id => [id, { select: `/assets/audio/voice/${lang}/${id}/cn_021.mp3` }]));
        audio.getManifest = () => ({ audio: { voice: bank('cn'), voiceJp: bank('jp') } });
        audio._buffer = async () => audio.ctx.createBuffer(1, audio.ctx.sampleRate * 90, audio.ctx.sampleRate);
        audio.setVolumes({ muted: false, voice: .8 }); audio.previewVoice('char_263_skadi', 'jp');
      });
      await page.waitForSelector('.voice-subtitles', { visible: true, timeout: 6000 }).catch(async error => {
        console.log(JSON.stringify(await page.evaluate(async () => {
          const { audio } = await import('/js/audio.js');
          return { current: audio.currentVoice(), count: audio.voiceListeners.size, blocked: [...document.querySelectorAll('.modal,.guide,.st,.gm.has-sp,.gm.has-spdraft,.game-select-popover')].map(e => e.className),
            strip: document.querySelector('.voice-subtitles')?.outerHTML, shop: document.querySelector('.shopbar')?.getBoundingClientRect().toJSON(), phase: window.__MOCK__.S().pub.phase };
        })));
        await page.screenshot({ path: new URL(`${engine}-failure.png`, out).pathname }); throw error;
      });
      await page.waitForFunction(() => document.querySelectorAll('.voice-subtitles__line').length === 2);
      assert.deepEqual(await page.$$eval('.voice-subtitles__line', ns => ns.map(n => n.lang)), ['ja', 'zh']);
      assert.equal(await page.$eval('.voice-subtitles', e => getComputedStyle(e).pointerEvents), 'none');
      const checkClear = async selectors => {
        await page.waitForFunction(selectors => {
          const e = document.querySelector('.voice-subtitles'); if (!e || getComputedStyle(e).visibility === 'hidden') return true;
          const a = e.getBoundingClientRect();
          return [...document.querySelectorAll(selectors)].every(n => { const b = n.getBoundingClientRect(); return !b.width || !b.height || a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom; });
        }, {}, selectors);
      };
      await checkClear('.shopbar,.gm__corner');
      const readPlacement = () => page.$eval('.voice-subtitles', e => ({ left: e.getBoundingClientRect().left, top: e.getBoundingClientRect().top, width: e.getBoundingClientRect().width }));
      const assertPlacement = (actual, expected, message) => {
        for (const k of ['left', 'top', 'width']) assert.ok(Math.abs(actual[k] - expected[k]) < 1, `${message}: ${k}`);
      };
      const beforeUpgrade = await readPlacement();
      const ready = await page.$eval('.readybtn', e => e.getBoundingClientRect().toJSON());
      assert.ok(beforeUpgrade.left > 1366 / 2 && beforeUpgrade.left + beforeUpgrade.width <= ready.left - 11.9);
      assert.ok(Math.abs(beforeUpgrade.top - ready.top) < 1, 'aligned with the ready row within subpixel layout rounding');
      // Solo / unlimited prep has no Countdown component. Its missing height must not lift captions into the round bar.
      await page.evaluate(() => { window.__captionOldDeadline = window.__MOCK__.S().pub.deadline; window.__MOCK__.S().pub.deadline = null; window.__MOCK__.pushPublic(); });
      await page.waitForSelector('.gtop__clock .countdown', { hidden: true });
      await page.waitForSelector('.voice-subtitles', { visible: true });
      assertPlacement(await readPlacement(), beforeUpgrade, 'untimed prep keeps the timer space and caption position');
      await checkClear('.gtop > *,.gm__bonds .bslot');
      await page.screenshot({ path: new URL(`${engine}-untimed-prep.png`, out).pathname });
      await page.evaluate(() => { window.__MOCK__.S().pub.deadline = window.__captionOldDeadline; window.__MOCK__.pushPublic(); });
      await page.waitForSelector('.gtop__clock .countdown', { visible: true });
      // Grow the actual shop content from three to five operator slots: the caption stays beside the ready row.
      await page.evaluate(() => { window.__captionOldShop = window.__MOCK__.S().priv.shop; window.__MOCK__.mutate(s => { s.priv.shop = { ...s.priv.shop, level: 1, slots: s.priv.shop.slots.slice(0, 3) }; }); });
      const smallShop = await page.$eval('.shopbar', e => e.getBoundingClientRect().width);
      await page.evaluate(() => window.__MOCK__.mutate(s => { const old = window.__captionOldShop; s.priv.shop = { ...old, level: 6, slots: [...old.slots, ...old.slots].slice(0, 5) }; }));
      await page.waitForFunction(w => document.querySelector('.shopbar').getBoundingClientRect().width > w, {}, smallShop);
      assertPlacement(await readPlacement(), beforeUpgrade, 'shop upgrades must not move or squeeze the subtitle');
      await page.evaluate(() => window.__MOCK__.mutate(s => { s.priv.shop = window.__captionOldShop; }));
      await page.evaluate(() => { window.__captionOldEffects = window.__MOCK__.S().priv.effects; window.__MOCK__.mutate(s => { s.priv.effects = []; }); });
      await page.waitForSelector('.gm__effects .effects', { hidden: true });
      assertPlacement(await readPlacement(), beforeUpgrade, 'the effects list does not anchor the subtitle');
      await page.evaluate(() => window.__MOCK__.mutate(s => { s.priv.effects = window.__captionOldEffects; }));
      // A left bench selection uses the existing right-hand detail card. It must take priority over captions.
      const selectedUid = await page.evaluate(async () => {
        const { data } = await import('/js/data.js'); let uid;
        window.__MOCK__.mutate(s => {
          const p = s.priv.hand.find(p => p?.kind === 'chess' && !['char_263_skadi', 'char_102_texas'].includes(data.lookup('chess', p.id)?.charId));
          s.priv.hand = s.priv.hand.map(q => q?.uid === p.uid ? null : q); s.priv.hand[0] = p; uid = p.uid;
        }); return uid;
      });
      await page.click(`.ff-piece[data-uid="${selectedUid}"]`);
      await page.waitForSelector('.dpanel[data-side=right]');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.voice-subtitles')).visibility === 'hidden');
      await page.screenshot({ path: new URL(`${engine}-detail-priority.png`, out).pathname });
      await page.click('.dpanel__close'); await page.waitForSelector('.dpanel', { hidden: true });
      await page.waitForSelector('.voice-subtitles', { visible: true });
      assertPlacement(await readPlacement(), beforeUpgrade, 'closing the detail card restores the current caption in place');
      // A short phrase used to cap the name column at 28% and ellipsize even four Chinese characters.
      await page.evaluate(async () => { const { audio } = await import('/js/audio.js'); audio.previewVoice('char_102_texas', 'cn'); });
      await page.waitForFunction(() => document.querySelector('.voice-subtitles__speaker span')?.textContent === '德克萨斯');
      await page.waitForSelector('.voice-subtitles', { visible: true });
      assert.equal(await page.$eval('.voice-subtitles__speaker span', e => e.scrollWidth <= e.clientWidth && e.scrollHeight <= e.clientHeight && getComputedStyle(e).textOverflow !== 'ellipsis'), true);
      await page.setViewport({ width: 968, height: 817 });
      await checkClear('.shopbar,.gm__corner,.gm__bonds .bslot,.gtop > *');
      await page.click('.bonds-toggle'); await page.waitForSelector('.voice-subtitles', { visible: true });
      await page.screenshot({ path: new URL(`${engine}-full-name-968.png`, out).pathname });
      await page.evaluate(async () => { const { audio } = await import('/js/audio.js'); audio.previewVoice('char_263_skadi', 'jp'); });
      await page.waitForFunction(() => document.querySelectorAll('.voice-subtitles__line').length === 2);
      await page.setViewport({ width: 1366, height: 768 }); await checkClear('.shopbar,.gm__corner');
      await page.screenshot({ path: new URL(`${engine}-prep-1366.png`, out).pathname });
      await page.setViewport({ width: 844, height: 390 }); await page.waitForSelector('.voice-subtitles', { visible: true }); await checkClear('.shopbar,.gm__corner,.gm__bonds .bslot,.gtop > *');
      await page.screenshot({ path: new URL(`${engine}-prep-844.png`, out).pathname });
      await page.setViewport({ width: 1366, height: 768 });
      await page.evaluate(() => window.__MOCK__.setPhase('COMBAT'));
      await page.waitForSelector('.chud');
      await page.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const { audio } = await import('/js/audio.js'); audio.previewVoice('char_263_skadi', 'jp');
      });
      await page.waitForSelector('.voice-subtitles', { visible: true });
      assertPlacement(await readPlacement(), beforeUpgrade, 'combat keeps the ready-row anchor when the ready button disappears');
      await checkClear('.chud > *,.gm__corner');
      await page.screenshot({ path: new URL(`${engine}-combat-1366.png`, out).pathname });
      await page.setViewport({ width: 844, height: 390 }); await checkClear('.chud > *,.gm__corner');
      await page.screenshot({ path: new URL(`${engine}-combat-844.png`, out).pathname });
      await page.evaluate(async () => {
        const { updateSettings } = await import('/js/ui/settings.js'); updateSettings({ textSize: 'xl' });
        document.documentElement.style.setProperty('--sa-b', '20px');
      });
      await checkClear('.chud > *,.gm__corner');
      await page.screenshot({ path: new URL(`${engine}-combat-844-large.png`, out).pathname });
      await page.evaluate(async () => { const { updateSettings } = await import('/js/ui/settings.js'); updateSettings({ textSize: 'sm' }); document.documentElement.style.removeProperty('--sa-b'); });
      await page.setViewport({ width: 1366, height: 768 });
      await page.click('.ewheel__btn'); await page.waitForSelector('.ewheel__dialog');
      await checkClear('.ewheel__dialog,.gm__corner,.chud > *');
      await page.screenshot({ path: new URL(`${engine}-chat.png`, out).pathname });
      await page.click('.ewheel__btn'); await page.waitForSelector('.ewheel__dialog', { hidden: true });
      await page.click('.gm__metrics'); await page.waitForSelector('.combat-metrics');
      await checkClear('.combat-metrics,.gm__corner,.chud > *');
      await page.click('.combat-metrics__close'); await page.waitForSelector('.combat-metrics', { hidden: true });

      // Live mode changes operate on the current phrase; a same-language dub is never duplicated.
      await page.evaluate(async () => { const { updateSettings } = await import('/js/ui/settings.js'); updateSettings({ voiceSubtitleMode: 'voice' }); });
      await page.waitForFunction(() => document.querySelectorAll('.voice-subtitles__line').length === 1 && document.querySelector('.voice-subtitles__line')?.lang === 'ja');
      await page.evaluate(async () => { const { updateSettings } = await import('/js/ui/settings.js'); updateSettings({ voiceSubtitleMode: 'ui' }); });
      await page.waitForFunction(() => document.querySelector('.voice-subtitles__line')?.lang === 'zh');
      await page.evaluate(async () => { const { updateSettings } = await import('/js/ui/settings.js'); const { audio } = await import('/js/audio.js'); updateSettings({ voiceSubtitleMode: 'dual' }); audio.previewVoice('char_263_skadi', 'cn'); });
      await page.waitForFunction(() => document.querySelectorAll('.voice-subtitles__line').length === 1 && document.querySelector('.voice-subtitles__line')?.lang === 'zh');

      // Viewing another board keeps its return action visible beside/under the caption.
      await page.evaluate(() => {
        const { store } = window.__MOCK__, s = store.get();
        store.patch('match', { public: { ...s.match.public, combatMode: 'client' } });
      });
      await page.click('.team__row:nth-child(3) .team__btn'); await page.waitForSelector('.team__ob'); await page.click('.team__ob');
      await page.waitForSelector('.chud__observe');
      await page.waitForFunction(() => window.__MOCK__.store.get().match.field?.fieldId === 'n:p3');
      await page.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const { audio } = await import('/js/audio.js'); audio.previewVoice('char_263_skadi', 'jp');
      });
      await page.waitForSelector('.voice-subtitles', { visible: true });
      await checkClear('.chud__observe,.chud__back,.gm__corner');
      await page.screenshot({ path: new URL(`${engine}-spectating.png`, out).pathname });
      // Retain the in-page promise: Chromium can otherwise collect a CDP-awaited module promise mid-switch.
      const switchLanguage = async lang => {
        await page.evaluate(code => { window.__captionLangSwitch = import('/js/ui/lang.js').then(m => m.switchLang(code)); }, lang);
        await page.waitForFunction(code => document.documentElement.dataset.lang === code, { timeout: 15000 }, lang);
      };
      await switchLanguage('en');
      await page.waitForFunction(() => [...document.querySelectorAll('.voice-subtitles__line')].map(e => e.lang).join(',') === 'ja,en', { timeout: 6000 }).catch(async error => {
        console.log(JSON.stringify(await page.evaluate(async () => { const { audio } = await import('/js/audio.js'); const { getLang } = await import('/shared/i18n.js');
          return { lang: getLang(), current: audio.currentVoice(), lines: [...document.querySelectorAll('.voice-subtitles__line')].map(e => ({ lang: e.lang, text: e.textContent })) }; })));
        throw error;
      });
      await page.screenshot({ path: new URL(`${engine}-bilingual-en.png`, out).pathname });
      await switchLanguage('ja');
      await page.waitForFunction(() => document.querySelectorAll('.voice-subtitles__line').length === 1 && document.querySelector('.voice-subtitles__line')?.lang === 'ja');
      await switchLanguage('zh');

      // Modals hide rather than overlap; an ordinary end still removes the subtitle immediately.
      await page.click('.gm__gear[aria-label="设置"]'); await page.waitForSelector('.settings-modal');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.voice-subtitles')).visibility === 'hidden');
      await page.keyboard.press('Escape'); await page.waitForSelector('.settings-modal', { hidden: true });
      await page.evaluate(async () => { const { audio } = await import('/js/audio.js'); audio.voiceNode.src.onended(); });
      await page.waitForSelector('.voice-subtitles', { hidden: true });

      const play = async (id, dub) => {
        await page.evaluate(async (id, dub) => { const { audio } = await import('/js/audio.js'); audio.previewVoice(id, dub); }, id, dub);
        await page.waitForFunction(async id => { const { audio } = await import('/js/audio.js'); return audio.currentVoice()?.charId === id; }, {}, id);
      };
      const endVoice = () => page.evaluate(async () => { const { audio } = await import('/js/audio.js'); audio.voiceNode.src.onended(); });
      const hover = async () => { await page.hover('.voice-subtitles'); await page.waitForSelector('.voice-subtitles.is-held'); };
      const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

      // Real mouse hover preserves a finished phrase, with no battle/audio pause or artificial timeout.
      await play('char_263_skadi', 'jp'); await page.waitForSelector('.voice-subtitles', { visible: true });
      const heldText = await page.$eval('.voice-subtitles', e => e.textContent);
      await hover(); await endVoice(); await settle();
      assert.equal(await page.$eval('.voice-subtitles.is-held', e => e.textContent), heldText);
      assert.equal(await page.$eval('.voice-subtitles', e => { const r = e.getBoundingClientRect(); return !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.voice-subtitles'); }), false, 'hover must not intercept playfield clicks/touches');
      assert.equal(await page.evaluate(async () => { const { audio } = await import('/js/audio.js'); return audio.currentVoice(); }), null);
      await page.screenshot({ path: new URL(`${engine}-hover-ended.png`, out).pathname });
      await page.mouse.move(0, 0); await page.waitForSelector('.voice-subtitles', { hidden: true });

      // New audio keeps playing while the old text is held. Leaving jumps straight to that current phrase.
      await play('char_263_skadi', 'jp'); await page.waitForSelector('.voice-subtitles', { visible: true }); await hover();
      await play('char_102_texas', 'cn'); await settle();
      assert.equal(await page.$eval('.voice-subtitles.is-held', e => e.textContent), heldText);
      await page.mouse.move(0, 0);
      await page.waitForFunction(() => document.querySelector('.voice-subtitles__speaker span')?.textContent === '德克萨斯');
      // A touch pointer cannot latch the hover state, even on a desktop with a mouse.
      await page.$eval('.voice-subtitles', e => { const r = e.getBoundingClientRect(); document.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 })); });
      assert.equal(await page.$('.voice-subtitles.is-held'), null);
      await endVoice(); await page.waitForSelector('.voice-subtitles', { hidden: true });

      // Moving the strip out from under a stationary mouse (e.g. resizing) also releases the old phrase.
      await play('char_102_texas', 'cn'); await page.waitForSelector('.voice-subtitles', { visible: true }); await hover(); await endVoice();
      await page.setViewport({ width: 1150, height: 768 });
      await page.waitForSelector('.voice-subtitles', { hidden: true });
      await page.setViewport({ width: 1366, height: 768 }); await page.mouse.move(0, 0);

      // Opening a modal via a keyboard/programmatic action must invalidate an already-finished held line.
      await play('char_102_texas', 'cn'); await page.waitForSelector('.voice-subtitles', { visible: true }); await hover(); await endVoice();
      await page.$eval('.gm__gear[aria-label="设置"]', e => e.click()); await page.waitForSelector('.settings-modal');
      await page.waitForSelector('.voice-subtitles', { hidden: true });
      await page.keyboard.press('Escape'); await page.waitForSelector('.settings-modal', { hidden: true });
      assert.equal(await page.$('.voice-subtitles'), null, 'closing the modal cannot resurrect the held phrase');
      await page.mouse.move(0, 0);

      // Muting or suspending audio clears a held phrase even when the source has already ended.
      for (const reason of ['mute', 'suspend']) {
        await play('char_102_texas', 'cn'); await page.waitForSelector('.voice-subtitles', { visible: true }); await hover(); await endVoice();
        await page.evaluate(async reason => {
          const { audio } = await import('/js/audio.js');
          if (reason === 'mute') audio.setVolumes({ muted: true }); else await audio.ctx.suspend();
        }, reason);
        await page.waitForSelector('.voice-subtitles', { hidden: true });
        await page.evaluate(async reason => {
          const { audio } = await import('/js/audio.js');
          if (reason === 'mute') audio.setVolumes({ muted: false }); else await audio.ctx.resume();
        }, reason);
        await settle(); assert.equal(await page.$('.voice-subtitles'), null, `${reason} must not resurrect expired text`);
        await page.mouse.move(0, 0);
      }
      // Disabling still removes a retained phrase, rather than just waiting for pointerleave.
      await play('char_102_texas', 'cn'); await page.waitForSelector('.voice-subtitles', { visible: true }); await hover(); await endVoice();
      await page.evaluate(async () => { const { updateSettings } = await import('/js/ui/settings.js'); updateSettings({ voiceSubtitles: false }); });
      await page.waitForSelector('.voice-subtitles', { hidden: true });
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.settings')).voiceSubtitles), false);
      assert.deepEqual(errors, []);
    } finally { await browser?.close(); await srv.close(); }
  });
}
