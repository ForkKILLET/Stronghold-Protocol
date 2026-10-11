// server/match/match/pause.js — Match methods: global pause (g.pause) — freeze, resume
// (every clock and deadline shifted by the pause), the drop at the battle phase's end, and the field clocks' "now".
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { BOSS_CLOCK_MS, OK, fail } from './common.js';

export class MatchPause {
  /** Connected, active human participants vote; AI and spectators never prevent a pause. */
  pauseVoters() { return this.humans().filter(p => p.alive && p.connected); }

  setPause(ps, on) {
    if ([PHASE.LOBBY, PHASE.RESULT].includes(this.phase) || this._finalEnding) return fail(ERR.WRONG_PHASE);
    if (!this.pauseVoters().includes(ps)) return fail(ERR.WRONG_PHASE);
    if (!on) {
      this.pauseRequests.delete(ps.playerId);
      this._resume();
      this.markPublic();
      return OK;
    }
    this.pauseRequests.add(ps.playerId);
    if (!this.paused && this.pauseVoters().every(p => this.pauseRequests.has(p.playerId))) {
      this.paused = true;
      this._pausedAt = this.sched.now();
      this._suspendTimers();
    }
    this.markPublic();
    return OK;
  }

  /** End a global pause: every clock and deadline moves on by the paused time (no-op when not paused). */
  _resume() {
    if (!this.paused) return;
    const d = Math.max(0, this.sched.now() - this._pausedAt);
    this.paused = false;
    this._pausedAt = 0;
    this.pausedMs += d;
    if (this.deadline) this.deadline += d;
    if (this.overtimeAt) this.overtimeAt += d;
    if (this._bossStartAt != null) this._bossStartAt += d;
    for (const f of this.fields) {
      if (!f.cc || f.done) continue;
      f.startAt += d;
      f.lastProgressAt += d;
      if (f.rearmDeadline && f.mode === 'client') this._armDeadline(f);
      if (f.rearmRelease && f.mode === 'server') this._armRelease(f);
      f.rearmDeadline = false;
      f.rearmRelease = false;
    }
    for (const clock of [this.draft, this.sp]) if (clock?.turnDeadline) clock.turnDeadline += d;
    this._resumeTimers();
    const reports = [...this._pausedReports.values()];
    this._pausedReports.clear();
    for (const {ps, msg} of reports) {
      if (msg.t === 'b.progress') this._onProgress(ps, msg); else this._onResult(ps, msg);
    }
    for (const f of this.fields.filter(x => x.pendingDone)) {
      f.pendingDone = false;
      this._fieldDone(f);
    }
    for (const f of this.fields.filter((x) => x.verifying && x.resultSource === 'verified' && x.result)) {
      f.verifying = false;
      this._fieldDone(f);
    }
    if (this._bossClockOn && !this._bossClock && (this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE)) {
      this._bossClock = this.later(BOSS_CLOCK_MS, () => this._bossClockTick());
    }
    if ([PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE].includes(this.phase)) this._checkFinalEnd();
    this.markPublic();
  }

  /** The battle phase is over: drop the pause without shifting anything (its timers are gone). */
  _clearPause() {
    this.pauseRequests.clear();
    this._pausedReports.clear();
    if (!this.paused) return;
    this.pausedMs += Math.max(0, this.sched.now() - this._pausedAt);
    this.paused = false;
    this._pausedAt = 0;
    this._resumeTimers();
    this.markPublic();
  }

  /** The field clocks' "now": frozen at the pause instant while paused. */
  _clockNow() { return this.paused ? this._pausedAt : this.sched.now(); }
}
