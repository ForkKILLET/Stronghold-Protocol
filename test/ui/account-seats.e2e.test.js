import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
import {TestClient} from '../helpers/wsClient.js';

for(const [engine,executablePath] of [['chrome','/run/current-system/sw/bin/google-chrome-stable'],['firefox','/run/current-system/sw/bin/firefox']])test(`${engine}: duplicate profile invitation and visible host handoff`,{
 skip:process.env.SP_E2E!=='1'||!existsSync(executablePath),timeout:90000,
},async()=>{
 const out=process.env.SP_E2E_OUT||'/tmp/sp-account-seats';mkdirSync(out,{recursive:true});let server,browser,guest;
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
  // A real room role switch, including host handover and returning to the player seat.
  await first.bringToFront();
  const roomShot=async label=>{
   await first.bringToFront();
   await first.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();await new Promise(requestAnimationFrame);});
   await first.screenshot({path:path.join(out,`${engine}-${label}.png`)});
  };
  assert.ok(await first.$eval('[data-testid="room-spectate"]',b=>b.disabled),'last human cannot abandon the room');
  guest=await TestClient.connect(server.url.replace('http:','ws:')+'/ws');const welcome=await guest.hello('联机验证');
  await guest.request({t:'room.join',code});await first.waitForFunction(()=>!document.querySelector('[data-testid="room-spectate"]')?.disabled);
  await first.waitForFunction(()=>document.querySelectorAll('.rseat:not(.rseat--empty)').length===2);await roomShot('room-actions-desktop');
  await first.locator('[data-testid="room-spectate"]').click();await first.waitForSelector('.modal');
  assert.match(await first.$eval('.modal',e=>e.textContent),/创建者身份将移交/);
  await first.locator('.modal .btn--primary').click();await first.waitForSelector('.specbar__who.is-me');
  assert.equal(await first.evaluate(()=>window.__SP__.store.get().room.hostId),welcome.playerId);
  // Every observer must see exactly one host, and the promoted player must really own the controls.
  const visibleHost=async(page)=>{
   await page.bringToFront();
   await page.waitForFunction(()=>document.querySelector('.rseat.is-host .rseat__name')?.textContent==='联机验证');
   await page.evaluate(()=>{for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();});
   assert.equal(await page.$$eval('.rseat.is-host',rows=>rows.length),1);
   assert.ok(await page.$eval('.rseat__host',e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.width>0&&r.height>0&&!!hit&&(hit===e||e.contains(hit));}),'host badge is visible, not just present in the DOM');
   assert.match(await page.$eval('.toast-host',e=>e.textContent),/同盟创建者已变更为「联机验证」/);
   assert.ok(await page.$eval('.toast',e=>parseFloat(getComputedStyle(e).fontSize)>=13),'mobile host-change notice stays readable');
  };
  await visibleHost(first);await visibleHost(second);
  assert.equal((await guest.request({t:'room.setDifficulty',difficulty:'HARD'})).t,'ok');
  await first.waitForFunction(()=>window.__SP__.store.get().room.difficulty==='HARD');
  const oldHostError=await first.evaluate(async()=>{try{await window.__SP__.net.request('room.setDifficulty',{difficulty:'NORMAL'});}catch(e){return e.code;}});
  assert.equal(oldHostError,'NOT_HOST','the spectator cannot keep host controls');
  // The old fitter shrank 570–650px-high windows to 48–79px cards: badges spilled behind the next card.
  for(const [width,height] of [[1440,900],[1440,650],[1440,600],[1366,575],[1024,570],[760,570],[640,580],[561,570],[844,390],[390,844]]){
   await first.setViewport({width,height});await first.bringToFront();await new Promise(r=>setTimeout(r,120));
   await first.$eval('.rseat.is-host .rseat__host',e=>e.scrollIntoView({block:'nearest',inline:'nearest'}));
   const layout=await first.$eval('.rseat.is-host .rseat__host',e=>{
    const r=e.getBoundingClientRect(),p=e.closest('.rseat__plate').getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    const seats=document.querySelector('.seats').getBoundingClientRect(),footer=document.querySelector('.room-bar').getBoundingClientRect();
    return {visible:!!hit&&(hit===e||e.contains(hit)),inside:r.left>=p.left-1&&r.right<=p.right+1&&r.top>=p.top-1&&r.bottom<=p.bottom+1,overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight+1,seatsOverlapFooter:seats.bottom>footer.top+1};
   });
   assert.deepEqual(layout,{visible:true,inside:true,overflow:false,seatsOverlapFooter:false},`${width}×${height}: host marker stays inside its plate`);
   if(width===1440&&height===600)await roomShot('host-handoff-medium-height');
  }
  await first.setViewport({width:844,height:390});await roomShot('room-spectator-mobile');
  assert.ok(await first.$eval('[data-testid="room-sit"]',b=>{const r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;}),'mobile spectator action stays reachable');
  await first.locator('[data-testid="room-sit"]').click();await first.waitForFunction(()=>{const s=window.__SP__.store.get();return s.room.seats.some(p=>p?.playerId===s.me.playerId);});
  assert.equal(await first.evaluate(()=>window.__SP__.store.get().room.hostId),welcome.playerId,'sitting back does not reclaim host');
  assert.deepEqual(errors,[]);
 }finally{await guest?.close();await browser?.close();await server?.close();}
});
