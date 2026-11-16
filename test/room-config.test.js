import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from '../server/index.js';
import {TestClient} from './helpers/wsClient.js';
import {validateC2S} from '../shared/protocol.js';
import {roomDoc} from '../server/persist.js';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { DATA } from './match/harness.js';
const options={t:'room.setOptions',difficulty:'HARD',prepMultiplier:1.5,battleSpeed:3};
test('saved room pause modes round-trip; legacy room documents retain unanimous voting',()=>{
 for(const pauseMode of [undefined,'vote','veto']) {
  const registry=new SessionRegistry();const host=registry.create('Host');
  const lobby=new Lobby({registry,getData:()=>DATA,log:{warn(){},info(){},error(){}}});
  try {
   const doc={code:'TEST',mode:'coop',difficulty:'NORMAL',hostId:host.playerId,
    seats:[{seat:0,playerId:host.playerId,name:'Host',isBot:false}],...(pauseMode?{pauseMode}:{})};
   assert.equal(lobby.restoreRooms([doc]).rooms,1);
   const room=lobby.rooms.get('TEST');assert.equal(room.pauseMode,pauseMode??'vote');
   assert.equal(roomDoc(room).pauseMode,pauseMode??'vote');
  } finally {lobby.shutdown();}
 }
});
test('room options validate the complete atomic update',()=>{
 assert.equal(validateC2S(options),null);
 for(const pauseMode of ['vote','veto'])assert.equal(validateC2S({...options,pauseMode}),null);
 for(const pauseMode of ['bad',null,true])assert.ok(validateC2S({...options,pauseMode}));
 for(const patch of [{difficulty:'bad'},{prepMultiplier:9},{battleSpeed:0},{battleSpeed:null}])assert.ok(validateC2S({...options,...patch}));
});
test('host updates broadcast together, unready teammates only on changes and lock matching/started rooms',async()=>{
 const srv=await startServer({port:0,quiet:true,workers:0});const clients=[];
 try{
  const host=await TestClient.connect(srv.url.replace('http','ws')+'/ws');clients.push(host);const hw=await host.hello('host');
  const guest=await TestClient.connect(srv.url.replace('http','ws')+'/ws');clients.push(guest);const gw=await guest.hello('guest');
  assert.equal((await host.request({t:'room.create',mode:'coop',difficulty:'NORMAL'})).t,'ok');
  const state=await host.waitFor('room.state');await guest.request({t:'room.join',code:state.code});
  assert.equal(state.pauseMode,'veto','new parties default to veto');
  await guest.request({t:'room.ready',ready:true});
  assert.equal((await guest.request(options)).code,'NOT_HOST');
  assert.equal((await host.request(options)).t,'ok');
  const changed=await guest.waitFor('room.state',s=>s.difficulty==='HARD');
  assert.equal(changed.prepMultiplier,1.5);assert.equal(changed.battleSpeed,3);
  assert.equal(changed.seats.find(s=>s?.playerId===gw.playerId).ready,false);
  const room=srv.lobby.rooms.get(state.code);assert.equal(roomDoc(room).prepMultiplier,1.5);
  assert.equal(roomDoc(room).pauseMode,'veto');
  await host.request({...options,pauseMode:'vote'});assert.equal(room.pauseMode,'vote');
  await host.request(options);assert.equal(room.pauseMode,'vote','old clients preserve the selected policy');
  await host.request({...options,pauseMode:'veto'});assert.equal(room.pauseMode,'veto');
  await guest.request({t:'room.ready',ready:true});await host.request(options);
  assert.equal(room.seatOf(gw.playerId).ready,true,'no-op does not reset readiness');
  room.content=Object.freeze({...room.content,modeId:'mode_x_custom'});
  await host.request({...options,battleSpeed:4});
  assert.equal(room.content.modeId,'mode_x_custom','pacing alone preserves the selected plugin mode');
  await host.request({...options,difficulty:'NORMAL'});
  assert.equal(room.content.modeId,undefined,'choosing another difficulty leaves the plugin mode');

  await host.request({...options,prepMultiplier:null,battleSpeed:2});
  assert.equal((await host.request({t:'match.join',mode:'coop',difficulty:'HARD'})).t,'ok');
  assert.equal((await host.request(options)).code,'MATCHING');
  await host.request({t:'match.leave'});
  await guest.request({t:'room.ready',ready:true});
  assert.equal((await host.request({t:'room.start'})).t,'ok');
  assert.equal((await host.request(options)).code,'ROOM_STARTED');
  assert.equal(room.hostId,hw.playerId);
 }finally{await Promise.all(clients.map(c=>c.close()));await srv.close();}
});
