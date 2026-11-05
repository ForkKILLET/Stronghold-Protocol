import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from '../server/index.js';
import {TestClient} from './helpers/wsClient.js';
import {snapshotServer,restoreServer} from '../server/persist.js';

const options={port:0,host:'127.0.0.1',quiet:true,workers:0,matchWorkers:1,store:null,announcementsFile:null,botRehearsal:0,userFile:':memory:',nameModeration:null,matchHost:{transport:'worker'}};
async function fixture(t){
 const srv=await startServer(options),clients=[];
 t.after(async()=>{await Promise.all(clients.map(c=>c.terminate()));await srv.close();});
 const cookies=new Map();
 const player=async(name,token)=>{if(!cookies.has(name)){const r=await fetch(srv.url+'/api/user');cookies.set(name,r.headers.get('set-cookie').split(';')[0]);}const c=await TestClient.connect(srv.url.replace('http','ws')+'/ws',{wsOptions:{headers:{Cookie:cookies.get(name)}}});clients.push(c);const w=await c.hello(name,token,{stateDelta:1});c.id=w.playerId;c.token=w.token;return c;};
 return {srv,player};
}

test('AI handover executes in the Match Worker, keeps account attribution and survives a checkpoint',async t=>{
 const {srv,player}=await fixture(t),host=await player('Host'),mate=await player('Mate');
 assert.equal((await host.request({t:'room.create',mode:'coop',difficulty:'NORMAL'})).t,'ok');
 const room=srv.lobby.roomOf(srv.registry.byId(host.id));
 await host.request({t:'room.setAiTakeover',on:true});await mate.request({t:'room.join',code:room.code});await mate.request({t:'room.ready',ready:true});
 await host.request({t:'room.addBot'});await host.request({t:'room.addBot'});
 assert.equal((await host.request({t:'room.start'})).t,'ok');
 const m=room.match;assert.equal(m.remote,true);
 await m.invoke('startRound',1);await m.invoke('enterPrep');await m.invoke('setDeadline',0);
 const late=await player('Late'),oldId=late.id;
 const session=srv.registry.byId(oldId);assert.ok(session.userId);const {userId,publicId}=session;
 assert.equal((await late.request({t:'room.spectate',code:room.code})).t,'ok');
 const checkpoint=async()=>{for(let i=0;i<200;i++){const doc=await m.snapshot();if(doc)return doc;await new Promise(r=>setTimeout(r,50));}throw new Error('AI prep did not reach a safe checkpoint');};
 const before=await checkpoint(),bot=before.players.find(p=>p.isBot);
 assert.equal((await late.request({t:'room.aiRequest',botId:bot.playerId})).t,'ok');
 const vote=room.aiTakeoverVotes[0];
 await host.request({t:'room.aiVote',voteId:vote.id,approve:true});
 assert.equal((await mate.request({t:'room.aiVote',voteId:vote.id,approve:true})).t,'ok');
 await late.waitFor('welcome',w=>w.playerId===bot.playerId);
 const after=await m.snapshot(),owner=after.players.find(p=>p.playerId===bot.playerId);
 assert.equal(owner.isBot,false);assert.equal(owner.aiTakeoverRound,1);assert.equal(owner.userId,userId);assert.equal(owner.publicId,publicId);
 assert.deepEqual(owner.hand,bot.hand);assert.equal(owner.funds,bot.funds);
 assert.equal(room.matchCtx.profileUsers[bot.playerId],userId);
 assert.equal(srv.registry.byId(oldId),null);assert.equal(room.spectatorOf(oldId),null);
 await late.terminate();const back=await player('Late',late.token);assert.equal(back.id,bot.playerId);
 assert.equal((await back.request({t:'g.freeze',on:false})).t,'ok');
 const restored=await srv.matchWorkerPool.create('handover-restored',{roomCode:'REST',mode:'coop',difficulty:'NORMAL',seats:after.players,spectators:[]},{},after);
 try{const cp=await restored.snapshot();assert.equal(cp.players.find(p=>p.playerId===bot.playerId).aiTakeoverRound,1);}finally{await restored.dispose();}
});

test('historical room content and checkpoint restore use the same isolated version host',async t=>{
 const {srv,player}=await fixture(t),host=await player('Archive'),version='act1autochess';
 assert.equal((await host.request({t:'room.create',mode:'solo',difficulty:'NORMAL',version,soloUnlimited:true})).t,'ok');
 const room=srv.lobby.roomOf(srv.registry.byId(host.id)),cs=room.content.cs;
 assert.equal((await host.request({t:'room.contentReady',cs})).t,'ok');
 assert.equal((await host.request({t:'room.start'})).t,'ok');
 assert.equal(room.match.hosted,true);assert.equal(room.match.remote,undefined);
 const {doc:checkpoint}=await room.match.captureSnapshot();
 assert.equal(checkpoint.version,version);assert.equal(checkpoint.cs,cs);
 const saved=snapshotServer({registry:srv.registry,lobby:srv.lobby,matchDocs:new Map([[room.code,checkpoint]])});
 const next=await startServer(options);t.after(()=>next.close());
 const initial=restoreServer({doc:saved,registry:next.registry,lobby:next.lobby,log:{warn(){},info(){},error(){}}});
 const result=initial.ready?await initial.ready:initial;assert.equal(result.matches,1);
 const restored=next.lobby.rooms.get(room.code);assert.equal(restored.version,version);assert.equal(restored.content.cs,cs);assert.equal(restored.soloUnlimited,true);
 assert.equal(restored.match.hosted,true);
 const again=(await restored.match.captureSnapshot()).doc;
 assert.equal(again.version,version);assert.equal(again.cs,cs);assert.equal(again.seed,checkpoint.seed);
 assert.deepEqual(again.players.map(p=>p.playerId),checkpoint.players.map(p=>p.playerId));
});
