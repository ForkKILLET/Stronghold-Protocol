// Static cascade/geometry contracts only. No browser layout, real touch or device verification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { length } from '../helpers/css-values.js';

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const layers = [
  'public/css/theme.css', 'public/css/components.css', 'public/css/screens/title.css',
  'public/css/screens/game.css', 'public/css/devices.css', 'public/css/utility-mobile.css',
].map((file) => postcss.parse(read(file)));
const mobile = layers.at(-1);

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

test('settings and shortcut editor share local units, focus stack and saved bindings', () => {
  const source = read('public/js/ui/settings.js');
  assert.match(source, /utility=\$\{true\} class="settings-shortcuts-modal"/);
  assert.match(source, /shortcutsStore\.set\(\{ \[action\]: code \}\)/);
  assert.match(source, /if \(other\) \{ setError/);
  assert.equal(declaration(':is(.title-screen, .lobby-screen, .room-screen, .protocol-screen, .sweep-host, .lo, .st, .ach, .modal--utility, .guide, .studio)', '--utility-text'),
    'calc(var(--t) * var(--sp-ui-scale, 1))');
});

test('control sizes are design units across phone, touch tablet and desktop, without coarse pixel inflation', () => {
  const scope = '.utility-modal :is(.set-toggle, .set-seg button, .set-native, .shortcut-key)';
  for (const viewport of [{ width: 640, height: 360, coarse: true }, { width: 844, height: 390, coarse: true },
    { width: 1280, height: 600, coarse: true }, { width: 1440, height: 900, coarse: false }]) {
    for (const base of ['.set-toggle', '.set-seg button', '.set-native', '.shortcut-key']) {
      assert.equal(property([base, scope], 'min-height', viewport), 'calc(.38 * var(--ui-unit))');
      assert.equal(property([base, '.utility-modal :is(.btn, .set-toggle, .set-seg button, .set-native, .shortcut-key)'], 'height', viewport), 'auto');
    }
  }
  assert.equal(property(['.set-toggle'], 'height', { width: 1440, height: 900, coarse: false }), 'calc(0.38 * var(--ui-unit, 1rem))',
    'outside management the fallback is exactly the original layout rem');
  assert.equal(declaration('.settings-modal .set-seg--fps button', 'min-width'), '0');
});

test('label and action SVGs track text while the close SVG stays half its button', () => {
  for (const selector of ['.settings-modal .set-row__label .icon', '.utility-modal .btn__icon']) {
    assert.equal(declaration(selector, 'width'), '1.15em');
    assert.equal(declaration(selector, 'height'), '1.15em');
  }
  assert.equal(declaration('.utility-modal__close .icon', 'width'), '50%');
  assert.equal(declaration('.utility-modal__close .icon', 'height'), '50%');
});

test('switch tracks, knobs and travel share the same layout unit rather than text scaling', () => {
  const source = read('public/css/screens/game.css');
  assert.match(source, /\.set-toggle i \{ width: calc\(0\.46 \* var\(--ui-unit, 1rem\)\); height: calc\(0\.24 \* var\(--ui-unit, 1rem\)\)/);
  assert.match(source, /translateX\(calc\(0\.22 \* var\(--ui-unit, 1rem\)\)\)/);
  assert.equal(declaration('.utility-modal .set-range', 'height'), 'calc(.5 * var(--ui-unit))');
  assert.equal(declaration('.utility-modal .set-range', 'border-block'), 'calc(.2 * var(--ui-unit)) solid transparent');
  for (const root of [30, 40, 71.1, 100]) assert.ok(Math.abs((.03 + .18 + .22 + .03) * root - .46 * root) < 1e-8);
});

test('voice, native selects and shortcuts wrap inside the requested width, with readable native input', () => {
  assert.equal(declaration('.settings-modal .set-row > .btn', 'grid-column'), '2 / 4');
  assert.equal(declaration('.settings-modal .set-seg', 'min-width'), '0');
  assert.equal(declaration('.settings-modal .set-voice', 'min-width'), '0');
  assert.equal(declaration('.utility-modal :is(.btn, .set-toggle, .set-seg button, .set-native, .shortcut-key)', 'white-space'), 'normal');
  assert.match(read('public/css/utility-mobile.css'), /font-size: max\(calc\(\.16 \* var\(--utility-text\)\), 16px\)/);
});

test('settings action buttons beat the generic utility minimum and retain compact font/padding', () => {
  const selector = ':is(.settings-modal, .settings-shortcuts-modal) .btn';
  for (const viewport of [{ width: 640, height: 360, coarse: true }, { width: 844, height: 390, coarse: true },
    { width: 1440, height: 900, coarse: false }]) {
    for (const base of ['.btn', '.btn--sm']) {
      const matches = ['.btn', base, '.utility-modal .btn', selector];
      assert.equal(property(matches, 'min-height', viewport), 'calc(.36 * var(--ui-unit))');
      assert.equal(property(matches, 'font-size', viewport), 'calc(.15 * var(--utility-text))');
      assert.equal(property(matches, 'padding', viewport), 'calc(.04 * var(--ui-unit)) calc(.12 * var(--ui-unit))');
    }
  }
  const unit = 390 / 10.8;
  assert.equal(length(declaration(selector, 'min-height'), { '--ui-unit': unit }), .36 * unit);
  assert.ok(length(declaration(selector, 'font-size'), { '--utility-text': unit }) < 8);
});

test('settings language dropdown follows the saved text scale without opting out of native input guards', () => {
  const picker = '.settings-modal .set-lang-picker :is(.set-lang__trigger, .set-lang__option)';
  assert.equal(declaration(picker, 'font-size'), 'calc(.16 * var(--utility-text))');
  assert.equal(declaration(picker, 'min-height'), 'calc(.36 * var(--ui-unit))');
  assert.match(read('public/js/ui/settings.js'), /<\$\{LangToggle\} class="set-lang" compact=\$\{true\}/);
  assert.match(read('public/js/ui/lang.js'), /if \(compact\) return html`<\$\{LanguageMenu\}/);
  assert.match(read('public/css/utility-mobile.css'), /font-size: max\(calc\(\.16 \* var\(--utility-text\)\), 16px\)/);
});
