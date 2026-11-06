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
 const out=process.env.SP_E2E_OUT||path.resolve(`.state/preparation-ui-20261106/${engine}`);mkdirSync(out,{recursive:true});
 const server=await startServer({host:'127.0.0.1',port:0,quiet:true,workers:0,userFile:':memory:',assetIndex:false,announcementsFile:null,clientBuild:process.env.SP_E2E_BUILD==='1'});
 let browser;const guests=[],errors=[],observations=[];
 try{
  browser=await puppeteer.launch({browser:engine,executablePath,headless:true,
   ...(engine==='firefox'?{extraPrefsFirefox:{'dom.ipc.processCount':2,'dom.ipc.processCount.webIsolated':1,'dom.ipc.processPrelaunch.enabled':false,'fission.autostart':false}}:{}),
   args:engine==='chrome'?['--no-sandbox','--mute-audio','--no-proxy-server','--enable-unsafe-swiftshader']:[]});
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await localFontsOnly(page);
  const settle=()=>page.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  const click=async selector=>{await page.waitForSelector(selector,{visible:true});assert.equal((await page.$$(selector)).length,1,selector);await page.click(selector);await settle();};
  const request=(t,fields={})=>page.evaluate(({t,fields})=>window.__SP__.net.request(t,fields),{t,fields});
  const resize=async(width,height,text='md')=>{await page.setViewport({width,height,deviceScaleFactor:1});await page.evaluate(text=>{document.documentElement.dataset.text=text;dispatchEvent(new Event('resize'));},text);await settle();};
  const shot=async name=>{await settle();await page.screenshot({path:path.join(out,name+'.png')});};
  await resize(1440,900);await page.goto(server.url,{waitUntil:'domcontentloaded'});await page.waitForSelector('.title-login input');await page.type('.title-login input','开局界面验证');await click('.title-login .btn--primary');await page.waitForSelector('.lobby-hub');
  await request('room.create',{mode:'coop',difficulty:'ABYSS'});await page.waitForSelector('.room-screen');
  const code=await page.evaluate(()=>window.__SP__.store.get().room.code);
  for(const name of ['同盟队友甲','作战队友乙','较长昵称的同盟队友丙']){const c=await TestClient.connect(server.url.replace('http','ws')+'/ws');c.id=(await c.hello(name)).playerId;await c.request({t:'room.join',code});await c.request({t:'room.ready',ready:true});guests.push(c);}
  await request('room.start');await page.waitForSelector('.brief');
  const match=server.lobby.rooms.get(code).match;match.setDeadline(180,()=>{});match.markPublic();
  for(const [width,height,text] of [[1920,1080],[1440,900],[844,390],[640,360,'xl']]){
   await resize(width,height,text);await shot('01-brief-'+width);
   const geometry=await page.evaluate(()=>{
    const bounds=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,right:r.right};};
    const bonds=document.querySelector('.brief__bonds'),banned=document.querySelector('.brief-banned');
    return{bonds:bounds(bonds),banned:bounds(banned),dy:bonds.scrollHeight-bonds.clientHeight,
     boss:bounds(document.querySelector('.brief__intel>.brief-boss')),stage:bounds(document.querySelector('.brief__intel>.brief-stage')),
     footer:[...document.querySelectorAll('.brief__foot button')].filter(e=>!e.disabled).map(e=>{const b=bounds(e),hit=document.elementFromPoint(b.x+b.w/2,b.y+b.h/2);return{...b,text:e.textContent.trim(),hit:e.contains(hit)};})};
   });observations.push({width,height,text,brief:geometry});
   assert.ok(Math.abs(geometry.boss.w-geometry.stage.w)<2,'battlefield spans the intel column');
   if(width>=1440)assert.ok(geometry.dy<=2,'normal desktop shows the entire bond and banned section');
   for(const button of geometry.footer){assert.ok(button.hit,button.text+' reachable');assert.ok(button.bottom<=height+1,button.text+' inside viewport');}
  }
  await resize(844,390);await click('.brief-reroll__actions button');await page.waitForSelector('.brief-reroll--vote');await shot('02-reroll-vote');
  const voteId=await page.evaluate(()=>window.__SP__.store.get().match.public.rerollVote.id);
  assert.equal((await guests[0].request({t:'g.rerollVote',voteId,agree:false})).t,'ok');
  await page.waitForFunction(()=>!document.querySelector('.brief-reroll--vote'));
  await resize(1440,900);
  const headerBefore=await page.$eval('.stephead',e=>{const r=e.getBoundingClientRect();return{height:r.height,pauseX:e.querySelector('.draft-pause').getBoundingClientRect().x};});
  await request('g.infoReady');for(const c of guests)await c.request({t:'g.infoReady'});await page.waitForSelector('.draft');
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
   const actions=await page.$$eval('.draft-detail__btns .btn',es=>es.map(e=>{const r=e.getBoundingClientRect();return{y:r.y,h:r.height};}));assert.equal(actions.length,2);assert.ok(Math.abs(actions[0].y-actions[1].y)<1,'skip and confirm share a row');
  }
  await resize(1440,900);await page.mouse.move(0,0);await settle();
  const headerAfter=await page.$eval('.stephead',e=>{const r=e.getBoundingClientRect();return{height:r.height,pauseX:e.querySelector('.draft-pause').getBoundingClientRect().x};});
  assert.ok(Math.abs(headerBefore.height-headerAfter.height)<1,'both preparation steps use the same header height');assert.ok(Math.abs(headerBefore.pauseX-headerAfter.pauseX)<1,'pause stays aligned');
  const beforePick=await grid();await click('.draft-confirm');await page.waitForFunction(()=>!!window.__SP__.store.get().match.private.bandId);await page.mouse.move(0,0);await settle();
  unchanged(beforePick,await grid());assert.ok(await page.$('.draft-grid'));assert.equal(await page.$eval('.draft-confirm',e=>e.disabled),true);await shot('04-draft-own-confirmed');
  const teammate=guests.find(c=>c.id===match.publicView().draft.turn);assert.ok(teammate);
  const nextBand=await page.$eval('.dband:not(.is-mine):not(.is-taken)',e=>e.dataset.band);
  assert.equal((await teammate.request({t:'g.bandFocus',bandId:nextBand})).t,'ok');await page.waitForSelector(`[data-band="${nextBand}"].is-preview`);
  await click(`[data-band="${nextBand}"]`);await page.mouse.move(0,0);await settle();unchanged(beforePick,await grid());
  assert.equal((await teammate.request({t:'g.band',bandId:nextBand})).t,'ok');await page.waitForSelector(`[data-band="${nextBand}"].is-taken`);await settle();
  unchanged(beforePick,await grid());assert.equal(await page.$eval('.draft-confirm',e=>e.disabled),true);await shot('05-draft-teammate-confirmed');
  observations.push({draft:'stable across preview, own confirmation, teammate focus and teammate confirmation',headerBefore,headerAfter});
  assert.deepEqual(errors,[]);
 }finally{writeFileSync(path.join(out,'observations.json'),JSON.stringify({engine,errors,observations},null,2));await browser?.close();for(const c of guests)await c.close();await server.close();}
});
