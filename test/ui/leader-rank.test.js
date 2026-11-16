// Boss chart rows and data provenance; browser fixtures cover phase lifecycle, motion and HUD placement.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });

const { LeaderRank, leaderSharePct, leaderChartRows, leaderRankSpot } = await import('../../public/js/ui/leaderRank.js');

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  return textOf(v.props?.children);
};

const ROWS = [
  { pid: 'p1', uid: 1, chess: 'op_a', tier: 5, dmg: 22 },
  { pid: 'p2', uid: 2, chess: 'op_b', tier: 4, dmg: 6 },
  { pid: 'p1', uid: 3, chess: 'op_c', tier: 6, dmg: 4 },
];
const PLAYERS = [{ playerId: 'p1', name: '博士甲' }, { playerId: 'p2', name: 'DoctorB' }];

test('the share is the operator\'s damage over the pool max, at least 1% for a real hit', () => {
  assert.equal(leaderSharePct(22, 100), 22);
  assert.equal(leaderSharePct(6, 100), 6);
  assert.equal(leaderSharePct(4, 100), 4);
  assert.equal(leaderSharePct(1, 1000), 1);
  assert.equal(leaderSharePct(0, 100), 0);
  assert.equal(leaderSharePct(10, 0), 0);
});

test('operator rows keep identity across rank changes and use player labels with real pool percentages', () => {
  const first = leaderChartRows(ROWS, null, 'operators');
  const changed = leaderChartRows([{ ...ROWS[1], dmg: 30 }, ROWS[0], ROWS[2]], null, 'operators');
  assert.equal(changed[1].key, first[0].key);
  assert.equal(changed[0].key, first[1].key);
  let mode, closed = false;
  const shown = LeaderRank({ rows: ROWS, players: PLAYERS, maxHp: 100, onClose: () => { closed = true; }, onMode: value => { mode = value; } });
  const nodes = [...walk(shown)];
  assert.ok(textOf(shown).includes('22%'));
  assert.deepEqual(nodes.filter(v => v.type?.name === 'UnitThumb').map(v => v.props.id), ['op_a', 'op_b', 'op_c']);
  const rows = nodes.filter(v => v.type === 'li');
  assert.equal(rows[1].props.style.transform, 'translateY(calc(1 * var(--ldmg-step)))');
  assert.equal(nodes.filter(v => v.props?.class === 'ldmg__bar')[1].props.style.width, `${6 / 22 * 100}%`);
  nodes.find(v => v.type === 'button' && textOf(v) === '玩家').props.onClick();
  assert.equal(mode, 'players');
  nodes.find(v => v.props?.class === 'ldmg__close').props.onClick();
  assert.equal(closed, true);
});

test('player totals use the separate complete server tally; missing old replay totals are never guessed', () => {
  const playerRows = [{ pid: 'p2', dmg: 60 }, { pid: 'p1', dmg: 32, chess: 'op_a', tier: 5 }];
  assert.equal(leaderChartRows(ROWS, playerRows, 'players')[0].key, 'player:p2');
  assert.deepEqual(leaderChartRows(ROWS, undefined, 'players'), []);
  const shown = LeaderRank({ rows: ROWS, playerRows, players: PLAYERS, mode: 'players', maxHp: 100 });
  assert.ok(textOf(shown).includes('60%'));
  assert.equal([...walk(shown)].filter(v => v.type?.name === 'PlayerAvatar').length, 1, 'unattributed total retains a player portrait');
  assert.ok(textOf(LeaderRank({ rows: ROWS, players: PLAYERS, mode: 'players', maxHp: 100 })).includes('当前记录未提供玩家总伤害'));
  assert.ok(textOf(LeaderRank({ rows: ROWS, players: PLAYERS, boss: false, maxHp: 100 })).includes('领袖回合开始后显示'));
});

test('a tall right column (可露希尔\'s TV + the overtime warning) moves the list under it at the right edge, clear of the DP box; left of it only without room (§37.201, §37.207)', () => {
  const hud = { left: 0, top: 0, right: 1280, bottom: 720 };
  const home = { left: 1072, top: 130, right: 1219, bottom: 232 };
  const tv = { left: 1028, top: 13, right: 1260, bottom: 242 };
  const dp = { left: 1213, top: 327, right: 1260, bottom: 393 };
  const bonds = { left: 104, top: 91, right: 933, bottom: 143 };
  // the plain countdown and its warning end above the list: it stays home
  assert.equal(leaderRankSpot({ panel: home, column: { left: 1030, top: 13, right: 1260, bottom: 102 }, hud }), null);
  // the TV reaches y 210 and the warning y 242: under them (242 + 6), at its home right edge (1280 − 1219)
  assert.deepEqual(leaderRankSpot({ panel: home, column: tv, hud, bonds, floor: 627 }), { top: 248, right: 61 });
  // the DP box beside it (x 1213…) would meet the list there: its right edge steps left of the box (1280 − 1213 + 6)
  assert.deepEqual(leaderRankSpot({ panel: home, column: tv, hud, bonds, dp, floor: 627 }), { top: 248, right: 73 });
  // 乌萨斯齐心团's wide column (from x 594) no longer sends it to the middle of the field
  assert.deepEqual(leaderRankSpot({ panel: home, column: { left: 594, top: 13, right: 1260, bottom: 190 }, hud, bonds, dp, floor: 627 }), { top: 196, right: 61 });
  // no room under the column above the floor: left of the column, its top under the bonds (bottom 143) + 6
  assert.deepEqual(leaderRankSpot({ panel: home, column: tv, hud, bonds, dp, floor: 300 }), { top: 149, right: 258 });
  // without a bond strip the top stays
  assert.deepEqual(leaderRankSpot({ panel: home, column: tv, hud, floor: 300 }), { top: 130, right: 258 });
  // nothing measured: home
  assert.equal(leaderRankSpot({ panel: null, column: null, hud }), null);
  // the style carries the spot
  const v = LeaderRank({ rows: ROWS, players: PLAYERS, maxHp: 100, spot: { top: 248, right: 73 } });
  assert.equal(v.props.class, 'ldmg is-moved');
  assert.equal(v.props.style, 'top:248px;right:73px');
  assert.equal(LeaderRank({ rows: ROWS, players: PLAYERS, maxHp: 100 }).props.style, null);
});

test('an otherwise clear countdown does not let the chart cover the DP box', () => {
  assert.deepEqual(leaderRankSpot({ panel: { left: 400, right: 620, top: 80, bottom: 240 },
    column: { left: 500, right: 650, top: 0, bottom: 60 },
    hud: { left: 0, right: 667, top: 0, bottom: 375 }, dp: { left: 600, right: 667, top: 160, bottom: 220 } }),
  { top: 80, right: 73 });
});
