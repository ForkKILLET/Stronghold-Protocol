// Complete account history in a real draft; local records are only a storage-disabled fallback.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
import {buildRecord,STATS_VERSION} from '../../public/js/ui/stats.js';

test('desktop Firefox: draft counts use the account, survive pagination and never silently fall back after an error',{
 skip:process.env.SP_E2E!=='1',timeout:120000,
},async()=>{
 const options={host:'127.0.0.1',port:0,quiet:true,workers:0,assetIndex:false,announcementsFile:null,clientBuild:false};
 const server=await startServer({...options,userFile:':memory:'});
 let browser,localServer;const errors=[];
 try{
  const {user,token}=await server.users.call('create');
  for(let i=0;i<55;i++)await server.users.call('record',{id:'draft-win-'+i,endedAt:i,mode:'mode_single_hard',difficulty:'HARD',source:'server',
   rows:[{userId:user.id,playerId:'self',victory:true,rounds:14,payload:{bandId:'band_amiya',frame:{roomMode:'solo',modeId:'mode_single_hard'}}}]});
  const local=buildRecord({seed:901,victory:true,roundsPassed:14,difficulty:'HARD',modeId:'mode_single_hard',players:[{playerId:'self',bandId:'band_amiya',victory:true,alive:true,roundsPassed:14,stats:{}}]},{myId:'self',now:902});
  browser=await puppeteer.launch({browser:'firefox',executablePath:'/run/current-system/sw/bin/firefox',headless:true,
   extraPrefsFirefox:{'dom.ipc.processCount':2,'dom.ipc.processCount.webIsolated':1,'dom.ipc.processPrelaunch.enabled':false,'fission.autostart':false}});
  const context=await browser.createBrowserContext(),page=await context.newPage();
  await context.setCookie({name:'sp_user',value:token,domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Strict'});
  const prepare=async page=>{
   page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:3072,height:1800});
   await page.evaluateOnNewDocument(({local,v})=>{localStorage.setItem('sp.name','策略账户验证');sessionStorage.setItem('sp.entered','1');localStorage.setItem('sp.pref.stats',JSON.stringify({v,records:[local]}));},{local,v:STATS_VERSION});
  };
  await prepare(page);let failStats=false;
  await page.setRequestInterception(true);
  page.on('request',r=>{
   const url=new URL(r.url());
   if(url.hostname==='fonts.googleapis.com')void r.respond({status:200,contentType:'text/css',body:''}).catch(()=>{});
   else if(failStats&&url.pathname==='/api/user/stats')void r.respond({status:503,contentType:'application/json',body:'{"error":"UNAVAILABLE"}'}).catch(()=>{});
   else void r.continue().catch(()=>{});
  });
  const enter=async(page,url)=>{
   await page.goto(url,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.__SP__?.store.get().connection.status==='online');
   const req=(t,fields={})=>page.evaluate(({t,fields})=>window.__SP__.net.request(t,fields),{t,fields});
   await req('room.create',{mode:'solo',difficulty:'NORMAL'});await req('room.start');await page.waitForSelector('.brief');
   await req('g.infoReady');await page.waitForSelector('.draft');await page.click('.dband[data-band="band_amiya"]');
   await page.waitForSelector('.draft-detail[data-stats-status="ready"]');
  };
  await enter(page,server.url);
  assert.equal(await page.$eval('.draft-detail',e=>e.dataset.statsSource),'server');
  assert.match(await page.$eval('.draft-detail__medal',e=>e.textContent),/55/,'all history, not the page size or the one local win');
  assert.ok(await page.$('.dband[data-band="band_amiya"] [data-testid="band-badge"]'));
  const out=path.resolve('.state/draft-account-progress-20261108');mkdirSync(out,{recursive:true});
  const shot=async(page,name)=>{
   await page.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
   await page.screenshot({path:path.join(out,name+'.png')});
  };
  await shot(page,'server-55-wins');
  failStats=true;
  await page.evaluate(async()=>{const {profileStore}=await import('/js/ui/profile.js');profileStore.set({status:'offline'});});
  await page.waitForSelector('.draft-detail[data-stats-status="error"]');
  assert.equal(await page.$('.draft-detail__medal'),null,'a server error never shows the one local win');
  assert.equal(await page.$('.dband[data-band="band_amiya"] [data-testid="band-badge"]'),null,'old badges clear on failure');
  await shot(page,'server-error');failStats=false;
  await page.click('[aria-label="重新读取统计"]');await page.waitForSelector('.draft-detail[data-stats-status="ready"]');
  assert.match(await page.$eval('.draft-detail__medal',e=>e.textContent),/55/);
  const other=await server.users.call('create');
  await context.setCookie({name:'sp_user',value:other.token,domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Strict'});
  await page.evaluate(async()=>{const {initProfile}=await import('/js/ui/profile.js');await initProfile();});
  await page.waitForSelector('.draft-detail[data-stats-status="ready"]');
  assert.equal(await page.$('.draft-detail__medal'),null,'switching identity does not reuse previous account or device wins');
  await page.close();
  localServer=await startServer({...options,userFile:''});
  const localPage=await context.newPage();await prepare(localPage);
  await localPage.setRequestInterception(true);localPage.on('request',r=>{
   if(new URL(r.url()).hostname==='fonts.googleapis.com')void r.respond({status:200,contentType:'text/css',body:''}).catch(()=>{});
   else void r.continue().catch(()=>{});
  });
  await enter(localPage,localServer.url);
  assert.equal(await localPage.$eval('.draft-detail',e=>e.dataset.statsSource),'local');
  assert.match(await localPage.$eval('.draft-detail__medal',e=>e.textContent),/1/);
  assert.equal(await localPage.$eval('.draft-detail__medal',e=>e.title),'此设备记录');
  await shot(localPage,'storage-disabled-local');assert.deepEqual(errors,[]);
 }finally{await browser?.close();await localServer?.close();await server.close();}
});
