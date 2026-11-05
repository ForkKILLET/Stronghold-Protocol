// Real room broadcasts and actual decoded Web Audio sources; no fake room state or replacement sounds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, OUT, CHROME, hasChrome, startRealServer, problemsOf } from '../e2e/client.mjs';

const enabled = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));

async function observe(c) {
  await c.page.evaluate(async () => {
    const { audio } = await import('/js/audio.js');
    const { data } = await import('/js/data.js');
    const url = data.get('assets').audio.sfx.ui.ready;
    window.__readySources = [];
    window.__readyUrl = url;
    const decoded = new WeakSet();
    const buffer = audio._buffer.bind(audio);
    audio._buffer = async (...args) => {
      const b = await buffer(...args);
      if (args[0] === url && b) decoded.add(b);
      return b;
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (decoded.has(this.buffer)) window.__readySources.push({ url, at: performance.now(),
        context: audio.ctx.state, gain: audio.sfxGain.gain.value, samples: this.buffer.length });
      return start.apply(this, args);
    };
  });
}
const count = (c) => c.page.evaluate(() => window.__readySources.length);
async function counts(clients, expected) {
  for (let i = 0; i < clients.length; i++) {
    await clients[i].page.waitForFunction((n) => window.__readySources.length >= n, { timeout: 5000 }, expected[i]);
    assert.equal(await count(clients[i]), expected[i], clients[i].label);
  }
}
const ready = (c, expected) => c.page.waitForFunction((expected) => {
  const s = globalThis.__SP__.store.get();
  return s.room.seats.find((p) => p?.playerId === s.me.playerId)?.ready === expected;
}, { timeout: 5000 }, expected);
async function join(c, code, spectator = false) {
  await c.open();
  await c.enter(c.label);
  // Initial loadout/ownership/card sync uses the real connection's heavy bucket. Allow it to refill before spectate;
  // ready/re-ready below has no artificial cooldown, and the production rate limit remains enabled.
  await new Promise(resolve=>setTimeout(resolve,1100));
  await c.click('.hub-entry', '加入同盟');
  await c.click('.join-row input');
  await c.page.keyboard.type(code);
  await c.click('.join-row button', spectator ? '观战' : '加入同盟');
  try {
    await c.page.waitForSelector(spectator ? '.room-screen .specbar__who.is-me' : '.room-screen .rseat.is-me');
  } catch (error) {
    await c.shot('join-failure');
    const state = await c.page.evaluate(() => {
      const s=globalThis.__SP__.store.get();return { me:s.me.playerId, room:s.room,
        messages:[...document.querySelectorAll('.toast')].map(e=>e.textContent) };
    });
    throw new Error(`${error.message}: ${JSON.stringify(state)}`, { cause:error });
  }
}

test('room ready plays the briefing sound for sender, teammate and spectator; rapid re-ready plays again',
  { skip: !enabled, timeout: 150000 }, async () => {
    const P = (await import('puppeteer-core')).default;
    const srv = await startRealServer({ env: { SP_WORKERS: '0', SP_USER_DB: ':memory:' } });
    // Three independent browser processes exceed the local bounded scope's thread budget. Isolated contexts retain
    // separate cookies/accounts and actual Web Audio, while sharing the process/GPU infrastructure.
    const browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run',
      '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--mute-audio'] })
      .catch(async error=>{await srv.stop();throw error;});
    const isolated = { launch: async () => {
      const context = await browser.createBrowserContext();
      return { pages: () => context.pages(), newPage: () => context.newPage(), close: () => context.close(), process: () => null };
    } };
    const clients = ['host', 'guest', 'spectator'].map((name) => new Client(isolated, srv.base, name, { prefix: 'room-ready-audio' }));
    const [host, guest, spectator] = clients;
    const observations = [];
    try {
      await host.open(); await host.enter('准备音效房主');
      await host.click('.hub-entry', '创建同盟');await host.click('.proto-start', '创建同盟');
      const room = (await host.waitFor(s=>!!s.room?.code,'room created')).room;
      await join(guest, room.code);
      await join(spectator, room.code, true);
      for (const c of clients) {
        assert.equal(await c.page.evaluate(() => document.visibilityState), 'visible', `${c.label}: active listener`);
        await observe(c);
      }
      await counts(clients, [0, 0, 0]);

      await guest.click('.room-bar__right button', '准备就绪');
      await ready(guest, true);
      await counts(clients, [1, 1, 1]);
      // Two immediate cycles: no arbitrary sleep or time-based cooldown between accepted actions.
      for (let n = 2; n <= 3; n++) {
        await guest.click('.room-bar__right button', '已就绪');
        await ready(guest, false);
        await counts(clients, [n - 1, n - 1, n - 1]);
        await guest.click('.room-bar__right button', '准备就绪');
        await ready(guest, true);
        await counts(clients, [n, n, n]);
      }
      observations.push({ action: 'ready and two rapid re-ready cycles', counts: await Promise.all(clients.map(count)) });
      await host.shot('shared-ready');

      // An unchanged server broadcast does not replay the cue on any client.
      await guest.page.evaluate(() => globalThis.__SP__.net.request('room.ready', { ready: true }));
      await counts(clients, [3, 3, 3]);
      await host.click('.rseat--empty button', '添加 AI 队友');
      await host.page.waitForSelector('.rseat.is-bot');
      await counts(clients, [3, 3, 3]);

      // Muting affects only this listener; the sender and spectator still hear the next edge.
      await host.page.evaluate(async () => { const { audio } = await import('/js/audio.js'); audio.setVolumes({ ...audio.volumes, muted: true }); });
      await guest.click('.room-bar__right button', '已就绪'); await ready(guest, false);
      await guest.click('.room-bar__right button', '准备就绪'); await ready(guest, true);
      await counts(clients, [3, 4, 4]);
      await host.page.evaluate(async () => { const { audio } = await import('/js/audio.js'); audio.setVolumes({ ...audio.volumes, muted: false }); });

      // A restored ready seat is not a new ready action on the reloaded client.
      await guest.page.reload({ waitUntil: 'domcontentloaded' });
      await guest.page.waitForSelector('.room-screen .rseat.is-me');
      await observe(guest);
      await counts(clients, [3, 0, 4]);
      await guest.click('.room-bar__right button', '已就绪'); await ready(guest, false);
      await guest.click('.room-bar__right button', '准备就绪'); await ready(guest, true);
      await counts(clients, [4, 1, 5]);

      await host.click('.room-bar__right button', '立即开始');
      await host.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing');
      await counts(clients, [4, 1, 5]);
      // The existing briefing action starts the very same decoded file on its sender.
      await host.click('.brief__foot .btn--primary', '准备就绪');
      await counts(clients, [5, 1, 5]);
      const result = await Promise.all(clients.map((c) => c.page.evaluate(() => ({
        url: window.__readyUrl, sources: window.__readySources,
      }))));
      assert.equal(new Set(result.map((r) => r.url)).size, 1, 'all clients and the briefing use the same file');
      assert.ok(result.every((r) => r.sources.every((s) => s.context === 'running' && s.gain > 0 && s.samples > 0)));
      assert.deepEqual(problemsOf(clients), []);
      observations.push({ action: 'after mute, reload and briefing', result });
    } finally {
      writeFileSync(path.join(OUT, 'room-ready-audio-observations.json'), JSON.stringify(observations, null, 2));
      await Promise.all(clients.map((c) => c.close()));
      await browser.close();
      await srv.stop();
    }
  });
