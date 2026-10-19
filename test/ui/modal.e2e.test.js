// Shared Modal keyboard boundaries, real Chrome. Component fixtures cover nested / empty dialogs; the settings
// case uses the real title screen. Opt-in: SP_E2E=1 node --test test/ui/modal.e2e.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);

describe('Modal keyboard focus', { skip: !ENABLED && 'set SP_E2E=1 and have Chrome to run' }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
  });
  after(async () => { await browser?.close(); await srv?.close(); });
  const active = (page) => page.evaluate(() => document.activeElement.id);
  const tab = async (page, reverse = false) => {
    if (reverse) await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    if (reverse) await page.keyboard.up('Shift');
  };
  async function fixture(page) {
    page.setDefaultTimeout(5000);
    await page.goto(`${srv.url}/dev/uikit.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      const { render } = await import('/vendor/preact.module.js');
      const { useState } = await import('/vendor/hooks.module.js');
      const { html, Modal, DialogHost, confirmDialog } = await import('/js/ui/components.js');
      function Fixture() {
        const [outer, setOuter] = useState(false), [inner, setInner] = useState(false), [empty, setEmpty] = useState(false);
        return html`<div>
          <button id="open" onClick=${() => setOuter(true)}>Open</button>
          <button id="empty-open" onClick=${() => setEmpty(true)}>Empty</button>
          <button id="confirm" onClick=${async () => { const ok = await confirmDialog({ text: 'Confirm?' }); document.querySelector('#result').textContent = String(ok); }}>Confirm</button>
          <output id="result"></output>
          <${Modal} open=${outer} onClose=${() => setOuter(false)}>
            <textarea id="first"></textarea>
            <button disabled>Disabled</button><input type="hidden" /><button hidden>Hidden</button>
            <button style="display:none">Display none</button><button style="visibility:hidden">Invisible</button>
            <div inert><button>Inert</button></div><button tabindex="-1">Programmatic only</button>
            <button id="inner-open" onClick=${() => setInner(true)}>Nested</button>
            <a id="last" href="#inside">Last</a>
          <//>
          <${Modal} open=${inner} onClose=${() => setInner(false)}>
            <button id="inner-first" data-autofocus>First</button><button id="inner-last">Last</button>
          <//>
          <${Modal} open=${empty} onClose=${() => setEmpty(false)}>No controls<//>
          <${DialogHost} />
        </div>`;
      }
      render(html`<${Fixture} />`, document.getElementById('kit'));
    });
  }

  test('initial focus, both Tab boundaries, nested priority, recovery and cleanup', async () => {
    const page = await browser.newPage();
    try {
      await fixture(page);
      await page.click('#open');
      await page.waitForFunction(() => document.activeElement.id === 'first');
      await tab(page, true);
      assert.equal(await active(page), 'last', 'hidden, disabled, inert and negative-tabindex controls are excluded');
      await tab(page);
      assert.equal(await active(page), 'first');
      await tab(page);
      assert.equal(await active(page), 'inner-open');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.activeElement.id === 'inner-first');
      await tab(page, true);
      assert.equal(await active(page), 'inner-last', 'only the topmost dialog traps focus');
      await tab(page);
      assert.equal(await active(page), 'inner-first');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelectorAll('.modal').length === 1);
      assert.equal(await active(page), 'inner-open');
      await page.focus('#open');
      assert.equal(await active(page), 'first', 'focus escaping to the background returns to the active dialog');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.modal', { hidden: true });
      assert.equal(await active(page), 'open');
      await tab(page);
      assert.equal(await active(page), 'empty-open', 'closed dialogs no longer trap focus');
      await page.click('#open');
      await page.waitForFunction(() => document.activeElement.id === 'first');
      await tab(page, true);
      assert.equal(await active(page), 'last', 'reopening does not leave stale listeners');
    } finally { await page.close(); }
  });

  test('clipboard fallback stays in the active dialog, copies its payload, restores focus and cleans up on failure', async () => {
    const page = await browser.newPage();
    try {
      await fixture(page);
      await page.click('#open');
      await page.waitForFunction(() => document.activeElement.id === 'first');
      for (const nested of [false, true]) {
        if (nested) {
          await page.click('#inner-open');
          await page.waitForFunction(() => document.activeElement.id === 'inner-first');
        }
        const result = await page.evaluate(async () => {
          const { copyText } = await import('/js/ui/clipboard.js');
          Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
          const prev = document.activeElement;
          const count = document.querySelectorAll('textarea').length;
          let copied;
          const original = document.execCommand;
          document.execCommand = (command) => {
            const el = document.activeElement;
            if (command !== 'copy') throw new Error('unexpected command');
            copied = el.value.slice(el.selectionStart, el.selectionEnd);
            return true;
          };
          const ok = await copyText('导出设置：\n{"language":"zh"}');
          const restored = document.activeElement === prev;
          document.execCommand = () => { throw new Error('denied'); };
          const denied = await copyText('denied');
          document.execCommand = original;
          return { ok, copied, restored, denied, cleaned: document.querySelectorAll('textarea').length === count,
            stillFocused: document.activeElement === prev };
        });
        assert.deepEqual(result, { ok: true, copied: '导出设置：\n{"language":"zh"}', restored: true,
          denied: false, cleaned: true, stillFocused: true });
      }
    } finally { await page.close(); }
  });

  test('no controls: focus the dialog itself; imperative confirm retains autofocus and native Enter', async () => {
    const page = await browser.newPage();
    try {
      await fixture(page);
      await page.click('#empty-open');
      await page.waitForFunction(() => document.activeElement.matches('.modal__box'));
      for (const reverse of [false, true]) {
        await tab(page, reverse);
        assert.equal(await page.evaluate(() => document.activeElement.matches('.modal__box')), true);
      }
      await page.keyboard.press('Escape');
      await page.waitForSelector('.modal', { hidden: true });
      assert.equal(await active(page), 'empty-open');
      await page.click('#confirm');
      await page.waitForFunction(() => document.activeElement.hasAttribute('data-autofocus'));
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('#result').textContent === 'true');
      assert.equal(await active(page), 'confirm');
    } finally { await page.close(); }
  });

  test('title settings: Tab leaves capture; Escape cancels capture then closes nested dialogs', async () => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1280, height: 720 });
      page.setDefaultTimeout(5000);
      await page.goto(srv.url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.title-screen [data-testid="settings-btn"]');
      await page.click('.title-screen [data-testid="settings-btn"]');
      await page.waitForFunction(() => document.querySelector('.modal__box')?.contains(document.activeElement));
      const assertInside = async () => assert.equal(await page.evaluate(() => document.querySelector('.modal__box').contains(document.activeElement)), true);
      for (const reverse of [false, true]) for (let i = 0; i < 25; i++) { await tab(page, reverse); await assertInside(); }
      // Shortcut editing now has its own nested dialog rather than inline .set-key controls.
      await page.evaluate(() => {
        const button = [...document.querySelectorAll('.settings-modal button')].find(el => el.textContent.trim() === '修改快捷键');
        button.focus(); button.click();
      });
      await page.waitForSelector('.settings-shortcuts-modal');
      const focusRetreat = () => page.evaluate(() => [...document.querySelectorAll('.settings-shortcuts-modal .shortcut-row')]
        .find(row => row.textContent.includes('撤离当前干员')).querySelector('button').focus());
      await focusRetreat();
      await page.keyboard.press('Enter');
      await page.waitForSelector('.shortcut-key.is-listening');
      await tab(page);
      await page.waitForSelector('.shortcut-key.is-listening', { hidden: true });
      await assertInside();
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('.shortcut-row')]
        .find(row => row.textContent.includes('撤离当前干员')).querySelector('button').textContent.trim()), 'Q');
      await focusRetreat();
      await page.keyboard.press('Enter');
      await page.waitForSelector('.shortcut-key.is-listening');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.shortcut-key.is-listening', { hidden: true });
      assert.ok(await page.$('.settings-shortcuts-modal'), 'first Esc cancels shortcut capture');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.settings-shortcuts-modal', { hidden: true });
      assert.ok(await page.$('.settings-modal'), 'second Esc returns from the shortcut dialog');
      await assertInside();
      await page.keyboard.press('Escape');
      await page.waitForSelector('.modal', { hidden: true });
      assert.equal(await page.evaluate(() => document.activeElement.matches('.title-screen [data-testid="settings-btn"]')), true);
      assert.ok(await page.$('.title-screen'), 'the background start button was not activated');
    } finally { await page.close(); }
  });

  test('settings keeps one completion action; the shared toolbar still opens the guide', async () => {
    const page = await browser.newPage();
    try {
      page.setDefaultTimeout(5000);
      await page.goto(srv.url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.title-screen [data-testid="settings-btn"]');
      await page.click('.title-screen [data-testid="settings-btn"]');
      await page.waitForSelector('.settings-modal');
      await page.waitForFunction(() => !document.querySelector('.modal__box').getAnimations().some((a) => a.playState === 'running'));
      assert.deepEqual(await page.$$eval('.settings-modal .modal__actions button', es => es.map(e => e.textContent.trim())), ['完成']);
      await page.click('.settings-modal .modal__actions button');
      await page.waitForSelector('.settings-modal', { hidden: true });
      assert.equal(await page.evaluate(() => document.activeElement.matches('.title-screen [data-testid="settings-btn"]')), true);
      await page.click('.title-screen .app-header [aria-label="玩法说明"]');
      await page.waitForSelector('.guide');
      await page.waitForFunction(() => document.querySelector('.guide').contains(document.activeElement));
      await tab(page);
      assert.equal(await page.evaluate(() => document.querySelector('.guide').contains(document.activeElement)), true);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.guide', { hidden: true });
      assert.equal(await page.$('.settings-modal'), null, 'the guide does not reopen settings');
    } finally { await page.close(); }
  });
});
