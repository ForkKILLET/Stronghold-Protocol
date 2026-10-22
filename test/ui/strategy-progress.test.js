import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strategyProgressModel } from '../../public/js/ui/strategyProgress.js';

test('strategy labels distinguish expenditure, completion, uses, income and available refreshes', () => {
  const make = (progressType, current, total, extra = {}) => strategyProgressModel({ progressType, progress: { current, total }, ...extra });
  assert.deepEqual(make('spend', 7, 20).lines, [['累计消费', '7 / 20']]);
  assert.equal(make('spend-once', 55, 55, { completed: false }).badge, '55 / 55', 'reaching a threshold is not proof of a reward');
  assert.equal(make('spend-once', 55, 55, { completed: true }).badge, '已完成');
  for (const type of ['refresh-uses', 'exchange', 'discount']) assert.equal(make(type, 2, 2).badge, '本回合已用尽');
  assert.equal(make('income', 3, 3).badge, '本回合已满');
  assert.equal(strategyProgressModel({ progressType: 'special-refresh', remaining: 0 }).badge, '剩余 0 次');
  assert.equal(strategyProgressModel({ progressType: 'unknown', progress: { current: 0, total: 1 } }), null);
  assert.equal(strategyProgressModel(null), null);
});
