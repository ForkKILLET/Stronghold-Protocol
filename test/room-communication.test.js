import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from '../server/index.js';
import {TestClient} from './helpers/wsClient.js';
import {EMOTES} from '../shared/constants.js';
import {normalizeDraft} from '../public/js/ui/gameLogic/draft.js';

test('waiting-room chat/emotes are isolated, rate-limited and spectator read-only; draft focus broadcasts',async()=>{
 const srv=await startServer({port:0,quiet:true,workers:0});const clients=[];
 const connect=async name=>{const c=await TestClient.connect(srv.url.replace('http','ws')+'/ws');clients.push(c);const w=await c.hello(name);c.id=w.playerId;return c;};
 try{
  const a=await connect('A'),b=await connect('B'),other=await connect('other'),spectator=await connect('observer');
  await a.request({t:'room.create',mode:'coop',difficulty:'NORMAL'});const room=await a.waitFor('room.state');
  await b.request({t:'room.join',code:room.code});await spectator.request({t:'room.spectate',code:room.code});
  assert.equal((await a.request({t:'room.chat',text:'讨论策略'})).t,'ok');
  const received=await b.waitFor('m.chat');assert.equal(received.text,'讨论策略');assert.equal(received.playerId,a.id);assert.equal(received.name,'A');
  assert.equal((await spectator.waitFor('m.chat')).text,'讨论策略');
  assert.equal((await a.request({t:'room.emote',id:EMOTES[0]})).code,'RATE');
  assert.equal((await spectator.request({t:'room.chat',text:'hi'})).code,'SPECTATOR');
  assert.equal((await other.request({t:'room.chat',text:'hi'})).code,'NOT_IN_ROOM');
  assert.equal((await b.request({t:'room.emote',id:EMOTES[0]})).t,'ok');await a.waitFor('m.emote');
  assert.ok(!other.inbox.some(m=>m.t==='m.chat'||m.t==='m.emote'));
  await b.request({t:'room.ready',ready:true});await a.request({t:'room.start'});
  await a.request({t:'g.infoReady'});await b.request({t:'g.infoReady'});
  const draft=await a.waitFor('m.public',m=>m.phase==='BAND_DRAFT');
  const match=srv.lobby.rooms.get(room.code).match;
  const band='band_amiya';assert.ok(match.gd.bandAllowed(band));
  assert.equal((await b.request({t:'g.bandFocus',bandId:band})).t,'ok');
  const update=await a.waitFor('m.public',m=>m.draft?.focus?.[b.id]===band);assert.equal(normalizeDraft(update.draft,update.players).focus.get(b.id),band);
  await b.request({t:'g.bandFocus',bandId:null});await a.waitFor('m.public',m=>m.phase==='BAND_DRAFT'&&!m.draft?.focus?.[b.id]);
  assert.equal((await a.request({t:'room.chat',text:'late'})).code,'ROOM_STARTED');
  assert.ok(draft.draft.order.length===2);
 }finally{await Promise.all(clients.map(c=>c.close()));await srv.close();}
});

test('room chat approval cannot leak a message after the sender leaves the room',async()=>{
 const srv=await startServer({port:0,quiet:true,workers:0});const clients=[];
 try{
  const a=await TestClient.connect(srv.url.replace('http','ws')+'/ws'),b=await TestClient.connect(srv.url.replace('http','ws')+'/ws');clients.push(a,b);
  await a.hello('A');await b.hello('B');await a.request({t:'room.create',mode:'coop',difficulty:'NORMAL'});
  const room=await a.waitFor('room.state');await b.request({t:'room.join',code:room.code});
  let approve;let started;
  const reviewing=new Promise(r=>{started=r;});
  srv.lobby.nameModeration={checkChat:()=>{started();return new Promise(r=>{approve=r;});}};
  const pending=a.request({t:'room.chat',text:'pending'});await reviewing;
  assert.equal((await a.request({t:'room.chat',text:'duplicate'})).code,'RATE');
  await a.request({t:'room.leave'});approve({allowed:true});assert.equal((await pending).code,'WRONG_PHASE');
  assert.ok(!b.inbox.some(m=>m.t==='m.chat'));
 }finally{await Promise.all(clients.map(c=>c.close()));await srv.close();}
});
