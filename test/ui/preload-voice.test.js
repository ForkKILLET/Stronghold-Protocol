import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeSettings } from '../../public/js/ui/gameLogic/settings.js';
import { normalizePreloadVoiceLang, resourceGroup, resourceSelection, selectedResourceGroup } from '../../public/js/resources/common.js';
import { percent, byteText, detailText } from '../../public/js/ui/resourcePanel.js';

test('persisted voice preload defaults/migration stay independent of playback and operator overrides', () => {
  assert.deepEqual(sanitizeSettings(null).preloadVoiceLang, ['cn']);
  for (const lang of ['cn', 'jp', 'en', 'kr']) {
    assert.deepEqual(sanitizeSettings({ voiceLang: lang }).preloadVoiceLang, [lang], 'old preferences use the existing playback dub once');
  }
  for (const [lang, expected] of [['cn', ['cn']], ['jp', ['jp']], ['en', ['en']], ['kr', ['kr']],
    ['all', ['cn', 'jp']], ['none', []], [[], []], [['kr', 'en', 'cn', 'en', 'invalid'], ['cn', 'en', 'kr']]]) {
    const settings = sanitizeSettings({ preloadVoiceLang: lang, voiceLang: 'cn', voiceOverrides: { char_102_texas: 'jp' } });
    assert.deepEqual(settings.preloadVoiceLang, expected); assert.equal(settings.voiceLang, 'cn');
    assert.deepEqual(settings.voiceOverrides, { char_102_texas: 'jp' });
    assert.deepEqual(sanitizeSettings(JSON.parse(JSON.stringify(settings))).preloadVoiceLang, expected);
  }
  for (const invalid of ['ja', 'JP', '', null, {}, 1]) assert.deepEqual(normalizePreloadVoiceLang(invalid), ['cn']);
});

test('voice grouping handles CDN prefixes and JP files named cn; unknown voices remain explicit shared group', () => {
  for (const prefix of ['', 'https://cdn.example/prefix']) {
    assert.equal(resourceGroup({ url: prefix + '/assets/audio/voice/jp/char_test/cn_019.mp3', tier: 2 }), 'voice_jp');
    assert.equal(resourceGroup({ url: prefix + '/assets/audio/voice/cn/char_test/cn_019.mp3', tier: 2 }), 'voice_cn');
    for (const lang of ['en', 'kr']) assert.equal(resourceGroup({ url: `${prefix}/assets/audio/voice/${lang}/char_test/cn_019.mp3`, tier: 2 }), `voice_${lang}`);
    assert.equal(resourceGroup({ url: prefix + '/assets/audio/voice/legacy/cn_019.mp3', tier: 2 }), 'voice');
  }
  assert.equal(selectedResourceGroup('voice_jp', true, 'cn'), false);
  assert.equal(selectedResourceGroup('voice_cn', true, 'jp'), false);
  assert.equal(selectedResourceGroup('voice', true, 'none'), false);
  assert.equal(selectedResourceGroup('sfx', true, 'none'), true);
  assert.equal(selectedResourceGroup('music', false, 'all'), false);
  assert.equal(selectedResourceGroup('map', false, 'none'), true);
  for (let mask = 0; mask < 16; mask++) {
    const languages = ['cn', 'jp', 'en', 'kr'];
    const selected = languages.filter((_, i) => mask & (1 << i));
    for (const lang of languages) {
      assert.equal(selectedResourceGroup(`voice_${lang}`, true, selected), selected.includes(lang));
      assert.equal(selectedResourceGroup(`voice_${lang}`, false, selected), false);
    }
    assert.equal(selectedResourceGroup('voice', true, selected), selected.length > 0);
  }
});

test('official battle effects form an optional group without moving board FX out of essentials', () => {
  for (const prefix of ['', 'https://cdn.example/prefix']) {
    for (const file of ['index.json', 'textures.json', 'prefabs/skill.json', 'mesh/unit.json', 'tex/half/a.webp']) {
      assert.equal(resourceGroup({ url: `${prefix}/assets/local/fx/${file}`, tier: 2 }), 'fx');
    }
    assert.equal(resourceGroup({ url: `${prefix}/assets/local/map/fx/materials.json`, tier: 1 }), 'map');
  }
  assert.equal(selectedResourceGroup('fx', false, []), false);
  assert.equal(selectedResourceGroup('fx', false, [], true), false, 'skin preload does not select effects');
  assert.equal(selectedResourceGroup('fx', true, []), true, 'effects do not depend on voice selection');
});

test('selected completion/percentage excludes unselected cache bytes, handles unknown sizes and skipped files', () => {
  const groups = [
    { id: 'ui', wanted: 1, present: 1, bytes: 4, totalBytes: 4, unknownSize: 0 },
    { id: 'voice_cn', wanted: 1, present: 1, bytes: 3, totalBytes: 3, unknownSize: 0 },
    { id: 'voice_jp', wanted: 2, present: 1, bytes: 100, totalBytes: 500, unknownSize: 0 },
  ];
  const cn = resourceSelection({ groups }, true, 'cn'); assert.equal(cn.selectionComplete, true);
  assert.equal(percent(cn), 100); assert.equal(byteText(cn), '7 B / 7 B'); assert.match(detailText(cn), /2\/2/);
  const jp = resourceSelection({ groups }, true, 'jp'); assert.equal(jp.selectionComplete, false); assert.equal(jp.selectedMissing, 1);
  assert.ok(percent(jp) < 100); assert.equal(groups[1].selected, undefined, 'input snapshots are not mutated');
  const unknown = resourceSelection({ groups: [{ ...groups[2], unknownSize: 1 }] }, true, 'jp');
  assert.equal(percent(unknown), 50);
  const skipped = resourceSelection({ groups: [{ ...groups[1], total: 1, wanted: 0, present: 0, bytes: 0, totalBytes: 0 }] }, true, 'cn');
  assert.equal(skipped.selectionComplete, true, 'oversized files are not required for completion');
});

test('voice preload choice saves and reloads browser preferences without changing playback language', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'); const prefs = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => prefs.get(key) ?? null, setItem: (key, value) => prefs.set(key, value),
  } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage; });
  const { updateSettings, settingsStore } = await import('../../public/js/ui/settings.js?voice-preload-persistence');
  updateSettings({ voiceLang: 'cn', preloadOptional: true, preloadVoiceLang: ['en', 'kr'] });
  const saved = JSON.parse(prefs.get('sp.pref.settings')); assert.deepEqual(saved.preloadVoiceLang, ['en', 'kr']); assert.equal(saved.voiceLang, 'cn');
  const reloaded = await import('../../public/js/ui/settings.js?voice-preload-reload');
  assert.deepEqual(reloaded.settingsStore.get().preloadVoiceLang, ['en', 'kr']);
  updateSettings({ voiceLang: 'jp' }); assert.deepEqual(settingsStore.get().preloadVoiceLang, ['en', 'kr']);
  updateSettings({ preloadVoiceLang: 'cn' }); assert.equal(settingsStore.get().voiceLang, 'jp');
  updateSettings({ preloadVoiceLang: [] });
  assert.deepEqual(JSON.parse(prefs.get('sp.pref.settings')).preloadVoiceLang, [], 'unchecking every language persists');
});

test('manager binds persisted choices, disables changes during ZIP and retains touch-safe wrapped controls', () => {
  const source = readFileSync(new URL('../../public/js/ui/resourcePanel.js', import.meta.url), 'utf8');
  assert.match(source, /data-testid="preload-voice-lang"/); assert.match(source, /name="preload-voice-lang"/);
  assert.match(source, /type="checkbox" name="preload-voice-lang"/);
  assert.match(source, /checked=\$\{selected.includes\(lang\)\}/);
  assert.match(source, /selected.filter\(\(id\) => id !== lang\)/);
  assert.doesNotMatch(source, /type="radio"|role="radiogroup"/);
  assert.match(source, /fieldset class="resource-voice-choice" disabled=\$\{disabled\}/);
  const css = readFileSync(new URL('../../public/css/components.css', import.meta.url), 'utf8');
  assert.match(css, /resource-voice-choice__options[^}]+flex-wrap: wrap/);
  assert.match(css, /resource-voice-choice \.resource-choice[^}]+min-height: 44px/);
  const main = readFileSync(new URL('../../public/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /updateSettings\(\{ preloadVoiceLang \}\)/);
  assert.match(main, /syncResources\(!!s.preload, !!s.preloadOptional, s.preloadVoiceLang, !!s.preloadSkins\)/);
});
