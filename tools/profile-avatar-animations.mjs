// Offline-only: official avatar bundle → clean animated WebP; runtime avatars stay ordinary images.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import puppeteer from 'puppeteer-core';
const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const renderer='profile-avatar-v1';
const viewer=`<!doctype html><body><script src="/vendor/pixi.min.js"></script><script src="/vendor/pixi-spine.js"></script><script>
const app=new PIXI.Application({width:192,height:192,backgroundAlpha:0,antialias:true,autoStart:false});document.body.append(app.view);app.stop();
window.renderAvatar=async(id,meta)=>{
 const stage=app.stage;stage.removeChildren().forEach(c=>c.destroy({children:true}));
 const number=id.slice(-2);let spine,sprites=[],duration,animation,bounds;
 if(number==='05'||number==='06'){
  const clip=meta.clips['avatar_dyn_'+number];duration=clip.duration;
  const prefix=number==='05'?'dog':'cat';
  sprites=await Promise.all(clip.curves.map(async c=>{
   const n=c.path.match(/f(\\d+)$/)[1].padStart(2,'0'),texture=await PIXI.Assets.load('/raw/'+prefix+'_sequence_f'+n+'.png');
   const sprite=new PIXI.Sprite(texture);sprite.width=sprite.height=192;stage.addChild(sprite);return {sprite,keys:c.keys};
  }));
 }else{
  const stem=(number==='08'?'assets_spine_avatar_dyn_':'assets_avatar_dyn_')+number;
  const resource=await PIXI.Assets.load({src:'/raw/'+stem+'.json',data:{spineAtlasFile:'/raw/'+stem+'.atlas'}});spine=new PIXI.spine.Spine(resource.spineData);spine.autoUpdate=false;
  animation=spine.spineData.animations.find(a=>/idle|loop/i.test(a.name))||spine.spineData.animations[0];
  if(!animation||!(animation.duration>0&&animation.duration<=30))throw Error('Unsupported avatar animation');
  duration=animation.duration;stage.addChild(spine);
  // The official background defines the clipped avatar square; moving logos/particles can extend outside it.
  spine.skeleton.setToSetupPose();spine.state.setAnimation(0,animation.name,true);spine.update(0);
  const slot=spine.skeleton.slots.find(s=>/^bg(?:_white)?$/i.test(s.data.name)),attachment=slot?.getAttachment();
  if(!attachment)throw Error('Missing avatar background viewport');
  const vertices=new Float32Array(attachment.worldVerticesLength||8);
  if(attachment.worldVerticesLength)attachment.computeWorldVertices(slot,0,vertices.length,vertices,0,2);
  else {attachment.updateOffset();attachment.computeWorldVertices(slot.bone,vertices,0,2);}
  const xs=[],ys=[];for(let i=0;i<vertices.length;i+=2){xs.push(vertices[i]);ys.push(vertices[i+1]);}
  const x=Math.min(...xs),y=Math.min(...ys),width=Math.max(...xs)-x,height=Math.max(...ys)-y;
  if(!(width>0&&height>0&&Math.abs(width-height)<1))throw Error('Unexpected avatar background viewport '+JSON.stringify({width,height,vertices:Array.from(vertices)}));
  bounds={x,y,width,height};const scale=192/Math.max(width,height);spine.scale.set(scale);spine.position.set(96-(x+width/2)*scale,96-(y+height/2)*scale);
 }
 const images=[],count=Math.ceil(duration*30);
 for(let frame=0;frame<count;frame++){
  const time=frame*duration/count;
  if(spine){spine.skeleton.setToSetupPose();spine.state.setAnimation(0,animation.name,true);spine.update(time);}
  for(const {sprite,keys} of sprites){let value=keys[0].value;for(const k of keys){if(k.time>time+1e-6)break;value=k.value;}sprite.alpha=value;}
  app.renderer.render(stage);images.push(app.view.toDataURL('image/png').split(',')[1]);
 }
 return {images,duration,fps:count/duration,animation:animation?.name,bounds};
};</script>`;

async function main(){
 const args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
 if(args.includes('--help')){console.log('node tools/profile-avatar-animations.mjs --game <Windows AB root> --python <UnityPy Python> [--browser <Chrome>] [--ffmpeg <ffmpeg>] [--only 01,02]');return;}
 const only=option('--only');if(only&&!/^(0[1-8])(,0[1-8])*$/.test(only))throw Error('Invalid --only list');
 const game=option('--game'),python=option('--python','python3'),browserPath=option('--browser','/run/current-system/sw/bin/google-chrome-stable');
 if(!game)throw Error('--game is required');
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'sp-avatar-render-')),raw=path.join(work,'raw');let browser,server;
 try{
  await exec(python,['-B',path.join(root,'tools/local-extract/profile_avatars.py'),'--game',path.resolve(game),'--out',raw]);
  const metadata=JSON.parse(await fs.readFile(path.join(raw,'source.json')));
  server=http.createServer(async(req,res)=>{
   try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(viewer);return;}
    const base=url.pathname.startsWith('/raw/')?raw:url.pathname.startsWith('/vendor/')?path.join(root,'public/vendor'):null;
    if(!base||!/^\/(raw|vendor)\/[A-Za-z0-9_.-]+$/.test(url.pathname)){res.writeHead(404).end();return;}
    const file=path.join(base,path.basename(url.pathname));res.setHeader('Content-Type',file.endsWith('.png')?'image/png':file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'application/octet-stream');res.end(await fs.readFile(file));
   }catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await puppeteer.launch({executablePath:browserPath,headless:true,args:['--no-sandbox','--no-proxy-server','--use-angle=swiftshader','--enable-unsafe-swiftshader','--renderer-process-limit=1']});
  const page=await browser.newPage();page.on('pageerror',e=>console.error(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>typeof globalThis.renderAvatar==='function');
  const catalogFile=path.join(root,'data/profile-avatars.json'),catalog=JSON.parse(await fs.readFile(catalogFile));
  for(const [id,a] of Object.entries(catalog.avatars).filter(([,a])=>a.group==='dynamic'&&(!only||only.split(',').includes(a.file.slice(-6,-4))))){
   const frames=await page.evaluate((id,metadata)=>globalThis.renderAvatar(id,metadata),id,metadata),folder=path.join(work,id.replace(':','-'));await fs.mkdir(folder);
   for(let i=0;i<frames.images.length;i++)await fs.writeFile(path.join(folder,String(i).padStart(4,'0')+'.png'),Buffer.from(frames.images[i],'base64'));
   const file=a.file.replace(/\.png$/,'.webp'),output=path.join(root,'public/assets/profile-avatars',file),tmp=path.join(work,file);
   await exec(option('--ffmpeg','ffmpeg'),['-v','error','-threads','1','-framerate',String(frames.fps),'-i',path.join(folder,'%04d.png'),'-c:v','libwebp_anim','-lossless','1','-compression_level','4','-loop','0','-threads','1','-y',tmp],{maxBuffer:1024*1024,timeout:60000});
   const bytes=await fs.readFile(tmp);await fs.copyFile(tmp,output);
   a.animation={file,source:'local-client',...{bundle:metadata.bundle,bundleSha256:metadata.bundleSha256},renderer,url:'/assets/profile-avatars/'+file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
   const {images:_images,...info}=frames;console.log(id,JSON.stringify({...info,bytes:bytes.length}));
  }
  await fs.writeFile(catalogFile+'.tmp',JSON.stringify(catalog,null,2)+'\n');await fs.rename(catalogFile+'.tmp',catalogFile);
  console.log('Rendered clean animations. Run npm run assets:avatars to refresh the manifest and preload hashes.');
 }finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(work,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
