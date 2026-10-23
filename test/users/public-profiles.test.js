import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openUserStore} from '../../server/users/store.js';
import {startServer} from '../../server/index.js';
import {DOCTOR_ID_ALPHABET,DOCTOR_ID_LENGTH,PRIVATE_PROFILE,normalizeDoctorId,formatDoctorId} from '../../shared/publicProfiles.js';
import {installPublicProfiles,PUBLIC_PROFILE_SCHEMA_VERSION} from '../../server/users/publicProfiles.js';
import {ReplayTimeline} from '../../shared/replays.js';
import {diffState} from '../../shared/stateDelta.js';

const replay={v:1,duration:10,players:[{playerId:'a',name:'A',seat:0},{playerId:'b',name:'B',seat:1}],
 fields:[{fieldId:'normal:a',spec:{players:[{playerId:'a',units:[]},{playerId:'b',units:[]}]}}],events:[
  {at:0,kind:'view',key:'public',full:{round:1,battleSpeed:2}},
  {at:1,kind:'view',key:'a',full:{funds:5,hand:['owner-hand']}},
  {at:2,kind:'view',key:'b',full:{funds:9,hand:['teammate-private-hand']}},
  {at:3,kind:'action',playerId:'b',action:'g.refresh'},
  {at:4,kind:'action',playerId:'a',action:'g.buy'},
  {at:5,kind:'view',key:'a',patch:diffState({funds:5,hand:['owner-hand']},{funds:4,hand:['owner-hand']})},
 ]};
const game=(id,users)=>({id,endedAt:Number(id.replace(/\D/g,''))||1,mode:'coop',difficulty:'NORMAL',source:'server',replay,
 rows:users.map((user,i)=>({userId:user.id,playerId:i?'b':'a',victory:true,rounds:3,payload:{bandId:'band_bldsk',trophies:23,stats:{kills:11},frame:{roomMode:'coop',modeId:'mode_multi_normal',matchId:id}}}))});

test('public IDs are stable, collision checked, formatted independently of names and survive recovery/restart',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'sp-public-id-')),file=path.join(directory,'users.sqlite');let store;
 try{
  store=await openUserStore(file,{backups:null});const created=await store.call('create'),a=created.user,b=(await store.call('create')).user;
  assert.equal(normalizeDoctorId(a.publicId),a.publicId);assert.notEqual(a.publicId,b.publicId);
  assert.equal(a.publicId.length,4);assert.equal(formatDoctorId(a.publicId),a.publicId);
  assert.equal(normalizeDoctorId(formatDoctorId(a.publicId).toLowerCase()),a.publicId);
  assert.equal(normalizeDoctorId(' a1b2 '),'A1B2');
  for(const invalid of ['123','12345','7K9M00000001','A1-B2','OOOO','IIII','LLLL','UUUU'])assert.equal(normalizeDoctorId(invalid),null);
  await store.call('rename',{id:a.id,name:'same'});await store.call('rename',{id:b.id,name:'same'});
  assert.deepEqual(a.visibility,PRIVATE_PROFILE);
  const code=await store.call('recovery',{id:a.id});assert.equal((await store.call('recover',code)).user.publicId,a.publicId);
  await store.close();store=await openUserStore(file,{backups:null});
  assert.equal((await store.call('authenticate',{token:created.token})).publicId,a.publicId);
  assert.deepEqual((await store.call('publicDoctor',{publicId:a.publicId})),{doctor:{publicId:a.publicId,name:'same',avatarId:null},visibility:PRIVATE_PROFILE});
  // Simulate the previously deployed additive schemas: existing credentials/results must remain valid.
  await store.close();const db=new DatabaseSync(file);db.exec('DROP TABLE public_replays;DROP TABLE public_profiles;DROP TABLE public_profile_schema;');db.close();
  store=await openUserStore(file,{backups:null});assert.equal((await store.call('authenticate',{token:created.token})).id,a.id);
  assert.ok((await readdir(path.join(directory,'backups'))).some(name=>name.startsWith('users-before-public-')));
 }finally{await store?.close();await rm(directory,{recursive:true,force:true});}
});

function profileDatabase(){
 const db=new DatabaseSync(':memory:');
 db.exec(`PRAGMA foreign_keys=ON;
  CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT DEFAULT '',avatar_id TEXT);
  CREATE TABLE user_replays(user_id TEXT,game_id TEXT,PRIMARY KEY(user_id,game_id));
  INSERT INTO users(id) VALUES('a'),('b'),('c');`);
 return db;
}
test('four-character IDs resolve repeated collisions and wrap without replacing another account',()=>{
 const db=profileDatabase();
 try{
  const profiles=installPublicProfiles(db,{randomStart:()=>DOCTOR_ID_ALPHABET.length**DOCTOR_ID_LENGTH-1});
  assert.deepEqual(['a','b','c'].map(id=>profiles.ensure(id).publicId),['ZZZZ','0000','0001']);
  db.exec("INSERT INTO users(id) VALUES('d')");assert.equal(profiles.ensure('d').publicId,'0002');
  assert.equal(profiles.ensure('a').publicId,'ZZZZ');
  assert.equal(profiles.find('0000').id,'b');assert.equal(db.prepare('SELECT count(DISTINCT public_id) AS n FROM public_profiles').get().n,4);
 }finally{db.close();}
});
test('failed short-ID migration rolls back every reassignment and the schema marker together',()=>{
 const db=profileDatabase();
 try{
  installPublicProfiles(db);
  db.exec("UPDATE public_profile_schema SET version=1; UPDATE public_profiles SET public_id=user_id||'12345678901';");
  const before=db.prepare('SELECT * FROM public_profiles ORDER BY user_id').all();let calls=0;
  assert.throws(()=>installPublicProfiles(db,{randomStart:()=>{if(++calls===2)throw new Error('allocation interrupted');return 0;}}),/allocation interrupted/);
  assert.deepEqual(db.prepare('SELECT * FROM public_profiles ORDER BY user_id').all(),before);
  assert.equal(db.prepare('SELECT version FROM public_profile_schema').get().version,1);
 }finally{db.close();}
});
test('schema 1 long IDs migrate once with a consistent backup, keeping credentials, recovery, privacy and replay ownership',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'sp-short-id-')),file=path.join(directory,'users.sqlite');let store;
 try{
  store=await openUserStore(file,{backups:null});const a=await store.call('create'),b=await store.call('create');
  await store.call('update',{id:a.user.id,name:'Doctor A',avatarId:'avatar:Avatar_def_01'});
  const recovery=await store.call('recovery',{id:b.user.id});await store.call('record',game('g1',[a.user,b.user]));
  await store.call('visibility',{id:a.user.id,visibility:{history:true,replays:true}});
  await store.call('shareReplay',{id:a.user.id,matchId:'g1',shared:true});await store.call('pinReplay',{id:b.user.id,matchId:'g1',pinned:true});
  await store.close();store=null;
  const db=new DatabaseSync(file),oldA='7K9M00000001',oldB='7K9M00000002';
  db.prepare('UPDATE public_profiles SET public_id=? WHERE user_id=?').run(oldA,a.user.id);
  db.prepare('UPDATE public_profiles SET public_id=? WHERE user_id=?').run(oldB,b.user.id);
  db.exec('UPDATE public_profile_schema SET version=1');db.close();
  store=await openUserStore(file,{backups:null});
  const migratedA=await store.call('authenticate',{token:a.token}),migratedB=await store.call('authenticate',{token:b.token});
  assert.equal(migratedA.id,a.user.id);assert.equal(migratedA.name,'Doctor A');assert.equal(migratedA.avatarId,'avatar:Avatar_def_01');
  assert.equal(migratedA.publicId.length,4);assert.equal(migratedB.publicId.length,4);assert.notEqual(migratedA.publicId,migratedB.publicId);
  assert.deepEqual(migratedA.visibility,{...PRIVATE_PROFILE,history:true,replays:true});
  assert.equal((await store.call('recover',recovery)).user.publicId,migratedB.publicId);
  const stats=await store.call('stats',{id:a.user.id});assert.equal(stats.summary.matches,1);assert.equal(stats.records[0].replay.shared,true);
  assert.equal((await store.call('stats',{id:b.user.id})).records[0].replay.pinned,true);
  assert.ok((await store.call('publicReplay',{publicId:migratedA.publicId,matchId:'g1'})).replay);
  assert.equal((await store.call('publicDoctor',{publicId:oldA})).error,'DOCTOR_NOT_FOUND');
  const backups=await readdir(path.join(directory,'backups'));assert.equal(backups.length,1);
  const backupFile=path.join(directory,'backups',backups[0]),backup=new DatabaseSync(backupFile,{readOnly:true});
  try{
   assert.equal(backup.prepare('SELECT version FROM public_profile_schema').get().version,1);
   assert.equal(backup.prepare('SELECT public_id FROM public_profiles WHERE user_id=?').get(a.user.id).public_id,oldA);
   assert.equal(backup.prepare('SELECT count(*) AS n FROM credentials').get().n,2);
  }finally{backup.close();}
  assert.equal((await stat(backupFile)).mode&0o777,0o600);
  await store.close();store=await openUserStore(file,{backups:null});
  assert.equal((await store.call('authenticate',{token:a.token})).publicId,migratedA.publicId);
  assert.deepEqual(await readdir(path.join(directory,'backups')),backups);
  await store.close();store=null;const current=new DatabaseSync(file,{readOnly:true});
  try{assert.equal(current.prepare('SELECT version FROM public_profile_schema').get().version,PUBLIC_PROFILE_SCHEMA_VERSION);}finally{current.close();}
 }finally{await store?.close();await rm(directory,{recursive:true,force:true});}
});

test('public sections are allowlisted, independent and do not leak private totals or raw result payloads',async t=>{
 const store=await openUserStore(':memory:');t.after(()=>store.close());const a=(await store.call('create')).user;
 await store.call('record',game('g1',[a]));
 assert.deepEqual(Object.keys(await store.call('publicDoctor',{publicId:a.publicId})).sort(),['doctor','visibility']);
 await store.call('visibility',{id:a.id,visibility:{statistics:true,achievements:true}});
 let visible=await store.call('publicDoctor',{publicId:a.publicId});
 assert.equal(visible.aggregate.count,1);assert.equal(visible.aggregate.trophies,undefined);
 assert.ok(visible.achievements.length>0);assert.ok(visible.achievements.every(a=>a.group!=='trophy'));
 assert.equal(visible.records,undefined);assert.equal(visible.trophies,undefined);assert.equal(JSON.stringify(visible).includes(a.id),false);
 assert.equal((await store.call('visibility',{id:a.id,visibility:{typo:true}})).error,'VISIBILITY');
 await store.call('visibility',{id:a.id,visibility:{statistics:false,achievements:false,trophies:true,history:true}});
 visible=await store.call('publicDoctor',{publicId:a.publicId});assert.equal(visible.trophies,23);
 assert.equal(visible.aggregate,undefined);assert.equal(visible.achievements,undefined);
 assert.equal(visible.records.length,1);assert.equal(visible.records[0].replay,false);
 assert.equal(visible.records[0].payload,undefined);assert.equal(visible.records[0].trophies,undefined);
 for(let i=2;i<=52;i++)await store.call('record',game('g'+i,[a]));
 const first=await store.call('publicDoctor',{publicId:a.publicId});assert.equal(first.records.length,50);assert.ok(first.next);
 const second=await store.call('publicDoctor',{publicId:a.publicId,before:first.next});assert.equal(second.records.length,2);assert.equal(second.next,null);
 assert.equal(new Set([...first.records,...second.records].map(r=>r.matchId)).size,52);
});

test('public replay grants are per owner, require both switches and disappear after revocation or eviction',async t=>{
 const store=await openUserStore(':memory:',{replays:{perUser:2}});t.after(()=>store.close());
 const a=(await store.call('create')).user,b=(await store.call('create')).user,outsider=(await store.call('create')).user;
 await store.call('record',game('g1',[a,b]));
 assert.equal((await store.call('shareReplay',{id:outsider.id,matchId:'g1',shared:true})).error,'REPLAY_NOT_FOUND');
 await store.call('shareReplay',{id:a.id,matchId:'g1',shared:true});
 assert.equal((await store.call('publicReplay',{publicId:a.publicId,matchId:'g1'})).error,'REPLAY_NOT_FOUND');
 await store.call('visibility',{id:a.id,visibility:{replays:true}});
 const shared=await store.call('publicReplay',{publicId:a.publicId,matchId:'g1'});
 assert.deepEqual(shared.replay.perspectives,['a']);assert.deepEqual(shared.replay.fields,replay.fields);
 assert.equal(JSON.stringify(shared).includes('teammate-private-hand'),false);
 assert.ok(shared.replay.events.every(e=>e.kind!=='action'||e.playerId==='a'));
 const timeline=new ReplayTimeline(shared.replay);assert.equal(timeline.at(4).a.funds,5);assert.equal(timeline.at(4).b,undefined);
 assert.equal((await store.call('publicDoctor',{publicId:a.publicId,section:'replays'})).records.length,1);
 assert.equal((await store.call('publicDoctor',{publicId:a.publicId})).records,undefined,'replays do not open private match history');
 assert.deepEqual((await store.call('replay',{id:b.id,matchId:'g1'})).replay,replay,'private archive is untouched');
 await store.call('visibility',{id:a.id,visibility:{replays:false}});
 assert.equal((await store.call('publicReplay',{publicId:a.publicId,matchId:'g1'})).error,'REPLAY_NOT_FOUND');
 await store.call('visibility',{id:a.id,visibility:{replays:true}});
 assert.ok((await store.call('publicReplay',{publicId:a.publicId,matchId:'g1'})).replay);
 await store.call('shareReplay',{id:b.id,matchId:'g1',shared:true});await store.call('visibility',{id:b.id,visibility:{replays:true}});
 await store.call('shareReplay',{id:a.id,matchId:'g1',shared:false});assert.ok((await store.call('publicReplay',{publicId:b.publicId,matchId:'g1'})).replay);
 await store.call('shareReplay',{id:a.id,matchId:'g1',shared:true});await store.call('pinReplay',{id:b.id,matchId:'g1',pinned:true});
 await store.call('record',game('g2',[a,b]));await store.call('record',game('g3',[a,b]));
 assert.equal((await store.call('publicReplay',{publicId:a.publicId,matchId:'g1'})).error,'REPLAY_NOT_FOUND');
 assert.ok((await store.call('publicReplay',{publicId:b.publicId,matchId:'g1'})).replay);
 assert.equal((await store.call('stats',{id:a.id})).summary.matches,3);
});

test('HTTP public reads need no account or cookie; writes remain authenticated, same-origin and owner scoped',async t=>{
 const server=await startServer({host:'127.0.0.1',port:0,workers:0,userFile:':memory:',quiet:true,announcementsFile:null});t.after(()=>server.close());
 const call=async(url,{cookie,body,origin}={})=>{const response=await fetch(server.url+url,{method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...(origin?{origin}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,headers:response.headers,data:await response.json()};};
 const account=await call('/api/user'),user=account.data.user,cookie=account.headers.get('set-cookie').split(';')[0];
 const publicUrl='/api/doctors/'+formatDoctorId(user.publicId).toLowerCase();
 const anonymous=await call(publicUrl);assert.equal(anonymous.status,200);assert.equal(anonymous.headers.get('set-cookie'),null);assert.equal(anonymous.headers.get('cache-control'),'no-store');
 assert.equal(JSON.stringify(anonymous.data).includes(user.id),false);
 assert.equal((await call('/api/user/visibility',{body:{visibility:{trophies:true}}})).status,401);
 assert.equal((await call('/api/user/visibility',{cookie,origin:'https://elsewhere.invalid',body:{visibility:{trophies:true}}})).status,403);
 assert.equal((await call('/api/user/visibility',{cookie,body:{visibility:{trophies:'yes'}}})).status,400);
 await server.users.call('record',game('g1',[user]));
 assert.equal((await call('/api/user/visibility',{cookie,body:{visibility:{trophies:true,replays:true}}})).status,200);
 assert.equal((await call('/api/user/replay/share',{cookie,body:{matchId:'g1',shared:true}})).status,200);
 const archive=await call(publicUrl+'/replay?matchId=g1');assert.equal(archive.status,200);assert.deepEqual(archive.data.replay.perspectives,['a']);
 assert.equal(archive.headers.get('x-sp-replay-content'),server.content.cs);
 assert.equal((await call(publicUrl,{body:{visibility:{history:true}}})).status,405);
 assert.equal((await call('/api/doctors/0000-0000-0000')).status,404);
 assert.equal((await call(publicUrl+'?before=-1')).status,400);
 assert.equal((await call('/api/user/replay/share',{cookie,body:{matchId:'g1',shared:false}})).status,200);
 assert.equal((await call(publicUrl+'/replay?matchId=g1')).status,404);
});
