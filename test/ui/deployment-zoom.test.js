import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, sanitizeSettings, deployFoldsShop, prepCameraFor } from '../../public/js/ui/gameLogic.js';

const read = rel => readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');

test('deployment zoom defaults off for new and old preferences; only a boolean true enables it', () => {
  assert.equal(DEFAULT_SETTINGS.deploymentZoom, false);
  for (const raw of [null, {}, { bgm: 0.5 }, ...[undefined, null, false, 0, 1, 'true', 'false', [], {}].map(deploymentZoom => ({ deploymentZoom }))]) {
    assert.equal(sanitizeSettings(raw).deploymentZoom, false);
  }
  assert.equal(sanitizeSettings({ deploymentZoom: true }).deploymentZoom, true);
});

test('deployment zoom toggles save and reload through the existing browser preferences', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const prefs = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => prefs.get(key) ?? null,
    setItem: (key, value) => prefs.set(key, value),
  } });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
  const settings = await import('../../public/js/ui/settings.js?deployment-zoom-save');
  assert.equal(settings.settingsStore.get().deploymentZoom, false);
  settings.updateSettings({ deploymentZoom: true });
  assert.equal(JSON.parse(prefs.get('sp.pref.settings')).deploymentZoom, true);
  const reloaded = await import('../../public/js/ui/settings.js?deployment-zoom-reload');
  assert.equal(reloaded.settingsStore.get().deploymentZoom, true);
  reloaded.updateSettings({ deploymentZoom: false });
  assert.equal(JSON.parse(prefs.get('sp.pref.settings')).deploymentZoom, false);
  const disabled = await import('../../public/js/ui/settings.js?deployment-zoom-disabled');
  assert.equal(disabled.settingsStore.get().deploymentZoom, false);
});

test('turning off automatic deployment zoom does not disable manual shop folding', () => {
  assert.equal(deployFoldsShop({ enabled: false, ownPrep: true, editable: true, drag: true }), false);
  const pub = { round: 1, bossRound: 14, hiddenRound: 15, players: [{ playerId: 'p', seat: 0, alive: true }] };
  assert.equal(prepCameraFor(pub, 'p', true).opts.shop, false);
  assert.equal(prepCameraFor(pub, 'p', false).opts.shop, true);
});

test('settings exposes the translated toggle and game screen subscribes to its live value', () => {
  assert.match(read('public/js/ui/settings.js'), /<\$\{Toggle\} label=\$\{t\('部署时镜头缩放'\)\} micro="DEPLOYMENT ZOOM" value=\$\{s\.deploymentZoom\} onChange=\$\{\(v\) => updateSettings\(\{ deploymentZoom: v \}\)\} \/>/);
  const game = read('public/js/screens/game.js');
  assert.match(game, /function MatchScreen\(\) \{\s+const settings = useSettings\(\);/);
  assert.match(game, /deployFoldsShop\(\{\s+enabled: settings\.deploymentZoom,/);
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(read(`public/i18n/${lang}.json`));
    assert.ok(pack['部署时镜头缩放'], lang);
    assert.ok(pack['放置或移动干员、装备时临时收起商店并放大棋盘，结束后恢复。默认关闭，不影响手动收起商店。'], lang);
  }
});
