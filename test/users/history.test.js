import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accountRecord,mergeAccountHistory,aggregateStats} from '../../shared/userStats.js';
import {buildRecord,buildQuitRecord,normalizeRecord,compactRecord,cachedAccountStats} from '../../public/js/ui/stats.js';
import {openUserStore} from '../../server/users/store.js';

const own={playerId:'p1',bandId:'band_amiya',name:'doctor',alive:true,victory:true,roundsPassed:9,stats:{dmgDealt:120}};
const frame={difficulty:'FUNNY',modeId:'mode_single_funny',durationMs:12345,hiddenReached:false,hiddenCleared:false};
const remote={id:'game-a',endedAt:200,playerId:'p1',victory:true,rounds:9,difficulty:'FUNNY',mode:'mode_single_funny',payload:{...own,frame}};

test('match identity survives local normalization, import and compaction',()=>{
 const rec=buildRecord({...frame,matchId:'game-a',players:[own],victory:true},{myId:'p1',now:200});
 const quit=buildQuitRecord({me:{playerId:'p1'},match:{public:{matchId:'game-a',phase:'PREP',round:2,players:[own]}}},{live:{active:true,startedAt:1,sawStart:true,aliveRound:2},now:200});
 assert.equal(quit.matchId,'game-a');
 assert.equal(rec.matchId,'game-a');assert.equal(normalizeRecord(rec).matchId,'game-a');assert.equal(compactRecord(rec).matchId,'game-a');
});
test('timeline prefers authoritative self stats, supplements local details and keeps legacy rows separate',()=>{
 const detail=buildRecord({...frame,matchId:'game-a',players:[{...own,stats:{dmgDealt:999}},{playerId:'teammate',name:'friend'}]},{myId:'p1',now:201});
 const legacy=buildRecord({...frame,seed:2,players:[own]},{myId:'p1',now:150});
 const merged=mergeAccountHistory([detail,legacy],[remote],['game-a']);
 assert.equal(merged.length,2);assert.equal(merged[0].players.find(p=>p.playerId==='p1').stats.dmgDealt,120);
 assert.equal(merged[0].players.find(p=>p.playerId==='teammate').name,'friend');assert.equal(merged[0].deviceOnly,undefined);
 assert.equal(merged[1].deviceOnly,true);assert.equal(aggregateStats([accountRecord(remote)]).count,1);
 assert.equal(mergeAccountHistory([{...detail,end:'quit'}],[remote],['game-a']).length,1);
 assert.equal(mergeAccountHistory([detail],[],['game-a']).length,0,'later server pages are not mislabeled as local-only');
 assert.equal(detail.players[0].stats.dmgDealt,999,'merge does not mutate local data');
});
test('server aggregates cover all pages and preserve compatibility with pre-frame records',async()=>{
 const db=await openUserStore(':memory:');
 try{
  const {user}=await db.call('create');const stranger=await db.call('create');
  for(let i=0;i<55;i++)await db.call('record',{id:'game-'+i,endedAt:i,mode:'mode_single_funny',difficulty:'FUNNY',source:'server',rows:[{userId:user.id,playerId:'p1',victory:true,rounds:9,payload:{...own,frame}},{userId:stranger.user.id,playerId:'p2',victory:false,rounds:1,payload:{playerId:'p2',stats:{dmgDealt:999999}}}]});
  const first=await db.call('stats',{id:user.id});
  assert.equal(first.userId,user.id);assert.equal(first.records.length,50);assert.equal(first.aggregate.count,55);assert.equal(first.aggregate.sums.dmgDealt,55*120);assert.equal(first.aggregate.duration.totalMs,55*12345);assert.equal(first.aggregate.bands.band_amiya.games,55);
  assert.equal(first.matchIds.length,55);assert.equal(first.aggregate.missingFrame,false);
  const next=await db.call('stats',{id:user.id,before:first.next});assert.equal(next.records.length,5);assert.equal(next.next,null);assert.equal(next.aggregate.count,55);
  await db.call('record',{id:'legacy',endedAt:100,mode:'mode_single_funny',difficulty:'FUNNY',source:'server',rows:[{userId:user.id,playerId:'p1',victory:true,rounds:9,payload:own}]});
  const legacy=await db.call('stats',{id:user.id});assert.equal(legacy.aggregate.missingFrame,true);assert.equal(legacy.aggregate.count,56);
 }finally{await db.close();}
});

test('opening an archive without storage or an account never reads a null cache',()=>{
 const data={records:[],matchIds:[],aggregate:aggregateStats([])};
 for(const cached of [null,undefined,{}, {data}]) {
  for(const userId of [undefined,null,''])assert.equal(cachedAccountStats(cached,userId),null);
 }
 assert.equal(cachedAccountStats(null,'known'),null);
 assert.equal(cachedAccountStats({userId:'known'},'known'),null);
 assert.equal(cachedAccountStats({userId:'known',data:null},'known'),null);
 assert.equal(cachedAccountStats({userId:'known',data:{}},'known'),null);
 assert.equal(cachedAccountStats({userId:'other',data},'known'),null);
 assert.equal(cachedAccountStats({userId:'known',data},'known'),data);
});


test('account totals and achievements distinguish gameplay plugins from cosmetics across the complete history',async()=>{
 const db=await openUserStore(':memory:');
 try {
  const {user}=await db.call('create');
  for(let i=0;i<55;i++)await db.call('record',{id:'official-'+i,endedAt:i,mode:'mode_multi_funny',difficulty:'FUNNY',source:'server',rows:[{userId:user.id,playerId:'p1',victory:true,rounds:9,payload:{...own,trophies:2,frame:{...frame,roomMode:'coop',vs:'a'.repeat(64),content:null}}}]});
  await db.call('record',{id:'modded',endedAt:100,mode:'mode_custom',difficulty:'FUNNY',source:'server',rows:[{userId:user.id,playerId:'p1',victory:true,rounds:9,payload:{...own,trophies:999,frame:{...frame,roomMode:'coop',content:{cs:'b'.repeat(64),plugins:['example@1']}}}}]});
  const standard=await db.call('stats',{id:user.id});
  assert.equal(standard.records.length,50);
  assert.equal(standard.aggregate.count,55);
  assert.equal(standard.aggregate.modded,1);
  assert.equal(standard.aggregate.trophies,110);
  assert.equal(standard.aggregate.byMode.coop.games,55);
  assert.equal(standard.achievements.count,55);
  assert.equal(standard.achievements.trophies,110);
  const all=await db.call('stats',{id:user.id,modded:true});
  assert.equal(all.aggregate.count,56);
  assert.equal(all.aggregate.byMode.coop.games,56);
  assert.equal(all.achievements.count,56);
  assert.equal(all.achievements.trophies,1109);
 } finally {await db.close();}
});
