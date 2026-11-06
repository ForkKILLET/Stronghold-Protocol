// Desktop Firefox regression: non-host readiness, settlement corners and the actual full CSS stack at boot.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
import {TestClient} from '../helpers/wsClient.js';
import {localFontsOnly} from '../helpers/localFonts.js';

test('desktop Firefox: preparation and settlement controls, unclipped protocol caption',{
 skip:process.env.SP_E2E!=='1',timeout:90000,
},async()=>{
 const baseline=process.env.SP_UI_BASELINE==='1';
 const out=path.resolve(`.state/desktop-polish-20261107/${baseline?'before':'after'}`);mkdirSync(out,{recursive:true});
 const server=await startServer({host:'127.0.0.1',port:0,quiet:true,workers:0,userFile:':memory:',assetIndex:false,announcementsFile:null,clientBuild:process.env.SP_E2E_BUILD==='1'});
 let browser,host;const errors=[],observations={};
 try{
  browser=await puppeteer.launch({browser:'firefox',executablePath:'/run/current-system/sw/bin/firefox',headless:true,
   extraPrefsFirefox:{'dom.ipc.processCount':2,'dom.ipc.processCount.webIsolated':1,'dom.ipc.processPrelaunch.enabled':false,'fission.autostart':false,'ui.primaryPointerCapabilities':6,'ui.allPointerCapabilities':6}});
  const page=await browser.newPage();await page.setViewport({width:3072,height:1800,deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(e.message));await localFontsOnly(page);
  const settle=()=>page.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  const shot=async name=>{await settle();await page.screenshot({path:path.join(out,name+'.png')});};
  const request=(t,fields={})=>page.evaluate(({t,fields})=>window.__SP__.net.request(t,fields),{t,fields});
  await page.goto(server.url,{waitUntil:'domcontentloaded'});await page.waitForSelector('.title-login input');
  await page.type('.title-login input','桌面界面验证');await page.click('.title-login .btn--primary');await page.waitForSelector('.lobby-hub');
  host=await TestClient.connect(server.url.replace('http','ws')+'/ws');await host.hello('本机房主');
  await host.request({t:'room.create',mode:'coop',difficulty:'NORMAL'});const room=await host.waitFor('room.state');
  await request('room.join',{code:room.code});await page.waitForSelector('.room-screen .rs-go');await shot('room-unready');
  observations.unready=await page.$eval('.rs-go',e=>{const s=getComputedStyle(e);return{classes:e.className,height:s.height,color:s.color,background:s.backgroundColor,border:s.borderStyle};});
  if(!baseline){assert.match(observations.unready.classes,/btn--primary/);assert.equal(observations.unready.height,'48px');}
  await page.click('.rs-go');await page.waitForFunction(()=>window.__SP__.store.get().room.seats.some(p=>p?.playerId===window.__SP__.store.get().me.playerId&&p.ready));
  await shot('room-ready');
  if(!baseline)assert.ok(await page.$('.rs-go.is-active'),'the active state remains styled and can be toggled');
  await page.click('.rs-go');await page.waitForFunction(()=>window.__SP__.store.get().room.seats.some(p=>p?.playerId===window.__SP__.store.get().me.playerId&&!p.ready));
  await page.click('.room-screen .app-back');await page.waitForSelector('.lobby-hub');
  const fixtures=JSON.parse(readFileSync(new URL('../fixtures/stats-results.json',import.meta.url),'utf8'));
  await page.evaluate(res=>{const s=window.__SP__.store.get();res.players[0].playerId=s.me.playerId;window.__SP__.store.set({match:{...s.match,public:{...res,phase:'RESULT'},result:res}});},fixtures['coop4-hard']);
  await page.waitForSelector('[data-testid="settle-intro"]');await page.click('[data-testid="settle-intro"]');await page.waitForSelector('.sself');await shot('settlement-self');
  await page.click('.settle__next');await page.waitForSelector('.steam');await shot('settlement-team');
  observations.corners=await page.$$eval('.tcard__rounds,.tchip,.steam__row',es=>es.map(e=>({class:e.className,radius:getComputedStyle(e).borderRadius})));
  if(!baseline){assert.ok(observations.corners.length>=10);assert.ok(observations.corners.every(e=>e.radius==='0px'));}
  // Render the real boot component against all of the app's styles, not a reduced CSS fixture.
  await page.evaluate(async()=>{
   const {h,render}=await import('/vendor/preact.module.js');const {data}=await import('/js/data.js');await data.loadAll('assets');
   const {ProtocolBoot}=await import('/js/ui/protocolBoot.js');const root=document.createElement('div');document.body.append(root);
   render(h(ProtocolBoot,{players:[{playerId:'a',name:'博士甲'},{playerId:'b',name:'博士乙'}],myId:'a'}),root);
  });
  await page.waitForSelector('.pboot__sub');await shot('protocol-boot');
  observations.caption=await page.$eval('.pboot__sub',e=>{
   const r=e.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(e);const text=range.getBoundingClientRect(),s=getComputedStyle(e);
   return{box:{top:r.top,bottom:r.bottom,left:r.left,right:r.right},text:{top:text.top,bottom:text.bottom,left:text.left,right:text.right},font:s.fontSize,lineHeight:s.lineHeight,padding:s.padding};
  });
  if(!baseline){const {box,text}=observations.caption;assert.ok(text.top>=box.top-1&&text.bottom<=box.bottom+1,'caption line fits its background');assert.ok(box.bottom<=1800&&text.left>=box.left-1&&text.right<=box.right+1);}
  assert.deepEqual(errors,[]);
 }finally{writeFileSync(path.join(out,'observations.json'),JSON.stringify({errors,observations},null,2));await browser?.close();await host?.close();await server.close();}
});
