// The DIY skin must cross the same owner/prep/battle/checkpoint boundaries as a preset operator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, legalTileFor } from './match/harness.js';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { freezeSkins } from '../shared/skins.js';
import { Battle } from '../server/sim/Battle.js';
import { snapshotMatch, restoreMatch } from '../server/match/snapshot.js';
import { createRngFromState } from '../server/sim/rng.js';

const SLOT = 'chess_char_5_diy1_a', ELITE = 'chess_char_5_diy1_b';
const PICK = { charId: 'char_112_siege', skillIndex: 2, uniEquipId: 'uniequip_002_siege' };
const SKIN = `${PICK.charId}@striker#2`, OTHER = `${PICK.charId}@wild#2`;
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

test('only base DIY slots are accepted; lobby session, seat and owner preferences stay separate', t => {
  const choices = { [SLOT]: SKIN, [ELITE]: SKIN, unknown: SKIN };
  assert.deepEqual(freezeSkins(choices, id => DATA.chess[id]), { [SLOT]: SKIN });
  const registry = new SessionRegistry(), lobby = new Lobby({ registry, getData: () => DATA, log: quiet });
  t.after(() => lobby.shutdown());
  const a = registry.create('A'), b = registry.create('B');
  a.connected = b.connected = true;
  assert.equal(lobby.create(a, { mode: 'coop', difficulty: 'NORMAL' }).ok, true);
  assert.equal(lobby.skins(a, { skins: choices }).ok, true);
  assert.deepEqual(a.skins, { [SLOT]: SKIN });
  assert.deepEqual(lobby.roomOf(a).seatOf(a.playerId).skins, a.skins);
  assert.equal(lobby.skins(b, { skins: { [SLOT]: OTHER } }).ok, true);
  assert.deepEqual(b.skins, { [SLOT]: OTHER });
  assert.deepEqual(a.skins, { [SLOT]: SKIN });
});

test('DIY skins survive prep, scouting, battle input/sim, live edits and checkpoint restore without changing kits', t => {
  const seats = [SKIN, OTHER].map((skin, i) => ({ seat: i, playerId: `p_${i}`, name: `P${i}`, connected: true,
    diy: { [SLOT]: PICK }, skins: { [SLOT]: skin } }));
  const h = makeMatch({ mode: 'coop', seats }); t.after(() => h.m.dispose());
  h.start().toPrep(1);
  for (const [i, skin] of [SKIN, OTHER].entries()) {
    const ps = h.ps(`p_${i}`);
    assert.equal(ps.skins[SLOT], skin, 'initial raw slot is accepted before the composed data view exists');
    for (const id of [SLOT, ELITE]) {
      const piece = ps.newPiece('chess', id), tile = legalTileFor(h.m, ps, id);
      assert.ok(tile);
      ps.board.set(tile.join(','), piece);
      assert.equal(ps.pieceView(piece).skin, skin);
    }
    const scout = h.m.prepFieldMeta(ps).units.filter(u => u.diy);
    assert.equal(scout.length, 2);
    assert.ok(scout.every(u => u.skin === skin));
    const input = ps.battleInput({ side: 'ally' });
    assert.equal(input.units.length, 2);
    for (const u of input.units) { assert.equal(u.skin, skin); assert.deepEqual(u.diy, PICK); }
    const battle = new Battle({ fieldId: `n:p_${i}`, kind: 'normal', players: [input], spawns: [], data: DATA, log: quiet });
    battle.start();
    const units = battle.fieldMeta().units.filter(u => u.diy);
    assert.equal(units.length, 2);
    for (const u of units) { assert.equal(u.skin, skin); assert.equal(u.diy.charId, PICK.charId); }
  }
  const ps = h.ps('p_0'), before = ps.battleInput({ side: 'ally' });
  h.m.setSkins('p_0', { [SLOT]: OTHER });
  const changed = ps.battleInput({ side: 'ally' });
  const withoutSkin = input => ({ ...input, units: input.units.map(({ skin: _skin, ...u }) => u) });
  assert.deepEqual(withoutSkin(changed), withoutSkin(before), 'cosmetic edits cannot alter skills, modules or stats');
  assert.equal(before.units[0].skin, SKIN, 'an already-created battle input stays frozen');
  assert.ok(changed.units.every(u => u.skin === OTHER));
  const cp = snapshotMatch(h.m), back = makeMatch({ mode: 'coop', seats }); t.after(() => back.m.dispose());
  assert.equal(restoreMatch(back.m, cp, { createRngFromState, log: quiet }), true);
  assert.equal(back.ps('p_0').skins[SLOT], OTHER);
  assert.equal(back.ps('p_0').gd.chess(ELITE).charId, PICK.charId);
  assert.equal(back.ps('p_0').pieceView([...back.ps('p_0').board.values()][0]).skin, OTHER);
  assert.ok(Object.isFrozen(back.ps('p_0').skins));
});
