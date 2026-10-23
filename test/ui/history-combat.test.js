import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HISTORY_KEY,saveCombatHistory,archivedCombatReader} from '../../public/js/battle/combatHistory.js';

const memory=()=>{const values=new Map();return {getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};};
const snapshot=(round,damage)=>({round,seconds:10,owners:['me','other'],rows:[
 {key:'me',ownerId:'me',defId:'chess_a',name:'Doctor',kind:'op',damage,healing:5,types:{phys:damage,arts:0,true:0,elemental:0}},
 {key:'other',ownerId:'other',defId:'chess_b',name:'Teammate',kind:'op',damage:9999,healing:0,types:{phys:9999,arts:0,true:0,elemental:0}},
]});
test('archived combat uses its match UUID, preserves round totals after the live runner clears, and excludes teammates',()=>{
 const storage=memory(),records=new Map([['one',snapshot(1,100)],['two',snapshot(2,400)]]);
 saveCombatHistory(storage,'battle-key',records,{matchId:'match-a'});
 const reader=archivedCombatReader(storage,{matchId:'match-a'});
 assert.deepEqual(reader.combatRounds({ownerId:'me'}),[1,2]);assert.equal(reader.legacy,false);
 assert.equal(reader.combatMetrics({ownerId:'me'}).damage,500);
 assert.equal(reader.combatMetrics({ownerId:'me',scope:'round',round:1}).damage,100);
 assert.equal(reader.combatMetrics({ownerId:'me',scope:'round',round:2}).damage,400);
 saveCombatHistory(storage,'new-key',new Map([['new',snapshot(1,999)]]),{matchId:'match-b'});
 assert.equal(reader.combatMetrics({ownerId:'me'}).damage,500,'open history retains its own immutable snapshot');
 assert.equal(archivedCombatReader(storage,{matchId:'match-a',matchKey:'new-key'}).combatMetrics({ownerId:'me'}).damage,0,'a mismatched UUID cannot fall back to a cache key');
});
test('legacy caches require an exact separately verified match key; absent or corrupt records never supply another match',()=>{
 const storage=memory();saveCombatHistory(storage,'legacy-key',new Map([['one',snapshot(1,123)]]));
 const unavailable=archivedCombatReader(storage,{matchId:'match-a'});assert.equal(unavailable.legacy,true);
 assert.deepEqual(unavailable.combatRounds({ownerId:'me'}),[]);
 assert.equal(archivedCombatReader(storage,{matchId:'match-a',matchKey:'wrong-key'}).combatMetrics({ownerId:'me'}).damage,0);
 assert.equal(archivedCombatReader(storage,{matchId:'match-a',matchKey:'legacy-key'}).combatMetrics({ownerId:'me'}).damage,123);
 storage.setItem(HISTORY_KEY,'broken');assert.equal(archivedCombatReader(storage,{matchId:'match-a'}).legacy,false);
 assert.deepEqual(archivedCombatReader(null,{matchId:'match-a'}).combatRounds(),[]);
});
