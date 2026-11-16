import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import { PHASE } from '../../shared/constants.js';
import { countdownState } from '../../public/js/ui/gameLogic/phases.js';
import { frozenNow } from '../../public/js/ui/matchStatus.js';

// Run the screen's real timer hook block without mounting its WebGL/browser UI.
const source = readFileSync(new URL('../../public/js/screens/game.js', import.meta.url), 'utf8');
const start = source.indexOf('  // timer ticks (≤ 10 s)');
const end = source.indexOf('  // Interface-theme voice', start);
assert.ok(start >= 0 && end > start);
const renderTimer = compileFunction(source.slice(start, end) + '\nreturn cd;',
  ['pub', 'priv', 'phase', 'paused', 'frozenAt', 'serverNow', 'total', 'alive', 'sp', 'solo', 'myId',
    'countdownState', 'useTicker', 'useRef', 'useEffect', 'audio', 'PHASE', 'live']);

function fixture() {
  const refs = [], sounds = [], intervals = [], live = { current: null };
  let refIndex = 0, effects = [];
  const audio = { sfx: (key, options) => sounds.push({ key, ...options }) };
  function render(pub, { now = 1000, priv = { ready: false }, alive = true, sp = null, solo = false } = {}) {
    refIndex = 0; effects = [];
    const paused = !!pub.paused;
    live.current = { pub, priv, paused };
    const cd = renderTimer(pub, priv, pub.phase, paused, paused ? frozenNow(pub, now, 1000) : null,
      () => now, 30, alive, sp, solo, 'me', countdownState, ms => intervals.push(ms),
      initial => refs[refIndex++] ??= { current: initial }, effect => effects.push(effect), audio, PHASE, live);
    for (const effect of effects) effect();
    return cd;
  }
  return { render, sounds, intervals };
}

test('co-op pause above ten seconds never enters the warning window as wall time passes', () => {
  const f = fixture(), pub = { phase: PHASE.PREP, round: 1, deadline: 31000, paused: true, pausedAt: 1000 };
  for (const now of [1000, 22000, 29000, 61000]) {
    assert.equal(f.render(pub, { now }).remain, 30);
  }
  assert.deepEqual(f.sounds, []);
  assert.deepEqual(f.intervals, [0, 0, 0, 0]);
});

test('pause inside the warning window stays silent; resume continues once per remaining second', () => {
  const f = fixture(), pub = { phase: PHASE.PREP, round: 1, deadline: 10000 };
  f.render(pub);
  assert.equal(f.sounds.length, 1);
  const paused = { ...pub, paused: true, pausedAt: 1000 };
  for (const now of [2000, 3000, 100000]) assert.equal(f.render(paused, { now }).remain, 9);
  assert.equal(f.sounds.length, 1);
  const resumed = { ...pub, deadline: 109000 };
  f.render(resumed, { now: 100000 });
  assert.equal(f.sounds.length, 1, 'the frozen second is not replayed');
  f.render(resumed, { now: 101000 });
  f.render(resumed, { now: 101100 });
  assert.equal(f.sounds.length, 2, 'the next live second sounds exactly once');
  assert.equal(f.sounds[1].key, 'timer');
});

test('a pending warning loses its owner on pause, phase change or readiness change', () => {
  for (const change of ['pause', 'phase', 'ready']) {
    const f = fixture(), pub = { phase: PHASE.PREP, deadline: 10000 }, priv = { ready: false };
    f.render(pub, { priv });
    const cue = f.sounds[0];
    assert.equal(cue.isCurrent(), true);
    if (change === 'pause') f.render({ ...pub, paused: true, pausedAt: 1000 }, { priv });
    if (change === 'phase') f.render({ ...pub, phase: PHASE.COMBAT }, { priv });
    if (change === 'ready') f.render(pub, { priv: { ready: true } });
    assert.equal(cue.isCurrent(), false, change);
  }
});

test('a shared draft pauses its own-turn warning, while a pending pause vote still allows live ticks', () => {
  const f = fixture(), sp = { turnPid: 'me', pickOf: new Set() };
  const pub = { phase: PHASE.SP_DRAFT, deadline: 10000, pauseRequests: ['me'], paused: false };
  f.render(pub, { sp });
  assert.equal(f.sounds.length, 1, 'a vote alone does not pause the match');
  f.render({ ...pub, paused: true, pausedAt: 1000 }, { now: 2000, sp });
  assert.equal(f.sounds.length, 1);
  assert.equal(f.intervals.at(-1), 0);
});

test('untimed, zero, ready, eliminated and another player’s draft turn stay silent', () => {
  for (const [pub, options] of [
    [{ phase: PHASE.PREP, deadline: 0 }, {}],
    [{ phase: PHASE.PREP, deadline: 1000 }, {}],
    [{ phase: PHASE.PREP, deadline: 10000 }, { priv: { ready: true } }],
    [{ phase: PHASE.PREP, deadline: 10000 }, { alive: false }],
    [{ phase: PHASE.SP_DRAFT, deadline: 10000 }, { sp: { turnPid: 'other', pickOf: new Set() } }],
  ]) {
    const f = fixture(); f.render(pub, options); assert.deepEqual(f.sounds, []);
  }
});
