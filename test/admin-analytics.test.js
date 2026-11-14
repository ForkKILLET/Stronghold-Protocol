import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {startServer} from '../server/index.js';
import {startAdminService} from '../server/admin/service.js';
import {createAdminAnalytics} from '../server/admin/analytics.js';
import {TestClient} from './helpers/wsClient.js';
import {analyticsDate,analyticsDay} from '../shared/adminAnalytics.js';
import {activitySegments} from '../public/js/admin/analytics.js';

test('DAU charts leave unknown dates blank instead of connecting through invented zero values',()=>{
  const segments=activitySegments([{dau:null},{dau:0},{dau:2},{dau:null},{dau:1}]);
  assert.deepEqual(segments,[[{i:1,value:0},{i:2,value:2}],[{i:4,value:1}]]);
  assert.deepEqual(activitySegments([{dau:null}]),[]);
});

test('analytics coalesces successful reports, bounds ranges and retries a failed query without showing fake zeros',async()=>{
  let at=Date.now(),calls=0,fail=false;
  const query=createAdminAnalytics({now:()=>at,users:{async call(method){assert.equal(method,'adminAnalytics');calls++;if(fail)throw Error('database unavailable');return {value:calls};}}});
  await Promise.all([query({}),query({})]);assert.equal(calls,1);
  await query({});assert.equal(calls,1);
  at+=30001;fail=true;await assert.rejects(()=>query({}));
  fail=false;assert.equal((await query({})).value,3);
  await assert.rejects(()=>query({from:'2026-02-30',to:'2026-03-01'}),e=>e.status===400);
  await assert.rejects(()=>createAdminAnalytics({users:null})({}),e=>e.status===503);
});

test('authenticated split admin serves aggregates only; successful game connections and real seats drive DAU/participation',async t=>{
  const token='admin-analytics-internal-secret-at-least-32',password='admin-analytics-panel-password';
  const game=await startServer({port:0,host:'127.0.0.1',quiet:true,workers:0,matchWorkers:0,store:null,userFile:':memory:',nameModeration:null,announcementsFile:null,clientBuild:false,adminToken:token,adminPort:0});
  const panel=await startAdminService({port:0,host:'127.0.0.1',password,token,gameUrl:game.telemetry.url,publicDir:path.resolve('public')});
  const clients=[];t.after(async()=>{await Promise.all(clients.map(c=>c.terminate()));await panel.close();await game.close();});
  const user=await game.users.call('create');
  // Looking at a profile or creating an account is not a game connection.
  const today=analyticsDate(analyticsDay(Date.now())),range={from:today,to:today};
  assert.equal((await game.users.call('adminAnalytics',range)).days[0].dau,0);
  const connect=async()=>{const c=await TestClient.connect(game.url.replace('http:','ws:')+'/ws',{wsOptions:{headers:{Cookie:'sp_user='+user.token}}});clients.push(c);await c.hello('统计测试');return c;};
  const c=await connect();await connect();
  await c.request({t:'room.create',mode:'solo',difficulty:'FUNNY'});await c.waitFor('room.state');await c.request({t:'room.start'});await c.waitFor('m.public');
  // The collector batches daily facts; query the DB after the queued write, without a full simulation.
  await new Promise(resolve=>setTimeout(resolve,350));
  const login=await fetch(panel.url+'/admin/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
  const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
  const url=panel.url+'/admin/api/analytics?'+new URLSearchParams(range);
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{headers:{...headers,Origin:'https://evil.invalid'}})).status,403);
  assert.equal((await fetch(url,{headers,method:'POST'})).status,405);
  assert.equal((await fetch(panel.url+'/admin/api/analytics?from=2026-02-30&to=2026-03-01',{headers})).status,400);
  assert.equal((await fetch(game.url+'/v1/analytics')).status,404);
  assert.equal((await fetch(game.telemetry.url+'/v1/analytics')).status,401);
  const response=await fetch(url,{headers});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const report=await response.json();assert.equal(report.days[0].dau,1);assert.equal(report.days[0].playingAccounts,1);
  assert.equal(report.days[0].settledGames,0,'an unfinished game is not a completed game');
  const text=JSON.stringify(report);assert.ok(!text.includes(user.user.id));assert.ok(!text.includes(user.token));assert.ok(!text.includes('统计测试'));
  const overview=await (await fetch(panel.url+'/admin/api/overview',{headers})).json();assert.equal(overview.capabilities.analytics,true);
  assert.equal(game.registry.size,2,'the admin did not create game sessions');
});
