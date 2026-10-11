import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChoiceView, choiceVisibilityKey, bountyCanHide } from '../../public/js/ui/choiceOverlay.js';
import { Countdown } from '../../public/js/ui/components.js';
function* walk(v) {
  if (Array.isArray(v)) { for (const n of v) yield* walk(n); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const sp = { family: 'bounty', name: '悬赏', cards: [{ idx: 0, id: 'a', name: 'A' }], order: ['me','other'], turnPid: 'me', pickOf: new Map() };
const pub = { round: 3, deadline: 9000, players: [{ playerId: 'me', name: 'Me' }, { playerId: 'other', name: 'Other' }] };
const props = { pub, sp, myId: 'me', solo: false, total: 30 };
test('hide and reopen controls only change disclosure, retain live timer and no selectable cards while hidden', () => {
  const events = [];
  const open = [...walk(ChoiceView({ ...props, onMinimize: (h) => events.push(h) }))];
  const hide = open.find((n) => n.props?.class === 'spov__hide');
  assert.ok(hide);
  hide.props.onClick();
  const folded = [...walk(ChoiceView({ ...props, minimized: true, onMinimize: (h) => events.push(h) }))];
  assert.ok(!folded.some((n) => n.props?.role === 'dialog' || n.props?.class?.split?.(' ').includes('spcard')));
  const timer = folded.find((n) => n.type === Countdown);
  assert.equal(timer.props.deadline, 9000);
  assert.equal(timer.props.total, 30);
  const reopen = folded.find((n) => n.props?.class === 'spov-folded__open');
  assert.equal(reopen.props['aria-expanded'], 'false');
  reopen.props.onClick();
  assert.deepEqual(events, [true, false]);
  assert.equal(sp.pickOf.size, 0);
});
test('untimed solo drafts keep reopen control without a countdown', () => {
  const nodes = [...walk(ChoiceView({ ...props, solo: true, minimized: true }))];
  assert.ok(nodes.some((n) => n.props?.class === 'spov-folded__open'));
  assert.ok(!nodes.some((n) => n.type === Countdown));
});
test('hiding remains local to the same draft turn and round; ordinary state updates do not reopen it', () => {
  const key = choiceVisibilityKey(pub, sp);
  assert.equal(choiceVisibilityKey({ ...pub, deadline: 9500 }, { ...sp, pickOf: new Map([['me', 0]]) }), key);
  assert.notEqual(choiceVisibilityKey({ ...pub, round: 9 }, sp), key);
  assert.notEqual(choiceVisibilityKey(pub, { ...sp, turnPid: 'other' }), key);
  assert.notEqual(choiceVisibilityKey(pub, { ...sp, family: 'tactic' }), key);
  assert.equal(choiceVisibilityKey(pub, null), null);
});
test('other contingency families retain their existing full overlay', () => {
  for (const family of ['tactic']) {
    assert.equal(bountyCanHide({ family }), false);
    const nodes = [...walk(ChoiceView({ ...props, sp: { ...sp, family }, minimized: true }))];
    assert.ok(nodes.some((n) => n.props?.role === 'dialog'));
    assert.ok(!nodes.some((n) => n.props?.class === 'spov__hide'));
  }
});

test('equipment drafts share disclosure controls and keep their own caption', () => {
 for (const family of ['shop', 'shop_s', 'supply', 'supply_s']) {
  assert.equal(bountyCanHide({family}),true);
  const nodes=[...walk(ChoiceView({...props,sp:{...sp,family},minimized:true}))];
  assert.ok(nodes.some(n=>n.props?.class==='spov-folded__open'));
  assert.equal(nodes[0].props['aria-label'],'装备选择已隐藏');
 }
});
