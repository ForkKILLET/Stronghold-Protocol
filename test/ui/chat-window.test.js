import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validChatPosition, chatWindowPosition } from '../../public/js/ui/chatWindow.js';

test('chat position ignores malformed browser preferences', () => {
  for (const value of [null, [], 'left', { x: '0.5', y: 0 }, { x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: -1, y: 0 }, { x: 0, y: 2 }]) assert.equal(validChatPosition(value), null);
  assert.deepEqual(validChatPosition({ x: 0.25, y: 1, unrelated: true }), { x: 0.25, y: 1 });
});

test('unsaved chat opens above its trigger and respects viewport margins', () => {
  const area = { x: 8, y: 8, width: 1424, height: 884 }, size = { width: 288, height: 216 };
  assert.deepEqual(chatWindowPosition(null, area, size, { left: 32, top: 830 }), { x: 32, y: 606 });
  assert.deepEqual(chatWindowPosition(null, area, size, { left: -30, top: 80 }), { x: 8, y: 8 });
});

test('remembered chat remains visible after a resize, keyboard offset or tiny viewport', () => {
  const saved = { x: 1, y: 1 }, size = { width: 288, height: 216 };
  for (const area of [{ x: 8, y: 8, width: 1424, height: 884 }, { x: 20, y: 120, width: 620, height: 230 }, { x: 8, y: 8, width: 200, height: 100 }]) {
    const point = chatWindowPosition(saved, area, size, { left: 0, top: 0 });
    assert.ok(point.x >= area.x && point.y >= area.y);
    assert.equal(point.x, area.x + Math.max(0, area.width - size.width));
    assert.equal(point.y, area.y + Math.max(0, area.height - size.height));
  }
  assert.deepEqual(saved, { x: 1, y: 1 }, 'temporary viewport restrictions do not overwrite the saved location');
});
