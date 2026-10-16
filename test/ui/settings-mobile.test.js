// Static cascade/geometry contracts only. No browser layout, real touch or device verification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const layers = [
  'public/css/theme.css', 'public/css/components.css', 'public/css/screens/title.css',
  'public/css/screens/game.css', 'public/css/devices.css', 'public/css/utility-mobile.css',
].map((file) => postcss.parse(read(file)));
const mobile = layers.at(-1);
const dialogs = ':is(.utility-modal.settings-modal, .utility-modal.settings-shortcuts-modal)';
const controls = `${dialogs} :is(.btn, .set-seg button, .set-toggle, .set-native, .shortcut-key)`;

function splitSelectors(selector) {
  return selector.split(/,\s*(?![^()]*\))/).map((part) => part.trim().replace(/\s+/g, ' '));
}

// These styles use class/type selectors and :is()/ :where(). Compute their real specificity,
// not a class count across every :is() alternative (which would artificially promote a rule).
function specificity(selector) {
  let extra = 0;
  const plain = selector.replace(/:(is|where)\(([^()]*)\)/g, (_, kind, choices) => {
    if (kind === 'is') extra += Math.max(...splitSelectors(choices).map(specificity));
    return '';
  });
  return extra + (plain.match(/\.[\w-]+|:(?!:)[\w-]+/g) || []).length * 10
    + (plain.match(/(?:^|\s|>)\s*[a-z][\w-]*/g) || []).length;
}

function mediaMatches(params, width, height, coarse) {
  return params.split(',').some((part) => {
    if (/pointer:\s*coarse/.test(part) && !coarse) return false;
    // Unknown media conditions do not participate in these deliberately limited fixtures.
    if (part.replace(/\((?:max-(?:width|height):\s*\d+px|(?:any-)?pointer:\s*coarse)\)/g, '')
      .replace(/\band\b|\s/g, '')) return false;
    return [...part.matchAll(/\(max-(width|height):\s*(\d+)px\)/g)]
      .every(([, axis, limit]) => (axis === 'width' ? width : height) <= Number(limit));
  });
}

// Fixtures explicitly enumerate matching selector strings. This verifies cascade/source order,
// not DOM selector matching or intrinsic sizes, just like the room mobile contract tests.
function property(selectors, name, { width = 844, height = 390, coarse = true } = {}) {
  let result, weight = -1;
  for (const layer of layers) layer.walkRules((rule) => {
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule' && parent.name === 'media' && !mediaMatches(parent.params, width, height, coarse)) return;
    }
    for (const selector of splitSelectors(rule.selector)) {
      if (!selectors.includes(selector)) continue;
      rule.walkDecls(name, (decl) => {
        const current = specificity(selector);
        if (current >= weight) { result = decl.value; weight = current; }
      });
    }
  });
  assert.notEqual(result, undefined, `${selectors.join(' / ')}: ${name}`);
  return result;
}

function declaration(selector, prop) {
  let value;
  mobile.walkRules((rule) => {
    if (!splitSelectors(rule.selector).includes(selector)) return;
    rule.walkDecls(prop, (decl) => { value = decl.value; });
  });
  assert.notEqual(value, undefined, `${selector}: ${prop}`);
  return value;
}

test('the shortcut editor explicitly shares settings scaling without changing Modal lifecycle or bindings', () => {
  const source = read('public/js/ui/settings.js');
  assert.match(source, /title=\$\{t\('修改快捷键'\)\}[^\n]*utility=\$\{true\} class="settings-shortcuts-modal"/);
  assert.match(source, /shortcutsStore\.set\(\{ \[action\]: code \}\)/);
  assert.match(source, /if \(other\) \{ setError/);
  for (const dialog of ['settings-modal', 'settings-shortcuts-modal']) {
    assert.equal(property(['.utility-modal', dialogs], '--utility-text'), 'var(--t)', dialog);
    assert.equal(property(['.utility-modal .modal__head .micro', `${dialogs} .modal__head .micro`], 'font-size'),
      'calc(.1 * var(--t))', dialog);
  }
});

test('all mobile settings buttons beat generic utility and coarse-pointer sizing in the actual stylesheet cascade', () => {
  for (const viewport of [
    { width: 640, height: 360, coarse: true }, { width: 844, height: 390, coarse: true },
    { width: 1000, height: 700, coarse: false }, { width: 1280, height: 600, coarse: true },
  ]) {
    for (const base of ['.set-toggle', '.set-seg button', '.set-native', '.shortcut-key', '.btn', '.btn--sm']) {
      const matches = [base, '.set-toggle, .set-seg button',
        '.utility-modal :is(.btn, .set-toggle, .set-seg button, .shortcut-key)',
        ':is(.utility-modal.resource-modal, .utility-modal.settings-modal, .utility-modal.title-about) :is(.btn, .set-toggle, .set-seg button, .shortcut-key)',
        controls];
      assert.equal(property(matches, 'min-height', viewport), '.6rem', base);
      assert.equal(property(matches, 'height', viewport), 'auto', base);
      assert.equal(property(matches, 'font-size', viewport), 'calc(.16 * var(--t))', base);
    }
    assert.equal(property([
      '.set-seg button', '.set-row--fps .set-seg--fps button',
      '.settings-modal .set-row--fps .set-seg--fps button', controls,
    ], 'min-width', viewport), '0', 'FPS choices cannot retain the coarse 44px minimum');
  }
});

test('normal desktop settings dimensions remain outside the mobile overrides', () => {
  const viewport = { width: 1440, height: 900, coarse: false };
  assert.equal(property(['.set-toggle', controls], 'height', viewport), '.38rem');
  assert.equal(property(['.set-row__label .icon', '.settings-modal .set-row__label .icon'], 'width', viewport), '.2rem');
  assert.equal(property(['.shortcut-row', '.settings-shortcuts-modal .shortcut-row'], 'grid-template-columns', viewport), '1fr 1.25rem');
});

test('SVGs track their label or button and the close icon remains proportionate', () => {
  assert.equal(declaration('.settings-modal .set-row__label .icon', 'width'), '1.15em');
  assert.equal(declaration('.settings-modal .set-row__label .icon', 'height'), '1.15em');
  assert.equal(declaration(`${dialogs} .btn__icon`, 'width'), '1.15em');
  assert.equal(property(['.utility-modal :is(.btn--square, .utility-modal__close)', `${dialogs} .utility-modal__close`], 'height'), '.6rem');
  assert.equal(declaration(`${dialogs} .utility-modal__close .icon`, 'width'), '50%');
  for (const textRoot of [40, 64, 76, 88]) {
    const labelIcon = .18 * textRoot * 1.15;
    const buttonIcon = .16 * textRoot * 1.15;
    assert.ok(labelIcon > buttonIcon && labelIcon <= .6 * 40);
  }
});

test('switch and slider geometry scale uniformly at phone and tablet rem sizes', () => {
  const rem = (selector, prop) => {
    const value = declaration(selector, prop);
    assert.match(value, /^\d*\.?\d+rem$/);
    return Number.parseFloat(value);
  };
  const track = rem('.settings-modal .set-toggle i', 'width');
  const knob = rem('.settings-modal .set-toggle i::after', 'width');
  const inset = rem('.settings-modal .set-toggle i::after', 'left');
  const travel = Number.parseFloat(declaration('.settings-modal .set-toggle.is-on i::after', 'transform').slice(11));
  assert.ok(Math.abs(inset * 2 + knob + travel - track) < 1e-8, 'on/off inset stays symmetric');
  for (const root of [40, 48, 56]) {
    assert.ok((inset + travel + knob) * root < track * root);
    assert.equal(rem('.settings-modal .set-range', 'height') * root, .6 * root);
    for (const thumb of ['::-webkit-slider-thumb', '::-moz-range-thumb']) {
      assert.equal(rem(`.settings-modal .set-range${thumb}`, 'height') * root, .32 * root);
    }
  }
  assert.equal(declaration('.settings-modal .set-range', 'border-block'), '.24rem solid transparent');
  assert.equal(declaration('.settings-modal .set-range', 'box-sizing'), 'border-box');
});

test('voice/native/select and shortcut rows shrink or wrap instead of retaining mobile pixel widths', () => {
  assert.equal(declaration('.settings-modal .set-row > .btn', 'grid-column'), '2 / 4');
  assert.equal(declaration('.settings-modal .set-voice', 'min-width'), '0');
  assert.equal(declaration('.settings-modal .set-seg', 'min-width'), '0');
  assert.equal(declaration(controls, 'white-space'), 'normal');
  assert.equal(declaration('.settings-modal .lang-select select', 'min-width'), '0');
  assert.match(declaration('.settings-modal .lang-select select', 'font-size'), /16px/);
  assert.equal(property(['.utility-modal .shortcut-row', '.shortcut-row', '.settings-shortcuts-modal .shortcut-row'],
    'grid-template-columns'), 'minmax(0, 1fr) minmax(0, 2.25rem)');
  assert.equal(declaration('.settings-modal .set-keys__head', 'flex-wrap'), 'wrap');
  assert.equal(declaration('.utility-modal .modal__body', 'overflow-y'), 'auto');
});
