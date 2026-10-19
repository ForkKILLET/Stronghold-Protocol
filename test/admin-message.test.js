import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAdminUpstream} from '../server/admin/upstream.js';
import {ServerMessage} from '../server/serverMessage.js';
import {Announcements} from '../server/announcements.js';
import {startServer} from '../server/index.js';
import {startAdminService} from '../server/admin/service.js';
import {TestClient} from './helpers/wsClient.js';
const token='server-message-internal-key-32-characters',password='server-message-admin-password';
const post=(value,headers={})=>({method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(value)});
const row=(text='维护通知',durationSeconds=900)=>({text,level:'warning',durationSeconds});
function temp(t){const dir=mkdtempSync(path.join(tmpdir(),'sp-message-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}

test('notification writes are atomic, versioned, bounded and survive restarts until absolute expiry',async t=>{
 const file=path.join(temp(t),'message.json');let now=Date.now();const store=new ServerMessage({file,now:()=>now});await store.start();
 const revision=store.state().revision;
 for(const message of [row('x'.repeat(501)),row(' ',900),row('a',0),row('a',86401),row('\u0000'),row('\ud800'),{...row(),url:'https://evil.invalid'}])
  await assert.rejects(()=>store.update({revision,message}),e=>e.status===400);
 const results=await Promise.allSettled([store.update({revision,message:row('😀'.repeat(500))}),store.update({revision,message:row('不能覆盖')})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
 const live=store.state();assert.equal(live.active,true);assert.equal(live.message.text,'😀'.repeat(500));assert.equal(live.persistent,true);
 const restored=new ServerMessage({file,now:()=>now});await restored.start();assert.deepEqual(restored.state(),live);
 now+=900000;assert.equal(restored.state().active,false,'absolute expiry is not restarted');
 await store.stop();await assert.rejects(()=>store.update({revision:live.revision,message:null}),e=>e.status===503);await restored.stop();
});

test('failed disk writes never change or broadcast the notification; invalid files fail closed',async t=>{
 const dir=temp(t),file=path.join(dir,'missing','message.json');let broadcasts=0;
 const store=new ServerMessage({file,onChange:()=>broadcasts++});await store.start();const before=store.state();
 await assert.rejects(()=>store.update({revision:before.revision,message:row()}),e=>e.status===503);
 assert.deepEqual(store.state(),before);assert.equal(broadcasts,0);
 mkdirSync(path.dirname(file));await store.update({revision:before.revision,message:row()});assert.equal(broadcasts,1);await store.stop();
 writeFileSync(file,'invalid');const bad=new ServerMessage({file,log:{warn(){}}});await bad.start();assert.equal(bad.state().available,false);
 await assert.rejects(()=>bad.update({revision:bad.state().revision,message:null}),e=>e.status===503);assert.equal(readFileSync(file,'utf8'),'invalid');await bad.stop();
});

test('operator notification overrides only the scrolling notice; expiry and withdrawal restore scheduled announcements',async t=>{
 let now=Date.now();const service=new Announcements({file:null,now:()=>now});await service.start();t.after(()=>service.stop());
 service.rows=[{id:'scheduled',text:'排期',level:'info',enabled:true,startAt:now-1,endAt:now+100000},
  {id:'popup',type:'popup',text:'长期公告',level:'info',enabled:true,startAt:0,endAt:null}];service.refresh();
 const original=service.message();const state=await service.serverMessage.update({revision:service.serverMessage.state().revision,message:row('通知',1)});
 assert.equal(service.message().announcement.text,'通知');assert.deepEqual(service.message().popupAnnouncement,original.popupAnnouncement);
 now+=1000;service.refresh();assert.equal(service.message().announcement.id,'scheduled');
 const next=await service.serverMessage.update({revision:state.revision,message:row('再通知')});
 await service.serverMessage.update({revision:next.revision,message:null});assert.equal(service.message().announcement.id,'scheduled');
});

const opts={host:'127.0.0.1',port:0,quiet:true,workers:0,matchWorkers:1,store:null,userFile:'',nameModeration:null,announcementsFile:null,adminToken:token,adminPort:0};
test('authenticated panel publishes to active matches and new connections, preserves popup config, rejects conflicts and unauthorised writes',async t=>{
 const file=path.join(temp(t),'message.json');const game=await startServer({...opts,serverMessageFile:file});
 const panel=await startAdminService({host:'127.0.0.1',port:0,password,token,gameUrl:game.telemetry.url,publicDir:path.resolve('public')});const clients=[];
 t.after(async()=>{await panel.close();await game.close();await Promise.all(clients.map(c=>c.terminate()));});
 const url=panel.url+'/admin/api/server-message',internal=game.telemetry.url+'/v1/server-message';
 assert.equal((await fetch(url)).status,401);assert.equal((await fetch(game.url+'/v1/server-message')).status,404);
 assert.equal((await fetch(internal)).status,401);assert.equal((await fetch(internal,{headers:{Authorization:'Bearer '+token,Origin:panel.url}})).status,401);
 const login=await fetch(panel.url+'/admin/api/login',post({password}));const Cookie=login.headers.get('set-cookie').split(';')[0];
 const get=()=>fetch(url,{headers:{Cookie}}).then(r=>r.json());const initial=await get();
 assert.equal((await fetch(url,post({revision:initial.revision,message:row()},{Cookie,Origin:'https://evil.invalid'}))).status,403);
 assert.equal((await fetch(url,{method:'PUT',headers:{Cookie}})).status,405);
 assert.equal((await fetch(url,{method:'POST',headers:{Cookie,'Content-Type':'text/plain'},body:'x'})).status,415);
 assert.equal((await fetch(url,post({revision:initial.revision,message:row('x'.repeat(501))},{Cookie}))).status,400);
 const host=await TestClient.connect(game.url.replace('http:','ws:')+'/ws');clients.push(host);await host.hello('对局中玩家');await host.request({t:'room.create',mode:'solo',difficulty:'NORMAL'});const room=await host.waitFor('room.state');await host.request({t:'room.start'});await host.waitFor('m.public');
 const match=game.lobby.rooms.get(room.code).match;
 const response=await fetch(url,post({revision:initial.revision,message:row('<b>维护通知</b> 😀')},{Cookie}));assert.equal(response.status,200);const saved=await response.json();
 assert.match(response.headers.get('cache-control'),/no-store/);
 await host.waitFor('site.announcement',m=>m.announcement?.text==='<b>维护通知</b> 😀');assert.equal(game.lobby.rooms.get(room.code).match,match);
 const late=await TestClient.connect(game.url.replace('http:','ws:')+'/ws');clients.push(late);await late.waitFor('site.announcement',m=>m.announcement?.id===saved.message.id);
 assert.equal((await fetch(url,post({revision:initial.revision,message:row('过时编辑')},{Cookie}))).status,409);
 assert.equal((await get()).message.id,saved.message.id);
 assert.equal((await fetch(url,post({revision:saved.revision,message:null},{Cookie}))).status,200);
 await host.waitFor('site.announcement',m=>m.announcement===null);assert.equal((await get()).message,null);
 assert.equal((await fetch(panel.url+'/admin/api/overview',{headers:{Cookie}}).then(r=>r.json())).capabilities.serverMessage,true);
});

test('notification state replays after a real game restart; panel sessions remain independent',async t=>{
 const file=path.join(temp(t),'message.json');let game=await startServer({...opts,matchWorkers:0,serverMessageFile:file});let panel;
 t.after(async()=>{await panel?.close();await game.close();});
 panel=await startAdminService({host:'127.0.0.1',port:0,password,token,gameUrl:game.telemetry.url,publicDir:path.resolve('public')});
 const login=await fetch(panel.url+'/admin/api/login',post({password})),Cookie=login.headers.get('set-cookie').split(';')[0];
 const initial=game.announcements.serverMessage.state();await game.announcements.serverMessage.update({revision:initial.revision,message:row('重启后保留')});
 const saved=game.announcements.message().announcement;await game.close();game=await startServer({...opts,matchWorkers:0,serverMessageFile:file});
 assert.deepEqual(game.announcements.message().announcement,saved);assert.equal((await fetch(panel.url+'/admin/api/session',{headers:{Cookie}})).status,200);
});

test('notification editor has a separate write limit and a bounded JSON body',async t=>{
 const game=await startServer({...opts,matchWorkers:0}),panel=await startAdminService({host:'127.0.0.1',port:0,password,token,gameUrl:game.telemetry.url,publicDir:path.resolve('public')});
 t.after(async()=>{await panel.close();await game.close();});
 const login=await fetch(panel.url+'/admin/api/login',post({password})),Cookie=login.headers.get('set-cookie').split(';')[0],url=panel.url+'/admin/api/server-message';
 const initial=await fetch(url,{headers:{Cookie}}).then(r=>r.json());
 assert.equal((await fetch(url,post({padding:'x'.repeat(5000)},{Cookie}))).status,413);
 const emoji=await fetch(url,post({revision:initial.revision,message:row('😀'.repeat(500))},{Cookie}));assert.equal(emoji.status,200,'500 emoji fit in the control JSON budget');
 for(let i=0;i<8;i++)assert.equal((await fetch(url,post({revision:initial.revision,message:null},{Cookie}))).status,409);
 assert.equal((await fetch(url,post({revision:initial.revision,message:null},{Cookie}))).status,429);
 assert.equal((await fetch(url,{headers:{Cookie}})).status,200,'write throttling does not block reading');
});


test('an older snapshot in flight cannot overwrite a successfully edited notification',async()=>{
 let now=Date.now(),finish=null,delay=false;
 const previous={revision:'old',message:null},next={revision:'new',message:{text:'最新通知'}};
 const value={schema:1,at:now,server:{instance:'one'},resources:{at:now},counts:{},players:[],rooms:[],matches:[],queue:[],serverMessage:previous};
 const upstream=createAdminUpstream({url:'http://fixed.invalid',token,now:()=>now,fetch:async(url)=>{
  if(url.pathname==='/v1/server-message')return new Response(JSON.stringify(next));
  if(delay)return new Promise(resolve=>{finish=()=>resolve(new Response(JSON.stringify(value)));});
  return new Response(JSON.stringify(value));
 }});
 await upstream.overview();now+=3000;delay=true;const pending=upstream.overview();
 await upstream.updateServerMessage({revision:'old',message:row()});finish();
 assert.deepEqual((await pending).serverMessage,next);upstream.close();
});
