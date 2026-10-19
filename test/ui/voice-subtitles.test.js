import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AudioManager, VoiceGate } from '../../public/js/audio.js';
import { sanitizeSettings } from '../../public/js/ui/gameLogic/settings.js';
import { voiceCaptionIdentity, selectVoiceCaptions, voiceCaptionPosition, voiceCaptionHudPosition } from '../../public/js/voiceCaptions.js';
import { extractVoiceCaptions } from '../../tools/build-voice-captions.mjs';

test('subtitle preferences default off/UI and reject invalid persisted values', () => {
  assert.equal(sanitizeSettings(null).voiceSubtitles, false);
  assert.equal(sanitizeSettings(null).voiceSubtitleMode, 'ui');
  assert.equal(sanitizeSettings({ voiceSubtitles: 'yes', voiceSubtitleMode: 'anything' }).voiceSubtitles, false);
  assert.equal(sanitizeSettings({ voiceSubtitleMode: 'anything' }).voiceSubtitleMode, 'ui');
  for (const mode of ['ui', 'dual', 'voice']) assert.equal(sanitizeSettings({ voiceSubtitles: true, voiceSubtitleMode: mode }).voiceSubtitleMode, mode);
});

test('caption identity uses the spoken file directory and full word key, independent of UI or requested dub', () => {
  assert.deepEqual(voiceCaptionIdentity('https://cdn.example/prefix/assets/audio/voice/jp/char_002_amiya/cn_025.mp3?v=1'), { key: 'char_002_amiya/cn_025', lang: 'ja' });
  assert.deepEqual(voiceCaptionIdentity('/assets/audio/voice/cn/char_002_amiya/cn_025.mp3'), { key: 'char_002_amiya/cn_025', lang: 'zh' });
  assert.deepEqual(voiceCaptionIdentity('/assets/audio/voice/native/char_102_texas_ita/cn_025.mp3', 'ITA'), { key: 'char_102_texas_ita/cn_025', lang: 'it' });
  assert.equal(voiceCaptionIdentity('/plugins/custom/voice.mp3'), null);
});

test('subtitle modes deduplicate matching languages/text, and never invent missing original text', () => {
  const input = { uiLang: 'zh', voiceLang: 'ja', uiText: '界面译文', voiceText: '音声の原文' };
  assert.deepEqual(selectVoiceCaptions({ ...input, mode: 'ui' }), [{ lang: 'zh', text: input.uiText }]);
  assert.deepEqual(selectVoiceCaptions({ ...input, mode: 'voice' }), [{ lang: 'ja', text: input.voiceText }]);
  assert.deepEqual(selectVoiceCaptions({ ...input, mode: 'dual' }).map(l => l.lang), ['ja', 'zh']);
  assert.equal(selectVoiceCaptions({ ...input, mode: 'dual', uiLang: 'zh-TW', voiceLang: 'zh' }).length, 1);
  assert.equal(selectVoiceCaptions({ ...input, mode: 'dual', voiceText: input.uiText }).length, 1);
  assert.deepEqual(selectVoiceCaptions({ ...input, mode: 'voice', voiceText: null }), []);
  assert.deepEqual(selectVoiceCaptions({ ...input, mode: 'dual', voiceText: null }), [{ lang: 'zh', text: input.uiText }]);
});

test('subtitle layout avoids bottom controls and yields when no lower-screen space remains', () => {
  const rect = { left: 0, top: 610, right: 1366, bottom: 768, width: 1366, height: 158 };
  const p = voiceCaptionPosition({ width: 1366, height: 768 }, { height: 60 }, [rect]);
  assert.ok(p.top >= 768 * .55 && p.top + 60 < rect.top);
  assert.equal(voiceCaptionPosition({ width: 844, height: 390 }, { height: 60 }, [{ ...rect, top: 220, bottom: 390 }]), null);
  const safe = voiceCaptionPosition({ width: 844, height: 390, safeBottom: 34, safeLeft: 40, safeRight: 40 }, { width: 240, height: 50 }, []);
  assert.ok(safe.top + 50 <= 390 - 34 - 12 && safe.left >= 40);
});

test('subtitle layout uses the wider bottom gap and adapts its width instead of moving above the shop', () => {
  const viewport = { width: 1000, height: 600 };
  const shop = { left: 320, right: 620, top: 480, bottom: 600, width: 300, height: 120 };
  const p = voiceCaptionPosition(viewport, { width: 520, height: 70 }, [shop]);
  assert.equal(p.width, 360);
  assert.equal(p.left, 628, 'use the larger right gap');
  assert.equal(p.top + 70, 588, 'stay along the bottom rather than cover the bench');
  const symmetric = { ...shop, left: 350, right: 650 };
  assert.equal(voiceCaptionPosition(viewport, { width: 520, height: 70 }, [symmetric]).left, 658, 'prefer right on equal width');
});

test('subtitle layout measures full-name/text wrapping and leaves room for the actual height', () => {
  const viewport = { width: 1000, height: 600 };
  const controls = { left: 320, right: 620, top: 480, bottom: 600, width: 300, height: 120 };
  const widths = [];
  const p = voiceCaptionPosition(viewport, { width: 520, heightAtWidth: width => { widths.push(width); return width < 320 ? 140 : 100; } }, [controls]);
  assert.ok(widths.includes(p.width));
  assert.equal(p.top, 488);
  assert.ok(p.left >= controls.right + 8);
  assert.equal(voiceCaptionPosition(viewport, { width: 520, height: 300 }, []), null, 'hide if a full name leaves no lower-screen space');
});

test('in-match subtitles stay left of the ready row when the shop widens', () => {
  const viewport = { width: 1366, height: 768 };
  const rail = { left: 1180, top: 82 };
  const shop = { left: 900, right: 1350, top: 540, bottom: 750, width: 450, height: 210 };
  const box = { height: 100 };
  const p = voiceCaptionHudPosition(viewport, box, rail, [shop]);
  assert.equal(p.top, rail.top);
  assert.equal(p.left + p.width, rail.left - 12);
  assert.deepEqual(voiceCaptionHudPosition(viewport, box, rail, [{ ...shop, left: 310, width: 1040 }]), p);
  assert.equal(voiceCaptionHudPosition(viewport, box, rail, [{ left: p.left, top: 150, right: 1366, bottom: 600, width: 500, height: 450 }]), null, 'a statistics panel hides the subtitle rather than moving it to the shop');
});

test('HUD subtitles measure wrapped names and hide rather than move when the bond strip overlaps', () => {
  const viewport = { width: 844, height: 390, safeTop: 24, safeRight: 40, safeBottom: 20 };
  let measured;
  const p = voiceCaptionHudPosition(viewport, { heightAtWidth: width => { measured = width; return 80; } }, { left: 800, top: 96 }, []);
  assert.equal(p.width, measured);
  assert.equal(p.top, 96);
  assert.ok(p.left + p.width <= 844 - 40 - 12 && p.top + 80 <= 390 - 20 - 12);
  assert.equal(voiceCaptionHudPosition(viewport, { height: 400 }, { left: 800, top: 96 }, []), null);
  const bonds = { left: 400, right: 750, top: 70, bottom: 105, width: 350, height: 35, overhead: true };
  assert.equal(voiceCaptionHudPosition(viewport, { height: 80 }, { left: 800, top: 96 }, [bonds]), null, 'an overlapping bond strip hides the subtitle without moving it');
});

test('generated tables cover installed Chinese voice files, including self-selected operators', () => {
  const read = p => JSON.parse(readFileSync(new URL('../../' + p, import.meta.url)));
  const assets = read('data/assets.json');
  const zh = read('data/voice-captions/zh.json');
  let count = 0;
  for (const slots of Object.values(assets.audio.voice)) for (const url of Object.values(slots).flat()) {
    const key = voiceCaptionIdentity(url)?.key;
    assert.ok(key && zh[key], 'missing caption: ' + url); count++;
  }
  assert.ok(count > 2000);
  for (const lang of ['zh', 'en', 'ja', 'ko', 'zh-TW']) assert.ok(Object.keys(read(`data/voice-captions/${lang}.json`)).length > 2000);
});

test('caption extraction keeps variant word keys instead of collapsing them onto an operator', () => {
  const base = { charId: 'char_002_amiya', wordKey: 'char_002_amiya', voiceId: 'CN_025', placeType: 'BATTLE_SKILL_1', voiceText: 'base' };
  const captions = extractVoiceCaptions({ charWords: { a: base, b: { ...base, wordKey: 'char_1001_amiya2', voiceText: 'alternate' } } }, new Set([base.charId]));
  assert.equal(captions['char_002_amiya/cn_025'], 'base');
  assert.equal(captions['char_1001_amiya2/cn_025'], 'alternate');
});

const id = 'char_002_amiya', path = (lang, n) => `/assets/audio/voice/${lang}/${id}/cn_0${n}.mp3`;
function rig() {
  const bank = { voice: { [id]: { select: [path('cn', 21), path('cn', 22)], place: path('cn', 23) } },
    voiceJp: { [id]: { select: [path('jp', 21), path('jp', 22)], place: path('jp', 23) } } };
  const manager = new AudioManager({ win: { document: { hidden: false } }, getManifest: () => ({ audio: bank }) });
  manager.ctx = { currentTime: 0, state: 'running', createBufferSource: () => ({ connect() {}, start() {}, stop() {} }),
    createGain: () => ({ gain: { value: 1, setValueAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }) };
  manager.voiceGain = {};
  manager.voiceGate = new VoiceGate({ gapMs: 0 });
  manager._buffer = async () => ({ duration: 2 });
  return manager;
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('subtitle events begin after successful audio start and identify the actual random/fallback file', async t => {
  t.mock.method(Math, 'random', () => .99);
  const a = rig(), events = [], pending = Promise.withResolvers();
  const off = a.subscribeVoice(value => events.push(value));
  a._buffer = () => pending.promise;
  assert.equal(a.previewVoice(id, 'jp'), true);
  assert.equal(a.currentVoice(), null, 'request/decode is not playback');
  pending.resolve({ duration: 2 }); await tick();
  assert.equal(a.currentVoice().url, path('jp', 22));
  a.voiceNode.src.onended();
  assert.equal(a.currentVoice(), null);
  a._buffer = async url => url.includes('/jp/') ? null : { duration: 2 };
  a.previewVoice(id, 'jp'); await tick();
  assert.equal(a.currentVoice().url, path('cn', 22), 'failed JP actually speaks the matching Chinese file');
  assert.equal(a.currentVoice().charId, id);
  a._stopVoice(); assert.equal(events.at(-1), null); off();
});

test('stale decode/end events cannot replace or clear a newer subtitle; dropped and failed lines stay absent', async () => {
  const a = rig(), first = Promise.withResolvers();
  a._buffer = () => first.promise; a.previewVoice(id, 'jp');
  a._buffer = async () => ({ duration: 2 }); a.previewVoice(id, 'cn'); await tick();
  const current = a.currentVoice(); first.resolve({ duration: 2 }); await tick();
  assert.equal(a.currentVoice(), current);
  const previousNode = a.voiceNode; a.previewVoice(id, 'jp'); await tick();
  const next = a.currentVoice(); previousNode.src.onended();
  assert.equal(a.currentVoice(), next);
  assert.equal(a.voice(id, 'place', { unitKey: 1 }), true); await tick();
  const placed = a.currentVoice();
  assert.equal(a.voice(id, 'place', { unitKey: 2 }), false, 'the voice gate drops a competing request');
  assert.equal(a.currentVoice(), placed);
  a._stopVoice(); a._buffer = async () => null; a.previewVoice(id, 'jp'); await tick();
  assert.equal(a.currentVoice(), null);
});

test('muting/context suspension hides subtitles; safety expiry follows audio time through background suspension', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const a = rig(); a.previewVoice(id, 'jp'); await tick();
  const line = a.currentVoice(); a.setVolumes({ muted: true }); assert.equal(a.currentVoice(), null);
  a.setVolumes({ muted: false }); assert.equal(a.currentVoice(), line);
  a.ctx.state = 'suspended'; assert.equal(a.currentVoice(), null);
  t.mock.timers.tick(7000);
  assert.equal(a.voiceNode.caption, line, 'wall time does not end a suspended source');
  a.ctx.state = 'running'; assert.equal(a.currentVoice(), line);
  a.ctx.currentTime = 2.1; t.mock.timers.tick(3000);
  assert.equal(a.currentVoice(), null);
});
