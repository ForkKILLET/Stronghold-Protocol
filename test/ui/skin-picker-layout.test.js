// CSS cascade/height budgets only; not a browser or real-device layout test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

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
  assert.equal(grid['grid-template-columns'], 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))');
  assert.equal(grid.gap, '6px');
  assert.equal(card.flex, 'none', 'the old 1.9rem flex basis must not become a vertical card height');
  assert.equal(card.width, 'auto', 'do not combine a full-width item with a wrapping row');
  assert.equal(card['min-width'], '0');
  assert.equal(card['max-width'], 'none');
  assert.equal(card.padding, '4px 8px 4px 4px');
  assert.equal(card['min-height'], '44px');
  assert.equal(card.height, undefined, 'larger user text can grow naturally instead of being clipped');
  for (const selector of ['.lo-skin__name', '.lo-skin__group']) {
    const text = style(selector);
    assert.equal(text['line-height'], '1.2');
    assert.match(text['font-size'], /var\(--utility-text, var\(--t\)\)/);
  }
});

test('desktop normal-text cards stay near 44px and phone cards keep 44px real touch targets', () => {
  const art = style('.lo-skin__art');
  assert.equal(art.width, 'max(.32rem, 28px)');
  assert.equal(art.height, art.width);
  // Border-box geometry: the image/text maximum plus top/bottom padding and the card border.
  for (const rem of [40, 71.1, 100]) {
    const image = Math.max(.32 * rem, 28);
    const text = (.16 + .12) * rem * 1.2 + Math.max(.02 * rem, 1);
    const height = Math.max(44, Math.max(image, text) + 8 + 2);
    assert.ok(height <= 46, `${rem}px design rem: ${height}px card`);
  }
  const card = style('.lo-skin', true), phoneArt = style('.lo-skin__art', true);
  assert.equal(card.flex, 'none');
  assert.equal(card['min-height'], '44px');
  assert.equal(card.padding, '4px');
  assert.equal(phoneArt.width, '32px');
  assert.equal(phoneArt.height, '32px');
  assert.equal(style('.lo-skins', true)['grid-template-columns'], 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))');
  assert.equal(Math.max(44, 32 + 4 * 2 + 2), 44);
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
