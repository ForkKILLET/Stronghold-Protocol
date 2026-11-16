// Only an open, visible card tracker polls. Correlation includes the match, owner and target, across remounts.
let sequence = 0;
export function watchCardCounter({ net, chessId, playerId, matchKey, onState,
  visible = () => true, timers = globalThis, interval = 2000, timeout = 5000 }) {
  let stopped = false, pending = null, next = null, expiry = null, data = null, lastError = null;
  const state = (loading, error = lastError) => { lastError = error; if (!stopped) onState({ data, loading, error }); };
  const schedule = () => {
    if (!stopped && visible()) next = timers.setTimeout(query, interval);
  };
  const finish = () => {
    if (expiry != null) timers.clearTimeout(expiry);
    expiry = null; pending = null;
  };
  const fail = (seq, code) => {
    if (stopped || pending !== seq) return;
    finish(); state(false, code || 'FAILED');
    if (code !== 'BAD_MSG') schedule();
  };
  function query() {
    if (next != null) timers.clearTimeout(next);
    next = null;
    if (stopped || pending != null || !visible()) return;
    const seq = sequence = sequence % 2_000_000_000 + 1;
    pending = seq;
    state(true);
    expiry = timers.setTimeout(() => fail(seq, 'TIMEOUT'), timeout);
    try {
      Promise.resolve(net.request('g.cardCounter', { chessId, seq }, { timeout }))
        .catch(error => fail(seq, error?.code));
    } catch (error) { fail(seq, error?.code); }
  }
  const off = net.on('m.cardCounter', msg => {
    if (stopped || pending == null || msg?.seq !== pending || msg.chessId !== chessId
      || msg.playerId !== playerId || msg.matchKey !== matchKey || !Array.isArray(msg.holders) || !msg.odds) return;
    finish(); data = msg; state(false, null); schedule();
  });
  query();
  return {
    refresh: query,
    stop() {
      stopped = true;
      off();
      if (next != null) timers.clearTimeout(next);
      finish();
    },
  };
}
