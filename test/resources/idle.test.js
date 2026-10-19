import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idleResourceCheck } from '../../public/js/resources/idle.js';

test('idle maintenance waits for inactivity/visibility and interrupts an active check on input', async () => {
  const tasks = new Map(), listeners = new Map(); let id = 0, allowed = true, calls = 0, interrupts = 0;
  const doc = { visibilityState: 'visible', addEventListener: (e, f) => listeners.set(e, f), removeEventListener: e => listeners.delete(e) };
  const win = { setTimeout(f, ms) { assert.equal(ms, 15000); tasks.set(++id, f); return id; }, clearTimeout: key => tasks.delete(key) };
  const wait = Promise.withResolvers();
  const cancel = idleResourceCheck({ win, doc, allowed: () => allowed, interrupt: () => interrupts++, run: async () => { calls++; return wait.promise; } });
  const dispatch = async () => { const [key, fn] = [...tasks][0]; tasks.delete(key); return fn(); };
  assert.equal(tasks.size, 1);
  const old = [...tasks.keys()][0]; listeners.get('keydown')(); assert.equal(tasks.has(old), false);
  allowed = false; listeners.get('pointerdown')(); assert.equal(tasks.size, 0);
  allowed = true; doc.visibilityState = 'hidden'; listeners.get('visibilitychange')(); assert.equal(tasks.size, 0);
  doc.visibilityState = 'visible'; listeners.get('visibilitychange')();
  const running = dispatch(); assert.equal(calls, 1);
  const before = interrupts; listeners.get('wheel')(); assert.equal(interrupts, before + 1);
  wait.resolve(false); await running; assert.equal(tasks.size, 1, 'interrupted work can retry after another idle interval');
  const stale = [...tasks.values()][0]; cancel(); await stale();
  assert.equal(calls, 1); assert.equal(tasks.size, 0); assert.equal(listeners.size, 0);
});
