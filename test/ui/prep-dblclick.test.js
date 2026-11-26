// A teammate takes two clicks to watch; the own avatar returns home on one click.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playerAvatarAction, teammateFieldShown } from '../../public/js/ui/teamPanel.js';

const mate = { playerId: 'p_1', fieldId: 'f1' };
const own = { playerId: 'p_0', fieldId: 'home' };

test('first click and selecting a different player open information without watching', () => {
  assert.equal(playerAvatarAction({ player: mate }), 'open');
  assert.equal(playerAvatarAction({ player: mate, openPid: 'p_2' }), 'open');
  assert.equal(playerAvatarAction({ player: own, self: true, observe: { observing: false } }), 'open');
});

test('second click watches in either combat mode; already shown and repeated requests only close', () => {
  for (const observe of [null, { observing: false }]) {
    const o = { openPid: 'p_1', player: mate, observe };
    assert.equal(playerAvatarAction(o), 'watch');
    assert.equal(playerAvatarAction({ ...o, watching: 'f1' }), 'close');
    assert.equal(playerAvatarAction({ ...o, watching: 'n:p_1' }), 'close');
    assert.equal(playerAvatarAction({ ...o, askedRecently: true }), 'close');
  }
});

test('own avatar returns immediately, or closes selected teammate information when already home', () => {
  const o = { openPid: 'p_0', player: own, self: true };
  assert.equal(playerAvatarAction({ ...o, observe: { observing: true } }), 'back');
  assert.equal(playerAvatarAction({ ...o, observe: { observing: false } }), 'close');
  assert.equal(playerAvatarAction({ ...o, watching: 'other' }), 'watch');
  assert.equal(playerAvatarAction({ ...o, watching: 'home' }), 'close');
  assert.equal(playerAvatarAction(o), 'close');
  assert.equal(playerAvatarAction({ player: own, self: true, observe: { observing: true } }), 'back');
  assert.equal(playerAvatarAction({ player: own, self: true, watching: 'other' }), 'watch');
  assert.equal(playerAvatarAction({ ...o, openPid: 'p_1' }), 'close');
  assert.equal(playerAvatarAction({ player: own, self: true, watching: 'other', askedRecently: true }), 'close');
});

test('shown fields include the prep scout and live battle', () => {
  assert.equal(teammateFieldShown('n:p_1', mate), true);
  assert.equal(teammateFieldShown('f1', mate), true);
  assert.equal(teammateFieldShown('other', mate), false);
  assert.equal(teammateFieldShown(null, mate), false);
});
