import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openUserStore} from '../../server/users/store.js';
import {ReplayTimeline} from '../../shared/replays.js';
import {recordFrame,recordAction,recordSpec,finishReplay} from '../../server/replays/capture.js';

const bundle={v:1,events:[{at:0,kind:'view',key:'public',full:{t:'m.public',round:1,battleSpeed:2}}],fields:[],duration:100};
const game=(id,users,replay=bundle)=>({id,endedAt:Number(id.replace(/\D/g,''))||1,mode:'solo',difficulty:'FUNNY',source:'server',replay,rows:users.map((userId,i)=>({userId,playerId:'p'+i,rounds:2,victory:true,payload:{}}))});
test('quota evicts the oldest unpinned, pins are per account, duplicate results cannot resurrect evictions',async()=>{
 const db=await openUserStore(':memory:',{replays:{perUser:3}});
 try{
  const a=(await db.call('create')).user.id,b=(await db.call('create')).user.id;
  for(let i=1;i<=3;i++)await db.call('record',game('g'+i,[a,b]));
  assert.equal((await db.call('pinReplay',{id:a,matchId:'g1',pinned:true})).replay.pinned,true);
  assert.equal((await db.call('pinReplay',{id:a,matchId:'g2',pinned:true})).replay.pinned,true);
  assert.equal((await db.call('pinReplay',{id:a,matchId:'g3',pinned:true})).error,'REPLAY_PIN_LIMIT');
  await db.call('record',game('g4',[a,b]));
  assert.deepEqual((await db.call('stats',{id:a})).replays,{saved:3,pinned:2,limit:3,pinLimit:2});
  assert.equal((await db.call('replay',{id:a,matchId:'g3'})).error,'REPLAY_NOT_FOUND');
  assert.equal((await db.call('replay',{id:b,matchId:'g1'})).error,'REPLAY_NOT_FOUND');
  assert.deepEqual((await db.call('replay',{id:a,matchId:'g1'})).replay,bundle);
  await db.call('record',game('g3',[a,b]));
  assert.equal((await db.call('replay',{id:a,matchId:'g3'})).error,'REPLAY_NOT_FOUND');
  assert.equal((await db.call('stats',{id:a})).records.length,4,'history is never pruned');
  assert.equal((await db.call('pinReplay',{id:a,matchId:'g1',pinned:false})).replay.pinned,false);
  await db.call('record',game('g5',[a]));
  assert.equal((await db.call('replay',{id:a,matchId:'g1'})).error,'REPLAY_NOT_FOUND');
  const outsider=(await db.call('create')).user.id;
  assert.equal((await db.call('replay',{id:outsider,matchId:'g2'})).error,'REPLAY_NOT_FOUND');
  assert.equal((await db.call('pinReplay',{id:outsider,matchId:'g2',pinned:true})).error,'REPLAY_NOT_FOUND');
 }finally{await db.close();}
});
test('restart retains replay bytes and reconciles a lowered quota; disabling does not delete settlements',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'sp-replays-'));let db;
 try{
  const file=path.join(dir,'users.sqlite');db=await openUserStore(file,{backups:null,replays:{perUser:3}});
  const id=(await db.call('create')).user.id;
  for(let i=1;i<=3;i++)await db.call('record',game('g'+i,[id]));
  for(const matchId of ['g1','g2'])await db.call('pinReplay',{id,matchId,pinned:true});
  await db.close();
  await assert.rejects(openUserStore(file,{backups:null,replays:{perUser:2}}),/quota is below existing pins/);
  db=await openUserStore(file,{backups:null,replays:{perUser:3}});
  await db.call('pinReplay',{id,matchId:'g1',pinned:false});await db.close();
  db=await openUserStore(file,{backups:null,replays:{perUser:2}});
  assert.deepEqual((await db.call('stats',{id})).replays,{saved:2,pinned:1,limit:2,pinLimit:1});
  assert.deepEqual((await db.call('replay',{id,matchId:'g2'})).replay,bundle);
  await db.call('pinReplay',{id,matchId:'g2',pinned:false});
  await db.close();db=await openUserStore(file,{backups:null,replays:{perUser:0}});
  const stats=await db.call('stats',{id});assert.equal(stats.replays.saved,0);assert.equal(stats.summary.matches,3);
 }finally{await db?.close();await rm(dir,{recursive:true,force:true});}
});
test('size limits and failed recordings cannot prevent settlement',async()=>{
 const db=await openUserStore(':memory:',{replays:{perUser:1,maxBytes:200}});
 try{
  const id=(await db.call('create')).user.id;
  await db.call('record',game('g1',[id],{...bundle,huge:'x'.repeat(1000)}));
  await db.call('record',game('g2',[id],{...bundle,unavailable:'size'}));
  await db.call('record',game('g3',[id]));
  assert.equal((await db.call('stats',{id})).summary.matches,3);
  assert.equal((await db.call('pinReplay',{id,matchId:'g3',pinned:true})).error,'REPLAY_PIN_LIMIT');
 }finally{await db.close();}
});
test('confirmed views, small patches, full operations and paused clocks reproduce without mutation or chat',()=>{
 let now=0;let funds=5,paused=false;
 const ps={playerId:'p',privateView:()=>({t:'m.private',funds,board:[]})};
 const m={replayMaxBytes:65536,players:new Map([['p',ps]]),order:[ps],fields:[],round:1,sched:{now:()=>now},log:{warn(){}},publicView:()=>({t:'m.public',round:1,battleSpeed:2,paused}),_fieldElapsed:()=>0};
 recordFrame(m,null,m.publicView());recordFrame(m,'p',ps.privateView());
 recordSpec(m,{fieldId:'n:p',kind:'normal',round:1,players:[],spawns:[]});
 now=1000;funds=3;recordAction(m,ps,{t:'g.buy'});
 now=2000;paused=true;recordAction(m,ps,{t:'g.pause'});
 now=4000;paused=false;recordAction(m,ps,{t:'g.pause'});
 recordFrame(m,'p',{t:'m.chat',text:'private chat'});now=5000;
 const replay=finishReplay(m),timeline=new ReplayTimeline(replay);
 const before=timeline.at(.01);assert.equal(before.p.funds,5);assert.equal(timeline.at(replay.events.find(e=>e.kind==='action').at).p.funds,3);assert.equal(before.p.funds,5);
 assert.equal(Math.round(timeline.elapsed(replay.fields[0],5000)*1000)/1000,6);assert.equal(timeline.actions.length,3);
 assert.equal(JSON.stringify(replay).includes('private chat'),false);
 assert.equal(replay.states,undefined);assert.equal(replay.players[0].userId,undefined);
});
