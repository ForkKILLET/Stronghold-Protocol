// Real room: persistent communication, independent information scrolling,
// keyboard visibility and read-only spectators. Run through check:local.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
import {TestClient} from '../helpers/wsClient.js';
import {localFontsOnly} from '../helpers/localFonts.js';
import {EMOTES} from '../../shared/constants.js';

for(const engine of ['chrome','firefox'])test(`${engine}: fixed briefing communication, keyboard and spectators`,{
 skip:process.env.SP_E2E!=='1'||(process.env.SP_E2E_ENGINE&&process.env.SP_E2E_ENGINE!==engine),timeout:120000,
},async()=>{
 const executablePath=engine==='chrome'?'/run/current-system/sw/bin/google-chrome-stable':'/run/current-system/sw/bin/firefox';assert.ok(existsSync(executablePath));
 const out=path.resolve(`.state/preparation-actions-20261107/${engine}`);mkdirSync(out,{recursive:true});
 const server=await startServer({host:'127.0.0.1',port:0,quiet:true,workers:0,userFile:':memory:',clientBuild:process.env.SP_E2E_BUILD==='1',assetIndex:false,announcementsFile:null});
 let browser,guest;const errors=[];
 try{
  browser=await puppeteer.launch({browser:engine,executablePath,headless:true,
   ...(engine==='firefox'?{extraPrefsFirefox:{'dom.ipc.processCount':2,'dom.ipc.processCount.webIsolated':1,'dom.ipc.processPrelaunch.enabled':false,'fission.autostart':false}}:{}),
   args:engine==='chrome'?['--no-sandbox','--mute-audio','--no-proxy-server','--enable-unsafe-swiftshader']:[]});
  const page=await browser.newPage();await localFontsOnly(page);page.on('pageerror',e=>errors.push(e.message));
  const request=(t,fields={})=>page.evaluate(({t,fields})=>window.__SP__.net.request(t,fields),{t,fields});
  const settle=()=>page.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime)&&!a.effect?.target?.closest?.('.ebubble'))a.finish();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  const chatGeometry=()=>page.evaluate(()=>{
   const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right};};
   const input=document.querySelector('.echat__input'),count=document.querySelector('.echat__count');
   return {dialog:rect(document.querySelector('.ewheel__dialog')),input:rect(input),count:rect(count),
    placeholder:input?.hasAttribute('placeholder'),triggerVisible:!!document.querySelector('.ewheel__btn').getBoundingClientRect().width,
    messageCounts:document.querySelectorAll('.echat__tab-count').length,
    tabs:[...document.querySelectorAll('.echat__tab')].map(e=>{const s=getComputedStyle(e);return {...rect(e),shadow:s.boxShadow,borders:[s.borderLeftWidth,s.borderRightWidth,s.borderTopWidth,s.borderBottomWidth]};})};
  });
  const checkChat=geometry=>{
   assert.equal(geometry.triggerVisible,true,'the floating window retains its communication trigger');
   assert.equal(geometry.placeholder,false);assert.equal(geometry.messageCounts,0);
   assert.equal(geometry.tabs.length,3);
   for(const tab of geometry.tabs){assert.ok(Math.abs(tab.w-tab.h)<1,'toolbar controls are square');assert.equal(tab.shadow,'none');assert.equal(new Set(tab.borders).size,1,'all button edges have equal thickness');}
   assert.ok(Math.abs(geometry.tabs[0].x-geometry.input.x)<1,'toolbar and input share the left edge');
   assert.ok(geometry.count.x>geometry.input.x&&geometry.count.right<geometry.input.right-3,'counter stays inside the right of the input');
  };
  await page.setViewport({width:1366,height:768});await page.goto(server.url,{waitUntil:'domcontentloaded'});await page.waitForSelector('.title-login input');await page.type('.title-login input','交流验证');await page.click('.title-login .btn--primary');await page.waitForSelector('.lobby-hub');
  await request('room.create',{mode:'coop',difficulty:'NORMAL'});await page.waitForSelector('.room-screen');const code=await page.evaluate(()=>window.__SP__.store.get().room.code);
  guest=await TestClient.connect(server.url.replace('http','ws')+'/ws');await guest.hello('测试队友');await guest.request({t:'room.join',code});await guest.request({t:'room.ready',ready:true});await request('room.start');await page.waitForSelector('.brief');
  const match=server.lobby.rooms.get(code).match;match.setDeadline(180,()=>{});match.markPublic();
  await guest.request({t:'g.chat',text:'请确认阵容后再开始'});await page.waitForFunction(()=>document.querySelector('.echat__history')?.textContent.includes('请确认阵容后再开始'));
  for(const [width,height] of [[1366,768],[844,390],[640,360]]){
   await page.setViewport({width,height});await settle();
   await page.type('.echat__input','等一下');await settle();const pinned=await chatGeometry();checkChat(pinned);
   await page.screenshot({path:path.join(out,`pinned-${width}.png`)});
   await page.click('.echat__pin');await page.waitForSelector('.ewheel__dialog',{hidden:true});
   await page.click('.ewheel__btn');await settle();const unpinned=await chatGeometry();checkChat(unpinned);
   for(const part of ['dialog','input','count'])for(const key of ['w','h'])assert.ok(Math.abs(pinned[part][key]-unpinned[part][key])<1,`${part} ${key} stays unchanged when unpinning`);
   assert.equal(await page.$eval('.echat__input',e=>e.value),'等一下','pinning preserves a draft');
   await page.screenshot({path:path.join(out,`unpinned-${width}.png`)});
   await page.click('[aria-label="表情"]');await settle();const emotes=await chatGeometry();
   assert.equal(emotes.input,null);assert.equal(emotes.count,null);assert.equal(await page.$('.echat__send'),null);
   for(const key of ['x','y','w','h'])assert.ok(Math.abs(unpinned.dialog[key]-emotes.dialog[key])<1,`dialog ${key} stays unchanged between messages and emotes`);
   await page.click('.echat__pin');await settle();const fixedEmotes=await chatGeometry();
   for(const key of ['w','h'])assert.equal(fixedEmotes.dialog[key],emotes.dialog[key],'pinning preserves the emote panel size');
   await page.screenshot({path:path.join(out,`emotes-${width}.png`)});
   await page.click('[aria-label="聊天历史"]');await page.click('.echat__pin');await settle();
   await page.click('.brief-bonds:first-child .brief-h');await page.waitForSelector('.ewheel__dialog',{hidden:true});
   await page.waitForSelector('.ewheel__btn',{visible:true});await page.click('.ewheel__btn');await settle();checkChat(await chatGeometry());
   await page.click('.echat__pin');await settle();
   await page.$eval('.echat__input',e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));});
  }
  for(const [width,height] of [[844,390],[740,360],[640,360],[844,240]]){
   await page.setViewport({width,height});await settle();await page.$eval('.brief__intel',e=>{e.scrollTop=e.scrollHeight;});await settle();
   const input=await page.$eval('.echat__input',e=>{const r=e.getBoundingClientRect();return{hit:e===document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),bottom:r.bottom};});await page.screenshot({path:path.join(out,`06-chat-${width}-${height}.png`)});assert.ok(input.hit&&input.bottom<=height,'fixed input survives independent intel scrolling '+JSON.stringify({width,height,input}));
   await page.screenshot({path:path.join(out,`06-chat-${width}-${height}.png`)});
  }
  await page.setViewport({width:844,height:390});await settle();await page.$eval('.echat__input',e=>e.focus());
  await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:200});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:24});visualViewport.dispatchEvent(new Event('resize'));});await settle();
  const keyboard=await page.$eval('.echat__input',e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,hit:e===document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)};});assert.ok(keyboard.hit&&keyboard.top>=24&&keyboard.bottom<=224,'keyboard leaves input visible');await page.screenshot({path:path.join(out,'07-chat-keyboard.png')});
  await page.evaluate(()=>{delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'));});await settle();
  await new Promise(resolve=>setTimeout(resolve,1050));await guest.request({t:'g.emote',id:EMOTES[0]});await page.waitForSelector('.communication-activity [data-emote]');
  await page.click('[data-testid="settings-btn"]');await page.waitForSelector('.settings-modal');await settle();
  assert.equal(await page.$eval('.echat-layer',e=>getComputedStyle(e).display),'none','settings hide the modeless chat window');await page.keyboard.press('Escape');
  // Reuse this disposable page as a new spectator identity. Firefox BiDi can send
  // keyboard actions to browser chrome when switching to a new private window.
  const context=browser.defaultBrowserContext(),watch=page;
  await watch.evaluate(()=>{localStorage.clear();sessionStorage.clear();});await context.deleteCookie(...await context.cookies());
  await watch.setViewport({width:844,height:390});await watch.goto(new URL(`/?spectate=${code}`,server.url).href,{waitUntil:'domcontentloaded'});await watch.waitForSelector('.title-login input');await watch.type('.title-login input','旁观验证');
  await watch.click('.title-login .btn--primary');await watch.waitForFunction(()=>!!window.__SP__?.store.get().match.public||!!window.__SP__?.store.get().ui.pendingJoinError);
  if(await watch.evaluate(()=>window.__SP__.store.get().ui.pendingJoinError?.code==='RATE')){await new Promise(resolve=>setTimeout(resolve,1100));await watch.click('[data-testid="invite-retry"]');}
  await watch.waitForSelector('.echat__input',{timeout:10000}).catch(async error=>{await watch.screenshot({path:path.join(out,'spectator-failure.png')});console.log(await watch.evaluate(()=>({phase:window.__SP__?.store.get().match.public?.phase,room:window.__SP__?.store.get().room,ui:window.__SP__?.store.get().ui,text:document.body.textContent.slice(-1800)})));throw error;});
  assert.equal(await watch.$eval('.echat__input',e=>e.disabled),true,'spectators cannot send');await watch.click('.echat__pin');await watch.click('.brief-bonds:first-child .brief-h');await watch.waitForSelector('.ewheel__dialog',{hidden:true});await watch.click('.ewheel__btn');assert.ok(await watch.$('.echat__history'),'spectators can reopen history');
  // The floating window leaves the battle corner's trigger and other controls reachable.
  await page.goto(`${server.url}/dev/game-mock.html?render=fallback&shot=1&phase=PREP`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__MOCK__&&window.__SP_VIEW__?.kind==='fallback');
  const cornerHeight=()=>page.$eval('.gm__corner',e=>e.getBoundingClientRect().height);
  for(const [width,height] of [[1366,768],[844,390],[640,360]]){
   await page.setViewport({width,height});await settle();const before=await cornerHeight();
   await page.click('.ewheel__btn');await page.click('[aria-label="聊天历史"]');await settle();checkChat(await chatGeometry());
   assert.ok(await cornerHeight()<=before,'the floating window does not reserve an extra row');
   assert.ok(await page.$$eval('.gm__corner>.gm__gear',es=>es.every(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})),'chat does not cover the other corner controls');
   await page.screenshot({path:path.join(out,`battle-${width}.png`)});
   await page.keyboard.press('Escape');await page.waitForSelector('.ewheel__dialog',{hidden:true});
   await page.waitForSelector('.ewheel__btn',{visible:true});
  }
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await guest?.close();await server.close();}
});
