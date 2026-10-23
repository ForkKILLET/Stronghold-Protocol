import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeMatch,legalTileFor} from './match/harness.js';
import {snapshotMatch,restoreMatch} from '../server/match/snapshot.js';
import {createRngFromState} from '../server/sim/rng.js';
import {ReplayTimeline} from '../shared/replays.js';
import {startServer} from '../server/index.js';
import {TestClient} from './helpers/wsClient.js';
import {validHostMessage} from '../server/match/host/ipc.js';
import {wireOptions} from '../server/match/host/proxy.js';

test('real confirmed prep operations and combat specs survive a checkpoint without changing outcomes',()=>{
 for(const clientCombat of [false,true]){
  const h=makeMatch({mode:'solo',difficulty:'NORMAL',fake:true,clientCombat,instant:false});
  h.m.replayMaxBytes=8*1024*1024;h.start();h.toPrep(1);
  const ps=h.ps('p_0'),m=h.m;ps.funds=100;
  assert.equal(m.handle(ps.playerId,{t:'g.refresh'}).ok,true);
  const slot=ps.shop.slots.findIndex(s=>s?.kind==='chess');assert.ok(slot>=0);
  const before=ps.hand.length;assert.equal(m.handle(ps.playerId,{t:'g.buy',slot}).ok,true);
  const piece=ps.hand.find(Boolean);assert.ok(piece);const tile=legalTileFor(m,ps,piece.id);
  assert.equal(m.handle(ps.playerId,{t:'g.move',uid:piece.uid,to:{area:'board',row:tile[0],col:tile[1]}}).ok,true);
  assert.ok(ps.hand.length>=before);
  const checkpoint=snapshotMatch(m);assert.ok(checkpoint.replayArchive.events.length);
  const restored=makeMatch({mode:'solo',difficulty:'NORMAL',fake:true,clientCombat,instant:false});restored.m.replayMaxBytes=m.replayMaxBytes;
  assert.equal(restoreMatch(restored.m,checkpoint,{createRngFromState,log:{warn(){}}}),true);
  restored.toPrep(2);restored.m.finish({victory:false});
  const replay=restored.ended.replay;assert.ok(replay.fields.length>=1);
  const actions=replay.events.filter(e=>e.kind==='action').map(e=>e.action);
  for(const action of ['g.refresh','g.buy','g.move'])assert.ok(actions.includes(action),action);
  const timeline=new ReplayTimeline(replay);const final=timeline.at(replay.duration);
  assert.equal(final.public.phase,'RESULT');assert.equal(final.public.round,2);
  assert.equal(final.p_0.board[0].id,piece.id);
  assert.ok(replay.fields[0].spec.players[0].units.length);
  assert.ok(replay.fields[0].end.time>0);
  assert.ok(h.sent.every(([,msg])=>!Object.hasOwn(msg,'replay')),'archive never rides a public result frame');
  m.dispose();restored.m.dispose();
 }
});

test('plugin settlement IPC isolates the bounded replay body from the small settlement envelope',()=>{
 assert.equal(wireOptions({replayMaxBytes:123,send(){}}).replayMaxBytes,123);
 assert.equal(validHostMessage({type:'end',matchId:'m',summary:{roundsPassed:2},replayJson:JSON.stringify({large:'x'.repeat(2*1024*1024)})}),true);
 assert.equal(validHostMessage({type:'end',matchId:'m',summary:{large:'x'.repeat(2*1024*1024)}}),false);
 assert.equal(validHostMessage({type:'end',matchId:'m',summary:{},replayJson:{}}),false);
});

for(const matchWorkers of [0,1])test(`account HTTP and ${matchWorkers?'Worker':'local'} Match archive are private, durable, read-only and origin protected`,{timeout:30000},async t=>{
 const srv=await startServer({port:0,host:'127.0.0.1',workers:0,matchWorkers,replayLimit:2,userFile:':memory:',quiet:true,announcementsFile:null});
 const clients=[];t.after(async()=>{await srv.close();for(const c of clients)c.terminate();});
 async function api(url,cookie,body,origin){const res=await fetch(srv.url+url,{method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...(origin?{origin}:{})},body:body?JSON.stringify(body):undefined});return {status:res.status,headers:res.headers,data:await res.json()};}
 const a=await api('/api/user'),cookie=a.headers.get('set-cookie').split(';')[0];
 const stranger=await api('/api/user'),other=stranger.headers.get('set-cookie').split(';')[0];
 const c=await TestClient.connect(srv.url.replace('http:','ws:')+'/ws',{wsOptions:{headers:{Cookie:cookie}}});clients.push(c);await c.hello('ReplayDoctor');
 assert.equal((await c.request({t:'room.create',mode:'solo',difficulty:'NORMAL'})).t,'ok');
 const room=srv.lobby.roomOf([...srv.registry.all()].find(s=>s.userId===a.data.user.id));
 assert.equal((await c.request({t:'room.start'})).t,'ok');await c.waitFor('m.public',p=>p.phase==='INFO_CHECK');
 const checkpoint=await (room.match.remote?room.match.snapshot():snapshotMatch(room.match));assert.ok(checkpoint.replayArchive);
 assert.equal((await c.request({t:'g.leave'})).t,'ok');
 let stats;
 for(let i=0;i<100;i++){stats=await srv.users.call('stats',{id:a.data.user.id});if(stats.records.length)break;await new Promise(r=>setTimeout(r,20));}
 assert.equal(stats.records.length,1);assert.equal(stats.replays.saved,1);assert.equal(stats.replays.limit,2);assert.equal(stats.replays.pinLimit,1);
 const matchId=stats.records[0].id,url='/api/user/replay?matchId='+matchId;
 const archive=await api(url,cookie);assert.equal(archive.status,200);assert.equal(archive.headers.get('cache-control'),'no-store');
 assert.equal(archive.headers.get('x-sp-replay-content'),srv.content.cs);assert.ok(archive.data.replay.events.length);
 assert.equal(JSON.stringify(archive.data).includes(a.data.user.id),false);
 assert.equal((await api(url)).status,401);assert.equal((await api(url,other)).status,404);
 assert.equal((await api(url,cookie,null,'https://evil.test')).status,403);
 assert.equal((await api('/api/user/replay/pin',cookie,{matchId,pinned:true},'https://evil.test')).status,403);
 assert.equal((await api('/api/user/replay/pin',other,{matchId,pinned:true})).status,404);
 assert.equal((await api('/api/user/replay/pin',cookie,{matchId,pinned:true})).status,200);
 assert.equal((await api('/api/user/replay/pin',cookie,{matchId,pinned:'true'})).status,400);
 assert.ok(c.log.every(msg=>!Object.hasOwn(msg,'replay')));
});
