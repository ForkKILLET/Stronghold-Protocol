// PR #828 review (must-fix F2): the strategy wall's orange corner badge follows the official bands victorCount — the
// stats page's own rule, ui/stats.js strategyBadgeIds (3 clears for all 40 strategies) — not a single local win; the
// detail pane's 已通过模拟 N 次 keeps counting every win. screens/bandDraft.js draftRecords, read after the screen is up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const { buildRecord } = await import('../../public/js/ui/stats.js');
const { draftRecords } = await import('../../public/js/screens/bandDraft.js');
const {accountDraftRecords}=await import('../../public/js/ui/draftProgress.js');
const {DEFAULT_VERSION}=await import('../../shared/versions.js');

const BANDS = JSON.parse(read('data/bands.json'));

function record(seed, { bandId = 'band_amiya', victory = true, difficulty = 'HARD', modeId = 'mode_multi_hard' } = {}) {
  return buildRecord({ seed, victory, roundsPassed: 14, difficulty, modeId, hiddenReached: false, hiddenCleared: false,
    players: [{ playerId: 'self', bandId, victory, alive: victory, roundsPassed: 14, stats: {} }],
  }, { myId: 'self', now: seed + 1 });
}

test('every official strategy needs 3 clears for its badge (data/bands.json victorCount, from activity_table)', () => {
  const list = Object.values(BANDS);
  assert.equal(list.length, 40);
  assert.ok(list.every((b) => b.victorCount === 3), 'victorCount 3 for all 40');
});

test('draftRecords: one win counts (已通过模拟 1 次) but gives no badge; the third clear does; training and quits never do', () => {
  const one = draftRecords([record(1)], BANDS);
  assert.deepEqual(one.won, { band_amiya: 1 });
  assert.deepEqual([...one.badges], [], 'a single local win is not the badge');
  const two = draftRecords([record(1), record(2), record(3, { difficulty: 'TRAINING', modeId: 'mode_training_1' }), { ...record(4), end: 'quit' }], BANDS);
  assert.deepEqual([...two.badges], [], 'training and a quit run are no clears');
  const three = draftRecords([record(1), record(2), record(5)], BANDS);
  assert.deepEqual(three.won, { band_amiya: 3 });
  assert.deepEqual([...three.badges], ['band_amiya']);
  const lost = draftRecords([record(1), record(2), record(6, { victory: false })], BANDS);
  assert.deepEqual([...lost.badges], [], 'a lost run is no clear');
  assert.deepEqual(draftRecords([], BANDS), { won: {}, badges: new Set(), trophies: 0 });
});

test('the wall gates the badge on draftRecords().badges with the official sprite; the records are read after mount', () => {
  const src = read('public/js/screens/bandDraft.js');
  assert.match(src, /const badged = progress\.badges\.has\(b\.bandId\);/);
  assert.match(src, /\$\{badged \? html`<span class="dband__badge" data-testid="band-badge"/);
  assert.match(src, /<\$\{Sprite\} k="statistics\/strategyBadge" class="dband__badge-art"/);
  assert.doesNotMatch(src, /\$\{wins \? html`<span class="dband__medal"/, 'no badge after one win');
  // the detail pane's count stays plain text
  assert.match(src, /progress\.won\[shownBand\.bandId\].*draft-detail__medal/);
  // not parsed while the screen mounts (the stats store can be large): an idle callback after it is up
  assert.match(src, /useStrategyProgress\(\{version,matchId:pub\?\.matchId,bands\}\)/);
  assert.doesNotMatch(src, /peekStatsRecords\(/);
  assert.ok(JSON.parse(read('data/assets.json')).ui['statistics/strategyBadge'], 'the official badge sprite is in the asset list');
  const css = read('public/css/screens/draft.css');
  assert.match(css, /\.dband__badge \{ position: absolute; top: -10\.8%; right: -10\.8%; width: 82\.35%; height: 84\.8%; pointer-events: none; \}/);
  // the PR's dead rules are gone
  assert.doesNotMatch(css, /\.acct-tag|\.dband__who/);
});

test('the compact order rows use doctor avatars and keep their profile entry', () => {
  const src = read('public/js/screens/bandDraft.js');
  assert.match(src, /<\$\{PlayerAvatar\} player=\$\{p\} self=\$\{self\} profileLink=\$\{true\}/);
  assert.doesNotMatch(src, /dorder__art|seatArtSrc|skinsStore/);
});


test('draft statistics isolate the current rules version and exclude gameplay plugins',()=>{
 const records=[record(11),{...record(12),version:'act1autochess'},{...record(13),content:{cs:'a'.repeat(64)}}];
 assert.equal(draftRecords(records,BANDS,DEFAULT_VERSION).won.band_amiya,1);
 assert.equal(draftRecords(records,BANDS,'act1autochess').won.band_amiya,1);
});

test('account strategy counts use full version aggregates, independent of history pagination and training badge eligibility',()=>{
 const account={userId:'a',records:[],byVersion:{[DEFAULT_VERSION]:{aggregate:{bands:{band_amiya:{games:60,wins:55}},trophies:110},strategyClears:{band_amiya:2}}}};
 const progress=accountDraftRecords(account,'a',DEFAULT_VERSION,BANDS);
 assert.deepEqual(progress.won,{band_amiya:55});assert.equal(progress.trophies,110);assert.equal(progress.badges.size,0);
 account.byVersion[DEFAULT_VERSION].strategyClears.band_amiya=3;
 assert.deepEqual([...accountDraftRecords(account,'a',DEFAULT_VERSION,BANDS).badges],['band_amiya']);
 assert.throws(()=>accountDraftRecords(account,'b',DEFAULT_VERSION,BANDS),/identity/);
 assert.throws(()=>accountDraftRecords({...account,withModded:true},'a',DEFAULT_VERSION,BANDS),/identity/);
 assert.throws(()=>accountDraftRecords(account,'a','act1autochess',BANDS),/Version/);
 delete account.byVersion[DEFAULT_VERSION].strategyClears;
 assert.equal(accountDraftRecords(account,'a',DEFAULT_VERSION,BANDS).badges.size,0,'old servers never infer qualifying clears from all wins');
});
