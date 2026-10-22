import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';

for(const [engine,executablePath] of [['chrome','/run/current-system/sw/bin/google-chrome-stable'],['firefox','/run/current-system/sw/bin/firefox']])test(`${engine}: duplicate profile invitation offers spectating`,{
 skip:process.env.SP_E2E!=='1'||!existsSync(executablePath),timeout:90000,
},async()=>{
 const out=process.env.SP_E2E_OUT||'/tmp/sp-account-seats';mkdirSync(out,{recursive:true});let server,browser;
 try{
  server=await startServer({port:0,host:'127.0.0.1',quiet:true,workers:0,userFile:':memory:',clientBuild:process.env.SP_E2E_BUILD==='1',assetIndex:false,announcementsFile:null,nameModeration:null});
  browser=await puppeteer.launch({browser:engine,executablePath,headless:true,args:engine==='chrome'?['--no-sandbox','--mute-audio','--no-proxy-server']:[]});
  const context=await browser.createBrowserContext(),errors=[];
  const open=async(query='')=>{
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1366,height:768});
   await page.evaluateOnNewDocument(()=>{localStorage.setItem('sp.name','同席验证');sessionStorage.setItem('sp.entered','1');});
   await page.goto(server.url+'/'+query,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.__SP__?.store.get().connection.status==='online');return page;
  };
  const first=await open();
  const code=await first.evaluate(async()=>{await window.__SP__.net.request('room.create',{mode:'coop',difficulty:'NORMAL'});return window.__SP__.store.get().room.code;});
  const second=await open(`?room=${code}`);
  await second.waitForSelector('[data-testid="invite-spectate"]');
  const capture=async(label)=>{
   await second.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();await new Promise(requestAnimationFrame);});
   await second.screenshot({path:path.join(out,`${engine}-${label}.png`)});
   assert.deepEqual(await second.$eval('.room-invite',e=>{const r=e.getBoundingClientRect();return{inside:r.top>=0&&r.bottom<=innerHeight+1&&r.left>=0&&r.right<=innerWidth+1,overflow:e.scrollWidth>e.clientWidth+1};}),{inside:true,overflow:false});
  };
  await capture('conflict-desktop');await second.setViewport({width:844,height:390});
  await second.evaluate(()=>{document.documentElement.dataset.text='xl';});await capture('conflict-mobile');
  await second.locator('[data-testid="invite-spectate"]').click();await second.waitForSelector('.room-screen');
  assert.ok(await second.evaluate(()=>{const s=window.__SP__.store.get();return s.room.spectators.some(p=>p.playerId===s.me.playerId)&&!s.room.seats.some(p=>p?.playerId===s.me.playerId);}));
  assert.ok(await first.evaluate(()=>{const s=window.__SP__.store.get();return s.room.seats.some(p=>p?.playerId===s.me.playerId);}));
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server?.close();}
});
