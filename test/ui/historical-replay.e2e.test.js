// Public historical replays must work in an independent tab, with HTTP only and no account / WS connection.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
import {makeMatch,legalTileFor} from '../match/harness.js';
import {localFontsOnly} from '../helpers/localFonts.js';

for(const [engine,executablePath] of [['chrome','/run/current-system/sw/bin/google-chrome-stable'],['firefox','/run/current-system/sw/bin/firefox']]){
 test(`${engine}: shared historical replay loads its rules and restores default data without joining the game`,{
  skip:process.env.SP_E2E!=='1'||!existsSync(executablePath),timeout:120000,
 },async()=>{
  const srv=await startServer({host:'127.0.0.1',port:0,workers:0,userFile:':memory:',quiet:true,assetIndex:false,announcementsFile:null,clientBuild:process.env.SP_E2E_BUILD==='1'});
  let browser,sockets=0;srv.wss.on('connection',()=>sockets++);
  try{
   const version='act1autochess',cs=srv.versions.csOf(version),h=makeMatch({data:srv.versions.data(version),version,mode:'coop',humans:2,instant:false});
   h.m.replayMaxBytes=8*1024*1024;h.m.cs=cs;h.m.userMatchId=randomUUID();h.start();h.toPrep(1);
   const ps=h.ps('p_0');ps.funds=100;h.sched.advance(500);
   const slot=ps.shop.slots.findIndex(s=>s?.kind==='chess'&&!s.sold);assert.equal(h.m.handle('p_0',{t:'g.buy',slot}).ok,true);
   h.sched.advance(500);const piece=ps.hand.find(p=>p?.kind==='chess'),tile=legalTileFor(h.m,ps,piece.id);
   assert.equal(h.m.handle('p_0',{t:'g.move',uid:piece.uid,to:{area:'board',row:tile[0],col:tile[1]}}).ok,true);
   h.toPrep(2);h.m.finish({victory:false});const summary=h.ended;h.m.dispose();
   assert.equal(summary.replay.version,version);
   const created=await srv.users.call('create'),{user}=created,{replay,...frame}=summary;delete frame.players;
   await srv.users.call('record',{id:summary.matchId,endedAt:Date.now(),mode:summary.modeId,difficulty:summary.difficulty,version,source:'server',replay,
    rows:[{userId:user.id,playerId:'p_0',rounds:summary.players[0].roundsPassed,victory:false,payload:{...summary.players[0],version,frame:{...frame,roomMode:'coop'}}}]});
   await srv.users.call('visibility',{id:user.id,visibility:{replays:true}});
   await srv.users.call('shareReplay',{id:user.id,matchId:summary.matchId,shared:true});
   for(const url of [`/api/user/replay?matchId=${summary.matchId}`,`/api/doctors/${user.publicId}/replay?matchId=${summary.matchId}`]){
    const response=await fetch(srv.url+url,{headers:{Cookie:'sp_user='+created.token}});
    assert.equal(response.status,200);assert.equal(response.headers.get('x-sp-replay-content'),cs);await response.arrayBuffer();
   }
   browser=await puppeteer.launch({browser:engine,executablePath,headless:true,args:engine==='chrome'?['--no-sandbox','--no-proxy-server','--mute-audio','--use-angle=swiftshader']:[]});
   const page=await browser.newPage(),errors=[],privateRequests=[];page.on('pageerror',e=>errors.push(e.message));
   if(engine==='chrome')await localFontsOnly(page);
   page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/user'))privateRequests.push(r.url());});
   await page.goto(`${srv.url}/?doctor=${user.publicId}&replay=${summary.matchId}`,{waitUntil:'domcontentloaded'});
   await page.setViewport({width:1366,height:768});
   try{await page.waitForFunction(()=>document.querySelector('.replay-canvas')?.dataset.ready==='true',{timeout:45000});}
   catch(error){console.error('Historical replay failed',{url:page.url(),errors,cause:error.cause,body:await page.evaluate(()=>document.body.innerText).catch(()=>null)});throw error;}
   await page.waitForFunction(()=>document.querySelector('.replay-canvas')?.dataset.mode==='prep');
   assert.equal(await page.evaluate(()=>window.__SP__.data.get('config')?.version?.id),version);
   const out=new URL('../e2e/out/historical-replay/',import.meta.url);mkdirSync(out,{recursive:true});
   await page.screenshot({path:new URL(`${engine}-prep.png`,out).pathname});
   const battle=replay.fields.find(f=>f.kind==='normal');assert.ok(battle);
   await page.$eval('.replay-seek input',(e,at)=>{e.value=String(at);e.dispatchEvent(new Event('input',{bubbles:true}));},battle.at+2000);
   await page.waitForFunction(()=>document.querySelector('.replay-canvas')?.dataset.mode==='battle'||document.querySelector('p.replay-field-status'),{timeout:30000});
   assert.equal(await page.$eval('.replay-field',e=>e.querySelector('p.replay-field-status')?.textContent || ''),'');
   assert.equal(await page.$eval('.replay-canvas',e=>e.dataset.mode),'battle');
   await page.waitForFunction(()=>Number(document.querySelector('.replay-canvas')?.dataset.gt)>2);
   await page.screenshot({path:new URL(`${engine}-battle.png`,out).pathname});
   await page.keyboard.press('Escape');await page.waitForSelector('.st--playback',{hidden:true});
   await page.waitForFunction(()=>window.__SP__.data.get('config')?.version?.id!=='act1autochess');
   assert.equal(sockets,0);assert.deepEqual(privateRequests,[]);assert.deepEqual(errors,[]);
  }finally{await browser?.close();await srv.close();}
 });
}
