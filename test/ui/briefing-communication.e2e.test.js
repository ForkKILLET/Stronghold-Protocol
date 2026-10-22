// SP_E2E=1: real local room -> INFO_CHECK; never touches a production game or a user's browser.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
import {TestClient} from '../helpers/wsClient.js';
import {EMOTES} from '../../shared/constants.js';

const sizes=[{width:1366,height:768},{width:844,height:390,safe:true},{width:740,height:360},{width:640,height:360,text:'xl'},{width:844,height:240}];
for(const [engine,executablePath] of [
 ['chrome',process.env.CHROME_PATH||'/run/current-system/sw/bin/google-chrome-stable'],
 ['firefox',process.env.FIREFOX_PATH||'/run/current-system/sw/bin/firefox'],
])test(`${engine}: briefing communication stays visible and reachable`,{
 skip:process.env.SP_E2E!=='1'||!existsSync(executablePath),timeout:120000,
},async()=>{
 const server=await startServer({port:0,host:'127.0.0.1',quiet:true,workers:0,userFile:':memory:',clientBuild:process.env.SP_E2E_BUILD==='1',assetIndex:false,announcementsFile:null});
 const out=process.env.SP_E2E_OUT||new URL('../e2e/out/briefing-communication/',import.meta.url).pathname;
 mkdirSync(out,{recursive:true});let browser,guest,observer;
 try{
  browser=await puppeteer.launch({browser:engine,executablePath,headless:true,args:engine==='chrome'?['--no-sandbox','--mute-audio','--no-proxy-server']:[]});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Keep touch emulation stable across resizes: toggling it can reload Chrome and lose an arriving message.
  const viewport=size=>({width:size.width,height:size.height,...(engine==='chrome'?{isMobile:true,hasTouch:true,isLandscape:true,deviceScaleFactor:1}:{})});
  const click=async selector=>page.locator(selector).click();
  const request=(t,fields={})=>page.evaluate(({t,fields})=>window.__SP__.net.request(t,fields),{t,fields});
  const settle=()=>page.evaluate(async()=>{await document.fonts.ready;document.getAnimations().filter(a=>!a.effect?.target?.closest?.('.ebubble')&&Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a=>a.finish());await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  await page.setViewport(viewport(sizes[0]));await page.goto(server.url,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.title-login input');await page.type('.title-login input','交流验证');await click('.title-login .btn--primary');
  await page.waitForSelector('.lobby-hub');await request('room.create',{mode:'coop',difficulty:'NORMAL'});await page.waitForSelector('.room-screen');
  const code=await page.evaluate(()=>window.__SP__.store.get().room.code);
  guest=await TestClient.connect(server.url.replace('http','ws')+'/ws');await guest.hello('测试队友的较长博士名字');
  await guest.request({t:'room.join',code});await guest.request({t:'room.ready',ready:true});
  observer=await TestClient.connect(server.url.replace('http','ws')+'/ws');await observer.hello('观战验证');await observer.request({t:'room.spectate',code});
  await request('room.start');await page.waitForSelector('.brief__foot');
  // Only extend this local fixture's countdown; all message delivery and UI actions use the real protocol.
  const match=server.lobby.rooms.get(code).match;match.setDeadline(180,()=>match.enterBandDraft());match.markPublic();
  await request('g.infoReady');await page.waitForFunction(()=>document.querySelector('.brief__foot > .btn')?.disabled);
  for(let i=0;i<sizes.length;i++){
   const size=sizes[i];
   await page.setViewport(viewport(size));
   await page.evaluate(size=>{
    document.documentElement.dataset.text=size.text||'md';
    for(const [key,value] of Object.entries({'--sa-l':size.safe?'44px':'0px','--sa-r':size.safe?'44px':'0px','--sa-b':size.safe?'21px':'0px'}))document.documentElement.style.setProperty(key,value);
    dispatchEvent(new Event('resize'));
   },size);await settle();
   const message=`${i}请确认阵容准备完毕之后再开始作战`;
   assert.equal((await guest.request({t:'g.chat',text:message})).t,'ok');
   await page.waitForFunction(message=>document.querySelector('.brief .communication-activity')?.textContent.includes(message),{},message);
   await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.communication-bubble')).opacity)>.9);
   await settle();await page.screenshot({path:path.join(out,`${engine}-${size.width}-${size.height}-chat.png`)});
   const activity=await page.$eval('.brief .communication-activity',e=>{
    const r=e.getBoundingClientRect(),main=e.closest('.brief__main').getBoundingClientRect(),bubble=e.querySelector('.communication-bubble'),b=bubble.getBoundingClientRect();
    return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,mainTop:main.top,mainBottom:main.bottom,visible:Number(getComputedStyle(bubble).opacity)>.5&&!!document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('.communication-activity'),pageOverflow:document.documentElement.scrollWidth-innerWidth};
   });
   assert.ok(activity.visible&&activity.top>=activity.mainTop&&activity.bottom<=activity.mainBottom+1,JSON.stringify(activity));
   assert.ok(activity.pageOverflow<=1,JSON.stringify(activity));
   const reroll=await page.$eval('.brief-reroll',e=>{
    const box=e.getBoundingClientRect(),right=e.closest('.brief__right').getBoundingClientRect(),bonds=document.querySelector('.brief__bonds').getBoundingClientRect();
    return{left:box.left,right:box.right,top:box.top,bottom:box.bottom,columnLeft:right.left,columnRight:right.right,columnBottom:right.bottom,bondsBottom:bonds.bottom};
   });
   assert.ok(reroll.left>=reroll.columnLeft-1&&reroll.right<=reroll.columnRight+1&&reroll.bottom<=reroll.columnBottom+1&&reroll.top>=reroll.bondsBottom-1,'reroll stays below the right-column bonds: '+JSON.stringify(reroll));
   if(i===0||i===1||i===4){
    await click('.brief-reroll__actions button');await page.waitForFunction(()=>!!window.__SP__.store.get().match.public.rerollVote);await settle();
    await page.screenshot({path:path.join(out,`${engine}-${size.width}-${size.height}-reroll-vote.png`)});
    for(const button of await page.$$('.brief-reroll__actions button')){
     await button.evaluate(e=>e.scrollIntoView({block:'nearest'}));await settle();
     const hit=await button.evaluate(e=>{const r=e.getBoundingClientRect(),panel=e.closest('.brief-reroll').getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{ok:!!hit&&e.contains(hit)&&r.top>=panel.top-1&&r.bottom<=panel.bottom+1,button:e.textContent,x:r.x,y:r.y,width:r.width,height:r.height,panelTop:panel.top,panelBottom:panel.bottom,top:hit?.className};});
     assert.ok(hit.ok,'reroll consent/cancel controls stay reachable: '+JSON.stringify(hit));
    }
    await page.screenshot({path:path.join(out,`${engine}-${size.width}-${size.height}-reroll-vote.png`)});
    await click('.brief-reroll__actions button:last-child');await page.waitForFunction(()=>!window.__SP__.store.get().match.public.rerollVote);await settle();
   }
   const stage=await page.$eval('.brief-stage',e=>{
    const label=e.querySelector('.brief-stage__k').getBoundingClientRect(),name=e.querySelector('.brief-stage__name').getBoundingClientRect();
    return{overlap:Math.min(label.right,name.right)>Math.max(label.left,name.left)+1&&Math.min(label.bottom,name.bottom)>Math.max(label.top,name.top)+1,overflow:e.scrollWidth-e.clientWidth};
   });
   assert.ok(!stage.overlap&&stage.overflow<=1,'battlefield label and name stay separate: '+JSON.stringify(stage));
   if(size.width===844){await page.$eval('.brief-stage',e=>e.scrollIntoView({block:'start'}));await settle();await page.screenshot({path:path.join(out,`${engine}-${size.width}-${size.height}-battlefield.png`)});}
   await click('.brief .ewheel__btn');await page.waitForSelector('.brief .ewheel__dialog');await settle();
   const geometry=await page.evaluate(()=>{
    const box=selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,height:r.height,hit:!!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest(selector)};};
    return{dialog:box('.brief .ewheel__dialog'),loadout:box('.brief-loadout'),button:box('.brief .ewheel__btn'),ready:box('.brief__foot > .btn'),header:box('.brief > .app-header'),cells:[...document.querySelectorAll('.ewheel__item')].map(e=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.ewheel__item')===e;})};
   });
   await page.screenshot({path:path.join(out,`${engine}-${size.width}-${size.height}-open.png`)});
   assert.ok(geometry.cells.every(Boolean),'all six emotes are reachable');
   assert.ok(geometry.dialog.top>=geometry.header.bottom-1&&geometry.dialog.bottom<=geometry.button.top+1,JSON.stringify(geometry));
   assert.ok(Math.abs(geometry.loadout.height-geometry.button.height)<1,JSON.stringify(geometry));
   assert.ok(geometry.loadout.hit&&geometry.button.hit,'both footer tools stay reachable');
   await click('.echat__tab[aria-label="聊天历史"]');
   await page.waitForFunction(message=>document.querySelector('.echat__history')?.textContent.includes(message),{},message);
   await click('.brief .ewheel__btn');
   // A fresh emote remains visible after scrolling the independent briefing information.
   await new Promise(resolve=>setTimeout(resolve,1050));
   assert.equal((await guest.request({t:'g.emote',id:EMOTES[0]})).t,'ok');
   await page.waitForSelector('.brief .communication-activity [data-emote]');
   await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.communication-bubble')).opacity)>.9);
   const scrollSelector=await page.$('.brief__intel')?'.brief__intel':'.brief__left';
   await page.$eval(scrollSelector,e=>{e.scrollTop=e.scrollHeight;});await settle();
   assert.equal(await page.$eval('.brief .communication-activity [data-emote]',e=>{const r=e.getBoundingClientRect();return !!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.communication-activity');}),true,'emote survives information scrolling');
   await page.screenshot({path:path.join(out,`${engine}-${size.width}-${size.height}-emote.png`)});
   await new Promise(resolve=>setTimeout(resolve,1050));
  }
  await click('.brief .ewheel__btn');await page.waitForSelector('.echat__input');
  await page.type('.echat__input','已就绪，可以交流');await click('.echat__send');
  assert.equal((await guest.waitFor('m.chat',m=>m.text==='已就绪，可以交流')).text,'已就绪，可以交流','ready player can actually send text');
  await click('.brief .ewheel__btn');
  await page.setViewport(viewport({width:844,height:390}));
  await page.evaluate(()=>{
   document.documentElement.dataset.text='md';
   for(const name of ['--sa-l','--sa-r','--sa-b'])document.documentElement.style.setProperty(name,'0px');
   dispatchEvent(new Event('resize'));
  });await settle();
  await click('.brief .ewheel__btn');await page.waitForSelector('.echat__input');
  await page.$eval('.echat__input',e=>e.focus());
  await page.evaluate(()=>{
   const vv=visualViewport;
   Object.defineProperty(vv,'height',{configurable:true,value:200});
   Object.defineProperty(vv,'offsetTop',{configurable:true,value:24});
   vv.dispatchEvent(new Event('resize'));
  });await settle();
  await page.screenshot({path:path.join(out,`${engine}-keyboard.png`)});
  const keyboard=await page.$eval('.ewheel__dialog',e=>{
   const r=e.getBoundingClientRect(),input=e.querySelector('input').getBoundingClientRect();
   return{top:r.top,bottom:r.bottom,inputTop:input.top,inputBottom:input.bottom,visibleTop:visualViewport.offsetTop,visibleBottom:visualViewport.offsetTop+visualViewport.height};
  });
  assert.ok(keyboard.top>=keyboard.visibleTop&&keyboard.bottom<=keyboard.visibleBottom+1,JSON.stringify(keyboard));
  assert.ok(keyboard.inputTop>=keyboard.top&&keyboard.inputBottom<=keyboard.visibleBottom+1,JSON.stringify(keyboard));
  await page.evaluate(()=>{delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'));});
  await click('.brief [data-testid="settings-btn"]');await page.waitForSelector('.settings-modal');await settle();
  assert.equal(await page.$eval('.brief .ewheel__btn',e=>{const r=e.getBoundingClientRect();return !!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.modal');}),true,'settings cover communication controls');
  await page.keyboard.press('Escape');await page.waitForSelector('.settings-modal',{hidden:true});
  const context=await browser.createBrowserContext(),watch=await context.newPage();
  await watch.setViewport(sizes[0]);await watch.goto(`${server.url}/?spectate=${code}`,{waitUntil:'domcontentloaded'});
  await watch.waitForSelector('.title-login input');await watch.type('.title-login input','旁观验证');await watch.locator('.title-login .btn--primary').click();
  await watch.waitForSelector('.brief .ewheel__btn');assert.equal(await watch.$eval('.brief .ewheel__btn',e=>e.disabled),true,'spectators cannot send');
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await guest?.close();await observer?.close();await server.close();}
});
