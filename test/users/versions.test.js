import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openUserStore} from '../../server/users/store.js';
import {DEFAULT_VERSION} from '../../shared/versions.js';

for(const historical of ['act1autochess','act3autochess@V3_1']) test(`${historical}: account history, full replay and public/pinned identity survive SQLite restart`,async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'sp-account-versions-'));
 let db=await openUserStore(path.join(root,'users.sqlite'),{backups:null});
 t.after(async()=>{await db.close();await rm(root,{recursive:true,force:true});});
 const created=await db.call('create'),{user}=created;
 const pid='player-one';
 const replay={v:1,version:historical,test:false,duration:20,players:[{playerId:pid,name:'Doctor',seat:0,isBot:false}],fields:[],events:[
  {at:0,kind:'view',key:'public',full:{t:'m.public',version:historical,round:1}},
  {at:1,kind:'view',key:pid,full:{t:'m.private',funds:10,hand:[{uid:1}]}},
  {at:2,kind:'action',playerId:pid,action:'g.buy'},
  {at:3,kind:'action',playerId:pid,action:'g.equip'},
  ...(historical==='act3autochess@V3_1'?[{at:4,kind:'action',playerId:pid,action:'g.command'},{at:5,kind:'view',key:pid,full:{t:'m.private',command:{currentCost:2,usesLeft:1}}}]:[]),
 ]};
 const record=async(id,version,{modded=false,test=false,aiTakeoverRound}={})=>db.call('record',{id,endedAt:10,mode:'solo',difficulty:'NORMAL',source:'server',replay:version===historical?replay:null,
  rows:[{userId:user.id,playerId:pid,victory:true,rounds:3,payload:{bandId:'band_amiya',trophies:2,stats:{dmgDealt:123},aiTakeoverRound,
   frame:{roomMode:'solo',modeId:version==='act3autochess@V3_1'?'mode_single_12':'mode_single_normal',version,test,...(modded?{content:{cs:'a'.repeat(64)}}:{})}}}]});
 await record('current',undefined);await record('historical',historical);await record('plugin',historical,{modded:true});await record('test',historical,{test:true});await record('takeover',historical,{aiTakeoverRound:1});
 let stats=await db.call('stats',{id:user.id});
 assert.equal(stats.byVersion[DEFAULT_VERSION].aggregate.count,1);
 assert.equal(stats.byVersion[historical].aggregate.count,1);
 assert.equal(stats.byVersion[historical].aggregate.sums.dmgDealt,123);
 assert.equal(stats.byVersion[historical].achievements.count,1);
 assert.deepEqual(stats.byVersion[historical].strategyClears,{band_amiya:1});
 assert.deepEqual(stats.byVersion[DEFAULT_VERSION].strategyClears,{band_amiya:1});
 assert.equal((await db.call('stats',{id:user.id,modded:true})).byVersion[historical].strategyClears.band_amiya,2);
 assert.equal((await db.call('stats',{id:user.id,modded:true})).byVersion[historical].aggregate.count,2);
 assert.equal((await db.call('pinReplay',{id:user.id,matchId:'historical',pinned:true})).replay.pinned,true);
 await db.call('visibility',{id:user.id,visibility:{...user.visibility,history:true,replays:true,statistics:true,achievements:true}});
 await db.call('shareReplay',{id:user.id,matchId:'historical',shared:true});
 await db.close();db=await openUserStore(path.join(root,'users.sqlite'),{backups:null});
 assert.equal((await db.call('authenticate',{token:created.token})).publicId,user.publicId);
 stats=await db.call('stats',{id:user.id});
 assert.equal(stats.records.find(r=>r.id==='historical').replay.pinned,true);
 assert.deepEqual((await db.call('replay',{id:user.id,matchId:'historical'})).replay,replay);
 assert.equal((await db.call('replayBody',{id:user.id,matchId:'historical',gzip:true})).version,historical);
 const publicRows=await db.call('publicDoctor',{publicId:user.publicId});
 assert.equal(publicRows.aggregate.count,1,'public default statistics exclude other official versions');
 const historicalProfile=await db.call('publicDoctor',{publicId:user.publicId,version:historical});
 assert.equal(historicalProfile.aggregate.count,1);assert.equal(historicalProfile.aggregate.sums.dmgDealt,123);
 assert.equal(historicalProfile.aggregate.trophies,undefined);assert.ok(!JSON.stringify(historicalProfile).includes(user.id));
 assert.equal(publicRows.records.find(r=>r.matchId==='historical').version,historical);
 const shared=(await db.call('publicReplay',{publicId:user.publicId,matchId:'historical'})).replay;
 assert.equal((await db.call('publicReplayBody',{publicId:user.publicId,matchId:'historical',gzip:true})).version,historical);
 assert.equal(shared.version,historical);assert.equal(shared.test,false);
 assert.ok(shared.events.some(e=>e.action==='g.buy'));assert.ok(shared.events.some(e=>e.action==='g.equip'));
 assert.ok(!JSON.stringify(shared).includes(user.id));
});
