// Static CSS budgets + lifecycle checks, not a browser/layout-engine substitute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postcss from 'postcss';

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
test('utility modal honours requested widths and keeps focus, close and body scrolling', () => {
  const component = read('public/js/ui/components.js');
  assert.match(component, /--utility-width:\$\{managementLength\(width\)\}/);
  assert.match(component, /utility && onClose[\s\S]*?utility-modal__close[\s\S]*?aria-label/);
  assert.match(component, /topmost\(\)/);
  assert.equal(declaration('.utility-modal .modal__body', 'overflow-y'), 'auto');
  assert.equal(declaration('.utility-modal .modal__body', 'min-height'), '0');
  assert.equal(declaration('.utility-modal', 'width'), 'var(--utility-width, calc(6.4 * var(--ui-unit, 1rem)))');
  sheet.walkRules(rule => {
    assert.doesNotMatch(rule.selector, /\.modal--utility \.settings-modal/,
      'no mobile rule may replace the requested settings width with 14rem');
  });
});

test('management and plugin modals opt in; gameplay choices keep their original geometry', () => {
  for (const file of ['public/js/ui/resourcePanel.js', 'public/js/ui/settings.js', 'public/js/screens/title.js',
    'public/js/ui/announcement.js', 'public/js/ui/resumeMatch.js', 'public/js/screens/loadout.js',
    'public/js/ui/matchInfo.js', 'public/js/ui/console.js', 'public/js/screens/room.js', 'public/js/ui/pluginPanel.js'])
    assert.match(read(file), /utility=\$\{true\}/, file);
  for (const file of ['public/js/ui/equipReplace.js', 'public/js/ui/choiceOverlay.js', 'public/js/ui/rewardOverlay.js'])
    assert.doesNotMatch(read(file), /utility=\$\{true\}/, file);
});

test('the final layer changes only local design units, and never defines global roots or zoom', () => {
  for (const file of ['public/index.html', 'public/dev/game-mock.html', 'public/dev/uikit.html', 'public/studio/index.html']) {
    const page = read(file);
    assert.ok(page.indexOf('/css/utility-mobile.css') > page.indexOf('/css/devices.css'), file);
  }
  assert.doesNotMatch(source, /(?:^|\n)\s*(?:html|body|:root)\s*\{/);
  assert.doesNotMatch(source, /--t\s*:|(?:zoom|scale)\s*:/);
  const roots = ':is(.title-screen, .lobby-screen, .room-screen, .protocol-screen, .sweep-host, .lo, .st, .ach, .modal--utility, .guide, .studio)';
  assert.equal(declaration(roots, '--ui-unit'), 'var(--sp-ui-unit, 1rem)');
  assert.equal(declaration(roots, '--utility-text'), 'calc(var(--t) * var(--sp-ui-scale, 1))');
  sheet.walkDecls('--ui-unit', d => assert.doesNotMatch(d.parent.selector, /\.gm\b|\.shopbar|\.combat-metrics/));
});

test('management retains explanations, desktop artwork and complete achievement descriptions', () => {
  assert.equal(declaration('.lobby-hub .hub-side .tips', 'display'), 'block');
  assert.equal(declaration('.lo-card__bonds', 'display'), 'flex');
  assert.equal(declaration('.ach-mark__text small', 'white-space'), 'normal');
  assert.equal(declaration('.sweep-host .sw-tile__cap', 'display'), 'block');
  const lobby = read('public/css/screens/lobby.css');
  for (const selector of ['pcard__meta', 'proto-brief p', 'hub-side .tips'])
    assert.doesNotMatch(lobby, new RegExp('\\.' + selector + ' \\{ display: none'));
  const title = read('public/css/screens/title.css');
  assert.doesNotMatch(title, /\.title-en \{ display: none/);
});

test('compact hit boxes stay within their own bounds, while native controls retain the iOS guard', () => {
  const selector = '.sp-coarse :is(.utility-modal, .lo, .st, .lobby-screen, .room-screen, .title-screen, .guide, .ach, .studio) :is(.btn, .tabs__tab, .set-toggle, .set-seg button, .fsbtn)::before';
  assert.equal(declaration(selector, 'inset'), '0');
  assert.equal(declaration(selector, 'width'), '100%');
  assert.equal(declaration(selector, 'transform'), 'none');
  assert.match(source, /font-size: max\(calc\(\.16 \* var\(--utility-text\)\), 16px\)/);
  assert.match(source, /min-height: 1\.6em; height: auto; max-width: 100%/);
});

test('resources keep landscape columns, ZIP progress and category status; only portrait windows stack', () => {
  const components = read('public/css/components.css');
  assert.match(components, /resource-manager__tiers[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.equal(declaration('.resource-manager__options', 'grid-template-columns', '(max-aspect-ratio: 1/1)'), 'minmax(0, 1fr)');
  assert.equal(declaration('.resource-manager__pack-progress small', 'font-size'), 'calc(.12 * var(--utility-text))');
  const resource = read('public/js/ui/resourcePanel.js');
  assert.match(resource, /packProgress\.speedBytesPerSecond/);
  assert.match(resource, /archiveGroup === group\.id/);
  assert.match(resource, /group\.present.*group\.wanted/s);
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

test('mandatory landscape stays global: utility, room, loadout and statistics cannot bypass the portrait gate', () => {
  sheet.walkRules((rule) => assert.doesNotMatch(rule.selector, /rotate-hint/, 'the compact layer must not override the orientation gate'));
  assert.match(read('public/css/theme.css'), /\.sp-rotatable \.rotate-hint \{ display: grid; \}/);
  assert.match(read('public/css/theme.css'), /@media \(orientation: portrait\) and \(max-width: 1024px\)/);
  for (const file of ['public/js/ui/components.js', 'public/js/ui/guide.js', 'public/js/ui/combatMetrics.js']) {
    assert.doesNotMatch(read(file), /useUtilitySurface|claimUtilitySurface|sp-utility-open/, file);
  }
});
