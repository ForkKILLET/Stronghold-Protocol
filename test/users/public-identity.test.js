import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from '../../server/index.js';
import {TestClient} from '../helpers/wsClient.js';
import {snapshotMatch} from '../../server/match/snapshot.js';
import {sessionDoc} from '../../server/persist.js';
import {SessionRegistry} from '../../server/net.js';

for(const matchWorkers of [0,1])test(`public doctor identity follows rooms, ${matchWorkers?'Worker':'local'} Match, checkpoints and settlement without exposing UUID`,async t=>{
 const server=await startServer({host:'127.0.0.1',port:0,workers:0,matchWorkers,userFile:':memory:',quiet:true,announcementsFile:null});
 const clients=[];t.after(async()=>{for(const client of clients)client.terminate();await server.close();});
 const response=await fetch(server.url+'/api/user'),{user}=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
 assert.match(user.publicId,/^[0-9A-HJKMNP-TV-Z]{4}$/);
 const client=await TestClient.connect(server.url.replace('http:','ws:')+'/ws',{wsOptions:{headers:{Cookie:cookie}}});clients.push(client);
 const welcome=await client.hello('公开身份测试'),session=server.registry.byId(welcome.playerId);
 assert.equal(session.publicId,user.publicId);
 const restored=new SessionRegistry().adopt(sessionDoc(session,Date.now()));assert.equal(restored.publicId,user.publicId);assert.equal(restored.userId,user.id);
 await client.request({t:'room.create',mode:'solo',difficulty:'NORMAL'});
 const room=server.lobby.roomOf(session),state=room.toState();assert.equal(state.seats[0].publicId,user.publicId);assert.equal(JSON.stringify(state).includes(user.id),false);
 await client.request({t:'room.start'});const pub=await client.waitFor('m.public',m=>m.phase==='INFO_CHECK');
 assert.equal(pub.players[0].publicId,user.publicId);assert.equal(JSON.stringify(pub).includes(user.id),false);
 const checkpoint=matchWorkers?await room.match.snapshot():snapshotMatch(room.match);
 assert.equal(checkpoint.players[0].publicId,user.publicId);assert.equal(checkpoint.players[0].userId,user.id);
 if(matchWorkers)await room.match.invoke('finish',{victory:false});else room.match.finish({victory:false});
 const result=await client.waitFor('m.result');assert.equal(result.players[0].publicId,user.publicId);assert.equal(JSON.stringify(result).includes(user.id),false);
});
