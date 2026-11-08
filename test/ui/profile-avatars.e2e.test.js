// Real animated-image decoding in isolated Firefox; no game rendering or player's browser profile required.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import puppeteer from 'puppeteer-core';
import {createHash} from 'node:crypto';
import {startServer} from '../../server/index.js';
import {localFontsOnly} from '../helpers/localFonts.js';

const firefox='/run/current-system/sw/bin/firefox';
test('Firefox: animated selection list, profile save, shared avatars, visibility and static fallback',{
 skip:process.env.SP_E2E!=='1'||!existsSync(firefox)||!existsSync('public/assets/profile-avatars/Avatar_dyn_01.webp'),timeout:120000,
},async()=>{
 const srv=await startServer({host:'127.0.0.1',port:0,workers:0,userFile:':memory:',quiet:true,announcementsFile:null,clientBuild:false,assetIndex:false});
 const out=new URL('../e2e/out/profile-avatars/',import.meta.url);mkdirSync(out,{recursive:true});let browser,currentPage;
 const errors=[];
 try{
  for(const reduced of [false,true]){
   browser=await puppeteer.launch({browser:'firefox',executablePath:firefox,headless:true,extraPrefsFirefox:{
    'dom.ipc.processCount':2,'dom.ipc.processCount.webIsolated':1,'dom.ipc.processPrelaunch.enabled':false,'fission.autostart':false,'ui.prefersReducedMotion':reduced?1:0,
   }});
   const page=await browser.newPage();currentPage=page;const requests=[];
   page.on('request',r=>{if(r.url().includes('/profile-avatars/')&&r.url().endsWith('.webp'))requests.push(r.url());});
   await localFontsOnly(page);page.on('pageerror',e=>errors.push(e.message));
   await page.setViewport({width:1600,height:1000});await page.goto(srv.url,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('sp.pref.doctorProfile')||'null')?.id);
   await page.evaluate(async()=>{(await import('/js/ui/profile.js')).openProfile('profile');});
   await page.waitForSelector('.profile-avatar-filters');
   await page.$$eval('.profile-avatar-filters button',els=>els.find(e=>e.textContent==='动态头像').click());
   const grid='.profile-avatars';
   await page.waitForFunction((grid,reduced)=>{
    const imgs=[...document.querySelectorAll(grid+' img')];
    return imgs.length===8&&imgs.every(i=>i.complete&&i.naturalWidth>0)&&imgs.filter(i=>i.src.endsWith('.webp')).length===(reduced?0:8);
   },{},grid,reduced);
   assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),reduced);
   await page.screenshot({path:new URL(reduced?'reduced-motion.png':'selection-list.png',out).pathname});
   if(reduced){assert.deepEqual(requests,[],'reduced motion must not download animation');await browser.close();browser=null;continue;}
   // Canvas drawImage reads an animated image's default frame in Firefox. Capture the actual visible IMG.
   const image=await page.$(grid+' button[aria-label="很调皮的狗"] img'),samples=[];
   for(let i=0;i<5;i++){
    const shot=await image.screenshot();samples.push(createHash('sha256').update(shot).digest('hex'));
    if(i<2)writeFileSync(new URL('frame-'+i+'.png',out),shot);
    await new Promise(r=>setTimeout(r,350));
   }
   assert.ok(new Set(samples).size>1,'visible decoded avatar frames must change');
   await page.click(grid+' button[aria-label="组织"]');
   await page.type('.profile-summary input','动画测试博士');
   await page.waitForFunction(()=>document.querySelector('.profile-summary img')?.src.endsWith('.webp'));
   await page.$$eval('.doctor-editor .doctor-actions button',els=>els.find(e=>e.textContent.includes('保存资料')).click());
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('sp.pref.doctorProfile')||'null')?.avatarId==='avatar:Avatar_dyn_01');
   await page.screenshot({path:new URL('selected-avatar.png',out).pathname});
   assert.equal((await page.evaluate(async()=> (await (await fetch('/api/user')).json()).user.avatarId)),'avatar:Avatar_dyn_01');

   // Exercise the actual common avatar components independently of a live match or other players.
   await page.evaluate(async()=>{
    const {h,render}=await import('/vendor/preact.module.js'),{AvatarFrame}=await import('/js/ui/components.js'),{PlayerAvatar}=await import('/js/ui/gameComponents.js');
    const root=document.createElement('div');root.id='avatar-probes';root.style='position:fixed;z-index:99999;top:20px;left:20px;background:#101814;padding:16px;display:flex;gap:16px';document.body.append(root);
    render(h('div',{},h(AvatarFrame,{name:'Doctor',src:'/assets/profile-avatars/Avatar_dyn_01.png',animation:'/assets/profile-avatars/Avatar_dyn_01.webp'}),h(PlayerAvatar,{player:{name:'Doctor',avatarId:'avatar:Avatar_dyn_01'}}),
     h(AvatarFrame,{name:'Fallback',src:'/assets/profile-avatars/Avatar_dyn_01.png',animation:'/assets/profile-avatars/missing.webp'})),root);
   });
   await page.waitForFunction(()=>{
    const imgs=[...document.querySelectorAll('#avatar-probes img')];return imgs.length===3&&imgs.every(i=>i.complete&&i.naturalWidth>0)&&imgs[0].src.endsWith('.webp')&&imgs[1].src.endsWith('.webp')&&imgs[2].src.endsWith('.png');
   });
   await page.screenshot({path:new URL('shared-and-fallback.png',out).pathname});
   await page.evaluate(()=>{document.getElementById('avatar-probes').style.top='-1000px';});
   await page.waitForFunction(()=>[...document.querySelectorAll('#avatar-probes img')].every(i=>i.src.endsWith('.png')));
   await page.evaluate(()=>{document.getElementById('avatar-probes').style.top='20px';});
   await page.waitForFunction(()=>document.querySelector('#avatar-probes img').src.endsWith('.webp'));
   const other=await browser.newPage();await other.goto('about:blank');await other.bringToFront();
   await page.waitForFunction(()=>document.hidden&&[...document.querySelectorAll('#avatar-probes img')].every(i=>i.src.endsWith('.png')));
   await page.bringToFront();await other.close();
   await page.waitForFunction(()=>!document.hidden&&document.querySelector('#avatar-probes img').src.endsWith('.webp'));
   writeFileSync(new URL('evidence.json',out),JSON.stringify({samples,errors},null,2));
   await browser.close();browser=null;
  }
  assert.deepEqual(errors,[]);
 }catch(e){
  console.log('browser errors',errors);
  if(currentPage&&!currentPage.isClosed()){
   console.log(await currentPage.$$eval('.profile-avatars img',els=>els.map(i=>({src:i.src,complete:i.complete,w:i.naturalWidth,rect:i.getBoundingClientRect().toJSON()}))));
   await currentPage.screenshot({path:new URL('failure.png',out).pathname}).catch(()=>{});
  }throw e;
 }finally{await browser?.close();await srv.close();}
});
