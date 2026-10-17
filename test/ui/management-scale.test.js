import { test } from 'node:test';
import assert from 'node:assert/strict';
import { managementScale, managementLength, updateManagementViewport } from '../../public/js/ui/managementScale.js';
import { sheet, declaration, read, length } from '../helpers/css-values.js';

test('management canvas fits safe areas below the battlefield rem floor and does not enlarge desktop', () => {
  for (const [width, height] of [[1920, 1080], [1440, 900], [1001, 700], [1000, 700], [844, 390], [640, 360], [560, 320], [390, 844]]) {
    for (const [left, right, top, bottom] of [[0, 0, 0, 0], [32, 12, 8, 10]]) {
      const rem = Math.max(40, Math.min(240, width / 19.2, height / 10.8));
      const { unit, factor } = managementScale({ width, height, rem, left, right, top, bottom });
      assert.ok(unit <= rem && factor <= 1);
      assert.ok(19.2 * unit <= width - left - right + .00001);
      assert.ok(10.8 * unit <= height - top - bottom + .00001);
      if (width === 640 && !left) assert.ok(unit < 40);
      if (width === 1920 && !left) assert.equal(factor, 1);
    }
  }
});

test('requested modal widths and page geometry are continuous across the old mobile breakpoint', () => {
  const widths = [1001, 1000].map(width => {
    const rem = width / 19.2, { unit } = managementScale({ width, height: 700, rem });
    return length(managementLength('7.4rem'), { '--ui-unit': unit });
  });
  assert.ok(Math.abs(widths[1] - widths[0]) < 1);
  assert.equal(managementLength('min(9.6rem, calc(100vw - .4rem))'),
    'min(calc(9.6 * var(--ui-unit, 1rem)), calc(100vw - calc(.4 * var(--ui-unit, 1rem))))');
  assert.equal(managementLength('94vw'), '94vw');
});

test('keyboard shrink/pan changes visible bounds while leaving management layout and text scale stable', () => {
  const props = new Map();
  const win = { innerWidth: 844, innerHeight: 390, visualViewport: { width: 844, height: 390, offsetTop: 0, offsetLeft: 0 },
    document: { documentElement: { style: { setProperty: (key, value) => props.set(key, value) } } },
    getComputedStyle: () => ({ fontSize: '40px', getPropertyValue: key => key === '--sa-l' ? '24px' : '0px' }) };
  updateManagementViewport(win);
  const unit = props.get('--sp-ui-unit'), factor = props.get('--sp-ui-scale');
  win.visualViewport.height = 210; win.visualViewport.offsetTop = 90;
  updateManagementViewport(win);
  assert.equal(props.get('--sp-ui-unit'), unit);
  assert.equal(props.get('--sp-ui-scale'), factor);
  assert.equal(props.get('--sp-vtop'), '90px');
  assert.ok(!props.has('font-size') && !props.has('--t'));
  assert.match(read('public/js/ui/device.js'), /on\(win\.visualViewport, 'scroll', setVh/);
});

test('protocol and report own safe areas once; the final outer viewport overrides shared screen insets', () => {
  const css = sheet('public/css/utility-mobile.css');
  const selector = '.screen:is(.protocol-screen, .sweep-host)';
  assert.equal(declaration(css, selector, 'top'), 'var(--sp-vtop, 0px)');
  assert.equal(declaration(css, selector, 'left'), 'var(--sp-vleft, 0px)');
  assert.equal(declaration(css, selector, 'right'), '0');
  assert.equal(declaration(css, selector, 'bottom'), 'auto');
  assert.equal(length(declaration(css, selector, 'height'), { '--sp-vh': 2.1 }), 210);
  assert.match(declaration(sheet('public/css/screens/lobby.css'), '.proto', 'padding'), /--sa-t/);
  assert.match(declaration(sheet('public/css/screens/lobby.css'), '.sw', 'padding'), /--sa-t/);
});

test('global layout/text roots and in-battle CSS retain their original ownership', () => {
  const css = sheet('public/css/utility-mobile.css');
  css.walkDecls('--ui-unit', d => assert.doesNotMatch(d.parent.selector, /\.gm\b|\.shopbar|\.combat-metrics/));
  css.walkDecls('--t', () => assert.fail('only theme.css owns --t'));
  assert.match(read('public/css/theme.css'), /font-size: clamp\(40px/);
  for (const file of ['public/js/ui/fieldHost.js', 'public/js/ui/underframe.js', 'public/js/ui/gameLogic/panel.js'])
    assert.doesNotMatch(read(file), /--ui-unit|--sp-ui/);
});
