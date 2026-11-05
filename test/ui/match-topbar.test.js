// Migration: The fork keeps its uniformly spaced HUD without plus separators; its HUD and battle layout regressions cover that design.
// test/ui/match-topbar.test.js — the match's top bar centre as in the event (PR #643 / #827, video 8:01): [🔍] in a
// bracket frame · + · one long band (回合 N | the phase capsule as a bevelled plate | the LP tower) under the official deco
// type · + · [🔍▶▶] in a bracket frame; and its 进场 (the maintainer's decision of 2026-10-21): the HUD waits hidden only
// while 协议启动！ shows and comes in as soon as it leaves (screens/game.js `hudIn`, css/screens/game.css .gm__hud.is-wait
// / .is-enter), the capsule scene of a change meanwhile waiting for it. Source checks; the browser side:
// test/ui/match-topbar.e2e.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** The stylesheet's 顶部中栏 block (to the narrow-screen rule's end) and its 进场 block (to its reduced-motion rule's end). */
function blocks() {
  const css = read('public/css/screens/game.css');
  const a = css.indexOf('/* 顶部中栏 (PR #643');
  const aEnd = css.indexOf('/* the two official 🔍 buttons', a);
  const b = css.indexOf('/* ---- 进场 (PR #827');
  const bReduce = css.indexOf('@media (prefers-reduced-motion: reduce)', b);
  const bEnd = css.indexOf('\n}\n', bReduce) + 3;
  assert.ok(a > 0 && aEnd > a && b > aEnd && bReduce > b && bEnd > bReduce, 'both blocks');
  return { css, centre: css.slice(a, aEnd), entry: css.slice(b, bEnd) };
}







test('screens/game.js: the HUD waits only while 协议启动！ shows, comes in as it leaves (no wait for the plate), 1.2 s, never with reduced motion', () => {
  const g = read('public/js/screens/game.js');
  assert.match(g, /const bootShown = !!boot && !hasOffers && !bootLeaving;/);
  assert.match(g, /const \[hudIn, setHudIn\] = useState\(\(\) => \(bootShown && !reducedMotion\(\) \? 'wait' : null\)\);/);
  // once per 协议启动！ (its boot.key): a plugin window's close re-shows it for the fade, and the HUD stays in
  assert.match(g, /useEffect\(\(\) => \{\n\s+if \(bootShown\) \{ if \(!reducedMotion\(\) && hudCame\.current !== boot\.key\) setHudIn\('wait'\); return; \}\n\s+if \(boot\) hudCame\.current = boot\.key;\n\s+setHudIn\(\(s\) => \(s === 'wait' \? 'enter' : s\)\);\n\s+\}, \[bootShown\]\);/);
  assert.match(g, /if \(hudIn !== 'enter'\) return undefined;\n\s+const id = setTimeout\(\(\) => setHudIn\(null\), 1200\);/);
  assert.doesNotMatch(g, /roundPopShown|setHudIn\('enter'\), 4000/, 'no wait for the round plate, no 4 s cap');
  assert.match(g, /<div class=\$\{cx\('gm__hud', hudIn && `is-\$\{hudIn\}`\)\} ref=\$\{hudElRef\}>/);
  assert.match(g, /held=\$\{hudIn === 'wait'\} \/>/);
});

test('ui/hud.js useCapsuleFx: a phase change while the HUD is held waits and plays when it comes in', () => {
  const hud = read('public/js/ui/hud.js');
  assert.match(hud, /function useCapsuleFx\(phase, round, held = false\) \{/);
  assert.match(hud, /if \(s\.key !== key && !\(held && s\.key !== null\)\) \{/);
  assert.match(hud, /const fx = useCapsuleFx\(phase, pub\?\.round, held\);/);
  assert.match(hud, /onRemoveSpectator = null, room = null, held = false \}\) \{/);
});
