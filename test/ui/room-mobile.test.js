// Component props and stylesheet cascade checks. Not a substitute for browser/phone layout verification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { RoomTools } from '../../public/js/screens/room.js';
import { SettingsButton } from '../../public/js/ui/settings.js';
import { GuideButton } from '../../public/js/ui/guide.js';

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const layers = ['public/css/components.css', 'public/css/screens/lobby.css', 'public/css/screens/room.css', 'public/css/utility-mobile.css']
  .map((file) => postcss.parse(read(file)));

function mediaMatches(params, width, height) {
  return params.split(',').some((part) => (!part.includes('max-aspect-ratio: 1/1') || width <= height) && [...part.matchAll(/\(max-(width|height):\s*(\d+)px\)/g)]
    .every(([, axis, max]) => (axis === 'width' ? width : height) <= Number(max)));
}

// Only the exact simple selectors listed per element below are matched. Cascade class counts and source order
// are real; there is deliberately no claim that this computes intrinsic text size, grid placement or touch hits.
function property(selectors, name, width, height) {
  let chosen, weight = -1;
  for (const layer of layers) layer.walkRules((rule) => {
    if (rule.parent.type === 'atrule' && rule.parent.name === 'media' && !mediaMatches(rule.parent.params, width, height)) return;
    for (const selector of rule.selector.split(',').map((s) => s.trim())) {
      if (!selectors.includes(selector)) continue;
      const specificity = (selector.match(/\.[\w-]+/g) || []).length;
      rule.walkDecls(name, (decl) => {
        if (specificity >= weight) { chosen = decl.value; weight = specificity; }
      });
    }
  });
  assert.notEqual(chosen, undefined, `${selectors.join(' / ')} ${name}`);
  return chosen;
}

test('room artwork frames grow to 1:2 and images fill them without side gutters across desktop and mobile CSS layers', () => {
  const selectors = ['.rseat__art img', '.room-screen .rseat__art img'];
  for (const [width, height] of [[1920, 1080], [844, 390], [560, 320], [390, 844]]) {
    const frame = ['.rseat__art', '.room-screen .rseat__art'];
    assert.equal(property(frame, 'aspect-ratio', width, height), '1 / 2');
    assert.equal(property(frame, 'flex', width, height), 'none', 'row space cannot flatten or stretch the portrait frame');
    assert.equal(property(frame, 'min-height', width, height), '0');
    assert.equal(property(frame, 'box-sizing', width, height), 'content-box', 'the image area keeps 1:2 inside its border');
    assert.equal(property(selectors, 'aspect-ratio', width, height), '1 / 2');
    assert.equal(property(selectors, 'width', width, height), '100%');
    assert.equal(property(selectors, 'height', width, height), '100%');
    assert.equal(property(selectors, 'max-width', width, height), '100%');
    assert.equal(property(selectors, 'object-fit', width, height), 'contain');
    assert.equal(property(selectors, 'object-position', width, height), 'center');
    assert.equal(property(selectors, 'inset', width, height), '0');
    assert.equal(property(selectors, 'transform', width, height), 'none');
    if (width > 560) assert.equal(property(['.seats', '.room-screen .seats'], 'grid-template-rows', width, height), 'auto', 'the row grows with the taller artwork and nameplate');
    assert.equal(property(['.seats', '.room-screen .seats'], 'overflow-y', width, height), 'auto');
  }
});

test('co-op utilities use three real icon-only square buttons and preserve action/accessible names', () => {
  const tools = RoomTools({ coop: true });
  assert.equal(tools.props.class, 'room-topbar__tools');
  const buttons = tools.props.children.filter((node) => node && typeof node === 'object');
  assert.equal(buttons.length, 3);
  const [stats, settings, guide] = buttons;
  assert.equal(stats.props.square, true);
  assert.equal(stats.props.icon, 'chart');
  assert.ok(!stats.props.children, 'there is no visible statistics text to hide with CSS');
  assert.equal(typeof stats.props.onClick, 'function');
  assert.ok(stats.props.title);
  assert.ok(stats.props['aria-label']);
  assert.equal(settings.type, SettingsButton);
  assert.equal(settings.props.square, true);
  assert.equal(guide.type, GuideButton);
  assert.equal(guide.props.square, true);
  assert.match(read('public/js/ui/settings.js'), /title=\$\{t\('设置'\)\} aria-label=\$\{t\('设置'\)\}/);
  assert.match(read('public/js/ui/guide.js'), /title=\$\{t\('玩法说明'\)\} aria-label=\$\{t\('玩法说明'\)\}/);
  assert.match(read('public/js/ui/settings.js'), /\$\{square \? null : label\}/, 'square mode removes text, not the nested gear SVG');
});

test('solo and co-op room utilities use the same icon-only order', () => {
  const buttons = RoomTools({ coop: false }).props.children.filter((node) => node && typeof node === 'object');
  assert.equal(buttons[0].props.square, true);
  assert.ok(!buttons[0].props.children);
  assert.equal(buttons[1].type, SettingsButton);
  assert.equal(buttons[1].props.square, true);
  assert.equal(buttons[2].type, GuideButton);
  assert.equal(buttons[2].props.square, true);
  assert.match(read('public/js/screens/room.js'), /<\$\{RoomTools\} coop=\$\{coop\}/);
});

for (const [width, height] of [[320, 568], [560, 320], [640, 360], [760, 390], [761, 390], [844, 390], [915, 412], [1000, 600], [1200, 500], [1920, 1080]]) {
  test(`room ${width}x${height}: intrinsic-width controls and invite keep the title in their grid row`, () => {
    const bar = ['.topbar', '.room-screen .topbar'];
    assert.equal(property(bar, 'height', width, height), 'auto');
    assert.equal(property(bar, 'min-height', width, height), 'calc(1.1 * var(--ui-unit))');
    assert.equal(property(bar, 'grid-template-columns', width, height), 'auto minmax(0, 1fr) auto');
    assert.equal(property(bar, 'grid-template-areas', width, height), '"controls title invite"');
    for (const [side, area] of [['left', 'controls'], ['center', 'title'], ['right', 'invite']])
      assert.equal(property(['.topbar__' + side, '.room-screen .topbar__' + side], 'grid-area', width, height), area);
    for (const selectors of [['.room-screen .topbar__left'], ['.room-screen .room-ping'], ['.room-screen .connection-status']])
      assert.equal(property(selectors, 'overflow', width, height), 'visible', 'connection and tools must not be clipped');
    assert.equal(property(['.room-bar', '.room-screen .room-bar'], 'height', width, height), 'auto');
  });
}

test('long translated titles may wrap inside their own column without moving the title to a new grid row', () => {
  assert.equal(property(['.topbar__title', '.room-screen .topbar__title'], 'white-space', 640, 360), 'normal');
  assert.equal(property(['.topbar__title', '.room-screen .topbar__title'], 'flex-wrap', 640, 360), 'wrap');
  assert.equal(property(['.topbar', '.room-screen .topbar'], 'grid-template-areas', 640, 360), '"controls title invite"');
});

test('invite character boxes follow their own text scale and keep complete glyphs', () => {
  assert.equal(property(['.invite__code span', '.room-screen .invite__code span'], 'width', 844, 390), '.85em');
  assert.equal(property(['.invite__code span', '.room-screen .invite__code span'], 'height', 844, 390), '1.2em');
});

test('short rooms keep a seat region and scroll; portrait rows grow with their actual 1:2 cards', () => {
  assert.equal(property(['.room-screen--coop'], 'overflow-y', 640, 270), 'auto');
  assert.equal(property(['.seats', '.room-screen .seats', '.room-screen--coop .seats'], 'min-height', 640, 270), 'calc(3.6 * var(--ui-unit))');
  assert.equal(property(['.seats', '.room-screen .seats', '.room-screen--coop .seats'], 'flex', 640, 270), '1 0 calc(3.6 * var(--ui-unit))');
  assert.equal(property(['.seats', '.room-screen .seats'], 'grid-template-rows', 390, 844), 'auto');
  assert.equal(property(['.seats', '.room-screen .seats'], 'grid-auto-rows', 390, 844), 'auto');
  assert.equal(property(['.room-screen .rseat__art'], 'aspect-ratio', 640, 360), '1 / 2');
});
