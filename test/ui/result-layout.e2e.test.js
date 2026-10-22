// Real application result/history routes, with recorded m.result fixtures; no production account or match.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
import {buildRecord,STATS_VERSION} from '../../public/js/ui/stats.js';

const fixtures=JSON.parse(readFileSync(new URL('../fixtures/stats-results.json',import.meta.url),'utf8'));
const cases=[
 {width:1366,height:768,fixture:'solo-normal'},
 {width:1920,height:1080,fixture:'coop4-hard'},
 {width:844,height:390,fixture:'coop4-hard',safe:true},
 {width:640,height:360,fixture:'coop4-hard',text:'xl'},
 {width:540,height:320,fixture:'solo-normal',text:'xl'},
];
for(const [engine,executablePath] of [
 ['chrome',process.env.CHROME_PATH||'/run/current-system/sw/bin/google-chrome-stable'],
 ['firefox',process.env.FIREFOX_PATH||'/run/current-system/sw/bin/firefox'],
])test(`${engine}: result details fill their page and every player's final stats are reachable`,{
 skip:process.env.SP_E2E!=='1'||!existsSync(executablePath),timeout:120000,
},async()=>{
 const server=await startServer({port:0,host:'127.0.0.1',quiet:true,workers:0,userFile:':memory:',clientBuild:process.env.SP_E2E_BUILD==='1',assetIndex:false,announcementsFile:null});
 const out=process.env.SP_E2E_OUT||new URL('../e2e/out/result-layout/',import.meta.url).pathname;
 mkdirSync(out,{recursive:true});let browser;
 try{
  browser=await puppeteer.launch({browser:engine,executablePath,headless:true,args:engine==='chrome'?['--no-sandbox','--mute-audio','--no-proxy-server']:[]});
  const page=await browser.newPage(),errors=[],issues=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluateOnNewDocument(records=>{
   if(location.protocol==='http:'||location.protocol==='https:')localStorage.setItem('sp.pref.stats',JSON.stringify(records));
  },{
   v:STATS_VERSION,records:[buildRecord(fixtures['coop4-hard'],{myId:'p_0',roomMode:'coop',now:Date.now()})],
  });
  const resize=async size=>{
   await page.setViewport({width:size.width,height:size.height,...(engine==='chrome'?{isMobile:true,hasTouch:true,isLandscape:true,deviceScaleFactor:1}:{})});
   await page.evaluate(size=>{
    document.documentElement.dataset.text=size.text||'md';
    for(const [key,value] of Object.entries({'--sa-l':size.safe?'44px':'0px','--sa-r':size.safe?'44px':'0px','--sa-b':size.safe?'21px':'0px'}))document.documentElement.style.setProperty(key,value);
    dispatchEvent(new Event('resize'));
   },size);
  };
  const settle=()=>page.evaluate(async()=>{
   await document.fonts.ready;
   for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();
   await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  });
  await resize(cases[0]);await page.goto(server.url,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.title-login input');await page.type('.title-login input','数据详情验证');await page.locator('.title-login .btn--primary').click();
  await page.waitForSelector('.lobby-hub');
  const check=async(label,hostSelector)=>{
   await settle();
   await page.screenshot({path:path.join(out,`${engine}-${label}-top.png`)});
   const layout=await page.$eval(`${hostSelector} .result__main`,main=>{
    const root=main.closest('.result'),r=root.getBoundingClientRect(),host=root.parentElement.getBoundingClientRect();
    const players=main.querySelector('.result__players'),p=players.getBoundingClientRect(),h=players.firstElementChild.getBoundingClientRect();
    return{top:r.top,bottom:r.bottom,hostTop:host.top,hostBottom:host.bottom,visibleBottom:innerHeight-parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sa-b')||'0'),headingGap:h.top-p.top,overflow:players.scrollWidth-players.clientWidth};
   });
   if(layout.top<layout.hostTop-1||layout.bottom>Math.min(layout.hostBottom,layout.visibleBottom)+1)issues.push(`${label}: details outside parent ${JSON.stringify(layout)}`);
   if(layout.headingGap>2)issues.push(`${label}: unnecessary top gap ${JSON.stringify(layout)}`);
   if(layout.overflow>1)issues.push(`${label}: horizontal overflow ${JSON.stringify(layout)}`);
   await page.$$eval(`${hostSelector} .result__players, ${hostSelector} .result__summary`,els=>els.forEach(e=>{e.scrollTop=e.scrollHeight;}));
   await page.$eval(`${hostSelector} .result__main`,e=>{e.scrollTop=e.scrollHeight;});
   await settle();
   const bottom=await page.$eval(`${hostSelector} .result__players`,e=>{
    const last=e.querySelector('.rcard:last-child .rstat:last-child'),r=last.getBoundingClientRect(),box=e.getBoundingClientRect();
    const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return{bottom:r.bottom,containerBottom:box.bottom,reachable:!!hit&&last.contains(hit)};
   });
   await page.screenshot({path:path.join(out,`${engine}-${label}-bottom.png`)});
   if(!bottom.reachable||bottom.bottom>Math.min(bottom.containerBottom,layout.hostBottom,layout.visibleBottom)+1)issues.push(`${label}: final stats clipped ${JSON.stringify(bottom)}`);
  };
  for(const size of cases){
   await resize(size);
   await page.evaluate(res=>window.__SP__.store.set(s=>({match:{...s.match,public:{...res,phase:'RESULT'},result:res}})),fixtures[size.fixture]);
   await page.waitForSelector('.steam__detail');await settle();await page.locator('.steam__detail').click();
   await page.waitForSelector('[data-testid="settle-detail"]');
   await check(`${size.width}-${size.height}-${size.fixture}`,'.settle__detail');
   await page.locator('.result-page > .app-header .app-back').click();await page.waitForSelector('.settle__detail',{hidden:true});
   await page.waitForFunction(()=>document.activeElement?.matches('.steam__detail'));
   await page.locator('.result-page > .app-header .app-back').click();await page.waitForSelector('.lobby-hub');
  }
  await resize(cases[2]);
  await page.locator('.lobby-hub .stats-entry').click();await page.waitForSelector('.st-tab[data-tab="history"]');
  await page.locator('.st-tab[data-tab="history"]').click();await page.waitForSelector('.st-table--history tr.is-clickable');
  await page.locator('.st-table--history tr.is-clickable').click();await page.waitForSelector('.st--replay .result__main');
  await check('history-844-390','.st--replay');
  await page.locator('.st--replay .app-back').click();await page.waitForSelector('.st-table--history');
  assert.deepEqual(errors,[]);assert.deepEqual(issues,[]);
 }finally{await browser?.close();await server.close();}
});
