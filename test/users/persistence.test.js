import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openUserStore} from '../../server/users/store.js';
import {startServer} from '../../server/index.js';
import {TestClient} from '../helpers/wsClient.js';

async function api(base,url,{cookie,body,origin,method}={}){
 const res=await fetch(base+url,{method:method||(body?'POST':'GET'),headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...(origin?{origin}:{})},body:body?JSON.stringify(body):undefined});
 return {status:res.status,cookie:res.headers.get('set-cookie')?.split(';')[0],data:await res.json(),headers:res.headers};
}
test('profiles survive reopen; credentials are hashed; recovery is one-use and backups are readable',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'sp-users-'));const file=path.join(dir,'users.sqlite');let store;
 try{
  store=await openUserStore(file);const first=await store.call('create');
  await store.call('update',{id:first.user.id,name:'博士',avatarId:'avatar:Avatar_def_01'});
  const {code}=await store.call('recovery',{id:first.user.id});const old=code;
  const next=await store.call('recovery',{id:first.user.id});assert.equal(await store.call('recover',{code:old}),null);
  const recovered=await store.call('recover',{code:next.code});assert.equal(recovered.user.id,first.user.id);assert.notEqual(recovered.token,first.token);
  assert.equal(await store.call('recover',{code:next.code}),null);
  const game={id:'test-game',endedAt:Date.now(),mode:'single_funny',difficulty:'FUNNY',source:'server',rows:[{userId:first.user.id,playerId:'p1',victory:true,rounds:9,payload:{bandId:'band_amiya'}}]};
  assert.equal((await store.call('record',game)).inserted,1);assert.equal((await store.call('record',game)).inserted,0);
  await store.call('backup',{directory:path.join(dir,'backups')});await store.close();
  const bytes=await readFile(file);assert.ok(!bytes.includes(first.token));assert.ok(!bytes.includes(next.code));
  store=await openUserStore(file);assert.equal((await store.call('authenticate',{token:first.token})).avatarId,'avatar:Avatar_def_01');
  assert.equal((await store.call('stats',{id:first.user.id})).summary.matches,1);await store.close();
  const backup=(await readdir(path.join(dir,'backups')))[0];store=await openUserStore(path.join(dir,'backups',backup),{backups:null});
  assert.equal((await store.call('authenticate',{token:recovered.token})).name,'博士');
 }finally{await store?.close().catch(()=>{});await rm(dir,{recursive:true,force:true});}
});

test('HTTP anonymous identity, cross-device recovery, WS separation and authoritative result recording',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'sp-user-api-'));const file=path.join(dir,'users.sqlite');let srv;const clients=[];
 try{
  srv=await startServer({port:0,workers:0,quiet:true,userFile:file});
  const a=await api(srv.url,'/api/user');const b=await api(srv.url,'/api/user');assert.equal(a.status,200);assert.notEqual(a.data.user.id,b.data.user.id);
  assert.match(a.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert.equal(a.headers.get('cache-control'),'no-store');
  assert.equal((await api(srv.url,'/api/user/profile',{cookie:a.cookie,body:{name:'博士',avatarId:'avatar:Avatar_def_01'},origin:'https://evil.test'})).status,403);
  assert.equal((await api(srv.url,'/api/user/profile',{cookie:a.cookie,body:{name:'博士',avatarId:'https://evil.test/a.png'}})).status,400);
  assert.equal((await api(srv.url,'/api/user/profile',{cookie:a.cookie,body:{name:'博士',avatarId:'band_amiya'}})).status,400);
  assert.equal((await api(srv.url,'/api/user/profile',{cookie:a.cookie,body:{name:'博士',avatarId:'avatar:Avatar_def_01'}})).status,200);
  const recovery=await api(srv.url,'/api/user/recovery',{cookie:a.cookie,body:{}});
  const recovered=await api(srv.url,'/api/user/recover',{cookie:b.cookie,body:{code:recovery.data.code}});assert.equal(recovered.data.user.id,a.data.user.id);
  assert.equal((await api(srv.url,'/api/user/recover',{cookie:b.cookie,body:{code:recovery.data.code}})).status,400);
  const wsUrl=srv.url.replace('http','ws')+'/ws';
  const c=await TestClient.connect(wsUrl,{wsOptions:{headers:{Cookie:a.cookie}}});clients.push(c);const cw=await c.hello('博士');
  const d=await TestClient.connect(wsUrl,{wsOptions:{headers:{Cookie:recovered.cookie}}});clients.push(d);const dw=await d.hello('博士');
  assert.notEqual(cw.playerId,dw.playerId);assert.equal(srv.registry.byId(cw.playerId).userId,srv.registry.byId(dw.playerId).userId);
  const renamed=await api(srv.url,'/api/user/name',{cookie:a.cookie,body:{name:'新博士'}});assert.equal(renamed.data.user.avatarId,'avatar:Avatar_def_01');
  assert.equal(srv.registry.byId(cw.playerId).name,'新博士');
  const stale=await TestClient.connect(wsUrl,{wsOptions:{headers:{Cookie:a.cookie}}});clients.push(stale);const staleWelcome=await stale.hello('旧名字');
  assert.equal(srv.registry.byId(staleWelcome.playerId).name,'新博士','stale reconnect names cannot overwrite the canonical profile');
  const stranger=await TestClient.connect(wsUrl,{wsOptions:{headers:{Cookie:b.cookie}}});clients.push(stranger);const sw=await stranger.hello('other',cw.token);assert.notEqual(sw.playerId,cw.playerId,'game token cannot switch account');
  await c.request({t:'room.create',mode:'solo',difficulty:'FUNNY'});const state=await c.waitFor('room.state');assert.equal(state.seats[0].avatarId,'avatar:Avatar_def_01');assert.equal(state.seats[0].userId,undefined);
  await c.request({t:'room.start'});const m=srv.lobby.rooms.get(state.code).match;assert.ok(m.userMatchId);assert.equal(m.publicView().matchId,m.userMatchId);assert.equal(m.publicView().userId,undefined);
  assert.equal((await api(srv.url,'/api/user/recover',{cookie:a.cookie,body:{code:'SP-'+'a'.repeat(43)}})).status,409);
  m.finish({victory:true});await Promise.all([...srv.lobby.userWrites]);
  const stats=await api(srv.url,'/api/user/stats',{cookie:recovered.cookie});assert.equal(stats.data.summary.matches,1);assert.equal(stats.data.records[0].source,'server');assert.equal(stats.data.aggregate.count,1);assert.equal(stats.data.records[0].payload.frame.matchId,m.userMatchId);assert.equal(stats.data.aggregate.missingFrame,false);
  assert.equal((await api(srv.url,'/api/user/stats',{cookie:b.cookie})).data.summary.matches,0);
  assert.equal((await api(srv.url,'/api/user/stats')).status,401);
  await Promise.all(clients.map(x=>x.close()));clients.length=0;await srv.close();srv=await startServer({port:0,workers:0,quiet:true,userFile:file});
  assert.equal((await api(srv.url,'/api/user',{cookie:a.cookie})).data.user.id,a.data.user.id);
  assert.equal((await api(srv.url,'/api/user/stats',{cookie:a.cookie})).data.summary.matches,1);
 }finally{await Promise.all(clients.map(x=>x.close()));await srv?.close();await rm(dir,{recursive:true,force:true});}
});

test('Match Worker checkpoints retain the private user mapping and stable result ID',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'sp-user-worker-'));let srv;let c;
 try{
  srv=await startServer({port:0,workers:0,matchWorkers:1,quiet:true,userFile:path.join(dir,'users.sqlite')});
  const account=await api(srv.url,'/api/user');
  c=await TestClient.connect(srv.url.replace('http','ws')+'/ws',{wsOptions:{headers:{Cookie:account.cookie}}});const welcome=await c.hello('worker');
  await c.request({t:'room.create',mode:'solo',difficulty:'FUNNY'});const room=await c.waitFor('room.state');
  assert.equal((await c.request({t:'room.start'})).t,'ok');
  const match=srv.lobby.rooms.get(room.code).match;
  const cp=await match.snapshot();assert.ok(cp.userMatchId);assert.equal(cp.players.find(p=>p.playerId===welcome.playerId).userId,account.data.user.id);
  await match.invoke('finish',{victory:true});await c.waitFor('m.result');await new Promise(r=>setTimeout(r,20));await Promise.all([...srv.lobby.userWrites||[]]);
  const result=await api(srv.url,'/api/user/stats',{cookie:account.cookie});assert.equal(result.data.summary.matches,1);assert.equal(result.data.records[0].id,cp.userMatchId);
 }finally{await c?.close();await srv?.close();await rm(dir,{recursive:true,force:true});}
});

test('Redis-style session recovery retains user ownership and avatar without reusing it across accounts',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'sp-user-resume-'));let srv;let c;
 const memory={doc:null,async load(){return this.doc;},async save(doc){this.doc=JSON.parse(JSON.stringify(doc));return true;},async close(){}};
 try{
  const opts={port:0,workers:0,quiet:true,userFile:path.join(dir,'users.sqlite'),store:memory};srv=await startServer(opts);
  const account=await api(srv.url,'/api/user');await api(srv.url,'/api/user/profile',{cookie:account.cookie,body:{name:'persistent',avatarId:'avatar:Avatar_def_01'}});
  c=await TestClient.connect(srv.url.replace('http','ws')+'/ws',{wsOptions:{headers:{Cookie:account.cookie}}});const welcome=await c.hello('persistent');
  await c.request({t:'room.create',mode:'solo',difficulty:'FUNNY'});await c.waitFor('room.state');
  await c.close();c=null;await srv.close();assert.equal(memory.doc.sessions[0].userId,account.data.user.id);
  srv=await startServer(opts);c=await TestClient.connect(srv.url.replace('http','ws')+'/ws',{wsOptions:{headers:{Cookie:account.cookie}}});
  const resumed=await c.hello('persistent',welcome.token);assert.equal(resumed.playerId,welcome.playerId);assert.equal(resumed.resumed,true);
  assert.equal((await c.waitFor('room.state')).seats[0].avatarId,'avatar:Avatar_def_01');
  await assert.rejects(TestClient.connect(srv.url.replace('http','ws')+'/ws',{wsOptions:{headers:{Cookie:account.cookie,Origin:'https://evil.test'}}}));
 }finally{await c?.close();await srv?.close();await rm(dir,{recursive:true,force:true});}
});

test('an unavailable user database leaves a Redis-backed result outbox for idempotent replay',async()=>{
 const {SessionRegistry}=await import('../../server/net.js');const {Lobby}=await import('../../server/lobby.js');const {snapshotServer,restoreServer}=await import('../../server/persist.js');
 const registry=new SessionRegistry();const lobby=new Lobby({registry,log:{info(){},warn(){},error(){}}});
 const entry={id:'pending-game',endedAt:Date.now(),mode:'single_funny',difficulty:'FUNNY',source:'server',rows:[{userId:'test-user',playerId:'p1',victory:true,rounds:9,payload:{}}]};
 lobby.userOutbox.set(entry.id,entry);
 let failedCalls=0;lobby.users={call:async()=>{failedCalls++;throw new Error('offline');}};
 lobby.flushUserResults();await Promise.all([...lobby.userWrites]);assert.equal(failedCalls,3);assert.equal(lobby.userOutbox.size,1);
 const doc=snapshotServer({registry,lobby});assert.equal(doc.userResultOutbox[0].id,'pending-game');
 const otherRegistry=new SessionRegistry();const restored=new Lobby({registry:otherRegistry,log:{info(){},warn(){},error(){}}});
 restoreServer({doc,registry:otherRegistry,lobby:restored});assert.equal(restored.userOutbox.size,1);
 let calls=0;restored.users={call:async(method,args)=>{assert.equal(method,'record');assert.equal(args.id,'pending-game');calls++;}};
 restored.flushUserResults();restored.flushUserResults();await Promise.all([...restored.userWrites]);assert.equal(calls,1);assert.equal(restored.userOutbox.size,0);
 lobby.shutdown();restored.shutdown();
});
