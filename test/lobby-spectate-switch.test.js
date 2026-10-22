import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Lobby} from '../server/lobby.js';
import {SessionRegistry} from '../server/net.js';
import {StubMatch} from '../server/match/StubMatch.js';
import {DATA} from './match/harness.js';

function setup(t,mode='coop'){
 const registry=new SessionRegistry(),lobby=new Lobby({registry,getData:()=>DATA,MatchClass:StubMatch,log:{info(){},error(){},warn(){},debug(){}}});
 t.after(()=>lobby.shutdown());
 const players=Array.from({length:5},(_,i)=>{const p=registry.create(`Doctor ${i}`);p.connected=true;return p;});
 assert.equal(lobby.create(players[0],{mode,difficulty:'NORMAL'}).ok,true);
 const room=lobby.roomOf(players[0]);return{lobby,room,players};
}
test('player ↔ spectator preserves loadout, migrates host, clears readiness and never duplicates a seat',async t=>{
 const {lobby,room,players:[host,guest]}=setup(t);lobby.join(guest,{code:room.code});
 guest.loadout={test:'kept'};room.seatOf(guest.playerId).loadout=guest.loadout;
 lobby.ready(guest,{ready:true});
 assert.equal(lobby.spectate(guest,{code:room.code}).ok,true);assert.equal(room.seatOf(guest.playerId),null);
 assert.equal(room.spectators.length,1);assert.equal(room.hostId,host.playerId);assert.equal(guest.roomCode,room.code);
 assert.equal(lobby.spectate(guest,{code:room.code}).ok,true);assert.equal(room.spectators.length,1,'idempotent spectator retry');
 assert.equal(lobby.ready(guest,{ready:true}).error,'SPECTATOR');
 assert.equal((await lobby.roomCommunication(guest,{t:'room.chat',text:'blocked'})).error,'SPECTATOR');
 assert.equal(lobby.join(guest,{code:room.code}).ok,true);assert.equal(room.spectators.length,0);
 assert.deepEqual(room.seatOf(guest.playerId).loadout,guest.loadout);assert.equal(room.seatOf(guest.playerId).ready,false);
 assert.equal(lobby.spectate(host,{code:room.code}).ok,true);assert.equal(room.hostId,guest.playerId);
 assert.equal(room.activeHumans().length,1);assert.equal(lobby.rooms.get(room.code),room);
 assert.equal(lobby.join(host,{code:room.code}).ok,true);assert.equal(room.hostId,guest.playerId,'sitting back does not reclaim host');
});
test('last human, solo, full spectator seats and a started match refuse the transition without mutation',t=>{
 const {lobby,room,players:[host,guest,s1,s2]}=setup(t);
 lobby.addBot(host);
 assert.equal(lobby.spectate(host,{code:room.code}).error,'NOT_READY');assert.equal(room.hostId,host.playerId);assert.ok(room.seatOf(host.playerId));
 lobby.join(guest,{code:room.code});lobby.spectate(s1,{code:room.code});lobby.spectate(s2,{code:room.code});
 assert.equal(lobby.spectate(guest,{code:room.code}).error,'ROOM_FULL');assert.ok(room.seatOf(guest.playerId));assert.equal(room.spectators.length,2);
 lobby.leave(s2);lobby.ready(guest,{ready:true});assert.equal(lobby.start(host).ok,true);
 assert.equal(lobby.spectate(guest,{code:room.code}).error,'ROOM_STARTED');assert.ok(room.seatOf(guest.playerId));
 const solo=setup(t,'solo');assert.equal(solo.lobby.spectate(solo.players[0],{code:solo.room.code}).error,'ROOM_FULL');
});
test('party and standalone queue tickets cannot move seats while waiting; cancellation enables the transition',t=>{
 const {lobby,room,players:[host,guest,outsider,watcher]}=setup(t);lobby.join(guest,{code:room.code});
 assert.equal(lobby.matchJoin(host,{mode:'coop',difficulty:'NORMAL'}).ok,true);
 assert.equal(lobby.spectate(host,{code:room.code}).error,'MATCHING');assert.equal(lobby.spectate(guest,{code:room.code}).error,'MATCHING');
 assert.equal(lobby.join(outsider,{code:room.code}).error,'MATCHING');assert.equal(room.activeHumans().length,2);
 assert.equal(lobby.spectate(watcher,{code:room.code}).ok,true,'non-participating observers can watch a matching party');
 assert.equal(lobby.matchJoin(outsider,{mode:'coop',difficulty:'NORMAL'}).ok,true);
 assert.equal(lobby.spectate(outsider,{code:room.code}).error,'MATCHING');assert.ok(lobby.queueByPlayer.has(outsider.playerId));
 assert.equal(lobby.matchLeave(host).ok,true);assert.equal(lobby.spectate(host,{code:room.code}).ok,true);
 assert.equal(room.hostId,guest.playerId);assert.equal(lobby.queueByPlayer.has(guest.playerId),false);
});
