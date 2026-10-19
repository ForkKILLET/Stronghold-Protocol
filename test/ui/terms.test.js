import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extractTerms } from '../../tools/build-terms.mjs';
import { parseRichText } from '../../public/js/ui/richText.js';
import { termHelpPosition } from '../../public/js/ui/termHelp.js';
import { applyFileOverlay } from '../../shared/i18nData.js';
const dir = new URL('../../data/', import.meta.url);
const load = name => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
const terms = load('terms.json');
test('the generated glossary resolves every game term and every related term by id', () => {
  const ids = new Set();
  for (const name of readdirSync(dir).filter(n => n.endsWith('.json'))) {
    const text = readFileSync(new URL(name, dir), 'utf8');
    for (const m of text.matchAll(/<\$([\w.-]+)>/g)) ids.add(m[1]);
  }
  assert.ok(ids.size >= 54);
  for (const id of ids) assert.ok(terms[id]?.name && terms[id]?.descRaw, id);
  assert.equal(parseRichText(terms['ba.cold'].descRaw).find(s => s.term).termId, 'ba.frozen');
  assert.equal(parseRichText(terms['ba.frozen'].descRaw).find(s => s.term).termId, 'ba.cold');
});
test('official locale overlays apply without stale fields and retain readable Chinese fallbacks', () => {
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const overlay = load(`i18n/${lang}.json`).files.terms;
    const result = applyFileOverlay(terms, overlay);
    assert.equal(result.stale, 0); assert.ok(result.applied >= 200);
    assert.notEqual(result.value['ba.cold'].descRaw, terms['ba.cold'].descRaw, lang);
    assert.equal(result.value['ba.cold'].id, 'ba.cold');
    for (const id of Object.keys(terms)) assert.ok(result.value[id]?.descRaw);
  }
});
test('extractor validates stable ids and copies only display fields', () => {
  assert.deepEqual(extractTerms({ termDescriptionDict: { 'ba.cold': { termId: 'ba.cold', termName: '寒冷', description: '说明', unused: true } } }),
    { 'ba.cold': { id: 'ba.cold', name: '寒冷', descRaw: '说明' } });
  assert.throws(() => extractTerms({}), /Missing/);
  assert.throws(() => extractTerms({ termDescriptionDict: { bad: { termId: 'other' } } }), /Invalid/);
});
test('term card flips above a low anchor and remains inside narrow/short viewports', () => {
  const box = { width: 296, height: 200 };
  for (const viewport of [{ width: 320, height: 720 }, { width: 844, height: 390 }]) {
    for (const left of [0, viewport.width - 16]) {
      const anchor = { left, width: 16, top: viewport.height - 20, bottom: viewport.height - 4 };
      const p = termHelpPosition(anchor, box, viewport);
      assert.ok(p.left >= 12 && p.left + box.width <= viewport.width - 12);
      assert.ok(p.top >= 12 && p.top + box.height < anchor.top);
    }
  }
});
