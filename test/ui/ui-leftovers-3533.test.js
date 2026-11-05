// Migration: Mainline pixel/rem layout contracts are superseded by the fork management units, PageHeader and room-options layout, checked by mobile-management in both browsers.
// test/ui/ui-leftovers-3533.test.js — the §35.18 UI leftovers fixed in 0.3.2 (DESIGN §35.51), pinned in the stylesheets
// and the markup; the browser checks are test/ui/room-fit.e2e.test.js and lobby-hub.e2e.test.js (text-fit) and the
// measurements in §35.51.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const block = (text, head) => {
  const i = text.indexOf(head);
  assert.ok(i >= 0, head);
  let depth = 0;
  for (let j = text.indexOf('{', i); j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}' && --depth === 0) return text.slice(i, j + 1);
  }
  return text.slice(i);
};







test('text-fit: ellipsis exceptions stay scoped; only player names may break inside a word', () => {
  const src = readFileSync(path.join(ROOT, 'test/e2e/text-fit.mjs'), 'utf8');
  assert.match(src, /webkitLineClamp/);
  // §35.23.12: callers may allow the compact version pill while checking its accessible name and bounds.
  assert.ok(src.includes("export function textProblems(rootSel, extraEllipsis = '')"));
  assert.ok(src.includes("if (!cut.matches(`.seat__name, .specbar__who, .room-mode${extraEllipsis ? `, ${extraEllipsis}` : ''}`)) out.push(`ellipsis ${label}`);"));
  assert.match(src, /!breakOk\(p, c\) && !el\.closest\('\.seat__name'\)/);
});





test('the draft\'s name cards fall back to the default picture when an outfit\'s fails, as the seat cards do', () => {
  const js = readFileSync(path.join(ROOT, 'public/js/screens/bandDraft.js'), 'utf8');
  assert.match(js, /const art = seatArtSrc\(arts, badArt\);/);
  assert.match(css('public/css/screens/draft.css'), /\.dorder__art \{[^}]*object-fit: cover; object-position: 50% 16%;/);
});
