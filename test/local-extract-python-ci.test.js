// The minimum-Python guard stays separate from ci.yml's exact local-runner contract (#744).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWorkflow } from '../tools/ci.mjs';

test('local extractor CI compiles every Python source with setup\'s minimum version and no extraction dependencies', () => {
  const src = readFileSync(new URL('../.github/workflows/local-extract-python.yml', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const setup = readFileSync(new URL('../tools/setup.mjs', import.meta.url), 'utf8');
  const minimum = setup.match(/major === 3 && minor >= (\d+)/)?.[1];
  assert.ok(minimum, 'read the actual accepted Python floor');
  assert.match(src, new RegExp(`python-version: '3\\.${minimum}'`));
  // setup-python has no Python 3.8 build for Ubuntu 26.04, which ubuntu-latest became (first seen 2026-11-02; history §37.96).
  assert.match(src, /^    runs-on: ubuntu-24\.04$/m);
  assert.match(src, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(src, /write|continue-on-error|pip install|npm |pull_request_target/);
  for (const event of ['push', 'pull_request']) {
    const block = src.match(new RegExp(`^  ${event}:\n((?: {4}[^\n]*\n| {6}[^\n]*\n)*)`, 'm'))?.[1];
    assert.match(block, /^    branches: \[main\]$/m);
    for (const path of ['tools/local-extract/**', 'tools/setup.mjs', 'test/local-extract-python-ci.test.js', '.github/workflows/local-extract-python.yml']) {
      assert.ok(block.includes(`- '${path}'`), `${event}: ${path}`);
    }
  }
  assert.match(src, /^  workflow_dispatch:$/m);
  assert.ok(Number(src.match(/timeout-minutes: (\d+)/)?.[1]) <= 5);
  const steps = parseWorkflow(src).jobs.compile.steps;
  assert.equal(steps[0].uses, main.match(/uses: (actions\/checkout@v\d+)/)?.[1]);
  assert.equal(steps[1].uses, 'actions/setup-python@v7');
  assert.deepEqual(steps.filter((s) => s.run).map((s) => s.run), ['python -m compileall -q -f tools/local-extract']);
});
