import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCombatHistory, saveCombatHistory, historyPage, HISTORY_KEY } from '../../public/js/battle/combatHistory.js';
const memory = () => { const map = new Map(); return { getItem: k => map.get(k), setItem: (k,v) => map.set(k,v) }; };
test('round records survive a reload, deduplicate battle IDs and stay confined to their match', () => {
 const storage = memory();
 const records = new Map([['a', { round: 2, seconds: 20, owners: ['p'], rows: [{ ownerId:'p', defId:'op', damage:100, healing:0, types:{} }] }]]);
 saveCombatHistory(storage, 'match1', records);
 assert.deepEqual(loadCombatHistory(storage, 'match1'), records);
 assert.equal(loadCombatHistory(storage, 'match2').size, 0);
 records.set('a', {...records.get('a'), seconds: 21});
 saveCombatHistory(storage, 'match1', records);
 assert.equal(loadCombatHistory(storage, 'match1').size, 1);
 assert.equal(loadCombatHistory(storage, 'match1').get('a').seconds, 21);
});
test('invalid cache, disabled storage and quota failures do not disrupt gameplay', () => {
 const storage = memory(); storage.setItem(HISTORY_KEY, '{');
 assert.equal(loadCombatHistory(storage, 'm').size, 0);
 assert.doesNotThrow(() => saveCombatHistory({setItem() {throw Error('quota');}}, 'm', new Map()));
 assert.equal(loadCombatHistory(null, 'm').size, 0);
});
test('round pagination defaults to latest, handles gaps and stops at both ends', () => {
 assert.deepEqual(historyPage([2,4,7], null), {round:7, previous:4, next:null});
 assert.deepEqual(historyPage([2,4,7], 4), {round:4, previous:2, next:7});
 assert.deepEqual(historyPage([2,4,7], 2), {round:2, previous:null, next:4});
 assert.deepEqual(historyPage([], null), {round:null, previous:null, next:null});
});
