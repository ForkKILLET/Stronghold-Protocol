// Local achievement aggregates. Only retained browser records; no account or server state.
import { isModdedRecord, countsTowardStats, selfRowOf, roundsOf } from './stats.js';
import { N_ } from '../../../shared/i18n.js';
/** 绝境突破: a clear on these difficulties. */
const HARD_UP = new Set(['HARD', 'ABYSS']);
/** The hexagon's 评语, clockwise from the top (the official order). */
export const HEX_TITLES = ['comment_4', 'comment_5', 'comment_6', 'comment_1', 'comment_2', 'comment_3'];

// Design reference: Stardust-minus d6e96f4 / 70875f41. Progress is derived, never separately persisted.
export const ACHIEVEMENT_GROUPS = [
  ['career', N_('模拟经历'), 'hourglass'], ['victory', N_('胜利'), 'crown'], ['difficulty', N_('难度'), 'rook'],
  ['alliance', N_('同盟'), 'users'], ['strategy', N_('策略'), 'book'], ['combat', N_('战斗'), 'sword'],
  ['trophy', N_('奖杯'), 'crown'],
];
export const ACHIEVEMENTS = [
  { id: 'games_1', group: 'career', name: N_('初次模拟'), desc: N_('完成 1 场模拟'), goal: 1, value: (p) => p.games },
  { id: 'games_10', group: 'career', name: N_('例行演练'), desc: N_('完成 10 场模拟'), goal: 10, value: (p) => p.games },
  { id: 'games_50', group: 'career', name: N_('久经推演'), desc: N_('完成 50 场模拟'), goal: 50, value: (p) => p.games },
  { id: 'games_200', group: 'career', name: N_('卫戍常驻'), desc: N_('完成 200 场模拟'), goal: 200, value: (p) => p.games },
  { id: 'hours_10', group: 'career', name: N_('长时值守'), desc: N_('累计模拟 10 小时'), goal: 10, value: (p) => Math.floor(p.hours) },
  { id: 'wins_1', group: 'victory', name: N_('初战告捷'), desc: N_('取得 1 场胜利'), goal: 1, value: (p) => p.wins },
  { id: 'wins_20', group: 'victory', name: N_('屡战屡胜'), desc: N_('取得 20 场胜利'), goal: 20, value: (p) => p.wins },
  { id: 'wins_100', group: 'victory', name: N_('百战不殆'), desc: N_('取得 100 场胜利'), goal: 100, value: (p) => p.wins },
  { id: 'clear_FUNNY', group: 'difficulty', name: N_('标准达成'), desc: N_('在标准模拟中获胜'), goal: 1, value: (p) => p.clears.FUNNY },
  { id: 'clear_NORMAL', group: 'difficulty', name: N_('险境突破'), desc: N_('在险境模拟中获胜'), goal: 1, value: (p) => p.clears.NORMAL },
  { id: 'clear_HARD', group: 'difficulty', name: N_('绝境求生'), desc: N_('在绝境模拟中获胜'), goal: 1, value: (p) => p.clears.HARD },
  { id: 'clear_ABYSS', group: 'difficulty', name: N_('终极考验'), desc: N_('在终极模拟中获胜'), goal: 1, value: (p) => p.clears.ABYSS },
  { id: 'hidden_1', group: 'difficulty', name: N_('触及核心'), desc: N_('击破隐秘核心 1 次'), goal: 1, value: (p) => p.hidden },
  { id: 'hidden_10', group: 'difficulty', name: N_('核心猎手'), desc: N_('击破隐秘核心 10 次'), goal: 10, value: (p) => p.hidden },
  { id: 'hidden_abyss', group: 'difficulty', name: N_('深渊之底'), desc: N_('在终极模拟中击破隐秘核心'), goal: 1, value: (p) => p.hiddenAbyss },
  { id: 'coop_10', group: 'alliance', name: N_('同盟战友'), desc: N_('完成 10 场同盟模拟'), goal: 10, value: (p) => p.modes.coop.games },
  { id: 'coop_wins_10', group: 'alliance', name: N_('同盟凯歌'), desc: N_('同盟模拟获胜 10 场'), goal: 10, value: (p) => p.modes.coop.wins },
  { id: 'solo_wins_10', group: 'alliance', name: N_('独当一面'), desc: N_('独立模拟获胜 10 场'), goal: 10, value: (p) => p.modes.solo.wins },
  { id: 'bands_10', group: 'strategy', name: N_('博采众长'), desc: N_('使用过 10 种不同的策略'), goal: 10, value: (p) => p.bandKinds },
  { id: 'bands_25', group: 'strategy', name: N_('运筹帷幄'), desc: N_('使用过 25 种不同的策略'), goal: 25, value: (p) => p.bandKinds },
  { id: 'titles_6', group: 'strategy', name: N_('评语收藏家'), desc: N_('获得全部 6 种评语'), goal: 6, value: (p) => p.titleKinds },
  { id: 'kills_1000', group: 'combat', name: N_('千军辟易'), desc: N_('累计击倒 1,000 名敌人'), goal: 1000, value: (p) => p.sums.kills },
  { id: 'kills_20000', group: 'combat', name: N_('万夫莫当'), desc: N_('累计击倒 20,000 名敌人'), goal: 20000, value: (p) => p.sums.kills },
  { id: 'boss_1m', group: 'combat', name: N_('领袖克星'), desc: N_('累计对领袖造成 1,000,000 伤害'), goal: 1_000_000, value: (p) => p.sums.bossDamage },
  { id: 'perfect_50', group: 'combat', name: N_('完美作战'), desc: N_('累计 50 回合完美作战'), goal: 50, value: (p) => p.sums.perfectRounds },
  { id: 'merges_200', group: 'combat', name: N_('精英集结'), desc: N_('累计晋升干员 200 次'), goal: 200, value: (p) => p.sums.merges },
  { id: 'trophy_10', group: 'trophy', name: N_('崭露头角'), desc: N_('累计获得 10 个奖杯'), goal: 10, value: (p) => p.trophies },
  { id: 'trophy_30', group: 'trophy', name: N_('声名鹊起'), desc: N_('累计获得 30 个奖杯'), goal: 30, value: (p) => p.trophies },
  { id: 'trophy_60', group: 'trophy', name: N_('威名远扬'), desc: N_('累计获得 60 个奖杯'), goal: 60, value: (p) => p.trophies },
  { id: 'trophy_100', group: 'trophy', name: N_('卫戍传奇'), desc: N_('累计获得 100 个奖杯'), goal: 100, value: (p) => p.trophies },
];

export function achievementsOf(progress) {
  return ACHIEVEMENTS.map((a) => {
    const raw = a.value(progress);
    const value = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    return { ...a, current: Math.min(value, a.goal), done: value >= a.goal, frac: Math.min(1, value / a.goal) };
  });
}

/**
 * Everything the panel shows, from the local records (any order). `hiddenLayers(bondId)`: a bond whose layers the game
 * never shows (bonds.json noStack) cannot be the 战果纪录.
 * @param {any[]} records
 * @param {{ hiddenLayers?: (bondId: string) => boolean }} [o]
 */
export function achievementStats(records, { hiddenLayers = () => false } = {}) {
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const out = {
    trophies: 0, bestRound: 0, count: 0, detailed: 0,
    modes: { solo: { games: 0, wins: 0, hard: 0 }, coop: { games: 0, wins: 0, hard: 0 } },
    titles: Object.create(null), best: null, maxima: { gold: 0, merges: 0, kills: 0 },
    topBonds: [], topBands: [], markedBands: [],
  };
  const bonds = new Map();
  const bands = new Map();
  const marked = new Set();
  const seen = new Set();
  const progress = { wins: 0, hours: 0, hidden: 0, hiddenAbyss: 0, clears: Object.create(null), sums: Object.create(null) };
  for (const rec of Array.isArray(records) ? records : []) {
    const self = rec ? selfRowOf(rec) : null;
    if (!self || (rec.id && seen.has(rec.id))) continue;
    if (rec.id) seen.add(rec.id);
    if (!countsTowardStats(rec) || isModdedRecord(rec)) continue;
    out.count++;
    if (!rec.compact) out.detailed++;
    out.trophies += Math.max(0, num(self.trophies));
    out.bestRound = Math.max(out.bestRound, roundsOf(rec));
    const won = !!self.victory;
    if (won) { progress.wins++; progress.clears[rec.difficulty] = (progress.clears[rec.difficulty] || 0) + 1; }
    progress.hours += Math.max(0, num(rec.durationMs)) / 3.6e6;
    if (rec.hiddenCleared) {
      progress.hidden++;
      if (rec.difficulty === 'ABYSS') progress.hiddenAbyss++;
    }
    const hardWin = won && HARD_UP.has(rec.difficulty);
    const mode = Object.hasOwn(out.modes, rec.roomMode) ? out.modes[rec.roomMode] : null;
    if (mode) { mode.games++; if (won) mode.wins++; if (hardWin) mode.hard++; }
    const tid = self.title?.id;
    if (tid) out.titles[tid] = (out.titles[tid] || 0) + 1;
    const st = self.stats || {};
    if (rec.end !== 'quit') for (const k of ['kills', 'bossDamage', 'perfectRounds', 'merges']) {
      progress.sums[k] = (progress.sums[k] || 0) + num(st[k]);
    }
    for (const k of ['gold', 'merges', 'kills']) if (rec.end !== 'quit' && num(st[k]) > out.maxima[k]) out.maxima[k] = st[k];
    if (self.bandId) {
      bands.set(self.bandId, (bands.get(self.bandId) || 0) + 1);
      if (hardWin) marked.add(self.bandId);
    }
    const seenBonds = new Set();
    for (const b of Array.isArray(self.bonds) ? self.bonds : []) {
      if (!b || !b.bondId || rec.compact || seenBonds.has(b.bondId)) continue;
      seenBonds.add(b.bondId);
      if (b.active) bonds.set(b.bondId, (bonds.get(b.bondId) || 0) + 1);
      const layers = num(b.layers);
      if (layers > 0 && !hiddenLayers(b.bondId) && (!out.best || layers > out.best.layers)) out.best = { rec, self, bondId: b.bondId, layers };
    }
  }
  const top = (map) => [...map].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3);
  out.topBonds = top(bonds).map(([bondId, games]) => ({ bondId, games }));
  out.topBands = top(bands).map(([bandId, games]) => ({ bandId, games }));
  out.markedBands = [...marked];
  out.achievements = achievementsOf({
    ...progress, games: out.count, modes: out.modes, trophies: out.trophies,
    bandKinds: bands.size, titleKinds: HEX_TITLES.filter((id) => out.titles[id] > 0).length,
  });
  out.achieved = out.achievements.filter((a) => a.done).length;
  return out;
}

/** The operators of a bond (plain chess, one per operator), by tier. */
export function bondOperators(chessList, bondId) {
  const seen = new Set();
  return (Array.isArray(chessList) ? chessList : [])
    .filter((c) => c && !c.isGolden && c.visible !== false && !c.isHidden && !c.isDiy && Array.isArray(c.bonds) && c.bonds.includes(bondId))
    .sort((a, b) => (a.tier - b.tier) || ((a.shopSortId ?? 0) - (b.shopSortId ?? 0)))
    .filter((c) => { const k = c.charId || c.chessId; if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * The 战果纪录's bonds beside the lineup: that match's bonds (active ones first, then by layers), at most six — the
 * 2×3 grid of the reference. `noStack(bondId)`: a bond whose layers the game never shows prints a dash.
 */
export function recordBonds(list, noStack = () => false) {
  return (Array.isArray(list) ? list : [])
    .filter((b) => b && b.bondId && (b.active || Number(b.layers) > 0))
    .map((b) => ({ bondId: b.bondId, active: !!b.active, layers: Math.max(0, Number(b.layers) || 0), hidden: noStack(b.bondId) }))
    .sort((a, b) => (b.active - a.active) || ((b.hidden ? -1 : b.layers) - (a.hidden ? -1 : a.layers)))
    .slice(0, 6);
}
