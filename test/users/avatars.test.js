import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {parseProfileAvatars,profileAvatarJobs,verifyProfileAvatars,profileAvatarManifest,mergeProfileManifest} from '../../tools/assets/profile-avatars.mjs';
import {filterProfileAvatars} from '../../shared/profileAvatars.js';
import {profileAvatarUrl,profileAvatarAnimationUrl} from '../../public/js/ui/assetUrls.js';
import {collectResourceFiles,TIER_REST} from '../../server/resources.js';
import {Downloader} from '../../tools/assets/downloader.mjs';
import {buildPlan} from '../../tools/assets/plan.mjs';
import {indexAudio} from '../../tools/assets/audio.mjs';
import {collectLeaves} from '../../tools/assets/manifest.mjs';
import {avatarWebpInfo,validate} from '../../tools/assets/formats.mjs';
import {rewriteAssetPaths} from '../../server/index.js';
import {resourceGroup,selectedResourceGroup} from '../../public/js/resources/common.js';

const img=file=>`<img src="https://media.prts.wiki/thumb/a/ab/${file}/80px-${file}?v=wiki" />`;
const table=body=>'<table class="wikitable"><tbody>'+body+'</tbody></table>';
test('PRTS parser imports rendered template entries with names, categories and original static PNG URLs',()=>{
 const defaults=Array.from({length:15},(_,i)=>'Avatar_def_'+String(i+1).padStart(2,'0')+'.png');
 const page='<h2 id="默认头像">'+table(defaults.map(img).join('')+defaults.map((_,i)=>`<td>“默认 ${i}”</td>`).join(''))
  +'<h2 id="动态头像">'+table(img('Avatar_dyn_01.png')+'<a href="https://media.prts.wiki/a/af/Avatar_dyn_01.gif?v=demo">动画</a><th>“动画”</th>')+table(img('Avatar_dyn_07.png')+'<a href="/index.php?title=File:Avatar_dyn_07.gif&amp;action=edit">缺失</a><th>“静态回退”</th>')+'<h2 id="特殊获取">'+Array.from({length:86},(_,i)=>table(img('Avatar_special_'+i+'.png')+'<th>“A &amp; B '+i+'”</th>')).join('');
 const parsed=parseProfileAvatars(page);assert.equal(Object.keys(parsed).length,103);
 assert.equal(parsed['avatar:Avatar_dyn_01'].animation,undefined,'wiki recordings are not raw avatar resources');
 assert.equal(parsed['avatar:Avatar_dyn_07'].animation,undefined);
 assert.equal(parsed['avatar:Avatar_special_0'].name,'A & B 0');assert.equal(parsed['avatar:Avatar_special_0'].group,'special');
 assert.equal(parsed['avatar:Avatar_def_01'].source,'https://media.prts.wiki/a/ab/Avatar_def_01.png');
 assert.throws(()=>parseProfileAvatars('<h2 id="默认头像">'),/Default avatar table/);
});
test('catalog is a bounded fixed-source roster; filtering and URL resolution never accept strategy or arbitrary URLs',async()=>{
 const {avatars,revision}=JSON.parse(await fs.readFile(new URL('../../data/profile-avatars.json',import.meta.url)));
 assert.equal(revision,441454);assert.equal(profileAvatarJobs(avatars).length,204);
 const plan=buildPlan({assets07:{},ops03:{},enemies05:{},maps05:{},audio:indexAudio({}),modelsData:{},profileAvatars:avatars});
 assert.equal(collectLeaves(plan.template.profileAvatars).length,204,'standard asset acquisition includes every avatar');
 assert.equal(filterProfileAvatars(avatars,'default').length,15);assert.equal(filterProfileAvatars(avatars,'all',' PRTS ')[0].name,'PRTS');
 for(const a of Object.values(avatars)){assert.match(a.sha256,/^[0-9a-f]{64}$/);assert.ok(a.bytes>0);}
 assert.throws(()=>profileAvatarJobs({'avatar:Avatar_def_01':{...avatars['avatar:Avatar_def_01'],source:'https://evil.test/a.png'}}),/Invalid avatar source/);
 assert.equal(Object.values(avatars).filter(a=>a.animation).length,8);
 const animated=profileAvatarManifest(avatars);
 assert.equal(collectResourceFiles({profileAvatars:animated},null).length,204);
 assert.equal(profileAvatarAnimationUrl({profileAvatars:animated},'avatar:Avatar_dyn_07'),avatars['avatar:Avatar_dyn_07'].animation.url);
 assert.equal(profileAvatarAnimationUrl({profileAvatars:animated},'avatar:Avatar_def_01'),null);
 assert.equal(profileAvatarUrl({profileAvatars:animated},'avatar:Avatar_dyn_01'),avatars['avatar:Avatar_dyn_01'].url);
 const cdn=rewriteAssetPaths({profileAvatars:animated},'https://cdn.example');
 assert.equal(profileAvatarAnimationUrl(cdn,'avatar:Avatar_dyn_01'),'https://cdn.example'+avatars['avatar:Avatar_dyn_01'].animation.url);
 const assets={profileAvatars:{'avatar:Avatar_def_01':'/assets/profile-avatars/Avatar_def_01.png'},bands:{band_amiya:'/assets/band/amiya.png'}};
 assert.equal(profileAvatarUrl(assets,'band_amiya'),null);assert.equal(profileAvatarUrl(assets,'https://evil.test/a.png'),null);
 const [file]=collectResourceFiles(assets,null).filter(f=>f.url.includes('profile-avatars'));
 assert.equal(file.tier,TIER_REST);assert.equal(resourceGroup(file),'avatar');
 assert.equal(selectedResourceGroup('avatar',false,'all'),false);assert.equal(selectedResourceGroup('avatar',true,'none'),true);
 assert.equal(profileAvatarUrl(assets,'avatar:Avatar_def_01'),file.url);
});
test('asset verification rejects a changed or unpinned PNG instead of silently replacing the receipt',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'avatar-roster-'));
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64');
 const a={file:'Avatar_def_01.png',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 try{
  await fs.mkdir(path.join(dir,'profile-avatars'));await fs.writeFile(path.join(dir,'profile-avatars',a.file),bytes);
  await verifyProfileAvatars({id:a},dir);
  await assert.rejects(verifyProfileAvatars({id:{...a,sha256:'0'.repeat(64)}},dir),/integrity mismatch/);
  await assert.rejects(verifyProfileAvatars({id:{file:a.file}},dir),/Missing avatar digest/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

// A bounded 1px animated WebP container. Pixel decoding is exercised with the actual assets in Firefox.
const chunk=(tag,body)=>{const header=Buffer.alloc(8);header.write(tag);header.writeUInt32LE(body.length,4);return Buffer.concat([header,body,...(body.length&1?[Buffer.alloc(1)]:[])]);};
const extended=Buffer.alloc(10);extended[0]=2;
const frame=Buffer.alloc(24);frame.writeUIntLE(100,12,3);
const body=Buffer.concat([Buffer.from('WEBP'),chunk('VP8X',extended),chunk('ANIM',Buffer.alloc(6)),chunk('ANMF',frame),chunk('ANMF',frame)]);
const riff=Buffer.alloc(8);riff.write('RIFF');riff.writeUInt32LE(body.length,4);const webp=Buffer.concat([riff,body]);
test('derived animation validation, receipts, full source-verifying acquisition and incremental manifest agree',async()=>{
 assert.deepEqual(avatarWebpInfo(webp),{width:1,height:1,frames:2,duration:200});
 assert.equal(validate('avatar-webp',webp),true);
 for(const bad of [webp.subarray(0,-1),Buffer.concat([webp,Buffer.from('extra')]),Buffer.from('<html>WEBP</html>')])assert.equal(avatarWebpInfo(bad),null);
 const oversized=Buffer.from(webp);oversized.writeUIntLE(512,24,3);assert.equal(avatarWebpInfo(oversized),null);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'avatar-animation-'));
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64');
 const record=(file,bytes)=>({file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 const a={...record('Avatar_dyn_01.png',png),url:'/assets/profile-avatars/Avatar_dyn_01.png',source:'https://media.prts.wiki/a/af/Avatar_dyn_01.png',group:'dynamic',animation:{...record('Avatar_dyn_01.webp',webp),url:'/assets/profile-avatars/Avatar_dyn_01.webp',source:'local-client',bundle:'arts/dynavatars_0.ab',bundleSha256:'1'.repeat(64),renderer:'profile-avatar-v1'}};
 try{
  const resources=path.join(dir,'public/assets');await fs.mkdir(path.join(resources,'profile-avatars'),{recursive:true});await fs.writeFile(path.join(resources,'profile-avatars',a.file),png);await fs.writeFile(path.join(resources,'profile-avatars',a.animation.file),webp);
  await verifyProfileAvatars({id:a},resources);
  await assert.rejects(verifyProfileAvatars({id:{...a,animation:{...a.animation,sha256:'0'.repeat(64)}}},resources),/integrity mismatch/);
  assert.throws(()=>profileAvatarJobs({'avatar:Avatar_dyn_01':{...a,animation:{...a.animation,source:'https://evil.test/animation.webp'}}}),/Invalid avatar animation/);
  const jobs=profileAvatarJobs({'avatar:Avatar_dyn_01':a}),job=jobs[1];
  assert.deepEqual(job.urls,[],'derived resources never guess a remote URL');
  const dl=new Downloader({root:resources,ledgerPath:path.join(dir,'ledger.json'),verifier:{resolve(){throw Error('must not request GitHub for a derived avatar');}},fetchImpl:async()=>{throw Error('unexpected network');},log:()=>{}});
  assert.equal((await dl.run([job])).get(job.rel).status,'skip');assert.ok(dl.accepted.has(job.rel));
  await fs.mkdir(path.join(dir,'data'));await fs.writeFile(path.join(dir,'data/assets.json'),JSON.stringify({profileAvatars:{id:a.url},stats:{files:1,bytes:png.length,profileAvatarBytes:png.length}}));
  await mergeProfileManifest(dir,{id:a});await mergeProfileManifest(dir,{id:a});
  const manifest=JSON.parse(await fs.readFile(path.join(dir,'data/assets.json')));
  assert.equal(manifest.stats.files,2);assert.equal(manifest.stats.bytes,png.length+webp.length);assert.equal(manifest.stats.profileAvatars,1);
  assert.deepEqual(manifest.profileAvatars.id,{url:a.url,animation:a.animation.url});
  await fs.writeFile(path.join(resources,'profile-avatars',a.animation.file),webp.subarray(0,-1));
  await assert.rejects(verifyProfileAvatars({id:a},resources),/Invalid avatar WebP/);
  assert.equal((await dl.run([job])).get(job.rel).status,'error');assert.ok(!dl.accepted.has(job.rel));
  await fs.unlink(path.join(resources,'profile-avatars',a.animation.file));
  assert.equal((await dl.run([job])).get(job.rel).status,'miss');
  await verifyProfileAvatars({id:a},resources,{allowMissingLocal:true});
  await mergeProfileManifest(dir,{id:a});
  const missing=JSON.parse(await fs.readFile(path.join(dir,'data/assets.json')));
  assert.equal(missing.profileAvatars.id,a.url,'uninstalled local animation is omitted, keeping the static avatar');assert.equal(missing.stats.files,1);assert.equal(missing.stats.bytes,png.length);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
