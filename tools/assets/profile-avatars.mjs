// PRTS personal-profile avatars only; wiki prose and unrelated file libraries are not imported.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Downloader} from './downloader.mjs';
import {isCompletePng,pngSize} from './formats.mjs';
import {contentHash} from './manifest.mjs';
export const AVATAR_SOURCE='https://prts.wiki/w/个人头像一览';
export const AVATAR_GROUPS={默认头像:'default',动态头像:'dynamic',特殊获取:'special',活动头像:'event'};
const decode=s=>s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');

/** Parse the rendered pinned revision, including avatars supplied by wiki templates. */
export function parseProfileAvatars(html){
 const sections=html.split(/<h2\b[^>]*id="(默认头像|动态头像|特殊获取|活动头像)"[^>]*>/);
 const avatars={};
 for(let i=1;i<sections.length;i+=2){
  const group=AVATAR_GROUPS[sections[i]];
  for(const match of sections[i+1].matchAll(/<table\b[^>]*class="wikitable"[^>]*>([\s\S]*?)<\/table>/g)){
   const table=match[1];const images=[...table.matchAll(/<img\b[^>]*src="(https:\/\/media\.prts\.wiki\/[^"<>]*Avatar_[^"<>]*\.png(?:\?[^"<>]*)?)"/g)];
   if(!images.length)continue;
   const names=[...table.replace(/<[^>]*>/g,'').matchAll(/“([^”\n]+)”/g)].map(m=>decode(m[1].trim()));
   const count=group==='default'?images.length:1;
   if(names.length<count)throw new Error('Avatar table has no usable names');
   for(let j=0;j<count;j++){
    const url=new URL(decode(images[j][1]));const segments=url.pathname.split('/').filter(Boolean);
    const file=segments.find(s=>/^Avatar_[A-Za-z0-9_]+\.png$/.test(s));
    if(!file)throw new Error('Unsupported avatar file');
    const source=url.origin+'/'+(segments[0]==='thumb'?segments.slice(1,4):segments).join('/');
    const id='avatar:'+file.slice(0,-4);
    if(avatars[id])throw new Error('Duplicate avatar: '+id);
    avatars[id]={name:names[j],group,file,source,url:'/assets/profile-avatars/'+file};
   }
  }
 }
 if(Object.values(avatars).filter(a=>a.group==='default').length!==15)throw new Error('Default avatar table changed');
 if(Object.keys(avatars).length<100)throw new Error('Incomplete avatar catalog');
 return avatars;
}

export function profileAvatarJobs(avatars={}){
 return Object.entries(avatars).map(([id,a])=>{
  if(!/^Avatar_[A-Za-z0-9_]+\.png$/.test(a.file)||id!=='avatar:'+a.file.slice(0,-4)||a.url!=='/assets/profile-avatars/'+a.file)throw new Error('Invalid avatar identity');
  const source=new URL(a.source);
  if(source.origin!=='https://media.prts.wiki'||!/^\/[0-9a-f]\/[0-9a-f]{2}\/Avatar_[A-Za-z0-9_]+\.png$/.test(source.pathname)||source.search||source.hash)throw new Error('Invalid avatar source');
  return {rel:'profile-avatars/'+a.file,urls:[a.source],kind:'png',...(a.bytes?{bytes:a.bytes}:{})};
 });
}

export async function verifyProfileAvatars(avatars,root,{allowMissing=false,recordHashes=false}={}){
 for(const [id,a] of Object.entries(avatars||{})){
  let bytes;
  try{bytes=await fs.readFile(path.join(root,'profile-avatars',a.file));}
  catch(e){if(allowMissing&&e.code==='ENOENT')continue;throw e;}
  const size=pngSize(bytes);
  if(!isCompletePng(bytes)||!size||size.width>2048||size.height>2048||bytes.length>2*1024*1024)throw new Error('Invalid avatar PNG: '+id);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  if(!recordHashes&&!/^[0-9a-f]{64}$/.test(a.sha256||''))throw new Error('Missing avatar digest: '+id);
  if(a.sha256&&(a.sha256!==sha256||a.bytes!==bytes.length))throw new Error('Avatar integrity mismatch: '+id);
  if(recordHashes){a.sha256=sha256;a.bytes=bytes.length;}
 }
}

export async function fetchProfileAvatars(avatars,root,{force=false,recordHashes=false,log=console.log}={}){
 const dl=new Downloader({root,ledgerPath:path.join(root,'../../.cache/profile-avatars-ledger.json'),concurrency:2,retries:3,timeoutMs:30000,force,log});
 await dl.loadLedger();await dl.run(profileAvatarJobs(avatars),'profile avatars');
 await verifyProfileAvatars(avatars,root,{recordHashes});
}

/** Fast asset-only update without rebuilding unrelated models/audio. */
export async function mergeProfileManifest(root,avatars){
 const file=path.join(root,'data/assets.json');const manifest=JSON.parse(await fs.readFile(file,'utf8'));
 const previous=Object.keys(manifest.profileAvatars||{}).length;
 manifest.profileAvatars=Object.fromEntries(Object.entries(avatars).map(([id,a])=>[id,a.url]));
 if(manifest.stats){const total=Object.values(avatars).reduce((n,a)=>n+a.bytes,0);manifest.stats.files+=Object.keys(avatars).length-previous;manifest.stats.bytes+=total-(manifest.stats.profileAvatarBytes||0);manifest.stats.profileAvatars=Object.keys(avatars).length;manifest.stats.profileAvatarBytes=total;}
 const {version:_v,hash:_h,generator:_g,stats:_s,...body}=manifest;
 manifest.hash=contentHash(body);
 await fs.writeFile(file+'.tmp',JSON.stringify(manifest)+'\n');await fs.rename(file+'.tmp',file);
}
