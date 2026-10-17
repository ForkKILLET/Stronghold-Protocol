// Opt-in browser regression for navigation across route/overlay boundaries. No production server is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';
const chrome=process.env.CHROME_PATH || '/run/current-system/sw/bin/google-chrome-stable';
test('shared navigation, latency width, overlay return and pre-game pause survive the complete start flow', {
  skip:process.env.SP_E2E!=='1'||!existsSync(chrome), timeout:120000,
}, async()=>{
 const server=await startServer({port:0,host:'127.0.0.1',quiet:true,workers:0,clientBuild:false});let browser;
 try {
  browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--mute-audio','--enable-unsafe-swiftshader']});
  const page=await browser.newPage();await page.setViewport({width:1366,height:768});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const click=async(selector)=>{await page.locator(selector).click();};
  const text=async(label)=>{await page.waitForFunction(label=>[...document.querySelectorAll('button')].some(e=>e.textContent.trim()===label&&!e.disabled),{},label);await page.evaluate(label=>[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===label&&!e.disabled).click(),label);};
  let tools;const geometry=new Map();
  const header=async(root)=>{
   const snapshot=await page.waitForFunction(root=>{
    const e=document.querySelector(root+' .app-header');
    const row=e?.querySelector('.app-header__row')?.getBoundingClientRect();
    if(!row||Math.abs(row.width-innerWidth)>=3)return false;
    const h=e.querySelector('.app-header__heading'),r=h?.getBoundingClientRect();
    return {
     view:[innerWidth,innerHeight],height:row.height,positions:[...e.querySelectorAll('.app-back,.latency-pill,.online-count,.topbar-announcement,.app-header__tools button,.app-header__identity')].filter(b=>b.offsetWidth).map(b=>{const r=b.getBoundingClientRect();return[r.x,r.y,r.width,r.height];}),
     width:row.width,ping:e.querySelector('.latency-pill').getBoundingClientRect().width,
     tools:[...e.querySelectorAll('.app-header__tools button')].map(b=>b.getAttribute('aria-label')||b.title),
     archive:!!e.querySelector('.stats-entry'),online:!!e.querySelector('.online-count'),
     heading:r?{center:r.x+r.width/2,font:parseFloat(getComputedStyle(h.querySelector('h1')).fontSize)}:null,
    };
   },{},root);
   const result=await snapshot.jsonValue();await snapshot.dispose();
   const key=result.view.join('x');
   if(!geometry.has(key))geometry.set(key,result);else {const base=geometry.get(key);assert.equal(result.height,base.height,root+' header height');assert.deepEqual(result.positions,base.positions,root+' shared controls moved');}
   if(!tools)tools=result.tools;else assert.deepEqual(result.tools,tools);
   assert.ok(Math.abs(result.width-(await page.viewport()).width)<3,JSON.stringify(result));
   if(result.heading){assert.ok(Math.abs(result.heading.center-(await page.viewport()).width/2)<2,JSON.stringify(result.heading));assert.ok(result.heading.font>=25);}
   assert.equal(result.ping,78);assert.equal(result.archive,true);assert.equal(result.online,true);
  };
  await page.goto(server.url,{waitUntil:'networkidle0'});await page.type('.title-screen input','导航验证');await text('开始');await header('.lobby-hub');
  const radar=await page.$eval('.hub-radar',e=>{const r=e.getBoundingClientRect(),s=document.querySelector('.hub-stage').getBoundingClientRect();return{top:r.top,bottom:r.bottom,stageTop:s.top,stageBottom:s.bottom};});
  assert.ok(radar.top>=radar.stageTop&&radar.bottom<=radar.stageBottom,JSON.stringify(radar));
  await click('.hub-plate--sweep');await header('.sweep-host');assert.equal(await page.$('.sw-info'),null);
  await click('.sweep-host .app-header [aria-label="玩法说明"]');await page.waitForSelector('.guide');await page.keyboard.press('Escape');await page.waitForSelector('.guide',{hidden:true});await header('.sweep-host');
  await click('.sweep-host .app-back');await header('.lobby-hub');
  await click('.lo-entry');await header('.lo');await click('.lo .app-back');await page.waitForSelector('.lo',{hidden:true});
  await click('.lobby-hub .stats-entry');await header('.st');await click('.st .app-back');await page.waitForSelector('.st',{hidden:true});
  await page.evaluate(()=>[...document.querySelectorAll('.hub-entry')].find(e=>e.textContent.includes('创建同盟')).click());await header('.protocol-screen');
  await click('.proto-start');await header('.room-screen');
  assert.equal(await page.$('.rseat__doc'),null);
  await page.waitForSelector('.rseat__strip .rseat__pick');await page.mouse.move(5,150);
  const editStyle=()=>page.$eval('.rseat__pick',e=>[getComputedStyle(e).borderColor,getComputedStyle(e).backgroundColor]);
  const idle=await editStyle();await page.hover('.rseat.is-me .rseat__art');
  await new Promise(r=>setTimeout(r,180));assert.deepEqual(await editStyle(),idle,'portrait hover does not activate edit');
  await page.hover('.rseat__pick');await new Promise(r=>setTimeout(r,180));assert.notDeepEqual(await editStyle(),idle);
  const actionSizes=await page.$$eval('.room-config-summary > button,.room-bar__right button',els=>els.map(e=>[e.getBoundingClientRect().height,getComputedStyle(e).fontSize,getComputedStyle(e).padding]));
  for(const size of actionSizes)assert.deepEqual(size,actionSizes[0],'room actions share height, font and padding');
  const keyBox=await page.$eval('.room-invitation',e=>{const code=e.querySelector('.invite__code span');return{insideHeader:!!e.closest('.app-header'),font:parseFloat(getComputedStyle(code).fontSize),buttons:[...e.querySelectorAll('button')].map(b=>b.getBoundingClientRect().height)};});
  assert.equal(keyBox.insideHeader,false);assert.ok(keyBox.font>=28);assert.ok(keyBox.buttons.every(h=>h>=36));
  const roomCode=await page.evaluate(async()=>{const{store}=await import('/js/store.js');return store.get().room.code;});
  await text('调整配置');await header('.room-options-screen');await text('时长倍率');
  await click('.room-options-screen .stats-entry');await header('.st');await click('.st .app-back');await page.waitForSelector('.st',{hidden:true});
  assert.equal(await page.$eval('.prep-setting input',e=>e.value),'2','configuration draft survives archive');
  await click('.room-options-screen .app-back');await header('.room-screen');
  assert.equal(await page.evaluate(async()=>{const{store}=await import('/js/store.js');return store.get().room.code;}),roomCode);
  for(const [width,height] of [[844,390],[390,844],[320,720]]) {
   await page.setViewport({width,height});await header('.room-screen');
   await page.waitForFunction(()=>[...document.querySelectorAll('.rseat')].every(e=>{const card=e.getBoundingClientRect(),plate=e.querySelector('.rseat__plate').getBoundingClientRect();return plate.bottom<=card.bottom+1;}));
   await click('.room-screen .stats-entry');await header('.st');await click('.st .app-back');await page.waitForSelector('.st',{hidden:true});await header('.room-screen');
  }
  await page.setViewport({width:1366,height:768});
  for(let i=0;i<3;i++){await page.waitForFunction(n=>document.querySelectorAll('.rseat:not(.rseat--empty)').length===n,{},i+1);await page.evaluate(()=>[...document.querySelectorAll('.rseat__actions button')].find(e=>e.textContent.includes('添加 AI')&&!e.disabled).click());}
  await page.waitForFunction(()=>document.querySelectorAll('.rseat:not(.rseat--empty)').length===4);
  await text('立即开始');await header('.brief');await click('.stephead .pausebtn');await page.waitForSelector('[data-testid=paused]');await text('继续作战');await page.waitForSelector('[data-testid=paused]',{hidden:true});
  await text('准备就绪');await header('.draft');await text('确认选择');await page.waitForSelector('.gm',{timeout:30000});
  assert.equal(await page.$('.gm .app-header'),null,'combat keeps its own HUD');assert.ok(await page.$('.gm .gtop'));
  assert.deepEqual(errors,[]);
 } finally {await browser?.close();await server.close();}
});
