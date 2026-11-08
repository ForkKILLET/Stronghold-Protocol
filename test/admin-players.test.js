import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {openUserStore} from '../server/users/store.js';
import {startServer} from '../server/index.js';
import {startAdminService} from '../server/admin/service.js';
import {TestClient} from './helpers/wsClient.js';
import {createAdminPlayers} from '../server/admin/players.js';

test('without account storage, active guests remain temporary and recovery is unavailable',async()=>{
  const players=createAdminPlayers({users:null,data:{},registry:{byId:()=>null},snapshot:{capture:()=>({players:[
    {id:'guest',name:'游客',connected:true,state:'lobby',locations:[]},
    {id:'gone',name:'断线游客',connected:false,state:'disconnected',locations:[]},
  ]})}});
  const list=await players.list({status:'offline'});assert.equal(list.total,1);assert.equal(list.counts.accounts,0);
  assert.equal(list.items[0].persistent,false);assert.equal(list.items[0].publicId,null);
  assert.equal((await players.list({status:'online',query:'游客'})).total,1);
  await assert.rejects(()=>players.recovery({publicId:'ABCD',name:'游客'}),{status:503});
});

test('account roster paginates offline users, merges sessions, filters all locations and never exports secrets',async t=>{
  const users=await openUserStore(':memory:');t.after(()=>users.close());
  const all=[];
  for(let i=0;i<60;i++){
    const entry=await users.call('create');all.push(entry);
    await users.call('update',{id:entry.user.id,name:`博士_${i}`,avatarId:'avatar:Avatar_def_01'});
  }
  const active=[{id:'session1',accountId:all[0].user.id,connected:true,name:'博士_0',lastSeen:100,
    state:'match',sessionCount:2,locations:[{state:'match',roomCode:'AAAA'},{state:'waiting',roomCode:'BBBB'}]},
  {id:'session2',accountId:all[1].user.id,connected:false,name:'博士_1',state:'disconnected',lastSeen:90},
  {id:'temporary',accountId:null,connected:true,name:'游客',state:'lobby',lastSeen:200}];
  const list=options=>users.call('adminPlayers',{active,...options});
  const page=await list({});assert.equal(page.total,61);assert.equal(page.items.length,50);assert.equal(page.pages,2);
  assert.deepEqual(page.counts,{accounts:60,online:1,offline:59,temporary:1});
  assert.equal(page.items[0].id,'temporary');assert.equal(page.items[1].id,all[0].user.publicId);
  assert.equal((await list({page:99})).items.length,11);
  assert.equal((await list({status:'offline'})).total,59);
  assert.equal((await list({status:'disconnected'})).total,1);
  const waiting=await list({status:'waiting'});assert.equal(waiting.total,1);assert.equal(waiting.items[0].sessionCount,2);
  assert.equal((await list({query:all[0].user.publicId.toLowerCase()})).items[0].publicId,all[0].user.publicId);
  assert.equal((await list({query:'博士_12'})).total,1);assert.equal((await list({query:'%'})).total,0);
  const text=JSON.stringify(page);for(const entry of all){assert.ok(!text.includes(entry.user.id));assert.ok(!text.includes(entry.token));}
  assert.ok(!text.includes('accountId'));assert.ok(!text.includes('credentials'));
});

test('split-service admin lists all accounts and bounds authenticated, non-retried recovery writes',async t=>{
  const token='admin-players-internal-secret-at-least-32',password='admin-players-test-password';
  const game=await startServer({port:0,host:'127.0.0.1',quiet:true,workers:0,matchWorkers:0,store:null,userFile:':memory:',nameModeration:null,announcementsFile:null,clientBuild:false,adminToken:token,adminPort:0});
  const panel=await startAdminService({port:0,host:'127.0.0.1',password,token,gameUrl:game.telemetry.url,publicDir:path.resolve('public')});
  const clients=[];t.after(async()=>{await panel.close();await game.close();await Promise.all(clients.map(c=>c.terminate()));});
  const live=await game.users.call('create'),offline=await game.users.call('create');
  for(const [entry,name] of [[live,'在线博士'],[offline,'离线博士']])await game.users.call('update',{id:entry.user.id,name,avatarId:'avatar:Avatar_def_01'});
  const c=await TestClient.connect(game.url.replace('http:','ws:')+'/ws');clients.push(c);const w=await c.hello('在线博士');game.registry.byId(w.playerId).userId=live.user.id;
  const request=(route,{cookie,body,origin,method}={})=>fetch(panel.url+'/admin/api/'+route,{method:method||(body?'POST':'GET'),headers:{...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request('list?kind=players')).status,401);
  assert.equal((await request('player-recovery',{body:{publicId:offline.user.publicId,name:'离线博士'}})).status,401);
  const login=await request('login',{body:{password}}),cookie=login.headers.get('set-cookie').split(';')[0];
  const response=await request('list?kind=players',{cookie});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const list=await response.json();assert.equal(list.total,2);assert.equal(list.counts.accounts,2);assert.equal(list.counts.online,1);
  assert.equal(list.items[0].publicId,live.user.publicId);assert.equal(list.items[1].state,'offline');
  assert.ok(!JSON.stringify(list).includes(offline.user.id));assert.ok(!JSON.stringify(list).includes(live.token));
  const publicProfile=await (await fetch(game.url+'/api/doctors/'+offline.user.publicId)).json();
  assert.equal(publicProfile.doctor.publicId,offline.user.publicId);assert.ok(!('aggregate' in publicProfile),'admin profile link still observes privacy');
  const auth={Authorization:'Bearer '+token};
  assert.equal((await fetch(game.url+'/v1/players')).status,404);
  assert.equal((await fetch(game.telemetry.url+'/v1/players')).status,401);
  assert.equal((await fetch(game.telemetry.url+'/v1/players',{headers:{...auth,Origin:panel.url}})).status,401);
  const old=await game.users.call('recovery',{id:offline.user.id});
  const body={publicId:offline.user.publicId,name:'离线博士'};
  assert.equal((await request('player-recovery',{cookie,body,origin:'https://evil.invalid'})).status,403);
  assert.equal((await request('player-recovery',{cookie,body:{...body,name:'错误博士'}})).status,409);
  assert.equal((await request('player-recovery',{cookie,method:'GET'})).status,405);
  assert.equal((await request('player-recovery',{cookie,body:{publicId:'../bad',name:'博士'}})).status,400);
  const issued=await request('player-recovery',{cookie,body});assert.equal(issued.status,200);assert.equal(issued.headers.get('cache-control'),'no-store');
  const result=await issued.json();assert.match(result.code,/^SP-/);assert.equal(result.doctor.publicId,body.publicId);
  assert.equal(await game.users.call('recover',{code:old.code}),null);
  assert.equal((await game.users.call('authenticate',{token:offline.token})).id,offline.user.id);
  assert.equal((await game.users.call('recover',{code:result.code})).user.id,offline.user.id);
  assert.equal(await game.users.call('recover',{code:result.code}),null);
  await game.users.call('update',{id:offline.user.id,name:'新代号',avatarId:'avatar:Avatar_def_01'});
  assert.equal((await request('player-recovery',{cookie,body})).status,409);
  for(let i=0;i<3;i++)await request('player-recovery',{cookie,body:{...body,name:'新代号'}});
  assert.equal((await request('player-recovery',{cookie,body:{...body,name:'新代号'}})).status,429);
  const bad=await request('list?kind=players&status=madeup',{cookie});assert.equal(bad.status,400);
  assert.equal(game.registry.size,1,'admin does not create player identities');
});
