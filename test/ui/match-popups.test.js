// The round / phase plates (ui/matchPopups.js, css/screens/match-popups.css): the small helpers, which phase gets which
// plate, the official roundStartDialog sprites they draw, and screens/game.js's wiring — the round plate at 回合开始, no
// 获得 for an eliminated player or a spectator seat (GitHub #236 / #237), the other phases' banners unchanged.
// The plates in a browser: test/ui/match-popups.e2e.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};
const P = await import('../../public/js/ui/matchPopups.js');

test('roundDigits: two digits, 00 before the first round', () => {
  assert.equal(P.roundDigits(1), '01');
  assert.equal(P.roundDigits(12), '12');
  assert.equal(P.roundDigits(0), '00');
  assert.equal(P.roundDigits(-3), '00');
  assert.equal(P.roundDigits('x'), '00');
});

test('roundsToBoss: the red strip from three rounds before the final assault, none at or after it', () => {
  assert.equal(P.roundsToBoss({ round: 10, bossRound: 14 }), null);
  assert.equal(P.roundsToBoss({ round: 11, bossRound: 14 }), 3);
  assert.equal(P.roundsToBoss({ round: 13, bossRound: 14 }), 1);
  assert.equal(P.roundsToBoss({ round: 14, bossRound: 14 }), null);
  assert.equal(P.roundsToBoss({ round: 15, bossRound: 14 }), null);
  assert.equal(P.roundsToBoss({ round: 3 }), null, 'no final assault round known');
  assert.equal(P.roundsToBoss(null), null);
});

test("phasePopupOf: 联防 gets the plate (the official faces) with the banner's words; the others keep the banner", () => {
  const b = { title: 'T', sub: 'S', micro: 'M' };
  assert.deepEqual(P.phasePopupOf('UNITE', b), { tone: 'orange', kinds:['happy','worried'], chev: true, duration: 2600, title: 'T', sub: 'S', micro:'M' });
  for (const ph of ['ROUND_START', 'PREP', 'COMBAT', 'BATTLE_CHECK', 'FINAL_ASSAULT', 'SETTLE']) assert.equal(P.phasePopupOf(ph, b), null, ph);
  assert.equal(P.phasePopupOf('UNITE', null), null);
});

test('the round plate fits inside 回合开始 (server DELAYS.ROUND_START)', () => {
  const delay = Number(read('server/match/match/common.js').match(/ROUND_START:\s*(\d+)/)?.[1]);
  assert.ok(delay > 0);
  assert.ok(P.ROUND_POPUP_MS + 280 <= delay, `${P.ROUND_POPUP_MS} + the fold within ${delay} ms`);
});



test('screens/game.js: the round plate at 回合开始, 获得 only for the players still in, the other banners kept', () => {
  const g = read('public/js/screens/game.js');
  assert.match(g, /if \(phase === PHASE\.ROUND_START && b && pub\?\.round > 0\) \{\n\s+setBanner\(null\);\n\s+setRoundPop\(\{ round: pub\.round, left: roundsToBoss\(pub\), sub: b\.sub, watching: spectator \|\| !alive, key: phaseKey \}\);/);
  assert.match(g, /<\$\{RoundPopup\} key=\$\{roundPop\.key\} round=\$\{roundPop\.round\} gain=\$\{roundGain\} left=\$\{roundPop\.left\} sub=\$\{roundPop\.sub\}\n\s+watching=\$\{roundPop\.watching\}/);
  assert.match(g, /\$\{!hasOffers && banner && !banner\.plate && !roundPop \? html`<\$\{PhaseBanner\}/, 'the other phases keep the banner, while an offer dialog stays unobscured');
  assert.match(g, /useEffect\(\(\) => \{ preloadPopupArt\(\); \}, \[\]\);/);
  const pop = read('public/js/ui/matchPopups.js');
  assert.match(pop, /\$\{gain != null && !watching \? html`<div class="mpop__cell mpop__cell--gold"/, 'no 获得 for a watcher');
  assert.match(pop, /\$\{sub \? html`<span class="mpop__sub"/, 'the spectator line remains visible');
});

test('the stylesheet keeps to the project\'s rules and is loaded', () => {
  const css = read('public/css/screens/match-popups.css');
  assert.doesNotMatch(css, /!important/);
  assert.doesNotMatch(css, /:has\(/);
  assert.doesNotMatch(css, /--t\s*:/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n\s+\.mpop \*/);
  for (const page of ['public/index.html', 'public/dev/game-mock.html']) assert.match(read(page), /href="\/css\/screens\/match-popups\.css"/, page);
});
