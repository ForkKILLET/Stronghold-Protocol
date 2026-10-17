// CSS cascade/height budgets only; not a browser or real-device layout test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { length } from '../helpers/css-values.js';

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const desktop = postcss.parse(read('public/css/screens/loadout.css'));
const mobile = postcss.parse(read('public/css/utility-mobile.css'));
const mobileQuery = '(max-width: 1000px), (max-height: 600px)';

function style(selector, phone = false) {
  const out = {};
  for (const sheet of phone ? [desktop, mobile] : [desktop]) {
    sheet.walkRules((rule) => {
      if (rule.selector !== selector) return;
      if (rule.parent.type === 'atrule' && (!phone || rule.parent.params !== mobileQuery)) return;
      rule.walkDecls((d) => { out[d.prop] = d.value; });
    });
  }
  return out;
}

test('skin cards override the legacy column flex sizing with compact auto-fit grid rows', () => {
  const grid = style('.lo-skins'), card = style('.lo-skin');
  assert.equal(grid.display, 'grid');
  assert.equal(grid['grid-template-columns'], 'repeat(auto-fit, minmax(min(100%, calc(1.8 * var(--ui-unit, 1rem))), 1fr))');
  assert.equal(length(grid.gap, { '--ui-unit': 100 }), 6);
  assert.equal(card.flex, 'none', 'the old 1.9rem flex basis must not become a vertical card height');
  assert.equal(card.width, 'auto', 'do not combine a full-width item with a wrapping row');
  assert.equal(card['min-width'], '0');
  assert.equal(card['max-width'], 'none');
  assert.match(card.padding, /--ui-unit/);
  assert.equal(length(card['min-height'], { '--ui-unit': 100 }), 44);
  assert.equal(card.height, undefined, 'larger user text can grow naturally instead of being clipped');
  for (const selector of ['.lo-skin__name', '.lo-skin__group']) {
    const text = style(selector);
    assert.equal(text['line-height'], '1.2');
    assert.match(text['font-size'], /var\(--utility-text, var\(--t\)\)/);
  }
});

test('skin art and minimum height scale with the local design unit instead of retaining phone pixel floors', () => {
  const art = style('.lo-skin__art'), card = style('.lo-skin');
  for (const unit of [30, 40, 71.1, 100]) {
    const vars = { '--ui-unit': unit };
    assert.ok(Math.abs(length(art.width, vars) - .32 * unit) < 1e-7);
    assert.equal(art.height, art.width);
    assert.ok(Math.abs(length(card['min-height'], vars) - .44 * unit) < 1e-7);
  }
  assert.match(style('.lo-skins', true)['grid-template-columns'], /minmax\(min\(100%, calc\(1\.5 \* var\(--ui-unit\)/);
});

test('compact picker keeps skin names, series, selection semantics and full-label tooltips', () => {
  const source = read('public/js/ui/skinPicker.js');
  assert.match(source, /title=\$\{\[x\.name, x\.group\]\.filter\(Boolean\)\.join\(' · '\)\}/);
  assert.match(source, /class="lo-skin__name">\$\{x\.name\}/);
  assert.match(source, /class="lo-skin__group">\$\{x\.group\}/);
  assert.match(source, /role="radiogroup"/);
  assert.match(source, /role="radio" aria-checked/);
  assert.match(source, /onClick=\$\{\(\) => setSkin\(chessId, x\.id\)\}/);
  assert.match(source, /onClick=\$\{\(\) => clearSkin\(chessId\)\}/);
});
