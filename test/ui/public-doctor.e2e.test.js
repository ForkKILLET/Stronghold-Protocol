// Real accounts, recording and WebSocket room; isolated browser profiles, never production.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
import {makeMatch,legalTileFor} from '../match/harness.js';
import {TestClient} from '../helpers/wsClient.js';
import {formatDoctorId} from '../../shared/publicProfiles.js';
import {localFontsOnly} from '../helpers/localFonts.js';

function recording(cs){
 const h=makeMatch({mode:'coop',humans:2,difficulty:'NORMAL',instant:false,botRehearsal:0});
 h.m.replayMaxBytes=8*1024*1024;h.m.cs=cs;h.m.userMatchId=randomUUID();h.start();h.toPrep(1);
 const ps=h.ps('p_0');ps.funds=100;h.sched.advance(500);
 const slot=ps.shop.slots.findIndex(s=>s?.kind==='chess');assert.equal(h.m.handle(ps.playerId,{t:'g.buy',slot}).ok,true);
 h.sched.advance(500);const piece=ps.hand.find(Boolean),tile=legalTileFor(h.m,ps,piece.id);
 assert.equal(h.m.handle(ps.playerId,{t:'g.move',uid:piece.uid,to:{area:'board',row:tile[0],col:tile[1]}}).ok,true);
 h.sched.advance(500);assert.equal(h.m.handle(ps.playerId,{t:'g.freeze'}).ok,true);
 h.toPrep(2);h.m.finish({victory:false});const summary=h.ended;h.m.dispose();return summary;
}
for(const [engine,executablePath] of [['chrome','/run/current-system/sw/bin/google-chrome-stable'],['firefox','/run/current-system/sw/bin/firefox']])test(`${engine}: doctor privacy, anonymous links, teammate entry and public replay`,{
 skip:process.env.SP_E2E!=='1'||!existsSync(executablePath),timeout:180000,
},async()=>{
 const server=await startServer({host:'127.0.0.1',port:0,workers:0,userFile:':memory:',quiet:true,announcementsFile:null,clientBuild:process.env.SP_E2E_BUILD==='1'});
 const out=process.env.SP_E2E_OUT||'/tmp/sp-public-doctor';mkdirSync(out,{recursive:true});let browser,guest;
 try{
  browser=await puppeteer.launch({browser:engine,executablePath,headless:true,args:engine==='chrome'?['--no-sandbox','--mute-audio','--no-proxy-server','--use-angle=swiftshader']:[],extraPrefsFirefox:{'webgl.force-enabled':true}});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await localFontsOnly(page);
  await page.setViewport({width:1440,height:900});
  await page.evaluateOnNewDocument(()=>{localStorage.setItem('sp.name','档案测试博士');sessionStorage.setItem('sp.entered','1');});
  await page.goto(server.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__SP__?.store.get().connection.status==='online');
  const user=await page.evaluate(()=>JSON.parse(localStorage.getItem('sp.pref.doctorProfile')));
  assert.match(user.publicId,/^[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(await page.$eval('.app-header__identity .me-chip__id',e=>e.textContent),'ID '+formatDoctorId(user.publicId));
  assert.equal(await page.$$('.avatar__badge--self').then(rows=>rows.length),0);
  const other=await server.users.call('create');await server.users.call('rename',{id:other.user.id,name:'队友博士'});
  const summary=recording(server.content.cs),{replay,...frame}=summary;delete frame.players;
  await server.users.call('record',{id:summary.matchId,endedAt:Date.now(),mode:summary.modeId,difficulty:summary.difficulty,source:'server',replay,
   rows:summary.players.map((p,i)=>({userId:i?other.user.id:user.id,playerId:p.playerId,rounds:p.roundsPassed,victory:p.victory,payload:{...p,frame:{...frame,roomMode:'coop'}}}))});
  const settle=target=>target.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  const capture=async(target,label,selector)=>{
   await settle(target);await target.screenshot({path:path.join(out,engine+'-'+label+'.png')});
   const m=await target.$eval(selector,e=>{const r=e.getBoundingClientRect(),body=e.querySelector('.st-body');return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth,bodyOverflow:body?body.scrollWidth-body.clientWidth:0};});
   assert.ok(m.left>=-1&&m.top>=-1&&m.right<=m.width+1&&m.bottom<=m.height+1&&m.overflow<=1&&m.bodyOverflow<=1,JSON.stringify({label,m}));
   assert.ok(await target.$$eval(selector+' .app-header__identity',controls=>controls.every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})),'header identity/start action fits '+label);
  };
  await page.locator('.stats-entry').click();await page.locator('.st-tab[data-tab="privacy"]').click();await page.waitForSelector('[data-visibility="replays"]');
  assert.equal(await page.$$eval('[data-visibility][aria-checked="false"]',e=>e.length),5);await capture(page,'privacy-desktop','.st');
  await page.setViewport({width:844,height:390});await capture(page,'privacy-mobile','.st');
  await page.setViewport({width:1440,height:900});
  await page.locator('.doctor-share .btn--ghost').click();await page.waitForSelector('.public-doctor__private');
  await page.keyboard.press('Escape');await page.waitForSelector('.public-doctor',{hidden:true});
  assert.ok(await page.evaluate(()=>document.documentElement.classList.contains('sp-stats-open')),'public preview leaves the own archive overlay intact');
  const context=await browser.createBrowserContext(),visitor=await context.newPage(),requests=[];
  await localFontsOnly(visitor);
  visitor.on('pageerror',e=>errors.push(e.message));visitor.on('request',r=>requests.push(new URL(r.url()).pathname));
  await visitor.setViewport({width:1440,height:900});
  const sessions=[...server.registry.all()].length;
  const url=server.url+'/?doctor='+user.publicId;await visitor.goto(url,{waitUntil:'domcontentloaded'});
  await visitor.waitForSelector('.public-doctor__private');await capture(visitor,'private-preview','.public-doctor');
  assert.equal([...server.registry.all()].length,sessions,'anonymous archive has no game session');
  assert.equal(requests.includes('/api/user'),false,'anonymous archive does not create an account');
  assert.equal((await context.cookies()).some(c=>c.name==='sp_user'),false);
  await page.bringToFront();
  for(const key of ['trophies','achievements','statistics','history','replays']){
   await page.locator('[data-visibility="'+key+'"]').click();await page.waitForSelector('[data-visibility="'+key+'"][aria-checked="true"]');
  }
  await visitor.bringToFront();await visitor.reload({waitUntil:'domcontentloaded'});await visitor.waitForSelector('.public-doctor .st-cards');await capture(visitor,'public-overview','.public-doctor');
  await visitor.locator('.st-tab[data-tab="replays"]').click();await visitor.waitForSelector('.st-empty');assert.equal(await visitor.$$('.st-table tbody tr').then(rows=>rows.length),0,'global toggle never publishes an individual replay');
  await visitor.evaluate(()=>{
   const original=window.fetch;let history;
   window.__restoreDoctorFetch=()=>{window.fetch=original;delete window.__restoreDoctorFetch;delete window.__releaseHistory;};
   window.fetch=async(...args)=>{
    const request=new URL(args[0],location.href);
    if(request.pathname.startsWith('/api/doctors/')&&request.searchParams.get('section')==='history'){
     if(request.searchParams.has('before'))return new Promise(resolve=>{window.__releaseHistory=()=>resolve(Response.json(history));});
     const response=await original(...args);history={...await response.json(),next:'delayed-page'};return Response.json(history);
    }
    return original(...args);
   };
  });
  await visitor.locator('.st-tab[data-tab="history"]').click();await visitor.waitForSelector('.public-doctor .st-more .btn');
  await visitor.locator('.public-doctor .st-more .btn').click();await visitor.waitForFunction(()=>!!window.__releaseHistory);
  await visitor.locator('.st-tab[data-tab="replays"]').click();await visitor.waitForSelector('.public-doctor .st-empty');
  await visitor.evaluate(()=>window.__releaseHistory());await settle(visitor);
  assert.equal(await visitor.$$('.public-doctor .st-table tbody tr').then(rows=>rows.length),0,'late history pagination cannot replace the public replay list');
  await visitor.evaluate(()=>window.__restoreDoctorFetch());
  await page.bringToFront();await page.locator('.st-tab[data-tab="history"]').click();await page.waitForSelector('.st-history-actions');
  await page.locator('button[aria-label="对局操作"]').click();await page.waitForSelector('.doctor-replay-menu');
  await page.evaluate(()=>[...document.querySelectorAll('.doctor-replay-menu button')].find(e=>e.textContent.trim()==='设为公开').click());
  await page.waitForFunction(()=>[...document.querySelectorAll('.doctor-replay-menu button')].some(e=>e.textContent.trim()==='设为私密'&&!e.disabled));
  assert.ok(await page.$('.doctor-replay-menu'),'sharing keeps the menu open');await page.keyboard.press('Escape');await page.waitForSelector('.doctor-replay-menu',{hidden:true});
  await page.waitForSelector('.st-replay-marks svg[role=img] title');await page.waitForFunction(()=>[...document.querySelectorAll('.st-replay-marks title')].some(e=>e.textContent==='公开'));
  await visitor.bringToFront();await visitor.locator('.public-doctor .st-top__right .btn--ghost').click();await visitor.waitForSelector('.public-doctor .st-table .btn');
  await visitor.locator('.st-tab[data-tab="achievements"]').click();await visitor.waitForSelector('.ach-mark');await capture(visitor,'public-achievements','.public-doctor');
  await visitor.setViewport({width:844,height:390});await capture(visitor,'achievements-mobile','.public-doctor');
  await visitor.locator('.st-tab[data-tab="replays"]').click();await visitor.waitForSelector('.public-doctor .st-table .btn');await capture(visitor,'public-replays-mobile','.public-doctor');
  await visitor.setViewport({width:390,height:844});await capture(visitor,'public-replays-portrait','.public-doctor');
  await visitor.setViewport({width:1440,height:900});await visitor.locator('.public-doctor .st-table .btn').click();await visitor.waitForSelector('.doctor-replay-menu');
  assert.equal(await visitor.$$('.doctor-replay-menu button').then(els=>els.length),1,'public menu only offers playback');
  await visitor.locator('.doctor-replay-menu button').click();await visitor.waitForSelector('.st--playback');
  await visitor.waitForFunction(()=>document.querySelector('.replay-canvas')?.dataset.ready==='true',{timeout:30000});
  await visitor.locator('.replay-toolbar label:first-child .game-select').click();await visitor.waitForSelector('.game-select-popover');
  assert.equal(await visitor.$$eval('.game-select-popover [role="option"]',rows=>rows.length),1,'only the sharer has a private prep perspective');await visitor.keyboard.press('Escape');
  const prep=replay.events.find(e=>e.kind==='action'&&e.action==='g.freeze').at;
  await visitor.$eval('.replay-seek input',(e,at)=>{e.value=String(at);e.dispatchEvent(new Event('input',{bubbles:true}));},prep);
  await visitor.waitForFunction(()=>document.querySelector('.replay-canvas')?.dataset.mode==='prep');await capture(visitor,'public-replay-prep','.st--playback');
  await visitor.keyboard.press('Escape');await visitor.waitForSelector('.public-doctor');
  await visitor.goto(url+'&replay='+summary.matchId,{waitUntil:'domcontentloaded'});await visitor.waitForSelector('.st--playback');
  assert.equal(requests.includes('/api/user'),false,'direct replay links remain anonymous');
  await visitor.keyboard.press('Escape');await visitor.waitForSelector('.public-doctor');
  await page.bringToFront();await page.locator('button[aria-label="对局操作"]').click();await page.waitForSelector('.doctor-replay-menu');
  await page.evaluate(()=>[...document.querySelectorAll('.doctor-replay-menu button')].find(e=>e.textContent.trim()==='设为私密').click());
  await page.waitForFunction(()=>[...document.querySelectorAll('.doctor-replay-menu button')].some(e=>e.textContent.trim()==='设为公开'&&!e.disabled));
  assert.ok(await page.$('.doctor-replay-menu'),'revoking sharing keeps the menu open');await page.keyboard.press('Escape');await page.waitForSelector('.doctor-replay-menu',{hidden:true});
  assert.equal((await fetch(server.url+'/api/doctors/'+user.publicId+'/replay?matchId='+summary.matchId)).status,404);
  await page.locator('.st .app-back').click();await page.waitForSelector('.st',{hidden:true});
  await page.evaluate(()=>window.__SP__.net.request('room.create',{mode:'coop',difficulty:'NORMAL'}));await page.waitForSelector('.room-screen');
  const code=await page.evaluate(()=>window.__SP__.store.get().room.code);
  guest=await TestClient.connect(server.url.replace('http:','ws:')+'/ws',{wsOptions:{headers:{Cookie:'sp_user='+other.token}}});await guest.hello('队友博士');await guest.request({t:'room.join',code});
  await page.waitForSelector('.rseat:not(.is-me) .doctor-name-link');
  const seat=await page.evaluate(()=>window.__SP__.store.get().room.seats.find(s=>s?.name==='队友博士'));assert.equal(seat.publicId,other.user.publicId);assert.equal(seat.userId,undefined);
  await page.locator('.rseat:not(.is-me) .doctor-name-link').click();await page.waitForSelector('.public-doctor__private');
  assert.equal(await page.$eval('.public-doctor .doctor-identity h2',e=>e.textContent),'队友博士');await capture(page,'teammate-profile','.public-doctor');
  await page.locator('.public-doctor .stats-entry').click();await page.waitForSelector('.public-doctor',{hidden:true});
  assert.equal(await page.$eval('.st .doctor-identity h2',e=>e.textContent),'档案测试博士','global own-avatar entry leaves the peer archive');
  await page.keyboard.press('Escape');await page.waitForSelector('.st',{hidden:true});assert.ok(await page.$('.room-screen'));
  await page.locator('.rseat:not(.is-me) .doctor-name-link').click();await page.waitForSelector('.public-doctor');
  await guest.request({t:'room.ready',ready:true});await page.evaluate(()=>window.__SP__.net.request('room.start'));
  await page.waitForSelector('.public-doctor',{hidden:true});await page.waitForSelector('.brief');
  await page.evaluate(()=>window.__SP__.net.request('g.infoReady'));await guest.request({t:'g.infoReady'});await page.waitForSelector('.draft');
  await page.locator('.dorder .doctor-avatar-link[title*="队友博士"]').click();await page.waitForSelector('.public-doctor');
  await page.keyboard.press('Escape');await page.waitForSelector('.public-doctor',{hidden:true});assert.ok(await page.$('.draft'));
  assert.deepEqual(errors,[]);
 }finally{await guest?.close();await browser?.close();await server.close();}
});
