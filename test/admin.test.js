import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startServer} from '../server/index.js';
import {adminPassword,createAdmin} from '../server/admin/index.js';
import {createAdminSnapshot} from '../server/admin/snapshot.js';
import {TestClient} from './helpers/wsClient.js';

const PASSWORD='local-admin-test-password';
const root=path.resolve(import.meta.dirname,'../public');
const opts={port:0,host:'127.0.0.1',quiet:true,workers:0,store:null,userFile:'',nameModeration:null,announcementsFile:null,clientBuild:false};
function fixture(){
  let at=Date.now();
  const sessions=[{playerId:'p1',userId:'SECRET_USER',token:'SECRET_TOKEN',name:'博士甲',connected:true,lastSeen:at},
    {playerId:'p2',userId:'SECRET_USER',token:'SECOND_TOKEN',name:'博士甲',connected:true,lastSeen:at-1},
    {playerId:'p3',userId:'SECRET_OTHER',token:'OTHER_TOKEN',name:'博士乙',connected:false,lastSeen:at-20,disconnectedAt:at-10},
    {playerId:'expired',name:'expired',connected:false,lastSeen:1}];
  const registry={all:()=>sessions,byId:id=>sessions.find(s=>s.playerId===id),isExpired:s=>s.playerId==='expired'};
  const match={startedAt:at-10000,mode:'solo',difficulty:'HARD',snapshot(){throw Error('must not export');},diag(){throw Error('must not request');}};
  const ctx={match,members:[sessions[0]],lastPublic:JSON.stringify({t:'m.public',phase:'PREP',round:4,paused:true,
    private:'SECRET_STATE',players:[{...sessions[0],lp:12,alive:true,hand:['SECRET_HAND']}]} )};
  const room={code:'ABCD',mode:'solo',difficulty:'HARD',hostId:'p1',createdAt:at-12000,match,matchCtx:ctx,
    seats:[sessions[0],{playerId:'bot',name:'AI',isBot:true},null],spectators:[sessions[2]],battleSpeed:2};
  const queue={queueId:'queue1',players:[sessions[1]],queuedAt:at-5000,mode:'coop',difficulty:'ABYSS'};
  const lobby={rooms:new Map([['ABCD',room]]),activeQueueMatches:new Set([ctx]),queueByPlayer:new Map([['p2',queue]]),recoveryDocs:new Map()};
  const network={diagnostics:{stats:()=>({sentBytes:1000,receivedBytes:500,recentEventLoop:{sampledAt:at,p99Ms:22,maxMs:30}})},bufferedBytes:()=>({total:42})};
  const health={registry,lobby,network,startedAt:at-100000},diagnostics={};
  return {health,diagnostics,data:{},now:()=>at,tick:ms=>at+=ms};
}
const post=(password=PASSWORD,headers={})=>({method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({password})});
async function login(url){const r=await fetch(url+'/admin/api/login',post());assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}

test('safe summaries deduplicate people/matches, preserve queue semantics, bound history and paginate',()=>{
  const f=fixture(),snapshot=createAdminSnapshot(f),o=snapshot.overview();
  assert.deepEqual(o.counts,{online:1,disconnected:1,rooms:1,matches:1,queuedTeams:1,queuedPlayers:1,bots:1,spectators:0});
  const matches=snapshot.list('matches').items;
  assert.equal(matches.length,1);assert.equal(matches[0].phase,'PREP');assert.equal(matches[0].round,4);assert.equal(matches[0].paused,true);
  assert.equal(matches[0].mode,'solo');assert.equal(matches[0].players[0].lp,12);
  const serialized=JSON.stringify(['matches','rooms','queue','players'].map(kind=>snapshot.list(kind)));
  for(const secret of ['SECRET_USER','SECRET_TOKEN','SECRET_OTHER','OTHER_TOKEN','SECOND_TOKEN','SECRET_STATE','SECRET_HAND','"userId"','"token"'])assert.ok(!serialized.includes(secret),secret);
  assert.equal(snapshot.list('players',{query:'博士乙'}).total,1);
  assert.equal(snapshot.list('players',{status:'online'}).items[0].sessionCount,2);
  assert.equal(snapshot.list('players',{status:'online'}).items[0].state,'match');
  assert.equal(snapshot.list('players',{status:'disconnected'}).total,1);
  assert.equal(snapshot.list('players',{page:50}).page,1);
  assert.equal(o.resources.socketBufferedBytes,42);assert.equal(o.resources.cpuPercent,null);
  snapshot.sample();assert.equal(snapshot.overview().history.length,1,'manual refresh and timer cannot create tiny rate windows');
  for(let i=0;i<110;i++){f.tick(3000);snapshot.sample();}
  const next=snapshot.overview();assert.ok(next.history.length<=101);assert.ok(next.history[0].at>=f.now()-300000);
  assert.ok(Number.isFinite(next.resources.cpuPercent));
  for(let i=0;i<110;i++)f.health.registry.all().push({playerId:`extra${i}`,name:'extra',connected:true,lastSeen:f.now()});
  f.tick(1001);assert.equal(snapshot.list('players',{page:3}).items.length,12);
  assert.equal(snapshot.list('players',{page:3}).pages,3);
  f.health.lobby.rooms.clear();f.health.lobby.activeQueueMatches.clear();f.health.lobby.queueByPlayer.clear();f.tick(1001);
  assert.equal(snapshot.overview().counts.matches,0);assert.equal(snapshot.overview().counts.queuedPlayers,0);
});

test('password loading is explicit and validates secrets before server startup',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'sp-admin-secret-')),file=path.join(dir,'secret');
  const previous={password:process.env.SP_ADMIN_PASSWORD,file:process.env.SP_ADMIN_PASSWORD_FILE};
  try{
    delete process.env.SP_ADMIN_PASSWORD_FILE;delete process.env.SP_ADMIN_PASSWORD;
    assert.equal(adminPassword(),null);assert.throws(()=>adminPassword('short'),/16/);
    process.env.SP_ADMIN_PASSWORD=PASSWORD;assert.equal(adminPassword(),PASSWORD);assert.equal(adminPassword(null),null);
    writeFileSync(file,PASSWORD+'\n');process.env.SP_ADMIN_PASSWORD_FILE=file;assert.equal(adminPassword(),PASSWORD);
    assert.throws(()=>adminPassword('a'.repeat(513)),/512/);
  }finally{for(const [key,value] of [['SP_ADMIN_PASSWORD',previous.password],['SP_ADMIN_PASSWORD_FILE',previous.file]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}rmSync(dir,{recursive:true,force:true});}
});

test('disabled admin namespace cannot leak via static aliases or encoded paths',async t=>{
  const srv=await startServer({...opts,adminPassword:null});t.after(()=>srv.close());
  for(const path of ['/admin','/admin/','/admin/index.html','/%61dmin/index.html','//admin/index.html','/ADMIN/index.html','/admin/api/overview']){
    const r=await fetch(srv.url+path);assert.equal(r.status,404,path);
  }
});

test('admin HTTP auth, bounded inputs, cookies, origin, session expiry and login/read throttling',async t=>{
  const f=fixture(),controller=createAdmin({password:PASSWORD,publicDir:root,...f,trustProxy:true});
  const server=http.createServer((req,res)=>controller.handle(req,res,new URL(req.url,'http://local').pathname));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{controller.close();await new Promise(r=>server.close(r));});
  assert.equal((await fetch(url+'/admin')).status,200);
  assert.equal((await fetch(url+'/admin/api/overview')).status,401);
  assert.equal((await fetch(url+'/admin/api/login',post('wrong'))).status,401);
  assert.equal((await fetch(url+'/admin/api/login',post(PASSWORD,{Origin:'https://evil.invalid'}))).status,403);
  assert.equal((await fetch(url+'/admin/api/login',post(PASSWORD,{'Sec-Fetch-Site':'cross-site'}))).status,403);
  assert.equal((await fetch(url+'/admin/api/login',{method:'POST',headers:{'Content-Type':'text/plain'},body:'x'})).status,415);
  assert.equal((await fetch(url+'/admin/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
  assert.equal((await fetch(url+'/admin/api/login',post('x'.repeat(3000)))).status,413);
  const response=await fetch(url+'/admin/api/login',post(PASSWORD,{'X-Forwarded-Proto':'https'}));
  assert.equal(response.status,200);const rawCookie=response.headers.get('set-cookie'),cookie=rawCookie.split(';')[0];
  for(const flag of ['Path=/admin','HttpOnly','SameSite=Strict','Secure'])assert.ok(rawCookie.includes(flag));
  const headers={Cookie:cookie};assert.equal((await fetch(url+'/admin/api/session',{headers})).status,200);
  assert.equal((await fetch(url+'/admin/api/list?kind=players',{headers})).status,200);
  for(const query of ['kind=checkpoint','kind=players&page=0','kind=players&q='+ 'a'.repeat(81),'kind=matches&status=online'])assert.equal((await fetch(url+'/admin/api/list?'+query,{headers})).status,400);
  assert.equal((await fetch(url+'/admin/api/overview',{headers:{Cookie:cookie+'; '+cookie}})).status,401);
  const result=await fetch(url+'/admin/api/overview',{headers});assert.equal(result.headers.get('cache-control'),'no-store');
  assert.ok(!(await result.text()).includes('SECRET'));
  assert.equal((await fetch(url+'/admin/api/overview',{headers:{...headers,Origin:'https://evil.invalid'}})).status,403);
  assert.equal((await fetch(url+'/admin/api/overview',{method:'DELETE',headers})).status,405);
  f.tick(60001);
  for(let i=0;i<120;i++)assert.equal((await fetch(url+'/admin/api/session',{headers})).status,200);
  assert.equal((await fetch(url+'/admin/api/session',{headers})).status,429);
  assert.equal((await fetch(url+'/admin/api/logout',{method:'POST',headers})).status,200);
  assert.equal((await fetch(url+'/admin/api/session',{headers})).status,401);
  const next=await login(url);f.tick(8*3600000+1);
  assert.equal((await fetch(url+'/admin/api/session',{headers:{Cookie:next}})).status,401);
  for(let i=0;i<8;i++)assert.equal((await fetch(url+'/admin/api/login',post('wrong'))).status,401);
  assert.equal((await fetch(url+'/admin/api/login',post())).status,429);
});

test('real Match Worker summaries update without checkpoints and admin reads do not create game sessions', {timeout:20000},async t=>{
  const srv=await startServer({...opts,adminPassword:PASSWORD,matchWorkers:1});const clients=[];
  t.after(async()=>{await srv.close();await Promise.all(clients.map(c=>c.terminate()));});
  const cookie=await login(srv.url),headers={Cookie:cookie};
  assert.equal(srv.registry.size,0);assert.equal(srv.network.connectionCount,0);
  for(const name of ['甲','乙']){const c=await TestClient.connect(srv.url.replace('http:','ws:')+'/ws');await c.hello(name);clients.push(c);}
  const [host,guest]=clients;
  assert.equal((await host.request({t:'room.create',mode:'coop',difficulty:'HARD'})).t,'ok');
  const room=await host.waitFor('room.state');await guest.request({t:'room.join',code:room.code});await guest.request({t:'room.ready',ready:true});await host.request({t:'room.start'});
  await host.waitFor('m.public',p=>p.phase==='INFO_CHECK');
  const match=srv.lobby.rooms.get(room.code).match;
  assert.equal(match.remote,true);match.snapshot=()=>{throw Error('admin must not checkpoint');};
  let rows=await (await fetch(srv.url+'/admin/api/list?kind=matches',{headers})).json();
  assert.equal(rows.total,1);assert.equal(rows.items[0].phase,'INFO_CHECK');assert.ok(rows.items[0].startedAt>0);assert.equal(rows.items[0].players.length,2);
  await host.request({t:'g.pause',on:true});await guest.request({t:'g.pause',on:true});await host.waitFor('m.public',p=>p.paused);
  await new Promise(r=>setTimeout(r,1010));
  rows=await (await fetch(srv.url+'/admin/api/list?kind=matches',{headers})).json();assert.equal(rows.items[0].paused,true);
  assert.equal(srv.registry.size,2);assert.equal(srv.network.connectionCount,2);
});
