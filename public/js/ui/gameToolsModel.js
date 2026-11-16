import { N_ } from '../../../shared/i18n.js';

export const GAME_TOOLS = Object.freeze([
  { id: 'metrics', label: N_('作战统计'), icon: 'signal', description: N_('查看本机作战伤害与治疗') },
  { id: 'cards', label: N_('记牌器'), icon: 'copy', description: N_('查看共享卡池与干员持有分布') },
  { id: 'boss', label: N_('领袖伤害排行'), icon: 'sword', description: N_('查看领袖战干员与玩家伤害排行') },
]);

export function pinnedTools(pref) {
  if (pref?.v !== 1 || !Array.isArray(pref.pinned)) return ['metrics'];
  return GAME_TOOLS.filter(tool => pref.pinned.includes(tool.id)).map(tool => tool.id);
}

export const DEFAULT_CARD_FAVORITE = 'char_249_mlyss';
export function favoriteOperators(pref) {
  if (pref?.v !== 1 || !Array.isArray(pref.favorites)) return [DEFAULT_CARD_FAVORITE];
  return [...new Set(pref.favorites.filter(id => typeof id === 'string' && /^char_[a-zA-Z0-9_]+$/.test(id) && id.length <= 64))].slice(0, 160);
}

/** Source identities, not chess ids, keep a favorite across seasons that reuse ids for different operators. */
export function counterRoster(list) {
  return (Array.isArray(list) ? list : []).filter(c => c?.charId && c.chessId && c.visible && !c.isHidden && !c.isGolden && !c.isDiy)
    .sort((a, b) => b.tier - a.tier || a.chessId.localeCompare(b.chessId));
}

export function oddsText(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return '—';
  if (value > 0 && value < .00001) return '<0.001%';
  return `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 3 })}%`;
}
