// Static CSS budgets + lifecycle checks, not a browser/layout-engine substitute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postcss from 'postcss';
import { combatMetricsLayout } from '../../public/js/ui/combatMetricsLayout.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const source = read('public/css/utility-mobile.css');
const sheet = postcss.parse(source);

function declaration(selector, prop, media = '') {
  let value;
  sheet.walkRules((rule) => {
    if (!rule.selector.split(/,\s*(?![^()]*\))/).includes(selector)) return;
    const current = rule.parent.type === 'atrule' ? rule.parent.params : '';
    if (current !== media) return;
    rule.walkDecls(prop, (decl) => { value = decl.value; });
  });
  assert.ok(value != null, `${selector} ${prop} (${media})`);
  return value;
}

const MOBILE = '(max-width: 1000px), (max-height: 600px)';
test('the opt-in utility modal preserves ordinary widths and keeps a keyboard-accessible close button in its header', () => {
  const component = read('public/js/ui/components.js');
  assert.match(component, /utility = false/);
  assert.match(component, /utility \? `--utility-width:\$\{width\}` : `width:\$\{width\}`/);
  assert.match(component, /utility && onClose[\s\S]*?utility-modal__close[\s\S]*?aria-label=\$\{t\('关闭'\)\}/);
  assert.match(component, /topmost\(\)/, 'existing focus trap/stack remains');
  assert.match(declaration('.utility-modal .modal__body', 'overflow-y'), /auto/);
  assert.equal(declaration('.utility-modal .modal__body', 'min-height'), '0');
  assert.equal(declaration('.utility-modal .modal__head', 'flex'), 'none');
});

test('resource/settings/about/announcement/resume/import/info/console utilities explicitly opt in, not gameplay selections', () => {
  for (const file of [
    'public/js/ui/resourcePanel.js', 'public/js/ui/settings.js', 'public/js/screens/title.js',
    'public/js/ui/announcement.js', 'public/js/ui/resumeMatch.js', 'public/js/screens/loadout.js',
    'public/js/ui/matchInfo.js', 'public/js/ui/console.js', 'public/js/screens/room.js',
  ]) assert.match(read(file), /utility=\$\{true\}/, file);
  for (const file of ['public/js/ui/equipReplace.js', 'public/js/ui/choiceOverlay.js', 'public/js/ui/rewardOverlay.js']) {
    assert.doesNotMatch(read(file), /utility=\$\{true\}/, file);
  }
  assert.match(read('public/js/ui/components.js'), /utility=\$\{utility\}/, 'imperative dialogs opt in without changing gameplay confirmations');
  assert.match(read('public/js/screens/stats.js'), /confirmDialog\(\{[\s\S]*?utility: true/);
});

test('the source and build entry load the density layer after the existing touch/game styles', () => {
  const html = read('public/index.html');
  assert.ok(html.indexOf('/css/utility-mobile.css') > html.indexOf('/css/devices.css'));
  assert.equal((html.match(/href="\/css\/utility-mobile.css"/g) || []).length, 1);
  for (const fixture of ['public/dev/game-mock.html', 'public/dev/uikit.html']) {
    const page = read(fixture);
    assert.ok(page.indexOf('/css/utility-mobile.css') > page.indexOf('/css/devices.css'), fixture);
  }
  assert.doesNotMatch(source, /(?:^|\n)\s*(?:html|body|:root)\s*\{/);
  assert.doesNotMatch(source, /--t\s*:|(?:zoom|scale)\s*:/);
  sheet.walkDecls((decl) => {
    if (/var\(--utility-text/.test(decl.value)) assert.equal(decl.prop, 'font-size', `${decl.prop} cannot move layout`);
  });
  assert.match(declaration('.utility-modal', '--utility-text', MOBILE), /max\(var\(--t\), 64px\)/);
  assert.equal(declaration(':is(.title-screen, .lobby-screen, .room-screen)', '--utility-text', MOBILE), 'var(--t)');
  assert.equal(declaration('.title-screen .title-tag', 'font-size', MOBILE), 'calc(.16 * var(--utility-text, var(--t)))');
  assert.equal(declaration('.lobby-screen .mode-card__points', 'font-size', MOBILE), 'calc(.14 * var(--utility-text, var(--t)))');
  assert.equal(declaration('.title-screen .title-cn', 'font-size', MOBILE), 'calc(.72 * var(--t))');
  assert.equal(declaration('.lobby-screen .lobby-body', 'padding', MOBILE), '.2rem .25rem');
  assert.equal(declaration(':is(.lobby-screen, .room-screen) .btn', 'min-height', MOBILE), '.75rem');
  assert.match(declaration(':is(.lobby-screen, .room-screen) .field__input', 'font-size', MOBILE), /16px/);
  assert.equal(declaration('.title-screen .title-login .field__input', 'font-size', MOBILE), 'calc(.2 * var(--utility-text, var(--t)))');
  assert.equal(declaration('.title-screen .lang-select select', 'font-size', MOBILE), 'calc(.2 * var(--utility-text, var(--t)))');
  assert.equal(declaration('.settings-modal :is(.set-seg button, .set-toggle, .shortcut-key)', 'font-size', MOBILE),
    'calc(.16 * var(--t))');
  assert.equal(declaration('.settings-modal :is(.set-seg button, .set-toggle, .shortcut-key)', 'min-height', MOBILE), '.75rem');
});

test('short-screen density does not change field/shop/chat layout or hide functional entries', () => {
  sheet.walkRules((rule) => {
    assert.doesNotMatch(rule.selector, /\.gm__hud|\.gm__field|\.shopbar|\.scard|\.ewheel|\.readybtn|\.uframe|\.bstrip/);
  });
  assert.equal(declaration('.lobby-screen .mode-card__points', 'display', MOBILE), 'flex');
  assert.equal(declaration('.lobby-screen .diff-card__effects', 'display', MOBILE), 'flex');
  assert.equal(declaration('.lobby-screen .tips', 'display', MOBILE), 'block');
  assert.equal(declaration('.st-note.is-warn', 'display', MOBILE), 'flex');
  assert.equal(declaration('.lo-card__bonds', 'display', MOBILE), 'flex');
  assert.equal(declaration('.title-screen .title-corner--tr', 'position', MOBILE), 'relative', 'language/stats entries remain accessible');
});

test('compact utility controls have real hit boxes instead of overlapping 44px pseudo-elements', () => {
  const selector = '.sp-coarse :is(.utility-modal, .lo, .st, .lobby-screen, .room-screen, .title-screen) :is(.btn, .tabs__tab, .set-toggle, .set-seg button, .fsbtn)::before';
  assert.equal(declaration(selector, 'inset', MOBILE), '0');
  assert.equal(declaration(selector, 'width', MOBILE), '100%');
  assert.equal(declaration(selector, 'transform', MOBILE), 'none');
  assert.equal(declaration('.resource-choice', 'min-height', MOBILE), '.7rem');
  assert.equal(declaration('.guide__dot', 'min-width', MOBILE), '24px');
  assert.equal(declaration('.guide__dots', 'overflow-x', MOBILE), 'auto');
  assert.match(declaration('.lo .lo-cult .lo-select select', 'font-size', MOBILE), /16px/, 'native select focus zoom guard');
});

test('resource tiers stay in two columns on landscape phones and stack only at genuinely narrow widths', () => {
  assert.equal(declaration('.resource-manager__tiers', 'grid-template-columns', MOBILE), 'repeat(2, minmax(0, 1fr))');
  assert.equal(declaration('.resource-manager__tiers', 'grid-template-columns', '(max-width: 560px)'), 'minmax(0, 1fr)');
  assert.equal(declaration('.resource-tier__list li', 'padding', MOBILE), '.07rem 0');
  assert.equal(declaration('.utility-modal.resource-modal', 'width'), 'min(9.6rem, calc(100vw - .4rem))');
  assert.equal(declaration('.resource-manager', 'gap', MOBILE), '.12rem');
  assert.match(read('public/css/components.css'), /\.resource-tier__summary \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(read('public/js/ui/resourcePanel.js'), /group\.present.*group\.wanted/s, 'category progress/counts retained');
  assert.match(read('public/js/ui/resourcePanel.js'), /packProgress\.speedBytesPerSecond/, 'ZIP transport speed is visible');
  assert.match(read('public/js/ui/resourcePanel.js'), /archiveGroup === group\.id/, 'current import category retained');
});

test('damage meter keeps its measured dock, four numeric columns and type bars; mobile ranks cannot shrink out of view', () => {
  const original = read('public/css/screens/game.css');
  assert.match(original, /--combat-corner-height/);
  assert.match(original, /combat-metrics__values \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.equal(declaration('.combat-metrics__body', 'display', MOBILE), 'flex');
  assert.equal(declaration('.combat-metrics__body', 'overflow-y', MOBILE), 'auto');
  assert.equal(declaration('.combat-metrics__list', 'overflow', MOBILE), 'visible');
  assert.equal(declaration('.combat-metrics__list', 'flex', MOBILE), 'none');
  assert.equal(declaration('.combat-metrics__list', 'order', MOBILE), '-1');
  assert.equal(declaration('.combat-metrics__close', 'min-height', MOBILE), '.7rem', 'coarse-pointer 44px minimum is explicitly overridden');
  assert.equal(declaration('.combat-metrics__close', 'min-width', MOBILE), '.7rem');
  assert.equal(declaration('.combat-metrics__head > .combat-metrics__tools', 'flex', MOBILE), '1 1 0');
  assert.equal(declaration('.combat-metrics[data-viewport-docked="true"]', 'position', MOBILE), 'fixed');
  assert.equal(declaration('.combat-metrics__values span', 'flex-direction', MOBILE), 'row');
  assert.match(read('public/js/ui/combatMetrics.js'), /ownerId: myId/);
  assert.match(read('public/js/ui/combatMetrics.js'), /useState\('battle'\)/);
  assert.match(read('public/js/ui/combatMetrics.js'), /r\.types\[t\.id\] \/ maximum/);
  const component = read('public/js/ui/combatMetrics.js');
  assert.ok(component.indexOf('class="combat-metrics__tools"') < component.indexOf('</header>'),
    'range controls stay in the pinned head');
  assert.match(component, /viewport\?\.addEventListener\('resize', measure\)/);
  assert.match(component, /viewport\?\.removeEventListener\('resize', measure\)/);
  assert.match(component, /viewport\?\.addEventListener\('scroll', measure\)/);
  assert.match(component, /useLayoutEffect\(\(\) =>/, 'position is measured before painting');
});

// Small evaluator for the numeric CSS expressions below. It does NOT model fonts, intrinsic sizes, grid/flex or
// CSS selector matching. The matrix verifies explicit viewport/safe-area budgets only.
function length(expr, vars, viewport, parent = viewport.width) {
  const tokens = expr.match(/--[\w-]+|\d*\.?\d+(?:dvh|vh|vw|rem|px|%)?|[a-z]+|[()+*/,-]/g) || [];
  let at = 0;
  function primary() {
    const token = tokens[at++];
    if (/^\d|^\./.test(token)) {
      const n = parseFloat(token);
      const unit = token.replace(/^[\d.]+/, '');
      return n * ({ px: 1, rem: vars.rem, vw: viewport.width / 100,
        vh: viewport.height / 100, dvh: viewport.height / 100, '%': parent / 100, '': 1 }[unit]);
    }
    if (token === '(') { const value = sum(); assert.equal(tokens[at++], ')'); return value; }
    assert.equal(tokens[at++], '(');
    if (token === 'var') {
      const name = tokens[at++];
      let fallback;
      if (tokens[at] === ',') { at++; fallback = sum(); }
      assert.equal(tokens[at++], ')');
      return vars[name] ?? fallback;
    }
    const values = [sum()];
    while (tokens[at] === ',') { at++; values.push(sum()); }
    assert.equal(tokens[at++], ')');
    if (token === 'min') return Math.min(...values);
    if (token === 'max') return Math.max(...values);
    assert.equal(token, 'calc');
    return values[0];
  }
  function product() {
    let value = primary();
    while (tokens[at] === '*' || tokens[at] === '/') {
      const op = tokens[at++];
      const right = primary();
      value = op === '*' ? value * right : value / right;
    }
    return value;
  }
  function sum() {
    let value = product();
    while (tokens[at] === '+' || tokens[at] === '-') {
      const op = tokens[at++];
      const right = product();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }
  const value = sum();
  assert.equal(at, tokens.length, expr);
  assert.ok(Number.isFinite(value), expr);
  return value;
}

for (const [width, height] of [[320, 568], [390, 844], [640, 360], [844, 390], [915, 412], [1000, 600]]) {
  test(`static viewport budget ${width}x${height}: resources/settings/guide/damage panel fit safe-area bounds`, () => {
    const viewport = { width, height };
    const vars = { rem: Math.max(40, Math.min(width / 19.2, height / 10.8)), '--sa-l': 20, '--sa-r': 12, '--sa-t': 8, '--sa-b': 10 };
    const available = width - vars['--sa-l'] - vars['--sa-r'] - 12;
    for (const selector of ['.modal--utility .utility-modal', '.modal--utility .resource-modal', '.modal--utility .settings-modal']) {
      const w = length(declaration(selector, 'width', MOBILE), vars, viewport, available);
      assert.ok(w <= available && w > 200, `${selector}: ${w}/${available}`);
    }
    const heightBudget = length(declaration('.modal--utility .utility-modal', 'max-height', MOBILE), vars, viewport);
    assert.equal(heightBudget, height - vars['--sa-t'] - vars['--sa-b'] - 12);
    const guideWidth = length(declaration('.guide__page', 'width', MOBILE), vars, viewport);
    assert.ok(guideWidth <= width - vars['--sa-l'] - vars['--sa-r'] - 28);
    assert.ok(guideWidth * 9 / 16 <= height - vars['--sa-t'] - vars['--sa-b'] - 90 + .01);
    const damageWidth = length(declaration('.combat-metrics', 'width', MOBILE), vars, viewport);
    assert.ok(damageWidth <= width - vars['--sa-l'] - vars['--sa-r'] - .48 * vars.rem);
    const dock = combatMetricsLayout({
      cornerTop: height - vars['--sa-b'] - .24 * vars.rem - 110,
      cornerBottom: height - vars['--sa-b'] - .24 * vars.rem,
      viewportHeight: height, rem: vars.rem, safeTop: vars['--sa-t'], safeBottom: vars['--sa-b'],
    });
    vars['--combat-available-height'] = dock.availableHeight;
    vars['--combat-viewport-height'] = dock.viewportSpace;
    const damageHeight = length(declaration('.combat-metrics', 'max-height', MOBILE), vars, viewport);
    assert.ok(damageHeight <= dock.availableHeight);
    const floatingHeight = length(declaration('.combat-metrics[data-viewport-docked="true"]', 'max-height', MOBILE), vars, viewport);
    assert.ok(floatingHeight <= height - vars['--sa-t'] - vars['--sa-b'] - 12);
  });
}

test('mandatory landscape stays global: utility, room, loadout and statistics cannot bypass the portrait gate', () => {
  sheet.walkRules((rule) => assert.doesNotMatch(rule.selector, /rotate-hint/, 'the compact layer must not override the orientation gate'));
  assert.match(read('public/css/theme.css'), /\.sp-rotatable \.rotate-hint \{ display: grid; \}/);
  assert.match(read('public/css/theme.css'), /@media \(orientation: portrait\) and \(max-width: 1024px\)/);
  for (const file of ['public/js/ui/components.js', 'public/js/ui/guide.js', 'public/js/ui/combatMetrics.js']) {
    assert.doesNotMatch(read(file), /useUtilitySurface|claimUtilitySurface|sp-utility-open/, file);
  }
});

test('utility/modal/title height budgets follow the visible viewport when the keyboard reduces it', () => {
  const viewport = { width: 390, height: 844 };
  const vars = { rem: 40, '--sp-vh': 3, '--sa-t': 8, '--sa-b': 10 };
  assert.equal(length(declaration('.modal--utility', 'height', MOBILE), vars, viewport), 300);
  assert.equal(length(declaration('.lo', 'height', MOBILE), vars, viewport), 300);
  assert.equal(length(declaration('.st', 'height', MOBILE), vars, viewport), 300);
  assert.equal(length(declaration('.title-screen', 'height', MOBILE), vars, viewport), 282);
  assert.equal(length(declaration('.modal--utility .utility-modal', 'max-height', MOBILE), vars, viewport), 270);
  assert.match(read('public/js/ui/device.js'), /visualViewport\?\.height/);
});
