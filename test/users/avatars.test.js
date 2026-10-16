import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {parseProfileAvatars,profileAvatarJobs,verifyProfileAvatars} from '../../tools/assets/profile-avatars.mjs';
import {filterProfileAvatars} from '../../shared/profileAvatars.js';
import {profileAvatarUrl} from '../../public/js/ui/assetUrls.js';
import {collectResourceFiles,TIER_REST} from '../../server/resources.js';
import {buildPlan} from '../../tools/assets/plan.mjs';
import {indexAudio} from '../../tools/assets/audio.mjs';
import {collectLeaves} from '../../tools/assets/manifest.mjs';
import {resourceGroup,selectedResourceGroup} from '../../public/js/resources/common.js';

const img=file=>`<img src="https://media.prts.wiki/thumb/a/ab/${file}/80px-${file}?v=wiki" />`;
const table=body=>'<table class="wikitable"><tbody>'+body+'</tbody></table>';
test('PRTS parser imports rendered template entries with names, categories and original static PNG URLs',()=>{
 const defaults=Array.from({length:15},(_,i)=>'Avatar_def_'+String(i+1).padStart(2,'0')+'.png');
 const page='<h2 id="默认头像">'+table(defaults.map(img).join('')+defaults.map((_,i)=>`<td>“默认 ${i}”</td>`).join(''))
  +'<h2 id="特殊获取">'+Array.from({length:86},(_,i)=>table(img('Avatar_special_'+i+'.png')+'<th>“A &amp; B '+i+'”</th>')).join('');
 const parsed=parseProfileAvatars(page);assert.equal(Object.keys(parsed).length,101);
 assert.equal(parsed['avatar:Avatar_special_0'].name,'A & B 0');assert.equal(parsed['avatar:Avatar_special_0'].group,'special');
 assert.equal(parsed['avatar:Avatar_def_01'].source,'https://media.prts.wiki/a/ab/Avatar_def_01.png');
 assert.throws(()=>parseProfileAvatars('<h2 id="默认头像">'),/Default avatar table/);
});
test('catalog is a bounded fixed-source roster; filtering and URL resolution never accept strategy or arbitrary URLs',async()=>{
 const {avatars,revision}=JSON.parse(await fs.readFile(new URL('../../data/profile-avatars.json',import.meta.url)));
 assert.equal(revision,441454);assert.equal(profileAvatarJobs(avatars).length,196);
 const plan=buildPlan({assets07:{},ops03:{},enemies05:{},maps05:{},audio:indexAudio({}),modelsData:{},profileAvatars:avatars});
 assert.equal(collectLeaves(plan.template.profileAvatars).length,196,'standard asset acquisition includes every avatar');
 assert.equal(filterProfileAvatars(avatars,'default').length,15);assert.equal(filterProfileAvatars(avatars,'all',' PRTS ')[0].name,'PRTS');
 for(const a of Object.values(avatars)){assert.match(a.sha256,/^[0-9a-f]{64}$/);assert.ok(a.bytes>0);}
 assert.throws(()=>profileAvatarJobs({'avatar:Avatar_def_01':{...avatars['avatar:Avatar_def_01'],source:'https://evil.test/a.png'}}),/Invalid avatar source/);
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
