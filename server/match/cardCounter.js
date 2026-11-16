// Read-only, requester-only shared-stock inspection. No RNG, reservations, recompute or replay state.
// A displayed shop/offer reserves nothing; held equivalents and real poolCopies are different quantities.
export function cardCounterView(m, viewer, chessId, seq) {
  const rec = m.gd.chess(chessId);
  if (!rec || rec.isDiy) return null;
  const base = m.gd.baseIdOf(chessId);
  const entry = m.pool.entries.get(base);
  const goldenCopies = m.gd.goldenCopies;
  const holders = m.order.map(ps => {
    let normal = 0, elite = 0, occupied = 0;
    for (const piece of [...ps.hand, ...ps.temp, ...ps.board.values()]) {
      if (piece?.kind !== 'chess' || ps.gd.baseIdOf(piece.id) !== base) continue;
      if (ps.gd.isGolden(piece.id)) elite++;
      else normal++;
      // Unknown provenance is not a zero-copy gift (defensive compatibility with incomplete old records).
      if (occupied != null) occupied = Number.isInteger(piece.poolCopies) && piece.poolCopies >= 0
        ? occupied + piece.poolCopies : null;
    }
    const held = normal + elite * goldenCopies;
    return { playerId: ps.playerId, name: ps.name, alive: ps.alive && !ps.left,
      normal, elite, held, occupied, extra: occupied == null ? null : Math.max(0, held - occupied) };
  });
  // Exactly the ordinary chess-slot candidate set, including this viewer's own eligible DIY stock.
  // A natural slot does not deplete stock, so a full natural refresh is K independent draws from this set.
  const eligible = m.pool._eligible({ maxTier: viewer.shop.level, extra: viewer.diyRollEntries() });
  let denominator = 0, numerator = 0;
  for (const [id, copies] of eligible) { denominator += copies; if (id === base) numerator += copies; }
  const slot = denominator > 0 ? numerator / denominator : 0;
  const slots = m.gd.shopSlots(viewer.shop.level).chess;
  return {
    t: 'm.cardCounter', seq, matchKey: `${m.roomCode}:${m.battlePrefix}`, playerId: viewer.playerId,
    chessId: base, round: m.round, at: m.sched.now(), goldenCopies,
    status: entry ? 'shared' : m.bannedChess.includes(base) ? 'banned' : 'unpooled',
    total: entry?.cap ?? null, remaining: entry ? m.pool.left(base) : null,
    overdraw: entry ? Math.max(0, -entry.left) : 0,
    held: holders.reduce((sum, p) => sum + p.held, 0), holders,
    odds: { level: viewer.shop.level, slots, numerator, denominator, slot,
      refresh: slots > 0 ? -Math.expm1(slots * Math.log1p(-slot)) : 0 },
  };
}
