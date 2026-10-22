import { html } from './components.js';
import { progressLabel } from '../itemProgress.js';
import { t, N_ } from '../../../shared/i18n.js';

const LABELS = {
  refresh: N_('主动刷新'), spend: N_('累计消费'), 'spend-once': N_('累计消费'),
  'refresh-uses': N_('本回合特殊刷新'), income: N_('下回合追加资金'), exchange: N_('本回合交换'), discount: N_('本回合优惠'),
};
const CONSUMED = new Set(['refresh-uses', 'exchange', 'discount']);

/** One presentation for the sidebar, tooltip and strategy details; all values belong to the shown player. */
export function strategyProgressModel(effect) {
  if (!effect) return null;
  const type = effect.progressType || 'refresh';
  if (type === 'special-refresh') {
    if (!Number.isInteger(effect.remaining) || effect.remaining < 0) return null;
    return { badge: t('剩余 {count} 次', { count: effect.remaining }), lines: [[t('待用特殊刷新'), String(effect.remaining)]] };
  }
  const progress = progressLabel(effect.progress);
  if (!progress || !LABELS[type]) return null;
  const full = effect.progress.current >= effect.progress.total;
  let badge = progress;
  const lines = [[t(LABELS[type]), progress]];
  if (type === 'spend-once') {
    if (effect.completed) badge = t('已完成');
    lines.push([t('奖励状态'), effect.completed ? t('已获得') : t('未获得')]);
  } else if (CONSUMED.has(type) && full) badge = t('本回合已用尽');
  else if (type === 'income' && full) badge = t('本回合已满');
  const rewards = progressLabel(effect.roundProgress);
  if (rewards) {
    lines.push([t('本回合获得'), rewards]);
    if (effect.roundProgress.current >= effect.roundProgress.total) badge = t('本回合已满');
  }
  return { badge, lines };
}

export function StrategyProgress({ effect }) {
  const model = strategyProgressModel(effect);
  return model ? html`<div class="strategy-progress">${model.lines.map(([label, value]) =>
    html`<p key=${label}>${label} <strong class="num">${value}</strong></p>`)}</div>` : null;
}
