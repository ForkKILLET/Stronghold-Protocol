// Isolated, opt-in Chrome touch / Firefox layout regression. Never connects to production.
// SP_E2E=1; SP_E2E_BUILD=1 checks the same flow using the compiled client.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';

const sizes=[
  {width:1366,height:768}, {width:640,height:360}, {width:740,height:360},
  {width:760,height:360}, {width:761,height:360}, {width:844,height:390,safe:true},
  {width:960,height:432}, {width:740,height:360,text:'xl'}, {width:844,height:300},
  {width:640,height:360,text:'xl'},
];
for(const [engine,executablePath] of [
  ['chrome',process.env.CHROME_PATH||'/run/current-system/sw/bin/google-chrome-stable'],
  ['firefox',process.env.FIREFOX_PATH||'/run/current-system/sw/bin/firefox'],
]) test(`management pages fit mobile landscape, safe areas and text settings (${engine})`,{
  skip:process.env.SP_E2E!=='1'||!existsSync(executablePath),timeout:180000,
},async()=>{
 const built=process.env.SP_E2E_BUILD==='1';
 const server=await startServer({host:'127.0.0.1',port:0,quiet:true,workers:0,userFile:':memory:',clientBuild:built,assetIndex:false,announcementsFile:null});
 const out=new URL(`../e2e/out/mobile-management/${built?'build':'source'}/${engine}/`,import.meta.url);
 mkdirSync(out,{recursive:true});const measurements=[],errors=[];let browser;
 try {
  browser=await puppeteer.launch({browser:engine,executablePath,headless:true,args:engine==='chrome'?['--no-sandbox','--mute-audio','--no-proxy-server','--enable-unsafe-swiftshader']:[]});
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  const settle=()=>page.evaluate(async()=>{
   await document.fonts.ready;
   document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a=>a.finish());
   await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  });
  const resize=async c=>{
   // Keep touch emulation stable: changing isMobile reloads Chrome's page.
   await page.setViewport({width:c.width,height:c.height,...(engine==='chrome'?{isMobile:true,hasTouch:true,isLandscape:true,deviceScaleFactor:1}:{})});
   await page.evaluate(c=>{
    const root=document.documentElement;root.dataset.text=c.text||'md';
    for(const [key,value] of Object.entries({'--sa-l':c.safe?'44px':'0px','--sa-r':c.safe?'44px':'0px','--sa-b':c.safe?'21px':'0px'}))root.style.setProperty(key,value);
    dispatchEvent(new Event('resize'));
    window.__SP__?.store.patch('presence',{online:999});
    window.__SP__?.store.patch('connection',{ping:9999});
   },c);await settle();
  };
  const click=async selector=>{await page.locator(selector).click();await settle();};
  const text=async(label,selector='button')=>{
   await page.waitForFunction(({label,selector})=>[...document.querySelectorAll(selector)].some(e=>e.textContent.trim()===label&&!e.disabled),{},{label,selector});
   await page.evaluate(({label,selector})=>[...document.querySelectorAll(selector)].find(e=>e.textContent.trim()===label&&!e.disabled).click(),{label,selector});await settle();
  };
  const snapshots=new Map();
  const capture=async(name,selector,configs=sizes)=>{
   await page.waitForSelector(selector);
   for(const c of configs){
    await resize(c);
    const m=await page.$eval(selector,root=>{
     const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
     const header=root.querySelector('.app-header');
     const controls=[...header.querySelectorAll('.app-back,.latency-pill,.online-count,.topbar-announcement,.app-header__tools > button,.app-header__identity,.app-header__heading')].filter(e=>e.offsetWidth).map(box);
     const foot=root.querySelector('.proto-foot,.room-options__actions,.room-bar,.brief__foot,.draft-detail__actions');
     const scroll=[root,...root.querySelectorAll('*')].filter(e=>e.offsetHeight&&/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+2).map(e=>({class:e.className,delta:e.scrollHeight-e.clientHeight}));
     const grid=root.querySelector('.draft-grid');
     return {root:box(root),header:box(header),controls,foot:foot&&box(foot),rootScroll:[root.scrollWidth-root.clientWidth,root.scrollHeight-root.clientHeight],scroll,
      gridOverflow:grid?grid.scrollWidth-grid.clientWidth:0,rem:getComputedStyle(document.documentElement).fontSize,
      document:[document.documentElement.scrollWidth-innerWidth,document.documentElement.scrollHeight-innerHeight]};
    });
    measurements.push({name,config:c,...m});const label=JSON.stringify({name,...c});
    assert.ok(m.document.every(v=>v<=1),label+' document overflow');
    assert.ok(m.rootScroll.every(v=>v<=2),label+' page overflow');
    assert.ok(Math.abs(m.root.x-(c.safe?44:0))<=1,label+' left safe area');
    assert.ok(Math.abs(m.root.right-(c.width-(c.safe?44:0)))<=1,label+' right safe area');
    assert.ok(m.root.bottom<=c.height-(c.safe?21:0)+1,label+' bottom safe area');
    if(c.height<=560){
     assert.ok(m.header.h<=54,label+' single-row header');
     for(const control of m.controls)assert.ok(Math.abs(control.y+control.h/2-(m.header.y+26))<=1,label+' shared controls and title occupy one row');
    }
    if(c.width<1000)assert.equal(m.rem,'40px',label+' gameplay rem stays unchanged');
    assert.ok(m.gridOverflow<=2,label+' strategy grid must not scroll sideways');
    if(m.foot)assert.ok(m.foot.y>=m.header.bottom-1&&m.foot.bottom<=m.root.bottom+1,label+' primary actions stay visible');
    for(let i=0;i<m.controls.length;i++){
     const a=m.controls[i];assert.ok(a.x>=m.root.x-1&&a.right<=m.root.right+1,label+' navigation control is clipped');
     for(const b of m.controls.slice(i+1))assert.ok(Math.min(a.right,b.right)-Math.max(a.x,b.x)<=1||Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)<=1,label+' navigation overlap');
    }
    const key=JSON.stringify(c);
    if(snapshots.has(key))assert.ok(Math.abs(m.header.h-snapshots.get(key))<1,label+' header height changed between pages');else snapshots.set(key,m.header.h);
    if((c.width===740&&!c.text)||c.safe||c.width===1366)await page.screenshot({path:new URL(`${name}-${c.width}${c.safe?'-safe':''}.png`,out).pathname});
   }
  };
  await resize(sizes[0]);await page.goto(server.url,{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{const event=new Event('beforeinstallprompt',{cancelable:true});event.prompt=async()=>({outcome:'dismissed'});dispatchEvent(event);});
  await page.waitForSelector('.title-login input');await page.type('.title-login input','手机布局验证');await click('.title-login .btn--primary');
  await capture('lobby','.lobby-hub');await resize(sizes[2]);
  await page.evaluate(()=>[...document.querySelectorAll('.hub-entry')].find(e=>e.textContent.includes('创建同盟')).click());
  await capture('create','.protocol-screen');await resize(sizes[2]);
  const language=async code=>{
   await click('.protocol-screen .settings-btn');await page.waitForSelector('.settings-modal');
   await click('.settings-modal .set-lang [role=combobox]');await click(`.game-select-popover [role=option][lang=${code}]`);
   await page.waitForFunction(code=>document.documentElement.lang===code,{},code);
   await page.keyboard.press('Escape');await page.waitForSelector('.settings-modal',{hidden:true});await settle();
  };
  await language('en');await capture('create-en','.protocol-screen',[sizes[1],sizes[2],sizes[5],sizes[7]]);
  await language('zh-CN');await resize(sizes[2]);
  await text('时长倍率');await page.$eval('.prep-setting input',e=>{e.value='1.5';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await text('3×','.prep-setting[aria-label="战斗倍速"] button');
  assert.ok(await page.$eval('.prep-setting input',e=>e.getBoundingClientRect().width>=64),'multiplier input fits decimals and native spinner');
  await click('.proto-start');await capture('room','.room-screen');
  assert.equal(await page.evaluate(()=>window.__SP__.store.get().room.battleSpeed),3,'creation speed reaches server');
  assert.equal(await page.evaluate(()=>window.__SP__.store.get().room.prepMultiplier),1.5,'creation prep draft reaches server');
  await resize(sizes[2]);await text('调整配置');await capture('options','.room-options-screen');
  await resize(sizes[2]);await click('.room-options-screen .stats-entry');
  await capture('profile','.st',[sizes[2],sizes[5],sizes[7]]);await click('.st .app-back');await page.waitForSelector('.st',{hidden:true});
  assert.equal(await page.$eval('.prep-setting input',e=>e.value),'1.5','configuration draft survives archive navigation');
  await text('保存并返回');await page.waitForSelector('.room-screen');await resize(sizes[2]);
  for(let i=0;i<3;i++){
   await page.evaluate(()=>[...document.querySelectorAll('.rseat__actions button')].find(e=>e.textContent.includes('添加 AI')&&!e.disabled).click());
   await page.waitForFunction(n=>document.querySelectorAll('.rseat:not(.rseat--empty)').length===n,{},i+2);
  }
  await capture('full-room','.room-screen',[sizes[1],sizes[2],sizes[5],sizes[7],sizes[8]]);
  await resize(sizes[2]);await text('立即开始');await capture('brief','.brief',[sizes[1],sizes[2],sizes[5],sizes[7]]);
  await resize(sizes[2]);await text('准备就绪');await capture('draft','.draft',[sizes[1],sizes[2],sizes[5],sizes[7]]);
  assert.deepEqual(errors,[]);
 } finally {
  writeFileSync(new URL('measurements.json',out),JSON.stringify({engine,built,measurements,errors},null,2));
  await browser?.close();await server.close();
 }
});
