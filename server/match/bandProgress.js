// Read-only strategy counters. The content handlers remain the sole owners of these values.
export function bandProgressView(ps) {
  const band = ps.bandId ? ps.gd.band(ps.bandId) : null;
  if (!band) return null;
  const params = key => {
    const b = band.buffs?.find(b => b.key === key);
    return b ? { ...b.bb, ...b.bbStr } : null;
  };
  const count = key => Number.isFinite(ps.counters[key]) ? Math.max(0, Math.trunc(ps.counters[key])) : 0;
  // Match-side round counters reset lazily; a view must not perform that reset.
  const roundCount = key => ps.counters[`${key}:r`] === ps.m.round ? count(key) : 0;
  const positive = n => Number.isFinite(n) && Math.trunc(n) > 0 ? Math.trunc(n) : null;
  const progress = (current, total) => ({ current, total });
  let p;
  if ((p = params('refresh_shop_count_gain_coin_bond_char_chess'))) {
    const total = positive(p.refresh_count), limit = positive(p.max_count);
    return total ? { progress: progress(count('band:chiave:refreshes') % total, total),
      ...(limit ? { roundProgress: progress(roundCount('band:chiave'), limit) } : {}) } : null;
  }
  if ((p = params('band_coin_cost_gain_random_char_by_shop_level'))) {
    const total = positive(p.coin_cnt);
    return total ? { progressType: 'spend', progress: progress(count('band:kirara:acc'), total) } : null;
  }
  if ((p = params('band_cost_coin_reach_cnt_gain_chess_from_pool'))) {
    const total = positive(p.coin_cnt);
    return total ? { progressType: 'spend-once', progress: progress(Math.min(count('band:paganini:spent'), total), total),
      completed: count('band:paganini:done') > 0 } : null;
  }
  if (params('band_first_self_refresh_present_char')) {
    // The handler uses the first TWO manual refreshes; bb.count is operators per refresh, not the use limit.
    return { progressType: 'refresh-uses', progress: progress(Math.min(ps.round.refreshes || 0, 2), 2) };
  }
  if ((p = params('round_start_gain_coin_by_bond_char_chess_buy'))) {
    const total = positive(p.max_count);
    return total ? { progressType: 'income', progress: progress(roundCount('band:mlynar'), total) } : null;
  }
  if ((p = params('first_sell_char_chess_exchange_char_chess_in_shop'))) {
    return { progressType: 'exchange', progress: progress(roundCount('band:vodfox'), positive(p.count) || 1) };
  }
  if (params('first_buy_in_round_char_price_change')) {
    return { progressType: 'discount', progress: progress(ps.counters['band:sciurus:r'] === ps.m.round ? 1 : 0, 1) };
  }
  if (params('up_shop_next_refresh_must_present_bond_char')) {
    return { progressType: 'special-refresh', remaining: count('band:pepe:special') };
  }
  return null;
}
