// Local real recorder + SQLite + real playback, isolated headless browsers; never uses a player's Firefox profile.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
import {makeMatch,legalTileFor} from '../match/harness.js';

function recording(cs){
 const h=makeMatch({mode:'coop',humans:2,difficulty:'NORMAL',instant:false,botRehearsal:0});
 h.m.replayMaxBytes=8*1024*1024;h.m.cs=cs;h.m.userMatchId=randomUUID();h.start();h.toPrep(1);
 const ps=h.ps('p_0');ps.name='测试博士 · Replay';ps.funds=100;h.sched.advance(500);
 for(let i=0;i<2;i++){
  const slot=ps.shop.slots.findIndex(s=>s?.kind==='chess'&&!s.sold);
  assert.equal(h.m.handle('p_0',{t:'g.buy',slot}).ok,true);h.sched.advance(500);
  const piece=ps.hand.find(p=>p?.kind==='chess'),tile=legalTileFor(h.m,ps,piece.id);
  assert.equal(h.m.handle('p_0',{t:'g.move',uid:piece.uid,to:{area:'board',row:tile[0],col:tile[1]}}).ok,true);h.sched.advance(500);
 }
 assert.equal(h.m.handle('p_0',{t:'g.refresh'}).ok,true);h.sched.advance(500);
 assert.equal(h.m.handle('p_0',{t:'g.freeze'}).ok,true);h.sched.advance(500);
 h.toPrep(2);h.m.finish({victory:false});const summary=h.ended;h.m.dispose();return summary;
}

for(const [engine,executablePath] of [['chrome','/run/current-system/sw/bin/google-chrome-stable'],['firefox','/run/current-system/sw/bin/firefox']]){
 test(`${engine}: full prep timeline, private archive controls, battle replay and mobile geometry`,{
  skip:process.env.SP_E2E!=='1'||!existsSync(executablePath),timeout:180000,
 },async()=>{
  const srv=await startServer({host:'127.0.0.1',port:0,workers:0,userFile:':memory:',quiet:true,announcementsFile:null,clientBuild:process.env.SP_E2E_BUILD==='1'});
  const wire=[];srv.wss.on('connection',ws=>ws.on('message',bytes=>{try{const m=JSON.parse(bytes);if(/^(g\.|b\.)/.test(m.t))wire.push(m.t);}catch{}}));
  const out=new URL('../e2e/out/account-replays/',import.meta.url);mkdirSync(out,{recursive:true});let browser;
  try{
   const summary=recording(srv.content.cs),{replay,...frame}=summary;delete frame.players;
   writeFileSync(new URL('fixture.json',out),JSON.stringify(replay));
   browser=await puppeteer.launch({browser:engine,executablePath,headless:true,args:engine==='chrome'?['--no-sandbox','--no-proxy-server','--mute-audio','--use-angle=swiftshader']:[],extraPrefsFirefox:{'webgl.force-enabled':true}});
   const page=await browser.newPage(),errors=[],intents=[];
   page.on('pageerror',e=>errors.push(e.message));

   await page.setViewport({width:1440,height:900,hasTouch:engine==='chrome'});
   await page.goto(srv.url,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>!!localStorage.getItem('sp.pref.doctorProfile'));
   const id=await page.evaluate(()=>JSON.parse(localStorage.getItem('sp.pref.doctorProfile')).id);
   const other=(await srv.users.call('create')).user.id;
   await srv.users.call('record',{id:summary.matchId,endedAt:Date.now(),mode:summary.modeId,difficulty:summary.difficulty,source:'server',replay,rows:summary.players.map((p,i)=>({userId:i?other:id,playerId:p.playerId,rounds:p.roundsPassed,victory:p.victory,payload:{...p,frame:{...frame,roomMode:'coop'}}}))});
   await page.click('.stats-entry');await page.waitForSelector('.st-tab[data-tab=history]');await page.click('.st-tab[data-tab=history]');
   await page.waitForSelector('.st-replay-actions .btn');
   await page.screenshot({path:new URL(`${engine}-history.png`,out).pathname});
   await page.click('.st-replay-actions button[aria-label="回放操作"]');await page.waitForSelector('.doctor-replay-menu');
   await page.click('.doctor-replay-menu button[aria-pressed=false]');await page.waitForSelector('.doctor-replay-menu',{hidden:true});
   await page.click('.st-replay-actions button[aria-label="回放操作"]');await page.waitForSelector('.doctor-replay-menu button[aria-pressed=true]');
   await page.evaluate(async()=>{for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();await new Promise(requestAnimationFrame);});
   const buttons=await page.$$eval('.doctor-replay-menu > .btn',els=>els.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height};}));
   assert.ok(buttons.every(r=>Math.abs(r.left-buttons[0].left)<=1&&Math.abs(r.right-buttons[0].right)<=1&&r.height>=44),'menu buttons have matching edges and tappable height: '+JSON.stringify(buttons));
   await page.screenshot({path:new URL(`${engine}-replay-menu.png`,out).pathname});await page.keyboard.press('Escape');await page.waitForSelector('.doctor-replay-menu',{hidden:true});
   assert.equal(await page.$('.st--replay'),null,'pinning does not open settlement');
   wire.length=0;
   await page.click('.st-replay-actions button:first-child');await page.waitForSelector('.st--playback');
   await page.waitForFunction(()=>document.querySelector('.replay-canvas')?.dataset.ready==='true',{timeout:30000});
   const seek=async time=>{await page.$eval('.replay-seek input',(e,value)=>{e.value=String(value);e.dispatchEvent(new Event('input',{bubbles:true}));},time);};
   const prep=replay.events.find(e=>e.kind==='action'&&e.action==='g.freeze').at;
   await seek(Math.ceil(prep));await page.waitForFunction(()=>document.querySelector('.replay-canvas')?.dataset.mode==='prep');
   assert.ok(await page.$eval('.replay-prep',e=>e.innerText.includes('已冻结')));
   await page.screenshot({path:new URL(`${engine}-prep-desktop.png`,out).pathname});
   const battle=replay.fields.find(f=>f.kind==='normal');assert.ok(battle.end.time>2);
   await seek(battle.at+2000);
   await page.waitForFunction(()=>document.querySelector('.replay-canvas')?.dataset.mode==='battle'&&Number(document.querySelector('.replay-canvas').dataset.gt)>2,{timeout:30000});
   assert.equal(await page.$('.replay-field-status'),null,'actual sim and renderer loaded');
   await page.screenshot({path:new URL(`${engine}-battle-desktop.png`,out).pathname});
   const paused=await page.$eval('.replay-canvas',e=>Number(e.dataset.gt));
   await new Promise(r=>setTimeout(r,180));assert.equal(await page.$eval('.replay-canvas',e=>Number(e.dataset.gt)),paused);
   await page.click('.replay-controls .btn--primary');await new Promise(r=>setTimeout(r,300));await page.click('.replay-controls .btn--primary');
   assert.ok(await page.$eval('.replay-canvas',(e,old)=>Number(e.dataset.gt)>old,paused));
   await page.click('.replay-toolbar label:first-child .game-select');await page.waitForSelector('.game-select-popover');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
   await page.waitForFunction(()=>document.querySelector('.replay-canvas')?.dataset.field==='n:p_1');
   await seek(battle.at+800);await page.waitForFunction(()=>Number(document.querySelector('.replay-canvas')?.dataset.gt)<2);
   for(const [w,h] of [[844,390],[740,360]]){
    await page.setViewport({width:w,height:h,hasTouch:engine==='chrome'});await seek(Math.ceil(prep));await page.waitForFunction(()=>document.querySelector('.replay-canvas')?.dataset.mode==='prep');
    const geometry=await page.evaluate(()=>{const root=document.querySelector('.st--playback').getBoundingClientRect(),els=[...document.querySelectorAll('.replay-toolbar,.replay-main,.replay-prep,.replay-controls')].map(e=>e.getBoundingClientRect().toJSON());return {root:root.toJSON(),els,overflow:document.documentElement.scrollWidth>innerWidth};});
    assert.equal(geometry.overflow,false);for(const r of geometry.els){assert.ok(r.top>=geometry.root.top-1);assert.ok(r.bottom<=geometry.root.bottom+1);assert.ok(r.width>0&&r.height>0);}
    for(let i=1;i<geometry.els.length;i++)assert.ok(geometry.els[i].top>=geometry.els[i-1].bottom-1,'panels do not overlap');
    await page.screenshot({path:new URL(`${engine}-prep-${w}.png`,out).pathname});
   }
   await page.keyboard.press('Escape');await page.waitForSelector('.st--playback',{hidden:true});await page.waitForSelector('.st-replay-actions');
   intents.push(...wire);
   assert.deepEqual(intents,[]);assert.deepEqual(errors,[]);
  }finally{await browser?.close();await srv.close();}
 });
}
