import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {request} from 'node:http';
import {openUserStore} from '../../server/users/store.js';
import {readProfileSnapshot,importProfileSnapshot,serveProfileSnapshot,pullProfileSnapshot} from '../../tools/profile-debug.mjs';
import {TestClient} from '../helpers/wsClient.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const replay = {v:1,duration:10,players:[{playerId:'p0',name:'Owner',seat:0},{playerId:'p1',name:'Teammate',seat:1}],fields:[],
  events:[{at:0,kind:'view',key:'public',full:{round:1}},{at:1,kind:'view',key:'p0',full:{funds:5}}]};
async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'sp-profile-debug-')), file = path.join(directory,'source.sqlite');
  const store = await openUserStore(file,{backups:null});
  const owner = await store.call('create'), other = await store.call('create'), recovery = await store.call('recovery',{id:owner.user.id});
  await store.call('update',{id:owner.user.id,name:'Owner',avatarId:'avatar:Avatar_def_01'});
  const game = (id,users) => ({id,endedAt:Number(id.slice(1)),mode:'coop',difficulty:'FUNNY',source:'server',replay,
    rows:users.map((u,i)=>({userId:u.user.id,playerId:`p${i}`,victory:true,rounds:9,payload:{name:i?'Other private result':'Owner',bandId:'band_amiya',stats:{dmgDealt:100},frame:{roomMode:'coop',matchId:id}}}))});
  await store.call('record',game('g1',[owner,other]));
  await store.call('record',game('g2',[other]));
  await store.call('record',game('g3',[owner]));
  await store.call('record',{...game('g3',[owner]),combat:{v:1,fields:[{battleId:'b1',round:1,fieldId:'f1',cs:null,seconds:10,players:['p0']}]}});
  await store.call('putCombat',{id:owner.user.id,matchId:'g3',record:{v:1,battleId:'b1',round:1,fieldId:'f1',cs:null,seconds:10,complete:true,
    rows:[{key:'one',ownerId:'p0',defId:'chess_amiya',name:'Owner operator',kind:'op',damage:100,healing:0,types:{phys:100,arts:0,true:0,elemental:0}}]}});
  await store.call('pinReplay',{id:owner.user.id,matchId:'g1',pinned:true});
  await store.call('visibility',{id:owner.user.id,visibility:{history:true,replays:true}});
  await store.call('shareReplay',{id:owner.user.id,matchId:'g1',shared:true});
  const stats = await store.call('stats',{id:owner.user.id});
  await store.close();
  const db = new DatabaseSync(file,{readOnly:true});
  let snapshot;
  try {snapshot = readProfileSnapshot(db,owner.user.publicId);} finally {db.close();}
  return {directory,file,owner,other,recovery,stats,snapshot};
}

test('read-only export selects only the requested account and its retained replays, with no credentials',async()=>{
  const f = await fixture();
  try {
    assert.equal(f.snapshot.user.name,'Owner');
    assert.deepEqual(f.snapshot.games.map(g=>g.id),['g1','g3']);
    assert.deepEqual(f.snapshot.games.map(g=>g.position),[1,3],'preserve history cursor positions');
    assert.equal(f.snapshot.results.length,2);
    assert.equal(f.snapshot.replays.length,2);
    assert.equal(f.snapshot.userReplays.filter(r=>r.pinned).length,1);
    assert.deepEqual(f.snapshot.publicReplays.map(r=>r.game_id),['g1']);
    const text = JSON.stringify(f.snapshot);
    for (const value of [f.owner.token,hash(f.owner.token),f.recovery.code,hash(f.recovery.code),f.other.user.id,'Other private result']) assert.ok(!text.includes(value));
    assert.equal(f.snapshot.credentials,undefined); assert.equal(f.snapshot.recovery,undefined);
    const db = new DatabaseSync(f.file,{readOnly:true});
    try {
      assert.throws(()=>readProfileSnapshot(db,'ZZZZ'),/not found/);
      assert.throws(()=>readProfileSnapshot(db,'invalid'),/Invalid/);
      assert.equal(db.prepare('SELECT count(*) n FROM credentials WHERE hash=?').get(hash(f.owner.token)).n,1);
      assert.equal(db.prepare('SELECT count(*) n FROM recovery').get().n,1);
    } finally {db.close();}
  } finally {fs.rmSync(f.directory,{recursive:true,force:true});}
});

test('import preserves profile, privacy, history ordering and replay bytes but uses a new local identity secret',async()=>{
  const f = await fixture(), target = path.join(f.directory,'clone'); let store;
  try {
    const metadata = await importProfileSnapshot(f.snapshot,target);
    assert.equal(metadata.records,2); assert.equal(metadata.pinned,1);
    const token = JSON.parse(fs.readFileSync(path.join(target,'session.json'))).token;
    assert.notEqual(token,f.owner.token);
    for (const name of ['users.sqlite','snapshot.json','session.json']) assert.equal(fs.statSync(path.join(target,name)).mode & 0o777,0o600);
    assert.equal(fs.statSync(target).mode & 0o777,0o700);
    const db = new DatabaseSync(path.join(target,'users.sqlite'),{readOnly:true});
    try {
      assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,1);
      assert.equal(db.prepare('SELECT count(*) n FROM recovery').get().n,0);
      assert.equal(db.prepare('SELECT count(*) n FROM credentials').get().n,1);
      for (const r of f.snapshot.replays) assert.equal(Buffer.from(db.prepare('SELECT body FROM replays WHERE game_id=?').get(r.game_id).body).toString('base64'),r.body);
      assert.equal(db.prepare('SELECT count(*) n FROM combat_records').get().n,1);
      assert.equal(Buffer.from(db.prepare('SELECT body FROM combat_records').get().body).toString('base64'),f.snapshot.combatRecords[0].body);
    } finally {db.close();}
    store = await openUserStore(path.join(target,'users.sqlite'),{backups:null});
    assert.equal((await store.call('authenticate',{token})).publicId,f.owner.user.publicId);
    assert.equal(await store.call('authenticate',{token:f.owner.token}),null);
    assert.equal(await store.call('recover',{code:f.recovery.code}),null);
    assert.deepEqual(await store.call('stats',{id:f.owner.user.id}),f.stats);
    await store.close(); store = null;
    await assert.rejects(importProfileSnapshot(f.snapshot,target),{code:'EEXIST'});
    assert.equal(JSON.parse(fs.readFileSync(path.join(target,'session.json'))).token,token,'refresh never overwrites a live database');
  } finally {await store?.close(); fs.rmSync(f.directory,{recursive:true,force:true});}
});

test('invalid ownership or relations cannot create a partially usable clone',async()=>{
  const f = await fixture(), target = path.join(f.directory,'bad');
  try {
    const wrong = structuredClone(f.snapshot); wrong.results[0].user_id = f.other.user.id;
    await assert.rejects(importProfileSnapshot(wrong,target),/ownership/);
    assert.equal(fs.existsSync(target),false);
    const broken = structuredClone(f.snapshot); broken.publicReplays.push({user_id:f.owner.user.id,game_id:'unowned'});
    await assert.rejects(importProfileSnapshot(broken,target),/FOREIGN KEY/);
    assert.equal(fs.existsSync(target),false);
    await assert.rejects(pullProfileSnapshot({ssh:'-oProxyCommand=bad',publicId:f.owner.user.publicId}),/SSH/);
    await assert.rejects(pullProfileSnapshot({ssh:'w2',publicId:f.owner.user.publicId,container:'game;bad'}),/container/);
  } finally {fs.rmSync(f.directory,{recursive:true,force:true});}
});

test('loopback source server authenticates HTTP and WS as the clone; changes never affect the source',async()=>{
  const f = await fixture(), target = path.join(f.directory,'clone'); let server, client;
  try {
    await importProfileSnapshot(f.snapshot,target);
    server = await serveProfileSnapshot(target,{port:0,quiet:true});
    assert.equal(server.host,'127.0.0.1'); assert.equal(server.store,null); assert.equal(server.telemetry,null); assert.equal(server.studio,null);
    const user = await (await fetch(server.url+'/api/user')).json();
    assert.equal(user.user.publicId,f.owner.user.publicId); assert.equal(user.user.name,'Owner');
    assert.deepEqual(await (await fetch(server.url+'/api/user/stats')).json(),f.stats);
    assert.deepEqual(await (await fetch(server.url+'/api/user/replay?matchId=g1')).json(),{replay});
    for (const headers of [{host:'attacker.example'},{'sec-fetch-site':'cross-site'}]) {
      const status = await new Promise((resolve,reject)=>{
        const req = request(server.url+'/api/user/name',{method:'POST',headers:{...headers,'content-type':'application/json'}},res=>{res.resume();resolve(res.statusCode);});
        req.on('error',reject);req.end(JSON.stringify({name:'Blocked'}));
      });
      assert.equal(status,403);
    }
    assert.equal((await (await fetch(server.url+'/api/user')).json()).user.name,'Owner');
    client = await TestClient.connect(server.url.replace('http:','ws:')+'/ws');
    const welcome = await client.hello('Owner');
    assert.equal(server.registry.byId(welcome.playerId).userId,f.owner.user.id);
    await client.close(); client = null;
    const changed = await fetch(server.url+'/api/user/name',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Local only'})});
    assert.equal(changed.status,200); assert.equal((await changed.json()).user.name,'Local only');
    const source = new DatabaseSync(f.file,{readOnly:true});
    try {assert.equal(source.prepare('SELECT name FROM users WHERE id=?').get(f.owner.user.id).name,'Owner');}
    finally {source.close();}
  } finally {await client?.close(); await server?.close(); fs.rmSync(f.directory,{recursive:true,force:true});}
});
