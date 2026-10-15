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
  return params.split(',').some((part) => [...part.matchAll(/\(max-(width|height):\s*(\d+)px\)/g)]
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

for (const [width, height] of [[320, 568], [390, 844], [560, 320], [640, 360], [760, 390], [761, 390], [844, 390], [915, 412], [1000, 600], [1200, 500]]) {
  test(`room ${width}x${height}: named title/control/invite areas override shared grid rules and fixed heights`, () => {
    const bar = ['.topbar', '.room-screen .topbar'];
    const center = ['.topbar__center', '.room-screen .topbar__center'];
    const left = ['.topbar__left', '.room-screen .topbar__left'];
    const right = ['.topbar__right', '.room-screen .topbar__right'];
    assert.equal(property(bar, 'height', width, height), 'auto');
    assert.equal(property(bar, 'min-height', width, height), '0');
    assert.equal(property(center, 'grid-area', width, height), 'title');
    assert.equal(property(left, 'grid-area', width, height), 'controls');
    assert.equal(property(left, 'flex-wrap', width, height), 'nowrap');
    assert.equal(property(['.room-ping', '.room-screen .room-ping'], 'flex', width, height), '1 1 auto');
    assert.equal(property(['.connection-status', '.room-screen .connection-status'], 'flex-wrap', width, height), 'nowrap');
    assert.equal(property(right, 'grid-area', width, height), 'invite');
    assert.equal(property(right, 'max-width', width, height), '100%', 'invite stays within its grid track');
    assert.equal(property(bar, 'grid-template-areas', width, height), '"controls title invite"');
    assert.equal(property(bar, 'grid-template-columns', width, height),
      width <= 560 ? 'minmax(0, .85fr) minmax(0, 1.3fr) minmax(0, .85fr)' : 'minmax(0, 1fr) minmax(0, 1.15fr) minmax(0, 1fr)');
    assert.equal(property(['.topbar__title', '.room-screen .topbar__title'], 'white-space', width, height), 'nowrap');
    assert.equal(property(['.topbar__title', '.room-screen .topbar__title'], 'flex-wrap', width, height), 'nowrap');
    assert.equal(property(['.room-bar', '.room-screen .room-bar'], 'height', width, height), 'auto',
      'footer contents may grow without spilling over the seats');
    assert.equal(property(['.room-bar', '.room-screen .room-bar'], 'grid-template-areas', width, height),
      width <= 560 ? '"options" "status" "actions"' : '"options actions" "status actions"');
    const buttons = ['.btn--square.btn--sm', '.room-screen--coop .room-topbar__tools .btn--square', '.room-screen .room-topbar__tools .btn--square'];
  assert.equal(property(buttons, 'width', width, height), '.75rem');
  });
}

test('normal desktop room chrome retains its existing three-column layout and height', () => {
  assert.equal(property(['.topbar', '.room-screen .topbar'], 'height', 1920, 1080), '1.36rem');
  assert.equal(property(['.topbar', '.room-screen .topbar'], 'grid-template-columns', 1920, 1080),
    'minmax(0, 1fr) auto minmax(0, 1fr)');
  assert.equal(property(['.room-bar', '.room-screen .room-bar'], 'height', 1920, 1080), '1.5rem');
});

test('the room title remains on the same row as controls and invitation at phone widths', () => {
  for (const width of [320, 360, 390, 560, 640, 844]) {
    assert.equal(property(['.topbar', '.room-screen .topbar'], 'grid-template-areas', width, 390), '"controls title invite"');
    assert.equal(property(['.topbar__title', '.room-screen .topbar__title'], 'white-space', width, 390), 'nowrap');
  }
});

test('invite code boxes scale with their own glyphs instead of a tiny rem box plus enlarged text', () => {
  const selector = ['.invite__code span', '.room-screen .invite__code span'];
  assert.equal(property(selector, 'width', 844, 390), '.72em');
  assert.equal(property(selector, 'height', 844, 390), '1em');
  assert.equal(property(selector, 'flex', 844, 390), 'none');
  assert.equal(property(['.topbar__title', '.room-screen .topbar__title'], 'font-size', 844, 390),
    'calc(.16 * var(--utility-text, var(--t)))');
});

test('short rooms retain a visible seat region and scrolling; portrait seats cannot overrun a smaller explicit first row', () => {
  assert.equal(property(['.room-screen--coop'], 'overflow-y', 640, 270), 'auto');
  assert.equal(property(['.seats', '.room-screen .seats', '.room-screen--coop .seats'], 'min-height', 640, 270), '3.6rem');
  assert.equal(property(['.seats', '.room-screen .seats', '.room-screen--coop .seats'], 'flex', 640, 270), '1 0 3.6rem');
  assert.equal(property(['.seats', '.room-screen .seats', '.room-screen--coop .seats'], 'grid-template-rows', 390, 844), 'none');
  assert.equal(property(['.seats', '.room-screen .seats', '.room-screen--coop .seats'], 'grid-auto-rows', 390, 844), 'minmax(3.5rem, auto)');
  assert.equal(property(['.seat', '.room-screen .seat'], 'min-height', 390, 844), '3.5rem');
  assert.equal(property(['.seat__foot .tt-anchor', '.room-screen--coop .seat__foot .tt-anchor'], 'position', 640, 360), 'static');
});
