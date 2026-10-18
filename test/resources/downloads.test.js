import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {importResourceZip} from '../../public/js/resources/archive.js';
import {ResourceStore} from '../../public/js/resources/store.js';
import {resourceGroup} from '../../public/js/resources/common.js';

const digest=body=>createHash('sha1').update(body).digest('hex').slice(0,12);
class Cache {
  entries=new Map();
  async put(k,r){this.entries.set(k,r.clone());}
  async match(k){return this.entries.get(typeof k==='string'?k:k.url)?.clone();}
  async keys(){return [...this.entries.keys()].map(k=>new Request(k));}
  async delete(k){return this.entries.delete(k);}
}
class Caches {
  entries=new Map();
  async open(k){if(!this.entries.has(k))this.entries.set(k,new Cache());return this.entries.get(k);}
  async keys(){return [...this.entries.keys()];}
}

test('category ZIPs match browser import, preserve identities, reuse unchanged groups and reject corrupt sources',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'sp-downloads-'));t.after(async()=>{await rm(root,{recursive:true,force:true});});
  const assets=path.join(root,'public'),out=path.join(root,'out'),manifest=path.join(root,'manifest.json');
  const rows=[['/assets/ui/main.png',1],['/assets/char/portrait/skin/char_x_skin.png',2],
    ['/assets/spine/op/char_x/char_x_skin/front/x.skel',2],['/assets/profile-avatars/a.png',2],
    ['/assets/audio/bgm/a.mp3',2],['/assets/local/fx/index.json',2],['/assets/audio/voice/native/a.mp3',2],
    ...['cn','jp','en','kr'].map(lang=>[`/assets/audio/voice/${lang}/a.mp3`,2])]
    .map(([url,tier],i)=>({url,tier,body:'fixture-'+i}));
  async function build(version='v1',output=out,previous=null){
    const files=[];
    for(const row of rows){const file=path.join(assets,row.url);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,row.body);
      files.push({url:row.url,tier:row.tier,size:Buffer.byteLength(row.body),hash:digest(row.body)});}
    await writeFile(manifest,JSON.stringify({version,files}));
    const args=['tools/resource_downloads.py','--manifest',manifest,'--assets-root',assets,'--output',output];
    if(previous)args.push('--previous',previous);
    const r=spawnSync('python3',args,{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
    return {doc:JSON.parse(await readFile(path.join(output,'downloads.json'))),files};
  }
  const first=await build();assert.equal(first.doc.packages.length,7);
  const store=new ResourceStore({format:1,version:'v1',files:first.files},{origin:'https://game.example',caches:new Caches(),fetcher:()=>{throw Error('must not download');}});
  for(const p of first.doc.packages){
    const bytes=await readFile(path.join(out,p.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),p.sha256);
    assert.equal((await importResourceZip(store,new Blob([bytes]))).imported,p.count);
  }
  assert.equal((await store.status()).present.size,rows.length);
  const second=await build('v2',path.join(root,'second'),out);
  assert.ok(second.doc.packages.every(p=>p.reused));
  assert.deepEqual(second.doc.packages.map(p=>p.sha256),first.doc.packages.map(p=>p.sha256));
  const a=first.doc.packages[0],b=second.doc.packages[0];
  assert.equal((await stat(path.join(out,a.url))).ino,(await stat(path.join(root,'second',b.url))).ino,'reuse hard-links on the same filesystem');
  rows[0].body+='changed';const third=await build('v3');
  assert.notEqual(third.doc.packages[0].sha256,first.doc.packages[0].sha256);
  assert.ok(third.doc.packages.filter(p=>p.id!=='core').every(p=>p.reused));
  const python=spawnSync('python3',['-c','import sys,json;sys.path.insert(0,"tools");from resource_packs import group;print(json.dumps([group(r) for r in json.loads(sys.argv[1])]))',JSON.stringify(first.files)],{encoding:'utf8',timeout:5000});
  assert.equal(python.status,0,python.stderr);
  assert.deepEqual(JSON.parse(python.stdout),first.files.map(f=>resourceGroup(f)==='music'?'bgm':resourceGroup(f)));
  // A wrong digest fails before a new catalogue can be published.
  const source=JSON.parse(await readFile(manifest));source.files[0].hash='0'.repeat(12);await writeFile(manifest,JSON.stringify(source));
  const invalid=spawnSync('python3',['tools/resource_downloads.py','--manifest',manifest,'--assets-root',assets,'--output',path.join(root,'invalid')],{encoding:'utf8'});
  assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/digest mismatch/);
});
