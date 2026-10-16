import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = rel => readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');

test('title resource management uses only the branch preload launcher', () => {
  const title = read('public/js/screens/title.js');
  assert.match(title, /import \{ ResourceLauncher \} from '\.\.\/ui\/resourcePanel\.js'/);
  assert.match(title, /<\$\{ResourceLauncher\} enabled=\$\{settings\.preload\}/);
  assert.doesNotMatch(title, /AssetDownloadButton|assetDownload|title-assets/);
  assert.doesNotMatch(read('public/css/screens/title.css'), /asset-download|asset-import|title-assets/);
  for (const rel of ['public/js/assetDownload.js', 'public/js/ui/assetDownload.js']) {
    assert.equal(existsSync(fileURLToPath(new URL('../../' + rel, import.meta.url))), false, rel);
  }
});

test('branch resource pipeline and iframe sandbox remain available without CSP', () => {
  for (const rel of ['public/js/ui/resourcePanel.js', 'public/js/resources/index.js', 'public/resource-sw.js']) {
    assert.ok(existsSync(fileURLToPath(new URL('../../' + rel, import.meta.url))), rel);
  }
  assert.match(read('public/js/ui/pluginFrame.js'), /setAttribute\('sandbox',\s*'allow-scripts'\)/);
  assert.doesNotMatch(read('public/js/render/app/pixi.js'), /pixiNoEval|installPixiNoEval/);
});
