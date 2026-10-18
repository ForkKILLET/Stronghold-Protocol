import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {startServer} from '../server/index.js';
import {startAdminService} from '../server/admin/service.js';
import {createAdminUpstream} from '../server/admin/upstream.js';
import {telemetryToken} from '../server/admin/telemetry-secret.js';
import {TestClient} from './helpers/wsClient.js';
const token='collector-test-key-at-least-32-characters',password='independent-panel-password';
const opts={port:0,host:'127.0.0.1',quiet:true,workers:0,matchWorkers:0,store:null,userFile:'',nameModeration:null,announcementsFile:null,adminToken:token,adminPort:0};
const publicDir=path.resolve(import.meta.dirname,'../public');
const pause=()=>new Promise(r=>setTimeout(r,2600));
const login=async url=>{const r=await fetch(url+'/admin/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};

test('collector is opt-in, separately authenticated, read-only and absent from the public game port',async t=>{
 assert.throws(()=>telemetryToken('short'),/32/);assert.throws(()=>telemetryToken('a'.repeat(513)),/512/);
 const game=await startServer(opts);t.after(()=>game.close());
 for(const route of ['/admin','/admin/api/overview','/v1/snapshot'])assert.equal((await fetch(game.url+route)).status,404);
 assert.equal((await fetch(game.telemetry.url+'/v1/snapshot')).status,401);
 assert.equal((await fetch(game.telemetry.url+'/v1/snapshot',{headers:{Authorization:'Bearer wrong'}})).status,401);
 const headers={Authorization:'Bearer '+token};
 assert.equal((await fetch(game.telemetry.url+'/v1/snapshot',{method:'POST',headers})).status,405);
 assert.equal((await fetch(game.telemetry.url+'/v1/snapshot',{headers:{...headers,Origin:'https://evil.invalid'}})).status,401);
 const c=await TestClient.connect(game.url.replace('http:','ws:')+'/ws');t.after(()=>c.terminate());
 const w=await c.hello('测试博士');const s=game.registry.byId(w.playerId);s.userId='DO_NOT_EXPORT_USER';s.addr='DO_NOT_EXPORT_ADDRESS';
 const response=await fetch(game.telemetry.url+'/v1/snapshot',{headers});assert.equal(response.status,200);
 const value=await response.json();assert.equal(value.schema,1);assert.ok(value.server.instance);assert.equal(value.counts.online,1);
 const serialized=JSON.stringify(value);for(const secret of [s.userId,s.token,s.addr,'"userId"','"token"','"addr"'])assert.ok(!serialized.includes(secret));
 assert.ok(!('history' in value));assert.equal(game.registry.size,1);
});

test('panel restart leaves a live match intact; game restart retains admin login and stale data recovers', {timeout:30000},async t=>{
 let game=await startServer(opts);const port=new URL(game.telemetry.url).port;
 const c=await TestClient.connect(game.url.replace('http:','ws:')+'/ws');await c.hello('玩家');
 await c.request({t:'room.create',mode:'solo',difficulty:'NORMAL'});const room=await c.waitFor('room.state');await c.request({t:'room.start'});await c.waitFor('m.public');
 const match=game.lobby.rooms.get(room.code).match;
 let panel=await startAdminService({port:0,host:'127.0.0.1',password,token,gameUrl:game.telemetry.url,publicDir});
 t.after(async()=>{await panel.close();await game.close();await c.terminate();});
 await panel.close();assert.equal(game.lobby.rooms.get(room.code).match,match);assert.equal(c.isOpen,true);
 panel=await startAdminService({port:0,host:'127.0.0.1',password,token,gameUrl:game.telemetry.url,publicDir});
 const Cookie=await login(panel.url),headers={Cookie};
 const overview=()=>fetch(panel.url+'/admin/api/overview',{headers}).then(r=>r.json());
 const original=await overview();assert.equal(original.counts.matches,1);assert.equal(original.connection.ok,true);
 await game.close();await pause();
 const stale=await overview();assert.equal(stale.counts.matches,1);assert.equal(stale.at,original.at);assert.equal(stale.connection.ok,false);
 assert.equal((await fetch(panel.url+'/admin/api/session',{headers})).status,200);
 assert.equal((await fetch(panel.url+'/admin')).status,200);
 game=await startServer({...opts,adminPort:Number(port)});await pause();
 const recovered=await overview();assert.equal(recovered.connection.ok,true);assert.equal(recovered.counts.matches,0);
 assert.notEqual(recovered.server.instance,original.server.instance);assert.equal(recovered.history.length,1);
 assert.equal((await fetch(panel.url+'/admin/api/session',{headers})).status,200);
});

test('panel coalesces requests and retains safe last data on schema/size failures',async()=>{
 let at=Date.now(),requests=0,mode='ok';
 const value={schema:1,at,server:{instance:'one'},resources:{at},counts:{online:2},players:[],rooms:[],matches:[],queue:[]};
 const upstream=createAdminUpstream({url:'http://fixed.invalid',token,now:()=>at,maxBytes:1024,fetch:async(url,options)=>{
   requests++;assert.equal(url.href,'http://fixed.invalid/v1/snapshot');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+token);
   await new Promise(r=>setTimeout(r,10));return new Response(mode==='size'?'x'.repeat(2048):JSON.stringify({...value,schema:mode==='schema'?9:1}));
 }});
 await Promise.all([upstream.overview(),upstream.list('players'),upstream.overview()]);assert.equal(requests,1);
 mode='schema';at+=3000;let data=await upstream.overview();assert.equal(data.connection.error,'SCHEMA');assert.equal(data.counts.online,2);
 mode='size';at+=3000;data=await upstream.overview();assert.equal(data.connection.error,'UNAVAILABLE');assert.equal(data.at,value.at);
 mode='ok';at+=3000;assert.equal((await upstream.overview()).connection.ok,true);upstream.close();
 await assert.rejects(()=>upstream.overview(),/closed/);
});
