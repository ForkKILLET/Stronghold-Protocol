// User-confirmed Regulation rule: sum every living player's remaining LP, then drain one shared pool on overtime.
// Direct FakeBattle setup only; no full match or simulation corpus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { makeMatch } from './harness.js';

const data = getVersionData('act3autochess@V3_1');
function boss(t, { clientCombat = false, eliminated = false } = {}) {
  const h = makeMatch({ data, mode: 'coop', modeId: 'mode_multi_abyss', humans: 4,
    seed: 73, fake: true, instant: false, clientCombat, clients: false }).start();
  t.after(() => h.m.dispose());
  const m = h.m;
  m.setDeadline(0);
  [19, 7, 41, 13].forEach((lp, i) => { m.order[i].lp = lp; });
  // Deliberately retain positive LP on the eliminated record: only live seats may contribute.
  if (eliminated) m.order[3].alive = false;
  m.round = m.gd.bossRound;
  m.startFinalAssault(false);
  return m;
}

for (const clientCombat of [false, true]) {
  test(`Regulation: two boss groups share all remaining LP and one overtime deduction (client=${clientCombat})`, t => {
    const m = boss(t, { clientCombat });
    assert.equal(m.fields.length, 2);
    assert.equal(m.teamLp, 80);
    assert.equal(m.publicView().teamLp, 80);
    for (const f of m.fields) {
      const input = f.spec || f.battle.opts;
      assert.ok(input.players.every(p => p.lpForBoss === 80), 'each group sees the entire pool');
    }
    const after = m.bossOvertimeStartReal, scale = m.gd.combatTimeScale;
    const rate = m.gd.bossOvertimeDrainReal;
    m._applyOvertime((after + 0.9) * scale);
    assert.equal(m.teamLp, 80);
    for (let i = 0; i < m.fields.length; i++) m._applyOvertime((after + 1) * scale);
    assert.equal(m.teamLp, 80 - rate, 'same elapsed time cannot drain once per field or player');
    m._applyOvertime((after + 3) * scale);
    assert.equal(m.teamLp, 80 - 3 * rate, 'catch-up deducts only the elapsed difference');
    m._syncTeamLp();
    assert.equal(m.alivePlayers().reduce((n, p) => n + p.lp, 0), m.teamLp);
    assert.equal(m.publicView().teamLp, m.teamLp);
  });
}

test('Regulation: eliminated players do not contribute to the shared boss LP pool', t => {
  const m = boss(t, { eliminated: true });
  assert.equal(m.fields.length, 2, 'three living players still occupy two groups');
  assert.equal(m.teamLp, 67);
  assert.equal(m.order[3].lpAtFinal, null);
});
