// Port field-lifetime cleanup without replacing this fork's existing SFX limiter or voice/subtitle pipeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AudioManager } from '../../public/js/audio.js';
const manifest = JSON.parse(readFileSync(new URL('../../data/assets.json', import.meta.url), 'utf8'));
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const sources = [];
  class Param { constructor() { this.value = 1; } cancelScheduledValues() {} setValueAtTime(v) { this.value = v; } linearRampToValueAtTime(v) { this.value = v; } }
  class Node { connect() {} disconnect() {} }
  class Gain extends Node { constructor() { super(); this.gain = new Param(); } }
  class Source extends Node {
    constructor() { super(); this.playbackRate = new Param(); this.started = false; this.stopped = false; sources.push(this); }
    start() { this.started = true; } stop() { this.stopped = true; }
  }
  const a = new AudioManager({ win: null, getManifest: () => manifest });
  a.ctx = { currentTime: 0, state: 'running', createBufferSource: () => new Source(), createGain: () => new Gain() };
  a.sfxGain = new Gain(); a.voiceGain = new Gain();
  a._buffer = async () => ({ duration: 1 });
  t.after(() => a.stopFieldSounds());
  return { a, sources, advance: () => { now += 1000; } };
}

for (const [reason, cleanup] of [['field replacement', a => a.setFieldUnits([])], ['screen exit', a => a.stopFieldSounds()]]) {
  test(`${reason} cancels a pending cue without releasing a new cue for the same URL`, async t => {
    const { a, sources, advance } = fixture(t);
    let open; const pending = new Promise(resolve => { open = resolve; }); a._buffer = () => pending;
    a._play('/same.mp3', { limited: true, unitKey: 'old' });
    assert.equal(a.limiter.active, 1);
    cleanup(a); cleanup(a); assert.equal(a.limiter.active, 0);
    advance(); a._play('/same.mp3', { limited: true, unitKey: 'new' });
    open({ duration: 1 }); await flush();
    assert.equal(sources.filter(s => s.started).length, 1);
    assert.equal(a.limiter.active, 1, 'the old callback cannot release the new request');
    cleanup(a); assert.equal(a.limiter.active, 0); assert.equal(sources[0].stopped, true);
  });
  test(`${reason} cancels a voice still decoding, without publishing a stale subtitle`, async t => {
    const { a, sources } = fixture(t), events = [];
    let open; a._buffer = () => new Promise(resolve => { open = resolve; });
    a.subscribeVoice(value => events.push(value));
    assert.equal(a.previewVoice('char_263_skadi', 'cn'), true);
    cleanup(a); open({ duration: 1 }); await flush();
    assert.equal(sources.filter(s => s.started).length, 0);
    assert.ok(events.every(value => value === null));
    assert.equal(a.voiceGate.playing, null);
  });
}

test('cleanup stops an audible voice and clears its subtitle; a late end does not clear a new line', async t => {
  const { a, sources } = fixture(t), events = [];
  a.subscribeVoice(value => events.push(value));
  assert.equal(a.previewVoice('char_263_skadi', 'cn'), true); await flush();
  assert.ok(a.currentVoice()); const old = sources[0];
  a.stopFieldSounds(); assert.equal(old.stopped, true); assert.equal(events.at(-1), null);
  assert.equal(a.previewVoice('char_263_skadi', 'cn'), true); await flush();
  const current = a.currentVoice(); assert.ok(current);
  old.onended(); assert.equal(a.currentVoice(), current); assert.equal(events.at(-1), current);
});

test('field cleanup preserves a pending UI cue and does not invoke an obsolete plugin fallback', async t => {
  const { a, sources } = fixture(t);
  let open, repicks = 0; const pending = new Promise(resolve => { open = resolve; });
  a._buffer = () => pending; a.fellBack.add('/plugin.mp3');
  a._play('/plugin.mp3', { limited: true, again: () => { repicks++; return '/fallback.mp3'; } });
  a.stopFieldSounds(); open(null); await flush();
  assert.equal(repicks, 0); assert.equal(a.limiter.active, 0); assert.equal(sources.length, 0);
  let uiOpen; a._buffer = () => new Promise(resolve => { uiOpen = resolve; });
  a._play('/ui.mp3'); a.stopFieldSounds(); uiOpen({ duration: 1 }); await flush();
  assert.equal(sources.length, 1); assert.equal(sources[0].started, true);
  assert.equal(a.uiVoices, 1); sources[0].onended(); assert.equal(a.uiVoices, 0);
});

test('natural end and the safety timer release a limited cue only once', async t => {
  const { a, sources, advance } = fixture(t);
  a._play('/first.mp3', { limited: true }); await flush();
  sources[0].onended(); assert.equal(a.limiter.active, 0);
  advance(); a._buffer = async () => ({ duration: 100 });
  a._play('/second.mp3', { limited: true }); await flush();
  t.mock.timers.tick(5000); sources[0].onended();
  assert.equal(a.limiter.active, 1); assert.equal(a.fieldSounds.size, 1);
});
