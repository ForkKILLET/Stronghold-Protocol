// Fetch a pinned catalog; --refresh --revision N explicitly imports a PRTS revision and records its SHA-256 roster.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AVATAR_SOURCE,parseProfileAvatars,fetchProfileAvatars,mergeProfileManifest} from './assets/profile-avatars.mjs';
import {restartForEnvProxy} from './assets/env-proxy.mjs';
import {collectHashes,hashesDoc} from './asset-hashes.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function main(){
 const args=process.argv.slice(2);
 if(args.includes('--help')){console.log('Usage: node tools/profile-avatars.mjs [--force] [--refresh --revision N]');return;}
 const refresh=args.includes('--refresh');
 if(!refresh&&args.includes('--revision'))throw new Error('--revision requires --refresh');
 const revision=args[args.indexOf('--revision')+1];
 const file=path.join(root,'data/profile-avatars.json');let catalog;
 if(refresh){
  if(!args.includes('--revision')||!/^\d+$/.test(revision))throw new Error('--refresh requires --revision N');
  const response=await fetch('https://prts.wiki/w/'+encodeURIComponent('个人头像一览'),{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('PRTS HTTP '+response.status);
  const html=await response.text();
  if(Number(html.match(/"wgCurRevisionId":(\d+)/)?.[1])!==Number(revision))throw new Error('Wiki revision differs; review the current revision before refresh');
  catalog={version:1,source:AVATAR_SOURCE,revision:Number(revision),avatars:parseProfileAvatars(html)};
 }else catalog=JSON.parse(await fs.readFile(file,'utf8'));
 await fetchProfileAvatars(catalog.avatars,path.join(root,'public/assets'),{force:args.includes('--force'),recordHashes:refresh});
 if(refresh){await fs.writeFile(file+'.tmp',JSON.stringify(catalog,null,2)+'\n');await fs.rename(file+'.tmp',file);}
 await mergeProfileManifest(root,catalog.avatars);
 await fs.writeFile(path.join(root,'data/asset-hashes.json'),JSON.stringify(hashesDoc(await collectHashes({root})),null,2)+'\n');
 console.log('Verified '+Object.keys(catalog.avatars).length+' profile avatars; asset manifest and preload hashes updated.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)&&!restartForEnvProxy())main().catch(e=>{console.error(e.message);process.exitCode=1;});
