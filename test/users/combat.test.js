import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openUserStore} from '../../server/users/store.js';
import {startServer} from '../../server/index.js';
import {captureCombatSpec,captureCombatEnd,finishCombatCapture} from '../../server/users/combatCapture.js';
import {TestClient} from '../helpers/wsClient.js';
import {makeMatch} from '../match/harness.js';
import {snapshotMatch,restoreMatch} from '../../server/match/snapshot.js';
import {createRngFromState} from '../../server/sim/rng.js';

const cs='a'.repeat(64);
const record=(battleId='b1',round=1,damage=100,seconds=10)=>({v:1,battleId,round,fieldId:'normal:p0',cs,seconds,complete:true,
  rows:[{key:'operator-1',ownerId:'p0',defId:'chess_amiya',kind:'op',name:'阿米娅',damage,healing:5,types:{phys:damage,arts:0,true:0,elemental:0}}]});
const archive={v:1,fields:[1,2].map(round=>({battleId:`b${round}`,round,fieldId:'normal:p0',cs,players:['p0'],seconds:10}))};
const game=(id,user,extra={})=>({id,endedAt:1,mode:'solo',difficulty:'FUNNY',source:'server',
  rows:[{userId:user.id,playerId:'p0',victory:true,rounds:2,payload:{bandId:'band_amiya'}}],combat:archive,...extra});

test('combat attachments survive restart, remain after replay eviction and deduplicate without losing complete records',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sp-combat-')),file=path.join(dir,'users.sqlite');let store;
  try {
    store=await openUserStore(file,{backups:null,replays:{perUser:1}});const {user}=await store.call('create');
    const replay={v:1,fields:[],events:[{at:0,kind:'view',key:'public',full:{round:1}}]};
    await store.call('record',game('g1',user,{replay}));
    let data=await store.call('combat',{id:user.id,matchId:'g1'});assert.equal(data.combat.coverage.status,'missing');assert.equal(data.combat.coverage.expected,2);
    assert.deepEqual(await store.call('putCombat',{id:user.id,matchId:'g1',record:record()}),{ok:true});
    assert.equal((await store.call('combat',{id:user.id,matchId:'g1'})).combat.coverage.status,'partial');
    await store.call('putCombat',{id:user.id,matchId:'g1',record:record('b2',2,200)});
    assert.equal((await store.call('putCombat',{id:user.id,matchId:'g1',record:record()})).unchanged,true);
    await store.call('putCombat',{id:user.id,matchId:'g1',record:{...record('b1',1,999,5),complete:false}});
    await store.call('record',game('g2',user,{replay}));
    assert.equal((await store.call('replay',{id:user.id,matchId:'g1'})).error,'REPLAY_NOT_FOUND');
    await store.close();store=await openUserStore(file,{backups:null,replays:{perUser:1}});
    data=await store.call('combat',{id:user.id,matchId:'g1'});
    assert.equal(data.combat.coverage.status,'complete');assert.equal(data.combat.records.length,2);assert.equal(data.combat.records[0].rows[0].damage,100);
    assert.equal(data.combat.source,'client');assert.equal((await store.call('stats',{id:user.id})).summary.matches,2,'uploads do not alter settlement totals');
  } finally {await store?.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('only owner fields and finite consistent bounded rows are accepted, and unknown/incomplete fields never become complete',async()=>{
  const store=await openUserStore(':memory:',{backups:null});
  try {
    const {user}=await store.call('create'),other=(await store.call('create')).user;
    await store.call('record',game('g1',user));
    assert.equal((await store.call('combat',{id:other.id,matchId:'g1'})).error,'COMBAT_NOT_FOUND');
    assert.equal((await store.call('putCombat',{id:other.id,matchId:'g1',record:record()})).error,'COMBAT_NOT_FOUND');
    for(const changed of [{battleId:'invented'},{round:2},{fieldId:'other'},{cs:'b'.repeat(64)},{seconds:11},
      {rows:[{...record().rows[0],ownerId:'other'}]},{rows:[{...record().rows[0],damage:NaN}]},
      {rows:[{...record().rows[0],damage:101}]},{rows:Array(129).fill(record().rows[0])}]) {
      assert.equal((await store.call('putCombat',{id:user.id,matchId:'g1',record:{...record(),...changed}})).error,'COMBAT_INPUT');
    }
    assert.deepEqual(await store.call('putCombat',{id:user.id,matchId:'g1',record:record('b1',1,100,5)}),{ok:true});
    assert.equal((await store.call('combat',{id:user.id,matchId:'g1'})).combat.records[0].complete,false);
    await store.call('record',game('old',user,{combat:undefined}));
    const old=await store.call('combat',{id:user.id,matchId:'old'});assert.equal(old.combat.coverage.expected,null);assert.equal(old.combat.coverage.status,'missing');
  } finally {await store.close();}
});

test('server manifest collection is independent of replay settings, matches fields once and records final clocks',()=>{
  const m={userMatchId:'g1',round:1,cs,fields:[]};
  const spec={battleId:'b1',fieldId:'f1',players:[{playerId:'p0'},{playerId:'p1'}]};
  captureCombatSpec(m,spec);captureCombatSpec(m,spec);assert.equal(m.combatArchive.fields.length,1);
  captureCombatEnd(m,{fieldId:'f1'},{time:12});
  assert.deepEqual(finishCombatCapture(m).fields[0],{battleId:'b1',round:1,fieldId:'f1',cs,players:['p0','p1'],seconds:12});
  const disabled={round:1};captureCombatSpec(disabled,spec);assert.equal(disabled.combatArchive,undefined);
});

test('single-record and whole-match budgets reject oversized data without corrupting saved fields',async()=>{
  const store=await openUserStore(':memory:',{backups:null});
  try {
    const {user}=await store.call('create');
    const fields=Array.from({length:16},(_,i)=>({...archive.fields[0],battleId:'b'+i}));
    await store.call('record',game('budget',user,{combat:{v:1,fields}}));
    const rows=Array.from({length:128},(_,i)=>({...record().rows[0],key:String(i).padStart(64,'k'),defId:'x'.repeat(64),name:'n'.repeat(100)}));
    const tooLarge=rows.map(row=>({...row,key:row.key.padStart(256,'k'),defId:'x'.repeat(160),name:'n'.repeat(128)}));
    assert.equal((await store.call('putCombat',{id:user.id,matchId:'budget',record:{...record('b0'),rows:tooLarge}})).error,'COMBAT_SIZE');
    let accepted=0,rejected=0;
    for(const f of fields) {
      const result=await store.call('putCombat',{id:user.id,matchId:'budget',record:{...record(f.battleId),rows}});
      if(result.ok)accepted++;else {assert.equal(result.error,'COMBAT_SIZE');rejected++;}
    }
    assert.ok(accepted>0 && rejected>0);
    const saved=await store.call('combat',{id:user.id,matchId:'budget'});
    assert.equal(saved.combat.records.length,accepted);assert.equal(saved.combat.coverage.status,'partial');
  } finally {await store.close();}
});

test('same-version match checkpoints retain accounting manifests independently of replay capture',()=>{
  const a=makeMatch({mode:'solo',humans:1,bots:0,clientCombat:true}),b=makeMatch({mode:'solo',humans:1,bots:0,clientCombat:true});
  try {
    a.m.userMatchId='accounting-match';a.m.start();
    captureCombatSpec(a.m,{battleId:'b1',fieldId:'f1',players:[{playerId:'p_0'}]});
    const snapshot=snapshotMatch(a.m);assert.ok(snapshot.combatArchive);
    assert.equal(restoreMatch(b.m,snapshot,{createRngFromState,log:{warn(){}}}),true);
    assert.deepEqual(b.m.combatArchive,a.m.combatArchive);assert.equal(b.m.userMatchId,'accounting-match');
  } finally {a.m.dispose();b.m.dispose();}
});

test('HTTP rejects cross-account/cross-origin writes and real match settlement retains a manifest with replay disabled',async()=>{
  const srv=await startServer({host:'127.0.0.1',port:0,workers:0,quiet:true,userFile:':memory:',replayLimit:0});let client;
  try {
    const response=await fetch(srv.url+'/api/user'),cookie=response.headers.get('set-cookie').split(';')[0],{user}=await response.json();
    const api=async(url,body,extra={})=>{
      const res=await fetch(srv.url+url,{method:body?'POST':'GET',headers:{cookie,...(body?{'content-type':'application/json'}:{}),...extra},body:body?JSON.stringify(body):undefined});
      return {status:res.status,data:await res.json()};
    };
    await srv.users.call('record',game('g1',user));
    assert.equal((await api('/api/user/combat',{matchId:'g1',record:record()},{origin:'https://other.invalid'})).status,403);
    assert.equal((await api('/api/user/combat',{matchId:'g1',record:record()})).status,200);
    assert.equal((await api('/api/user/combat?matchId=g1')).data.combat.records.length,1);
    assert.equal((await api('/api/user/combat',{matchId:'missing',record:record()})).status,404);
    const anonymous=await fetch(srv.url+'/api/user/combat?matchId=g1');assert.equal(anonymous.status,401);
    client=await TestClient.connect(srv.url.replace('http','ws')+'/ws',{wsOptions:{headers:{Cookie:cookie}}});
    const welcome=await client.hello('combat');await client.request({t:'room.create',mode:'solo',difficulty:'FUNNY'});
    const room=await client.waitFor('room.state');
    await client.request({t:'room.start'});const match=srv.lobby.rooms.get(room.code).match;
    match.round=1;match._ccField({fieldId:'f',kind:'normal',players:[welcome.playerId],opts:{seed:1,kind:'normal',round:1,fieldId:'f',players:[{playerId:welcome.playerId,units:[]}],spawns:[]}});
    match.finish({victory:true});await Promise.all([...srv.lobby.userWrites]);
    const saved=await srv.users.call('combat',{id:user.id,matchId:match.userMatchId});assert.equal(saved.combat.coverage.expected,1);
    assert.equal((await srv.users.call('replay',{id:user.id,matchId:match.userMatchId})).error,'REPLAY_NOT_FOUND');
  } finally {await client?.close();await srv.close();}
});
