import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {resolveServerConfig,validateServerConfig} from '../server/runtimeConfig.js';
import {startServer} from '../server/index.js';
import {TestClient} from './helpers/wsClient.js';

function fixture(t,doc={}){
 const root=mkdtempSync(path.join(os.tmpdir(),'sp-runtime-config-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(path.join(root,'config'));const file=path.join(root,'config/server.json');
 writeFileSync(file,JSON.stringify(doc));return{root,file,write:next=>writeFileSync(file,JSON.stringify(next))};
}
test('options > env > file > defaults, immutable snapshots and no environment mutation',t=>{
 const f=fixture(t,{limits:{maxRooms:9},reconnect:{soloMs:86400000},workers:{simulation:0}});
 const env={SP_MAX_ROOMS:'7',SP_REDIS_SAVE_MS:'12345'},before=JSON.stringify(env);
 const a=resolveServerConfig({maxRooms:5},{root:f.root,env});
 assert.equal(a.options.maxRooms,5);assert.equal(a.config.sources['limits.maxRooms'],'option:maxRooms');
 assert.equal(a.config.values.persistence.saveMs,12345);assert.equal(a.config.sources['persistence.saveMs'],'env:SP_REDIS_SAVE_MS');
 assert.equal(a.options.soloReconnectWindowMs,86400000);assert.equal(a.config.sources['reconnect.soloMs'],'file');
 assert.equal(a.config.sources['network.rateBurst'],'default');assert.equal(JSON.stringify(env),before);
 assert.ok(Object.isFrozen(a.config.values.reconnect));
 assert.equal(resolveServerConfig({soloReconnectWindowMs:null},{root:f.root,env:{}}).options.soloReconnectWindowMs,null);
 assert.equal(resolveServerConfig({soloReconnectWindowMs:undefined},{root:f.root,env:{}}).options.soloReconnectWindowMs,86400000);
 f.write({limits:{maxRooms:3}});assert.equal(a.options.maxRooms,5,'editing never mutates the running snapshot');
 const b=resolveServerConfig({},{root:f.root,env:{}});assert.equal(b.options.maxRooms,3,'a later startup reads the new file');
 assert.equal(resolveServerConfig({},{root:f.root,env:{SP_MAX_ROOMS:'bad'}}).options.maxRooms,3,'an invalid legacy env falls back to the file');
});
test('default path is optional, explicit paths are required, unknown/invalid settings fail closed',t=>{
 const f=fixture(t);rmSync(f.file);
 assert.equal(resolveServerConfig({},{root:f.root,env:{}}).config.file,null);
 assert.throws(()=>resolveServerConfig({serverConfigFile:f.file},{env:{}}),/ENOENT/);
 assert.equal(resolveServerConfig({serverConfigFile:null},{env:{SP_SERVER_CONFIG:f.file}}).config.file,null);
 assert.throws(()=>resolveServerConfig({serverConfigFile:42},{env:{}}),/serverConfigFile/);
 for(const doc of [[],null,{server:{port:3}},{limits:{maxRoms:5}},{reconnect:{soloMs:'24h'}},{workers:{simulation:33}},{shutdown:{timeoutMs:0}},{persistence:{saveMs:10}}])assert.throws(()=>validateServerConfig(doc));
 f.write({workers:{simulation:0,rooms:1}});assert.throws(()=>resolveServerConfig({},{root:f.root,env:{}}),/cannot exceed/);
 f.write({limits:{maxRooms:-1}});assert.throws(()=>resolveServerConfig({maxRooms:8},{root:f.root,env:{SP_MAX_ROOMS:'9'}}),/invalid server config/,'invalid file remains invalid even when overridden');
 writeFileSync(f.file,'{"limits":');assert.throws(()=>resolveServerConfig({},{root:f.root,env:{}}),/not valid JSON/);
 writeFileSync(f.file,' '.repeat(65537));assert.throws(()=>resolveServerConfig({},{root:f.root,env:{}}),/64 KiB/);
});
test('actual server uses the file for admission, registry, lobby, worker settings and restart-only reload',async t=>{
 const f=fixture(t,{limits:{maxRooms:1,maxSessions:17,maxPendingConnections:5},reconnect:{soloMs:86400000,capacityGraceMs:100,coopMs:700000,lobbyMs:55000},network:{rateBurst:20},persistence:{checkpointConcurrency:2,checkpointWaitMs:750},workers:{simulation:0},shutdown:{timeoutMs:60000}});
 const clients=[];let server;
 t.after(async()=>{await Promise.all(clients.map(c=>c.close()));await server?.close();});
 const options={serverConfigFile:f.file,port:0,host:'127.0.0.1',quiet:true,announcementsFile:null,nameModeration:null,store:{async load(){return null;},async saveSerialized(){return true;}}};
 server=await startServer(options);
 assert.equal(server.network.opts.maxPendingConnections,5);assert.equal(server.network.opts.capacityReconnectMs,100);
 assert.equal(server.persister.checkpointConcurrency,2);assert.equal(server.persister.checkpointWaitMs,750);
 assert.equal(server.registry.maxSessions,17);assert.equal(server.registry.reconnectWindowMs,700000);
 assert.equal(server.network.opts.rateBurst,20);assert.equal(server.lobby.soloResumeWindowMs(),86400000);
 assert.equal(server.lobby.opts.lobbyGraceMs,55000);assert.equal(server.workerPool,null);
 const connect=async()=>{const c=await TestClient.connect(server.url.replace('http:','ws:')+'/ws');clients.push(c);await c.hello('config test');return c;};
 const first=await connect(),second=await connect();
 assert.equal((await first.request({t:'room.create',mode:'solo',difficulty:'NORMAL'})).t,'ok');
 assert.equal((await second.request({t:'room.create',mode:'solo',difficulty:'NORMAL'})).t,'error');
 f.write({limits:{maxRooms:2},workers:{simulation:0}});
 assert.equal((await second.request({t:'room.create',mode:'solo',difficulty:'NORMAL'})).t,'error');
 await Promise.all(clients.splice(0).map(c=>c.close()));await server.close();server=await startServer(options);
 assert.equal(server.lobby.opts.maxRooms,2);
 const publicConfig=await fetch(server.url+'/config/server.json');assert.equal(publicConfig.status,404,'operator config is never a public game file');
});
test('AI takeover defaults obey boolean configuration precedence and initialize new co-op rooms',async t=>{
 const f=fixture(t,{rooms:{aiTakeoverDefault:false},workers:{simulation:0}});
 assert.equal(resolveServerConfig({serverConfigFile:null},{env:{}}).options.aiTakeoverDefault,true);
 assert.equal(resolveServerConfig({},{root:f.root,env:{}}).options.aiTakeoverDefault,false);
 for(const value of ['true','1'])assert.equal(resolveServerConfig({},{root:f.root,env:{SP_AI_TAKEOVER_DEFAULT:value}}).options.aiTakeoverDefault,true);
 for(const value of ['false','0'])assert.equal(resolveServerConfig({},{root:f.root,env:{SP_AI_TAKEOVER_DEFAULT:value}}).options.aiTakeoverDefault,false);
 assert.equal(resolveServerConfig({aiTakeoverDefault:false},{root:f.root,env:{SP_AI_TAKEOVER_DEFAULT:'true'}}).options.aiTakeoverDefault,false);
 assert.equal(resolveServerConfig({},{root:f.root,env:{SP_AI_TAKEOVER_DEFAULT:'invalid'}}).options.aiTakeoverDefault,false);
 for(const value of [0,1,'true',null])assert.throws(()=>validateServerConfig({rooms:{aiTakeoverDefault:value}}));
 for(const enabled of [false,true]){
  f.write({rooms:{aiTakeoverDefault:enabled},workers:{simulation:0}});
  const srv=await startServer({serverConfigFile:f.file,port:0,host:'127.0.0.1',quiet:true,announcementsFile:null});
  const client=await TestClient.connect(srv.url.replace('http:','ws:')+'/ws');
  try{
   const me=await client.hello('Config');
   for(const version of ['act2autochess','act3autochess@V3_1']){
    assert.equal((await client.request({t:'room.create',mode:'coop',difficulty:'NORMAL',version},10000)).t,'ok');
    const room=srv.lobby.roomOf(srv.registry.byId(me.playerId));
    assert.equal(room.aiTakeoverEnabled,enabled);assert.equal(room.toState().aiTakeoverEnabled===true,enabled);
    assert.equal((await client.request({t:'room.setAiTakeover',on:!enabled})).t,'ok');
    assert.equal(room.aiTakeoverEnabled,!enabled,'host may override the server default');
   }
   assert.equal((await client.request({t:'room.create',mode:'solo',difficulty:'NORMAL'})).t,'ok');
   assert.equal(srv.lobby.roomOf(srv.registry.byId(me.playerId)).aiTakeoverEnabled,false);
  }finally{await client.terminate();await srv.close();}
 }
});
test('configuration validation happens before listening and the process honors its configured shutdown deadline',async t=>{
 const f=fixture(t,{shutdown:{timeoutMs:1000},workers:{simulation:0}});
 // Windows kill('SIGTERM') terminates immediately instead of delivering a catchable signal. Exercise the same
 // installed handler through IPC there; Unix still verifies delivery of the actual operating-system signal.
 const code=`import {runMain} from './server/http/boot.js'; await runMain(async()=>({url:'http://localhost',host:'127.0.0.1',port:0,runtimeConfig:{values:{shutdown:{timeoutMs:1000}}},close:()=>new Promise(()=>{})})); process.on('message',message=>{if(message==='shutdown')process.emit('SIGTERM');}); setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{cwd:new URL('..',import.meta.url),stdio:['ignore','pipe','pipe','ipc']});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 let output='';child.stdout.setEncoding('utf8');child.stdout.on('data',part=>{output+=part;});
 while(!output.includes('Internet:'))await once(child.stdout,'data');
 let errors='';child.stderr.on('data',part=>{errors+=part;});
 const started=Date.now(),exited=once(child,'exit');
 if(process.platform==='win32')child.send('shutdown');else child.kill('SIGTERM');
 const [exit]=await exited;
 assert.equal(exit,1);assert.ok(Date.now()-started>=900);assert.match(errors,/timed out/);
 f.write({limits:{unknown:2}});await assert.rejects(()=>startServer({serverConfigFile:f.file,quiet:true}),/unknown server config key/);
});

test('explicit null solo retention follows game data while the omitted default follows upstream',async t=>{
 const a=await startServer({port:0,host:'127.0.0.1',quiet:true,workers:0,serverConfigFile:null,soloReconnectWindowMs:null});t.after(()=>a.close());
 assert.equal(a.lobby.soloResumeWindowMs(),86400_000);
 const b=resolveServerConfig({serverConfigFile:null},{env:{}});assert.equal(b.options.soloReconnectWindowMs,21600_000);
 for(const doc of [{limits:{maxPendingConnections:-1}},{reconnect:{capacityGraceMs:0}},{persistence:{checkpointConcurrency:0}},{persistence:{checkpointWaitMs:'fast'}}])assert.throws(()=>validateServerConfig(doc));
});
