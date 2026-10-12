import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from '../server/index.js';
import {TestClient} from './helpers/wsClient.js';

test('production room Worker receives custom rules and owns unanimous pause with shifted deadlines', {timeout:15000}, async t=>{
 const errors=[];
 const srv=await startServer({port:0,host:'127.0.0.1',matchWorkers:1,workers:0,log:{info(){},warn(){},debug(){},error:(...x)=>errors.push(x.map(String).join(' '))}});
 const clients=[];
 t.after(async()=>{await srv.close();await Promise.all(clients.map(c=>c.terminate()));assert.deepEqual(errors,[])});
 async function player(name){const c=await TestClient.connect(srv.url.replace('http:','ws:')+'/ws');clients.push(c);const w=await c.hello(name);c.id=w.playerId;return c}
 async function ok(c,msg){const r=await c.request(msg);assert.equal(r.t,'ok',JSON.stringify(r))}
 const host=await player('Host'), guest=await player('Guest');
 await ok(host,{t:'room.create',mode:'coop',difficulty:'HARD',prepMultiplier:2,battleSpeed:4});
 const room=await host.waitFor('room.state');
 await ok(guest,{t:'room.join',code:room.code});await ok(guest,{t:'room.ready',ready:true});await ok(host,{t:'room.start'});
 const initial=await host.waitFor('m.public',p=>p.phase==='INFO_CHECK');
 assert.equal(initial.battleSpeed,4);assert.equal(initial.prepMultiplier,2);
 const match=srv.lobby.rooms.get(room.code).match;assert.equal(match.remote,true);
 const checkpoint=await match.snapshot();assert.equal(checkpoint.gameSpeed,4);assert.equal(checkpoint.prepMultiplier,2);
 await ok(host,{t:'g.pause',on:true});
 const requested=await host.waitFor('m.public',p=>p.pauseRequests?.length===1);assert.equal(requested.paused,false);
 await ok(guest,{t:'g.pause',on:true});
 const paused=await host.waitFor('m.public',p=>p.paused);assert.equal(paused.pauseRequests.length,2);assert.equal(paused.pauseRequired.length,2);
 assert.equal((await guest.request({t:'g.infoReady',setupRevision:0})).t,'error');
 await new Promise(r=>setTimeout(r,80));await ok(guest,{t:'g.pause',on:false});
 const resumed=await host.waitFor('m.public',p=>!p.paused&&p.deadline>initial.deadline);
 assert.ok(resumed.deadline>=initial.deadline+60);
 await ok(host,{t:'g.leave'});await ok(guest,{t:'g.leave'});
 // Lobby departure acknowledgement precedes the serialized Match hooks.
 // Drain those commands and any resulting disposal before closing the pool.
 for(let i=0;i<4;i++){const queued=match.queue;await queued;if(match.queue===queued)break;}
});
