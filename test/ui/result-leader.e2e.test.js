// Real result/history UI; charts come from credited b.progress on a controlled Match/FakeBattle, not a full WS game.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
import {getVersionData} from '../../server/data.js';
import {makeMatch} from '../match/harness.js';
import {buildRecord,STATS_VERSION} from '../../public/js/ui/stats.js';

function resultFixture(){
 const data=getVersionData('act3autochess@V3_1');
 const ops=Object.values(data.chess).filter(c=>c.visible&&!c.isGolden&&c.charId&&c.tier>=4);
 const h=makeMatch({humans:4,fake:true,instant:false,clientCombat:true,clients:false,data,version:'act3autochess@V3_1'}).start(),m=h.m;
 try{
  h.toPrep(1,{band:'band_amiya'});m.round=14;m.bossId='boss_1';m.hiddenBossId='boss_9';m.hiddenLayerSum=1e9;
  m._planBossWaves();m.startFinalAssault(false);
  const report=(hidden)=>{
   h.sched.advance(4000);
   for(const[i,f]of m.fields.entries()){
    const fractions=hidden?[.4-i*.1,.12-i*.02]:[.23-i*.1,.14-i*.05],by={},rows=[];
    f.players.forEach((pid,j)=>{const dmg=Math.round(m.bossPool.maxHp*fractions[j]);by[pid]=dmg;
     rows.push({pid,uid:1+i*2+j,chess:ops[i*2+j].chessId,tier:ops[i*2+j].tier,dmg});});
    assert.deepEqual(m.handle(f.authority,{t:'b.progress',battleId:f.battleId,gt:4,killed:0,total:0,
     bossDmg:Object.values(by).reduce((a,b)=>a+b,0),by,ops:rows}),{ok:true});
   }
  };
  report(false);m.bossPool.hp=0;m._finishFinal(false,()=>({perPlayer:{},synthetic:true}));h.toPrep(15);
  m.startFinalAssault(true);report(true);m.finish({victory:true,hiddenCleared:false});
  return structuredClone(m.lastResultMsg);
 }finally{m.dispose();}
}

for(const[engine,executablePath]of[
 ['chrome',process.env.CHROME_PATH||'/run/current-system/sw/bin/google-chrome-stable'],
 ['firefox',process.env.FIREFOX_PATH||'/run/current-system/sw/bin/firefox'],
])test(`${engine}: settlement Boss chart entry, both fights, modes, keyboard and archived result`,{
 skip:process.env.SP_E2E!=='1'||!existsSync(executablePath),timeout:180000,
},async()=>{
 const res=resultFixture(),out=process.env.SP_E2E_OUT||new URL('../e2e/out/result-leader/',import.meta.url).pathname;
 mkdirSync(out,{recursive:true});writeFileSync(path.join(out,'fixture.json'),JSON.stringify(res,null,2));
 const server=await startServer({port:0,host:'127.0.0.1',workers:0,roomWorkers:0,matchWorkers:0,quiet:true,
  userFile:':memory:',clientBuild:process.env.SP_E2E_BUILD==='1',assetIndex:false,announcementsFile:null});
 let browser;const errors=[],http=[],observations=[];
 try{
  browser=await puppeteer.launch({browser:engine,executablePath,headless:true,
   args:engine==='chrome'?['--no-sandbox','--mute-audio','--no-proxy-server']:['-remote-allow-system-access'],
   ...(engine==='firefox'?{extraPrefsFirefox:{'dom.ipc.processCount':2,'dom.ipc.processCount.webIsolated':1,'dom.ipc.processPrelaunch.enabled':false,'fission.autostart':false}}:{})});
  const page=await browser.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)http.push([r.status(),new URL(r.url()).pathname]);});
  await page.setViewport({width:1440,height:900});
  await page.evaluateOnNewDocument(()=>{sessionStorage.setItem('sp.entered','1');localStorage.setItem('sp.name','排行验证');localStorage.setItem('sp.pref.lobby.version',JSON.stringify('act3autochess@V3_1'));});
  await page.goto(server.url,{waitUntil:'domcontentloaded'});await page.waitForSelector('.lobby-hub');
  await page.waitForFunction(()=>window.__SP__.store.get().connection.status==='online');
  await page.evaluate(res=>{const s=window.__SP__.store.get();window.__SP__.store.set({me:{...s.me,playerId:res.players[0].playerId},
   match:{...s.match,public:{...res,phase:'RESULT'},result:res}});},res);
  await page.waitForSelector('[data-testid="settle-intro"]');
  if(engine==='firefox')await page.$eval('[data-testid="settle-intro"]',e=>e.click());else await page.keyboard.press('Enter');
  await page.waitForSelector('.settle__next');await page.click('.settle__next');
  await page.waitForSelector('.steam__detail');await page.click('.steam__detail');
  await page.waitForSelector('.result__leader-toggle');
  const settle=()=>page.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();await new Promise(requestAnimationFrame);});
  const geometry=async(label)=>{
   await settle();
   const box=await page.$eval('.ldmg--result',el=>{const r=el.getBoundingClientRect(),v=el.querySelector('.ldmg__viewport'),row=v.querySelector('.ldmg__row');return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:el.scrollWidth-el.clientWidth,rowHeight:row?.getBoundingClientRect().height||0,viewportHeight:v.clientHeight};});
   assert.ok(box.left>=0&&box.right<=box.width+1&&box.top>=0&&box.bottom<=box.height+1,JSON.stringify(box));assert.ok(box.overflow<=1,JSON.stringify(box));assert.ok(box.viewportHeight>=box.rowHeight,JSON.stringify(box));
   observations.push({label,...box});await page.screenshot({path:path.join(out,`${engine}-${label}.png`)});
  };
  await page.click('.result__leader-toggle');await page.waitForSelector('.ldmg--result');
  assert.equal(await page.$('.ldmg__auto'),null);
  assert.deepEqual(await page.$$eval('.ldmg__share',es=>es.map(e=>e.textContent)),['23%','14%','13%']);
  await geometry('boss-1440');
  await page.click('.ldmg__rounds button:nth-child(2)');await page.click('.ldmg__modes button:nth-child(2)');
  assert.deepEqual(await page.$$eval('.ldmg__share',es=>es.map(e=>e.textContent)),['40%','30%','12%','10%']);
  for(const[width,height]of[[844,390],[390,844],[640,360]]){await page.setViewport({width,height});await geometry(`hidden-players-${width}`);}
  await page.keyboard.press('Escape');await page.waitForSelector('.ldmg',{hidden:true});
  assert.equal(await page.evaluate(()=>document.activeElement?.matches('.result__leader-toggle')),true);
  await page.setViewport({width:1440,height:900});await settle();
  await page.click('.result__leader-toggle');await page.click('.result__actions [aria-label="作战统计"]');
  await page.waitForSelector('.combat-metrics');assert.equal(await page.$('.ldmg'),null);await page.keyboard.press('Escape');
  await page.click('.result__leader-toggle');await page.click('.ldmg__close');await page.waitForSelector('.ldmg',{hidden:true});
  // Historical route reads the normalized/exportable record and keeps the two-chart selector.
  const record=buildRecord(res,{myId:res.players[0].playerId,version:res.version,now:Date.now()});
  await page.evaluate(records=>{localStorage.setItem('sp.pref.stats',JSON.stringify(records));const s=window.__SP__.store.get();window.__SP__.store.set({match:{...s.match,public:null,result:null}});},{v:STATS_VERSION,records:[record]});
  await page.waitForSelector('.lobby-hub');await page.click('.lobby-hub .stats-entry');await page.waitForSelector('.st-tab[data-tab="history"]');await page.click('.st-tab[data-tab="history"]');
  await page.waitForSelector('.st-table--history tr.is-clickable');await page.click('.st-table--history tr.is-clickable');
  await page.waitForSelector('.st--replay .result__leader-toggle');await page.click('.st--replay .result__leader-toggle');await geometry('history-640');
  await page.click('.ldmg__rounds button:nth-child(2)');assert.equal(await page.$eval('.ldmg__rounds button:nth-child(2)',e=>e.getAttribute('aria-pressed')),'true');
  await page.evaluate(async()=>{await(await import('/js/ui/lang.js')).switchLang('en');document.documentElement.dataset.text='xl';});
  await page.setViewport({width:640,height:360});await geometry('history-english-xl-640');
  assert.deepEqual(errors,[]);assert.deepEqual(http,[]);
 }finally{writeFileSync(path.join(out,`${engine}-result.json`),JSON.stringify({observations,errors,http},null,2));await browser?.close();await server.close();}
});
