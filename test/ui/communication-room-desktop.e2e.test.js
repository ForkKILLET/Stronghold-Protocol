// Desktop-only visual regression, using the local Firefox binary and disposable accounts.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
import {TestClient} from '../helpers/wsClient.js';
import {localFontsOnly} from '../helpers/localFonts.js';

test('desktop Firefox: alliance cards, shared preparation HUD and stable chat / strategy layout',{
 skip:process.env.SP_E2E!=='1',timeout:90000,
},async()=>{
 const out=path.resolve('.state/communication-room-20261107');mkdirSync(out,{recursive:true});
 const server=await startServer({host:'127.0.0.1',port:0,quiet:true,workers:0,userFile:':memory:',assetIndex:false,announcementsFile:null,clientBuild:process.env.SP_E2E_BUILD==='1'});
 let browser;const guests=[],errors=[],observations=[];
 try{
  browser=await puppeteer.launch({browser:'firefox',executablePath:'/run/current-system/sw/bin/firefox',headless:true,
   extraPrefsFirefox:{'dom.ipc.processCount':2,'dom.ipc.processCount.webIsolated':1,'dom.ipc.processPrelaunch.enabled':false,'fission.autostart':false,'ui.primaryPointerCapabilities':6,'ui.allPointerCapabilities':6}});
  const page=await browser.newPage();await localFontsOnly(page);page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:3072,height:1800,deviceScaleFactor:1});
  const settle=()=>page.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime)&&!a.effect?.target?.closest?.('.ebubble'))a.finish();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  const shot=async name=>{await settle();await page.screenshot({path:path.join(out,name+'.png')});};
  const request=(t,fields={})=>page.evaluate(({t,fields})=>window.__SP__.net.request(t,fields),{t,fields});
  const checkHud=async stage=>{
   await settle();
   assert.equal(await page.$('.brief>.app-header,.draft>.app-header'),null,'preparation has no second navigation band');
   const geometry=await page.$eval('.preparation-hud',e=>{
    const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
    return{header:rect(e),left:rect(e.querySelector('.gtop__left')),middle:rect(e.querySelector('.stephead__middle')),right:rect(e.querySelector('.stephead__right')),exit:rect(e.querySelector('.gtop__exit')),pause:rect(e.querySelector('.pausebtn'))};
   });observations.push({stage,geometry});
   assert.ok(geometry.header.h<180,'a single HUD band replaces both preparation headers');
   assert.ok(geometry.left.right+4<=geometry.middle.x&&geometry.middle.right+4<=geometry.right.x,'corner controls and step / decision stay separate');
   const controls=await page.$$eval('.preparation-tools__actions button',es=>es.map(e=>{const r=e.getBoundingClientRect();return{label:e.getAttribute('aria-label'),disabled:e.disabled,w:r.width,h:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};}));
   assert.deepEqual(controls.map(e=>e.label),['作战统计','设置','玩法说明','全屏']);
   assert.equal(controls[0].disabled,true,'combat metrics are unavailable before combat');
   assert.ok(controls.every(e=>Math.abs(e.w-e.h)<1&&e.hit),'all four square tools remain reachable below chat');
   const content=await page.$eval('.brief__intel,.draft-order__rows',e=>({bottom:e.getBoundingClientRect().bottom,scroll:e.scrollHeight>e.clientHeight,overflow:getComputedStyle(e).overflowY}));
   const chat=await page.$eval('.communication-dock',e=>e.getBoundingClientRect().top);
   assert.ok(content.bottom<=chat,'chat has its own reserved space below the independently scrolling information');
   assert.equal(content.overflow,'auto');
   await page.hover('.preparation-tools [aria-label="设置"]');await settle();
   assert.ok(await page.$eval('.preparation-tools [aria-label="设置"]',e=>{
    const r=e.getBoundingClientRect();
    for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();
     if((s.overflowX!=='visible'&&(r.left-4<b.left-.5||r.right+4>b.right+.5))||(s.overflowY!=='visible'&&(r.top-4<b.top-.5||r.bottom+4>b.bottom+.5)))return false;}
    return true;
   }),'corner button hover brackets fit within clipping ancestors');
   await page.click('.preparation-tools [aria-label="设置"]');await page.waitForSelector('.modal');
   await page.keyboard.press('Escape');await page.waitForSelector('.modal',{hidden:true});
   await page.click('.preparation-tools [aria-label="玩法说明"]');await page.waitForSelector('.guide');
   await page.keyboard.press('Escape');await page.waitForSelector('.guide',{hidden:true});
   await page.click('.gtop__exit');await page.waitForSelector('.modal');await page.keyboard.press('Escape');await page.waitForSelector('.modal',{hidden:true});
   await page.click('.preparation-hud .pausebtn');await page.waitForFunction(()=>window.__SP__.store.get().match.public.pauseRequests.includes(window.__SP__.store.get().me.playerId));
   await page.click('.preparation-hud .pausebtn');await page.waitForFunction(()=>!window.__SP__.store.get().match.public.pauseRequests.includes(window.__SP__.store.get().me.playerId));
   return geometry;
  };
  const checkChat=async name=>{
   await settle();const geometry=await page.evaluate(()=>{
    const dialog=document.querySelector('.ewheel__dialog'),input=dialog.querySelector('.echat__input'),tab=dialog.querySelector('.echat__tab');
    const r=dialog.getBoundingClientRect(),i=input.getBoundingClientRect(),t=tab.getBoundingClientRect();
    return{width:r.width,height:r.height,inset:t.left-r.left,inputInset:i.left-r.left,hit:input===document.elementFromPoint(i.x+i.width/2,i.y+i.height/2),paddings:['.echat__tabs','.echat__history-pane','.echat'].map(s=>parseFloat(getComputedStyle(dialog.querySelector(s)).paddingLeft))};
   });observations.push({name,...geometry});
   assert.equal(geometry.width,288,'all desktop preparation and battle chat panes use the same fixed width');
   assert.ok(geometry.hit,'input remains reachable');assert.ok(geometry.inset>=8,'tools have breathing room');
   assert.ok(Math.abs(geometry.inset-geometry.inputInset)<1,'tools and input stay aligned');assert.ok(geometry.paddings.every(n=>n>=8));
   await page.type('.echat__input','稍等一下');await page.click('.echat__pin');
   await page.waitForSelector('.ewheel__dialog',{hidden:true});await page.waitForSelector('.ewheel__btn',{visible:true});
   assert.match(await page.$eval('.ewheel__btn',e=>getComputedStyle(e).backgroundColor),/^rgb\(/,'communication trigger is opaque');
   await page.click('.ewheel__btn');await settle();
   assert.equal(await page.$eval('.echat__input',e=>e.value),'稍等一下','unpinning preserves the unsent message');
   assert.equal(await page.$eval('.echat__pin',e=>e.getAttribute('aria-pressed')),'false');
   await page.click('.echat__pin');await settle();
   assert.equal(await page.$eval('.echat__pin',e=>e.getAttribute('aria-pressed')),'true');
   await shot(name);return geometry;
  };
  await page.goto(server.url,{waitUntil:'domcontentloaded'});await page.waitForSelector('.title-login input');
  await page.type('.title-login input','交流布局验证');await page.click('.title-login .btn--primary');await page.waitForSelector('.lobby-hub');
  await request('room.create',{mode:'coop',difficulty:'NORMAL'});await page.waitForSelector('.room-screen');
  const code=await page.evaluate(()=>window.__SP__.store.get().room.code);
  for(const name of ['同盟队友甲','同盟队友乙','同盟队友丙']){
   const c=await TestClient.connect(server.url.replace('http','ws')+'/ws');c.id=(await c.hello(name)).playerId;await c.request({t:'room.join',code});await c.request({t:'room.ready',ready:true});guests.push(c);
  }
  await page.waitForFunction(()=>document.querySelectorAll('.rseat:not(.rseat--empty)').length===4);await settle();
  await page.waitForFunction(()=>document.querySelector('[data-testid="preparation-ready"] .brief-ready__txt b')?.textContent==='4');
  assert.equal(await page.$$eval('[data-testid="preparation-ready"] .brief-ready__pips i.on',es=>es.length),4);
  assert.equal(await page.$eval('.room-screen',e=>e.textContent.includes('人数达标')),false);
  const cards=await page.$$eval('.rseat',es=>es.map(e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top};}));
  observations.push({cards,viewport:3072});assert.equal(cards.length,4);assert.ok(Math.abs((cards[0].left+cards[3].right)/2-1536)<1,'four cards are centered on the whole page');
  assert.ok(cards.every(c=>Math.abs(c.top-cards[0].top)<1));
  await shot('01-room-empty');await (await page.$('.ewheel__dialog')).screenshot({path:path.join(out,'02-chat-empty.png')});
  await page.setViewport({width:1440,height:900,deviceScaleFactor:1});await settle();
  const narrow=await page.$$eval('.rseat',es=>es.map(e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top};}));
  assert.ok(Math.abs((narrow[0].left+narrow[3].right)/2-720)<1);assert.ok(narrow.every(c=>Math.abs(c.top-narrow[0].top)<1),'desktop cards keep one row');
  assert.ok(narrow[0].left>=await page.$eval('.room-communication',e=>e.getBoundingClientRect().right),'reserved chat does not cover cards');
  await shot('01-room-1440');await page.setViewport({width:3072,height:1800,deviceScaleFactor:1});await settle();
  await guests[0].request({t:'room.chat',text:'看一下阵容再开始'});await page.waitForFunction(()=>document.querySelector('.echat__history')?.textContent.includes('看一下阵容再开始'));
  await checkChat('03-room-chat');
  await request('room.start');await page.waitForSelector('.brief');
  const match=server.lobby.rooms.get(code).match;match.setDeadline(180,()=>{});match.markPublic();
  const briefHud=await checkHud('briefing');
  const brief=await checkChat('04-briefing-chat');
  await page.setViewport({width:1440,height:900,deviceScaleFactor:1});await checkHud('briefing-1440');await shot('04-briefing-1440');
  await page.setViewport({width:3072,height:1800,deviceScaleFactor:1});await settle();
  await page.click('[aria-label="表情"]');await settle();
  assert.ok(Math.abs(await page.$eval('.ewheel__dialog',e=>e.getBoundingClientRect().height)-brief.height)<1,'switching modes preserves the outer height');
  await page.click('[aria-label="聊天历史"]');
  await request('g.infoReady');for(const c of guests)await c.request({t:'g.infoReady'});await page.waitForSelector('.draft');
  const draftHud=await checkHud('strategy');
  assert.equal(await page.$('.draft .stephead__status,.draft .preparation-hud [data-testid="match-info-open"],.draft__link,[data-testid="draft-tip"]'),null,'strategy header and left column omit duplicate cues and decoration');
  assert.ok(await page.$('.draft-detail__btns [data-testid="match-info-open"]'),'match information joins the right-hand actions');
  assert.ok(Math.abs(briefHud.header.h-draftHud.header.h)<1,'step changes preserve header height');
  for(const control of ['exit','pause'])for(const axis of ['x','y','w','h'])assert.ok(Math.abs(briefHud[control][axis]-draftHud[control][axis])<1,'pause and exit stay in the same slots');
  assert.equal(await page.$$eval('.draft-order .dorder__idx',es=>es.length),4,'compact order rows restore their order numbers');
  assert.equal(await page.$('.draft-order .dorder__art'),null,'order rows no longer use the expanded portrait treatment');
  assert.ok(await page.$eval('.draft-grid',e=>getComputedStyle(e).display==='grid'&&getComputedStyle(e).gridTemplateColumns.split(/\s+/).length>=3),'the strategy wall retains its multiple columns');
  assert.ok(await page.$('.draft-detail__hp .lp--lg .lp__icon'),'initial HP uses the shared tower icon');
  assert.ok(await page.$eval('.draft-detail__overview',e=>{const a=e.querySelector('.draft-detail__art').getBoundingClientRect(),h=e.querySelector('.draft-detail__hp').getBoundingClientRect();return Math.abs(a.x+a.width/2-h.x-h.width/2)<1;}),'initial HP stays centered below the strategy artwork');
  const detailStyle=await page.evaluate(()=>{
   const info=getComputedStyle(document.querySelector('[data-testid="match-info-open"]')),eff=getComputedStyle(document.querySelector('.draft-detail__eff')),card=getComputedStyle(document.querySelector('.draft-detail'));
   return{infoBorders:[info.borderTopWidth,info.borderRightWidth,info.borderBottomWidth,info.borderLeftWidth],introBackground:eff.backgroundColor,introBorders:[eff.borderTopWidth,eff.borderRightWidth,eff.borderBottomWidth,eff.borderLeftWidth],cardBackground:card.backgroundImage};
  });observations.push({detailStyle});
  assert.ok(detailStyle.infoBorders.every(w=>w==='1px'),'match info keeps the standard button border');
  assert.equal(detailStyle.introBackground,'rgba(0, 0, 0, 0)');assert.ok(detailStyle.introBorders.every(w=>w==='0px'));
  assert.match(detailStyle.cardBackground,/rgba\(20, 30, 26, 0\.9\)/,'detail card uses the pre-merge dark gradient');
  await page.click('[data-testid="match-info-open"]');await page.waitForSelector('.minfo-dlg');await page.keyboard.press('Escape');await page.waitForSelector('.minfo-dlg',{hidden:true});
  const checkActions=async()=>{
   const layout=await page.$eval('.draft-detail',e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),buttons=[...e.querySelectorAll('.draft-detail__btns .btn')].map(b=>{const r=b.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,w:r.width,h:r.height,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});return{gaps:[buttons[0].x-r.left-parseFloat(s.borderLeftWidth),...buttons.slice(1).map((b,i)=>b.x-buttons[i].right),r.right-buttons.at(-1).right-parseFloat(s.borderRightWidth)],buttons};});
   observations.push({actions:layout});assert.equal(layout.buttons.length,3);
   assert.ok(layout.gaps.every(g=>Math.abs(g-layout.gaps[0])<1),'all three actions and detail edges share one spacing');
   assert.ok(layout.buttons.every(b=>Math.abs(b.h-layout.buttons[0].h)<1&&Math.abs(b.y-layout.buttons[0].y)<1&&b.hit),'match info, skip and confirm are aligned and reachable');
   assert.ok(Math.abs(layout.buttons[0].w-layout.buttons[0].h)<1,'information uses a compact square button');
  };
  await checkActions();
  await checkChat('05-strategy-chat');
  // Both desktop sizes keep the corners, chat and wall reachable, including after our pick.
  await page.setViewport({width:1440,height:900,deviceScaleFactor:1});await checkHud('strategy-1440');await checkActions();await shot('05-strategy-1440');
  const myId=await page.evaluate(()=>window.__SP__.store.get().me.playerId);
  while(match.publicView().draft.turn!==myId){const c=guests.find(c=>c.id===match.publicView().draft.turn);assert.ok(c);await c.request({t:'g.bandSkip'});}
  await page.waitForFunction(()=>!document.querySelector('.draft-confirm')?.disabled);await settle();
  const wall=()=>page.$$eval('.dband',es=>es.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};}));
  const beforePick=await wall();await page.click('.draft-confirm');await page.waitForFunction(()=>!!window.__SP__.store.get().match.private.bandId);await settle();assert.deepEqual(await wall(),beforePick);
  const teammate=guests.find(c=>c.id===match.publicView().draft.turn),nextBand=await page.$eval('.dband:not(.is-mine):not(.is-taken)',e=>e.dataset.band);
  await teammate.request({t:'g.bandFocus',bandId:nextBand});await page.waitForSelector(`[data-band="${nextBand}"].is-preview`);await page.click(`[data-band="${nextBand}"]`);await page.mouse.move(0,0);await settle();assert.deepEqual(await wall(),beforePick);
  await teammate.request({t:'g.band',bandId:nextBand});await page.waitForSelector(`[data-band="${nextBand}"].is-taken`);await settle();assert.deepEqual(await wall(),beforePick);
  assert.equal(await page.$eval('.draft-confirm',e=>e.disabled),true,'viewing a teammate never changes our confirmed choice');await shot('05-strategy-confirmed-1440');
  await page.setViewport({width:3072,height:1800,deviceScaleFactor:1});
  await page.goto(server.url+'/dev/game-mock.html?render=fallback&shot=1&phase=PREP',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.gm__corner .ewheel__btn');await page.click('.gm__corner .ewheel__btn');await page.waitForSelector('.echat__pin');
  await page.click('.echat__pin');await page.click('[aria-label="聊天历史"]');await checkChat('06-battle-chat');
  assert.ok(await page.$$eval('.gm__corner>.gm__gear',es=>es.every(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})),'expanded chat leaves corner actions reachable');
  assert.deepEqual(errors,[]);
 }finally{writeFileSync(path.join(out,'observations.json'),JSON.stringify({errors,observations},null,2));await browser?.close();for(const c of guests)await c.close();await server.close();}
});
