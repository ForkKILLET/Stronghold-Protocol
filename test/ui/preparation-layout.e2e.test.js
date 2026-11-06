// Real local room; bounded by check:local. No production sessions or user browser profiles.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,existsSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
import {TestClient} from '../helpers/wsClient.js';
import {localFontsOnly} from '../helpers/localFonts.js';

for(const engine of ['chrome','firefox'])test(`${engine}: preparation layout and actions remain usable`,{
 skip:process.env.SP_E2E!=='1'||(process.env.SP_E2E_ENGINE&&process.env.SP_E2E_ENGINE!==engine),timeout:120000,
},async()=>{
 const executablePath=engine==='chrome'?'/run/current-system/sw/bin/google-chrome-stable':'/run/current-system/sw/bin/firefox';
 assert.ok(existsSync(executablePath));
 const out=process.env.SP_E2E_OUT||path.resolve(`.state/preparation-matching-style-20261107/${engine}`);mkdirSync(out,{recursive:true});
 const server=await startServer({host:'127.0.0.1',port:0,quiet:true,workers:0,userFile:':memory:',assetIndex:false,announcementsFile:null,clientBuild:process.env.SP_E2E_BUILD==='1'});
 let browser;const guests=[],errors=[],observations=[];
 try{
  // Advertise mouse capabilities without changing app CSS. Some headless Chromium
  // builds still report no hover; verify the same bracket bounds via keyboard focus there.
  // Chromium: microsoft/playwright src/server/chromium/chromium.ts headless flags.
  // Gecko: widget/LookAndFeel.h Fine=2 | Hover=4, nsXPLookAndFeel.cpp ui prefs.
  browser=await puppeteer.launch({browser:engine,executablePath,headless:true,
   ...(engine==='firefox'?{extraPrefsFirefox:{'dom.ipc.processCount':2,'dom.ipc.processCount.webIsolated':1,'dom.ipc.processPrelaunch.enabled':false,'fission.autostart':false,'ui.primaryPointerCapabilities':6,'ui.allPointerCapabilities':6}}:{}),
   args:engine==='chrome'?['--no-sandbox','--mute-audio','--no-proxy-server','--enable-unsafe-swiftshader','--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4']:[]});
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await localFontsOnly(page);
  const settle=()=>page.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  const click=async selector=>{await page.waitForSelector(selector,{visible:true});assert.equal((await page.$$(selector)).length,1,selector);await page.click(selector);await settle();};
  const request=(t,fields={})=>page.evaluate(({t,fields})=>window.__SP__.net.request(t,fields),{t,fields});
  const resize=async(width,height,text='md')=>{await page.setViewport({width,height,deviceScaleFactor:1});await page.evaluate(text=>{document.documentElement.dataset.text=text;dispatchEvent(new Event('resize'));},text);await settle();};
  const shot=async name=>{await settle();await page.screenshot({path:path.join(out,name+'.png')});};
  const sizes=[[1920,1080],[1440,900],[844,390],[640,360,'xl']],roomActions=new Map();
  const actionStyles=selector=>page.$$eval(selector,es=>es.map(e=>{
   const s=getComputedStyle(e),icon=e.querySelector('.btn__icon,.lo-entry__icon'),i=icon&&getComputedStyle(icon);
   return {height:s.height,minWidth:s.minWidth,font:s.fontSize,padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft],gap:s.gap,spacing:s.letterSpacing,color:s.color,background:s.backgroundColor,border:s.borderColor,icon:i&&[i.width,i.height]};
  }));
  await resize(1440,900);await page.goto(server.url,{waitUntil:'domcontentloaded'});await page.waitForSelector('.title-login input');await page.type('.title-login input','开局界面验证');await click('.title-login .btn--primary');await page.waitForSelector('.lobby-hub');
  await request('room.create',{mode:'solo',difficulty:'NORMAL'});await page.waitForSelector('.room-screen');
  for(const [width,height] of [[1440,900],[844,390],[640,360]]){
   await resize(width,height);await shot('00-solo-room-'+width);
   const body=await page.$eval('.seats--solo',e=>{const r=e.getBoundingClientRect(),brief=e.querySelector('.solo-brief').getBoundingClientRect();return{overflow:e.scrollWidth-e.clientWidth,right:r.right,briefRight:brief.right};});
   assert.ok(body.overflow<=2&&body.briefRight<=body.right+1,'solo room fits beside pinned communication '+JSON.stringify({width,body}));
  }
  await click('.echat__pin');await click('.app-header__title');
  await click('.app-back');await page.waitForSelector('.lobby-hub');await resize(1440,900);
  await request('room.create',{mode:'coop',difficulty:'ABYSS'});await page.waitForSelector('.room-screen');
  const code=await page.evaluate(()=>window.__SP__.store.get().room.code);
  for(const name of ['同盟队友甲','作战队友乙','较长昵称的同盟队友丙']){const c=await TestClient.connect(server.url.replace('http','ws')+'/ws');c.id=(await c.hello(name)).playerId;await c.request({t:'room.join',code});await c.request({t:'room.ready',ready:true});guests.push(c);}
  await page.waitForSelector('.echat__history');
  for(const [width,height,text] of sizes){
   await resize(width,height,text);await page.mouse.move(0,0);await settle();await shot('00-room-pinned-'+width);
   roomActions.set(width,await actionStyles('.room-loadout,.room-bar__right .btn--primary'));
   assert.equal(roomActions.get(width).length,2,'matching reference includes loadout and start');
  }
  await click('.echat__pin');await click('.app-header__title');
  await request('room.start');await page.waitForSelector('.brief');
  assert.equal(await page.$('.ewheel__dialog'),null,'manual closure survives the room / briefing transition');
  await click('.brief .ewheel__btn');await click('.echat__pin');
  assert.ok(await page.$('.brief .communication-dock.is-pinned'));
  await guests[0].request({t:'g.chat',text:'先看禁用盟约再准备'});await page.waitForFunction(()=>document.querySelector('.echat__history')?.textContent.includes('先看禁用盟约再准备'));
  await page.type('.echat__input','收到，稍等一下');await click('.echat__send');await page.waitForFunction(()=>document.querySelector('.echat__history')?.textContent.includes('收到，稍等一下'));
  await click('.brief .brief-bonds:first-child .brief-h');assert.ok(await page.$('.ewheel__dialog'),'outside click keeps pinned messages');
  const match=server.lobby.rooms.get(code).match;match.setDeadline(180,()=>{});match.markPublic();
  for(const [width,height,text] of sizes){
   await resize(width,height,text);await shot('01-brief-'+width);
   await page.mouse.move(0,0);await settle();
   const actions=await actionStyles('.brief-loadout,.brief-go');
   observations.push({width,roomActions:roomActions.get(width),briefActions:actions});
   assert.deepEqual(actions,roomActions.get(width),'confirmation actions match room size, spacing, colors and icons');
   assert.equal(await page.$$eval('.brief-bond .bond__ban',es=>es.length),0,'no second generic ban marker');
   assert.ok(await page.$$eval('.brief-bond__ban',es=>es.length>0&&es.every(e=>Number(e.textContent)>0)),'keep nonzero banned-member counts');
   const geometry=await page.evaluate(()=>{
    const bounds=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,right:r.right};};
    const bonds=document.querySelector('.brief__bonds'),banned=document.querySelector('.brief-banned');
    return{bonds:bounds(bonds),banned:bounds(banned),dy:bonds.scrollHeight-bonds.clientHeight,
     right:bounds(document.querySelector('.brief__right')),tools:bounds(document.querySelector('.brief__tools')),go:bounds(document.querySelector('.brief-go')),
     boss:bounds(document.querySelector('.brief__intel>.brief-boss')),stage:bounds(document.querySelector('.brief__intel>.brief-stage')),
     footer:[...document.querySelectorAll('.brief__foot button')].filter(e=>!e.disabled).map(e=>{const b=bounds(e),s=getComputedStyle(e),hit=document.elementFromPoint(b.x+b.w/2,b.y+b.h/2);return{...b,text:e.textContent.trim(),hit:e.contains(hit),font:s.fontSize,paddingX:[s.paddingLeft,s.paddingRight],animation:s.animationName};})};
   });observations.push({width,height,text,brief:geometry});
   assert.ok(Math.abs(geometry.boss.w-geometry.stage.w)<2,'battlefield spans the intel column');
   if(width>=1440)assert.ok(geometry.dy<=2,'normal desktop shows the entire bond and banned section');
   for(const button of geometry.footer){assert.ok(button.hit,button.text+' reachable');assert.ok(button.bottom<=height+1,button.text+' inside viewport');}
   assert.ok(Math.abs(geometry.tools.x-geometry.right.x)<1,'tools align with the left edge of the bond column');
   for(const button of geometry.footer)assert.ok(Math.abs(button.h-geometry.go.h)<1,button.text+' has the ready button height');
   for(const button of geometry.footer)assert.ok(Math.abs(button.y-geometry.go.y)<1,'normal opening actions share one row');
   assert.equal(new Set(geometry.footer.map(b=>b.font)).size,1,'all opening action fonts match');
   assert.equal(new Set(geometry.footer.map(b=>b.paddingX.join('/'))).size,1,'all opening action horizontal padding matches');
   assert.equal(geometry.footer[0].animation,geometry.footer[1].animation,'loadout and reroll share the entrance animation');
   assert.notEqual(geometry.footer[1].animation,'none','reroll has an entrance animation');
   for(const selector of ['.brief-loadout','.brief-reroll__start','.brief-go']){
    const activation=await page.evaluate(()=>matchMedia('(hover: hover)').matches)?'hover':'focus';
    if(activation==='hover')await page.hover(selector);
    else {
     await page.mouse.move(0,0);await page.focus(selector);
     await page.keyboard.press('Tab');await page.keyboard.down('Shift');
     try{await page.keyboard.press('Tab');}finally{await page.keyboard.up('Shift');}
     assert.equal(await page.$eval(selector,e=>e.matches(':focus-visible')),true,'keyboard makes the same bracket geometry visible');
    }
    await page.waitForFunction(selector=>getComputedStyle(document.querySelector(selector),'::after').opacity==='1',{timeout:3000},selector);await settle();
    const hover=await page.$eval(selector,e=>{
     const r=e.getBoundingClientRect(),after=getComputedStyle(e,'::after'),clipped=[];
     for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();
      if((s.overflowX!=='visible'&&(r.left-4<b.left-.5||r.right+4>b.right+.5))||(s.overflowY!=='visible'&&(r.top-4<b.top-.5||r.bottom+4>b.bottom+.5)))clipped.push(p.className||p.tagName);}
     return {clipped,opacity:after.opacity,hovered:e.matches(':hover'),hoverMedia:matchMedia('(hover: hover)').matches,disabled:e.disabled};
    });
    observations.push({width,selector,activation,hover});
    if(hover.opacity!=='1')await shot('hover-failure-'+width);
    assert.equal(hover.opacity,'1','hover brackets are visible '+JSON.stringify(hover));assert.deepEqual(hover.clipped,[],selector+' hover fits ancestor clipping bounds');
    if(width===1440||width===640)await shot(activation+'-'+selector.slice(1)+'-'+width);
   }
   await page.mouse.move(0,0);await settle();
   assert.equal(await page.$eval('.brief-reroll__actions button',e=>e.classList.contains('btn--danger')),true,'reroll uses the shared danger style');
   assert.ok(await page.$('.brief .communication-dock.is-pinned'));
   const chat=await page.$eval('.echat__input',e=>{const r=e.getBoundingClientRect();return{visible:e===document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),bottom:r.bottom};});assert.ok(chat.visible,'pinned input is not clipped');assert.ok(chat.bottom<=height);
  }
  await resize(844,390);await click('.brief-reroll__actions button');await page.waitForSelector('.brief-reroll--vote');
  for(const [width,height] of [[844,390],[640,360]]){
   await resize(width,height);await shot('02-reroll-vote-'+width);
   assert.ok(await page.$$eval('.brief__foot button',es=>es.filter(e=>!e.disabled).every(e=>{const r=e.getBoundingClientRect();return r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})),'all vote actions remain reachable in the bond column');
   assert.ok(await page.$eval('.brief__foot',e=>Math.abs(e.querySelector('.brief__tools').getBoundingClientRect().bottom-e.querySelector('.brief-go').getBoundingClientRect().bottom)<1),'ready aligns with the bottom row of vote actions');
  }
  const voteId=await page.evaluate(()=>window.__SP__.store.get().match.public.rerollVote.id);
  assert.equal((await guests[0].request({t:'g.rerollVote',voteId,agree:false})).t,'ok');
  await page.waitForFunction(()=>!document.querySelector('.brief-reroll--vote'));
  await resize(1440,900);
  const headerBefore=await page.$eval('.stephead',e=>{const r=e.getBoundingClientRect();return{height:r.height,pauseX:e.querySelector('.draft-pause').getBoundingClientRect().x};});
  await request('g.infoReady');for(const c of guests)await c.request({t:'g.infoReady'});await page.waitForSelector('.draft');
  assert.ok(await page.$('.draft .communication-dock.is-pinned'),'pin survives the briefing / strategy transition');
  await click('.echat-window [aria-label="表情"]');await page.waitForFunction(()=>![...document.querySelectorAll('.ewheel__item')].some(e=>e.disabled));
  await click('.ewheel__item:first-child');assert.ok(await page.$('.ewheel__dialog'),'sending an emote keeps the pin');await click('.echat-window [aria-label="聊天历史"]');await page.waitForSelector('.communication-activity',{hidden:true});
  const myId=await page.evaluate(()=>window.__SP__.store.get().me.playerId);
  // Rotate earlier teammates to the end using their real skip allowance, so our
  // confirmation necessarily leaves teammates still choosing.
  while(match.publicView().draft.turn!==myId){const c=guests.find(c=>c.id===match.publicView().draft.turn);assert.ok(c);assert.equal((await c.request({t:'g.bandSkip'})).t,'ok');}
  await page.waitForFunction(()=>!document.querySelector('.draft-confirm')?.disabled);
  const grid=()=>page.evaluate(()=>({scroll:document.querySelector('.draft-grid').scrollTop,cards:[...document.querySelectorAll('.dband')].map(e=>{const r=e.getBoundingClientRect();return{id:e.dataset.band,x:r.x,y:r.y,w:r.width,h:r.height};})}));
  const unchanged=(a,b)=>{assert.equal(a.scroll,b.scroll,'grid scroll position');assert.equal(a.cards.length,b.cards.length);for(let i=0;i<a.cards.length;i++)for(const key of ['x','y','w','h'])assert.ok(Math.abs(a.cards[i][key]-b.cards[i][key])<1,`${a.cards[i].id} ${key} stays fixed`);};
  for(const [width,height,text] of [[1440,900],[844,390],[640,360,'xl']]){
   await resize(width,height,text);await page.mouse.move(0,0);await settle();
   await page.waitForFunction(()=>document.querySelector('.draft-detail__name')?.textContent.trim()==='华法琳');
   const initial=await grid();await shot('03-draft-default-'+width);
   const alternative=await page.$eval('.dband:not([data-band="band_bldsk"])',e=>e.dataset.band);
   await click(`[data-band="${alternative}"]`);await page.mouse.move(0,0);await settle();unchanged(initial,await grid());
   await click('[data-band="band_bldsk"]');await page.mouse.move(0,0);await settle();unchanged(initial,await grid());
   assert.equal(await page.$('.dband__selmark'),null);
   const actions=await page.$$eval('.draft-detail__btns .btn',es=>es.map(e=>{const r=e.getBoundingClientRect();return{y:r.y,h:r.height};}));assert.equal(actions.length,3);assert.ok(actions.every(a=>Math.abs(a.y-actions[0].y)<1),'information, skip and confirm share a row');
  }
  await resize(1440,900);await page.mouse.move(0,0);await settle();
  const headerAfter=await page.$eval('.stephead',e=>{const r=e.getBoundingClientRect();return{height:r.height,pauseX:e.querySelector('.draft-pause').getBoundingClientRect().x};});
  assert.ok(Math.abs(headerBefore.height-headerAfter.height)<1,'both preparation steps use the same header height');assert.ok(Math.abs(headerBefore.pauseX-headerAfter.pauseX)<1,'pause stays aligned');
  const beforePick=await grid();await click('.draft-confirm');await page.waitForFunction(()=>!!window.__SP__.store.get().match.private.bandId);await page.mouse.move(0,0);await settle();
  unchanged(beforePick,await grid());assert.ok(await page.$('.draft-grid'));assert.equal(await page.$eval('.draft-confirm',e=>e.disabled),true);await shot('04-draft-own-confirmed');
  const ownFocus=match.publicView().draft.focus[myId];
  const teammate=guests.find(c=>c.id===match.publicView().draft.turn);assert.ok(teammate);
  const nextBand=await page.$eval('.dband:not(.is-mine):not(.is-taken)',e=>e.dataset.band);
  assert.equal((await teammate.request({t:'g.bandFocus',bandId:nextBand})).t,'ok');await page.waitForSelector(`[data-band="${nextBand}"].is-preview`);
  await click(`[data-band="${nextBand}"]`);await page.mouse.move(0,0);await settle();unchanged(beforePick,await grid());
  assert.equal((await teammate.request({t:'g.band',bandId:nextBand})).t,'ok');await page.waitForSelector(`[data-band="${nextBand}"].is-taken`);await settle();
  unchanged(beforePick,await grid());assert.equal(await page.$eval('.draft-confirm',e=>e.disabled),true);await shot('05-draft-teammate-confirmed');
  assert.equal(match.publicView().draft.picks[myId],'band_bldsk','browsing after confirmation cannot change our authoritative pick');
  assert.equal(match.publicView().draft.focus[myId],ownFocus,'browsing after confirmation does not publish another preview');
  observations.push({draft:'stable across preview, own confirmation, teammate focus and teammate confirmation',headerBefore,headerAfter});
  assert.deepEqual(errors,[]);
 }finally{writeFileSync(path.join(out,'observations.json'),JSON.stringify({engine,errors,observations},null,2));await browser?.close();for(const c of guests)await c.close();await server.close();}
});
