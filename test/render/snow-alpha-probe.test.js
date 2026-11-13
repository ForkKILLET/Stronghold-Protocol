import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareRgb } from '../../tools/research/snow-alpha-probe.mjs';

test('probe distinguishes lost zero-alpha RGB from valid opaque controls and ignores output alpha', () => {
  const points = [{ x: 0, y: 0, rgba: [146, 147, 148, 0] }, { x: 1, y: 0, rgba: [90, 100, 110, 255] }];
  const valid = compareRgb(points, new Uint8Array([146, 147, 148, 255, 90, 100, 110, 255]));
  assert.equal(valid.mismatches, 0);
  const lost = compareRgb(points, new Uint8Array([0, 0, 0, 255, 90, 100, 110, 255]));
  assert.equal(lost.mismatches, 1); assert.equal(lost.zeroAlphaMismatches, 1); assert.equal(lost.maxError, 148);
  assert.deepEqual(lost.samples[0].actual, [0, 0, 0, 255]);
  assert.throws(() => compareRgb(points, new Uint8Array(4)), /Incomplete readback/);
});

const python = ['python3', 'python'].find(p => spawnSync(p, ['-I', '-B', '-c', 'from PIL import Image'], { env: process.env }).status === 0);
test('probe generator preserves all controls and produces a self-contained offline page', { skip: !python && 'no Pillow' }, () => {
  const path = fileURLToPath(new URL('../local-extract/snow-alpha-probe.py', import.meta.url));
  const result = spawnSync(python, ['-I', '-B', path], { encoding: 'utf8', env: process.env });
  assert.equal(result.status, 0, result.stderr);
});
