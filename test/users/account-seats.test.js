import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from '../../server/index.js';
import {TestClient} from '../helpers/wsClient.js';

for(const remote of [false,true])test(`${remote?'Worker':'local'}: one profile owns one player participation across rooms, queues and matches`,{timeout:40000},async t=>{
 const server=await startServer({port:0,host:'127.0.0.1',quiet:true,workers:0,matchWorkers:remote?1:0,userFile:':memory:',nameModeration:null,assetIndex:false});
 const clients=[];
 t.after(async()=>{await Promise.all(clients.map(c=>c.close()));await server.close();});
 const identity=async()=>{const r=await fetch(server.url+'/api/user');return r.headers.get('set-cookie').split(';')[0];};
 const connect=async(cookie,token)=>{
  const c=await TestClient.connect(server.url.replace('http:','ws:')+'/ws',{wsOptions:{headers:{Cookie:cookie}}});clients.push(c);
  const welcome=await c.hello('account test',token);return{c,welcome,s:server.registry.byId(welcome.playerId)};
 };
 const cookie=await identity(),a=await connect(cookie),b=await connect(cookie),others=[];
 for(let i=0;i<3;i++)others.push(await connect(await identity()));
 assert.notEqual(a.s.playerId,b.s.playerId);assert.equal(a.s.userId,b.s.userId);
 const blocked=async(c,msg)=>assert.equal((await c.request(msg)).code,'ACCOUNT_ACTIVE');
 const create={t:'room.create',mode:'coop',difficulty:'NORMAL'};
 const queue={t:'match.join',mode:'coop',difficulty:'NORMAL'};
 assert.equal((await a.c.request(create)).t,'ok');
 const state=await a.c.waitFor('room.state'),room=server.lobby.rooms.get(state.code);
 assert.equal(state.seats[0].userId,undefined);
 await blocked(b.c,{t:'room.join',code:room.code});await blocked(b.c,create);await blocked(b.c,queue);
 assert.equal((await b.c.request({t:'room.spectate',code:room.code})).t,'ok');
 await blocked(b.c,{t:'room.join',code:room.code});
 assert.equal((await others[0].c.request({t:'room.join',code:room.code})).t,'ok');
 // Defense in depth for rooms restored from before the restriction.
 const original=others[0].s.userId;others[0].s.userId=a.s.userId;
 await blocked(a.c,{t:'room.start'});await blocked(a.c,queue);others[0].s.userId=original;
 assert.equal((await a.c.request({t:'room.leave'})).t,'ok');
 assert.equal((await b.c.request({t:'room.join',code:room.code})).t,'ok','spectator can sit after the original seat is released');
 await blocked(a.c,{t:'room.join',code:room.code});
 assert.equal((await b.c.request({t:'room.leave'})).t,'ok');
 assert.equal((await others[0].c.request({t:'room.leave'})).t,'ok');
 assert.equal((await a.c.request(queue)).t,'ok');await blocked(b.c,queue);await blocked(b.c,create);
 assert.equal((await a.c.request({t:'match.leave'})).t,'ok');
 assert.equal((await b.c.request(create)).t,'ok');await b.c.request({t:'room.leave'});
 // Worker ownership is reserved synchronously, without an admission gap after removing queue tickets.
 assert.equal((await a.c.request(queue)).t,'ok');
 for(const other of others)assert.equal((await other.c.request(queue)).t,'ok');
 await blocked(b.c,create);await a.c.waitFor('m.public',()=>true,15000);
  assert.equal((await a.c.request(create)).code,'ROOM_STARTED','same-session admissions cannot escape an active standalone match');
 await a.c.terminate();
 await others[0].c.waitFor('m.public',m=>m.players.some(p=>p.playerId===a.s.playerId&&!p.connected),10000);
 await blocked(b.c,create);
 const resumed=await connect(cookie,a.welcome.token);assert.equal(resumed.s.playerId,a.s.playerId);
 assert.equal((await resumed.c.request({t:'g.leave'},10000)).t,'ok');
 assert.equal((await b.c.request(create)).t,'ok','explicit departure releases account participation');
 assert.ok(others[0].s.activeMatchCtx&&!others[0].s.activeMatchCtx.disposed,'teammates continue playing');
});
