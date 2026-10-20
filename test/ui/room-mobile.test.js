import {designCss} from '../helpers/designCss.js';
// Component props and stylesheet cascade checks. Not a substitute for browser/phone layout verification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const read = (file) => designCss(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'));
const layers = ['public/css/components.css', 'public/css/screens/lobby.css', 'public/css/screens/room.css', 'public/css/utility-mobile.css']
  .map((file) => postcss.parse(read(file)));

function mediaMatches(params, width, height) {
  return params.split(',').some((part) => [...part.matchAll(/\((min|max)-(width|height):\s*(\d+)px\)/g)]
    .every(([, bound, axis, limit]) => bound === 'max' ? (axis === 'width' ? width : height) <= Number(limit) : (axis === 'width' ? width : height) >= Number(limit)));
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

test('room artwork preserves 1:2 while the seat container fits available height', () => {
  const selectors = ['.rseat__art img', '.room-screen .rseat__art img'];
  for (const [width, height] of [[1920, 1080], [844, 390], [560, 320], [390, 844]]) {
    const frame = ['.rseat__art', '.room-screen .rseat__art'];
    assert.equal(property(frame, 'aspect-ratio', width, height).replaceAll(' ', ''), '1/2');
    assert.equal(property(frame, 'flex', width, height), 'none', 'row space cannot flatten or stretch the portrait frame');
    assert.equal(property(frame, 'min-height', width, height), '0');
    assert.equal(property(frame, 'box-sizing', width, height), 'border-box', 'the entire artwork frame fits the available seat height');
    assert.equal(property(selectors, 'aspect-ratio', width, height), '1 / 2');
    assert.equal(property(selectors, 'width', width, height), '100%');
    assert.equal(property(selectors, 'height', width, height), '100%');
    assert.equal(property(selectors, 'max-width', width, height), '100%');
    assert.equal(property(selectors, 'object-fit', width, height), 'contain');
    assert.equal(property(selectors, 'object-position', width, height), 'center');
    assert.equal(property(selectors, 'inset', width, height), '0');
    assert.equal(property(selectors, 'transform', width, height), 'none');
    if (width > 560) assert.equal(property(['.seats', '.room-screen .seats'], 'grid-template-rows', width, height), 'auto', 'the row grows with the taller artwork and nameplate');
    assert.equal(property(['.seats', '.room-screen .seats'], 'overflow', width, height), 'visible');
  }
});

// Short landscape uses the same footer geometry on both sides of the former 760px breakpoint.
for(const [width,height] of [[640,360],[740,360],[760,390],[761,390],[844,390],[915,412]]) {
 test(`landscape room ${width}x${height}: two footer rows and a shrinking seat region`,()=>{
  assert.equal(property(['.room-bar'],'grid-template-areas',width,height),'"summary status" "tools actions"');
  assert.equal(property(['.room-bar'],'--room-action-height',width,height),'36px');
  assert.equal(property(['.seats','.room-screen .seats','.room-screen--coop .seats'],'min-height',width,height),'0');
  assert.equal(property(['.seats','.room-screen .seats','.room-screen--coop .seats'],'flex',width,height),'1 1 0');
 });
}
test('portrait fallback keeps its four-row footer and readable invitation glyphs',()=>{
 assert.equal(property(['.room-bar'],'grid-template-areas',390,844),'"summary" "status" "tools" "actions"');
 assert.equal(property(['.invite__code span','.room-screen .invite__code span'],'width',844,390),'max(32px,.46rem,.9em)');
 assert.equal(property(['.invite__code span','.room-screen .invite__code span'],'height',844,390),'max(40px,1.05em)');
});
test('room continues using shared navigation, bounded card fitting and isolated layers',()=>{
 const js=read('public/js/screens/room.js'),css=read('public/css/screens/room.css');
 assert.match(js, /<\$\{PageHeader\}/);
 assert.match(js, /const rows=Math.ceil\(cards.length\/columns\), rowHeight=/);
 assert.match(css, /\.room-screen > \.seats, \.room-screen > \.room-bar \{ isolation: isolate; \}/);
});
