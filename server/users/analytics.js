// Additive operational history, stored in the account Worker, not in the independent admin process.
import {analyticsDay, analyticsDate, analyticsRange} from '../../shared/adminAnalytics.js';

export function installAnalytics(db, {now = Date.now} = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS analytics_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,started_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS daily_activity(day INTEGER NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),played INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,user_id));
    CREATE INDEX IF NOT EXISTS games_ended_at ON games(ended_at);
    CREATE INDEX IF NOT EXISTS users_created_at ON users(created_at);`);
  db.prepare('INSERT OR IGNORE INTO analytics_schema VALUES(1,1,?)').run(now());
  const meta = db.prepare('SELECT version,started_at AS startedAt FROM analytics_schema WHERE id=1').get();
  if (meta.version !== 1) throw Error('Unsupported analytics schema');
  const touch = db.prepare(`INSERT INTO daily_activity(day,user_id,played) SELECT ?,id,? FROM users WHERE id=?
    ON CONFLICT(day,user_id) DO UPDATE SET played=max(played,excluded.played)`);
  const date = column => `CAST((${column}+28800000)/86400000 AS INTEGER)`;
  return {
    activity({entries}) {
      if (!Array.isArray(entries) || entries.length > 256 || entries.some(e => !Number.isSafeInteger(e?.day) || e.day < 0 || typeof e.id !== 'string' || e.id.length > 128 || typeof e.played !== 'boolean'))
        throw Error('Invalid activity batch');
      db.exec('BEGIN IMMEDIATE');
      try { for (const e of entries) touch.run(e.day, e.played ? 1 : 0, e.id); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
      return true;
    },
    report(input = {}) {
      const at = now(), range = analyticsRange(input, at);
      const daily = new Map(Array.from({length: range.last - range.first + 1}, (_, i) => {
        const day = range.first + i;
        return [day, {date: analyticsDate(day), dau: day < analyticsDay(meta.startedAt) ? null : 0,
          playingAccounts: day < analyticsDay(meta.startedAt) ? null : 0,
          partialActivity: day === analyticsDay(meta.startedAt), newAccounts: 0, settledGames: 0, settledPlayers: 0,
          soloGames: 0, coopGames: 0, otherGames: 0}];
      }));
      for (const r of db.prepare(`SELECT day,count(*) AS n,sum(played) AS playing FROM daily_activity WHERE day BETWEEN ? AND ? GROUP BY day`).all(range.first, range.last)) {
        if (daily.get(r.day).dau != null) { daily.get(r.day).dau = r.n; daily.get(r.day).playingAccounts = r.playing; }
      }
      for (const r of db.prepare(`SELECT ${date('created_at')} AS day,count(*) AS n FROM users WHERE created_at>=? AND created_at<? GROUP BY day`).all(range.start, range.end)) daily.get(r.day).newAccounts = r.n;
      // One game is counted once, independently of its result rows or repeated outbox delivery.
      const games = db.prepare(`SELECT ${date('g.ended_at')} AS day,g.mode,
        (SELECT json_extract(r.payload,'$.frame.roomMode') FROM results r WHERE r.game_id=g.id LIMIT 1) AS roomMode,
        count(*) AS n FROM games g WHERE ended_at>=? AND ended_at<? GROUP BY day,g.mode,roomMode`).all(range.start, range.end);
      for (const r of games) {
        const row = daily.get(r.day); row.settledGames += r.n;
        const mode = r.roomMode || (r.mode?.includes('single') ? 'solo' : r.mode?.includes('multi') ? 'coop' : null);
        row[mode === 'solo' ? 'soloGames' : mode === 'coop' ? 'coopGames' : 'otherGames'] += r.n;
      }
      for (const r of db.prepare(`SELECT ${date('g.ended_at')} AS day,count(DISTINCT r.user_id) AS n
        FROM games g JOIN results r ON r.game_id=g.id WHERE g.ended_at>=? AND g.ended_at<? GROUP BY day`).all(range.start, range.end)) daily.get(r.day).settledPlayers = r.n;
      const days = [...daily.values()];
      const totals = Object.fromEntries(['newAccounts','settledGames','soloGames','coopGames','otherGames'].map(k => [k, days.reduce((sum, r) => sum + r[k], 0)]));
      totals.activeAccounts = range.last < analyticsDay(meta.startedAt) ? null : db.prepare('SELECT count(DISTINCT user_id) AS n FROM daily_activity WHERE day BETWEEN ? AND ?').get(range.first, range.last).n;
      totals.playingAccounts = range.last < analyticsDay(meta.startedAt) ? null : db.prepare('SELECT count(DISTINCT user_id) AS n FROM daily_activity WHERE day BETWEEN ? AND ? AND played=1').get(range.first, range.last).n;
      totals.settledPlayers = db.prepare('SELECT count(DISTINCT r.user_id) AS n FROM results r JOIN games g ON g.id=r.game_id WHERE g.ended_at>=? AND g.ended_at<?').get(range.start, range.end).n;
      const first = db.prepare('SELECT min(ended_at) AS at FROM games').get().at;
      return {at, timezone: 'Asia/Shanghai', range: {from: range.from, to: range.to},
        coverage: {activitySince: meta.startedAt, settlementsSince: first}, totals, days};
    },
  };
}
