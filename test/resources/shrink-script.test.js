import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('offline compression uses isolated fixtures, preserving original art and validating candidate migration', (t) => {
  const python = process.env.PYTHON_SHRINK || process.env.PYTHON || 'python';
  const cwd = fileURLToPath(new URL('../../', import.meta.url));
  const probe = spawnSync(python, ['-B', '-c', [
    'import sys, json',
    'try:',
    ' from PIL import features',
    " webp = features.check('webp')",
    'except ImportError:',
    ' webp = False',
    "print(json.dumps({'version': list(sys.version_info[:2]), 'webp': webp}))",
  ].join('\n')], { cwd, encoding: 'utf8', timeout: 10000 });
  if (probe.error?.code === 'ENOENT') return t.skip('Python is optional');
  assert.equal(probe.status, 0, probe.stderr || probe.error?.message);
  const info = JSON.parse(probe.stdout);
  if (info.version[0] < 3 || (info.version[0] === 3 && info.version[1] < 10) || !info.webp) {
    return t.skip('Requires optional Python 3.10+ and WebP-enabled Pillow');
  }
  const tests = spawnSync(python, ['-B', '-m', 'unittest', 'discover', '-s', 'test/resources',
    '-p', 'shrink_assets_test.py'], { cwd, encoding: 'utf8', timeout: 60000 });
  assert.equal(tests.status, 0, tests.stdout + tests.stderr + (tests.error?.message || ''));
  assert.match(tests.stderr, /\bOK\b/);
});
