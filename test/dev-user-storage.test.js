import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ROOT} from '../server/http/config.js';
import {startServer,userFileFromArgv} from '../server/index.js';

test('only source-client CLI supplies a local user database; explicit paths and disabling win',()=>{
 assert.equal(userFileFromArgv([],{}),undefined);
 assert.equal(userFileFromArgv(['--hot'],{}),undefined);
 assert.equal(userFileFromArgv(['--source-client'],{}),path.join(ROOT,'.state','users.sqlite'));
 for(const argv of [[],['--source-client']])for(const file of ['custom.sqlite',':memory:',''])assert.equal(userFileFromArgv(argv,{SP_USER_DB:file}),file);
});

test('local profiles save through the real API and retain their identity after server restart',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'sp-dev-users-')),file=path.join(root,'nested/users.sqlite');let server;
 const options={host:'127.0.0.1',port:0,workers:0,roomWorkers:0,matchWorkers:0,quiet:true,assetIndex:false,serverConfigFile:false,announcementsFile:null,nameModeration:null,clientBuild:false};
 try{
  server=await startServer({...options,userFile:userFileFromArgv(['--source-client'],{SP_USER_DB:file})});
  const initial=await fetch(server.url+'/api/user');assert.equal(initial.status,200);
  const {user}=await initial.json(),cookie=initial.headers.get('set-cookie').split(';')[0];
  const save=await fetch(server.url+'/api/user/profile',{method:'POST',headers:{cookie,origin:server.url,'content-type':'application/json'},body:JSON.stringify({name:'本机资料测试',avatarId:'avatar:Avatar_dyn_01'})});
  assert.equal(save.status,200);assert.equal((await save.json()).user.avatarId,'avatar:Avatar_dyn_01');
  await server.close();server=null;
  server=await startServer({...options,userFile:file});
  const restored=await fetch(server.url+'/api/user',{headers:{cookie}});assert.equal(restored.status,200);
  const result=(await restored.json()).user;assert.equal(result.id,user.id);assert.equal(result.name,'本机资料测试');assert.equal(result.avatarId,'avatar:Avatar_dyn_01');
  await server.close();server=null;
  server=await startServer({...options,userFile:userFileFromArgv(['--source-client'],{SP_USER_DB:''})});
  const disabled=await fetch(server.url+'/api/user');assert.equal(disabled.status,503);assert.equal((await disabled.json()).error,'USER_STORAGE_DISABLED');
 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
});
