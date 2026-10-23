// Reproduce leaving a finished match before reading its archived details. No production profile or browser is used.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
import {buildRecord,STATS_VERSION} from '../../public/js/ui/stats.js';
import {localFontsOnly} from '../helpers/localFonts.js';

const fixtures=JSON.parse(readFileSync(new URL('../fixtures/stats-results.json',import.meta.url),'utf8'));
for(const [engine,executablePath] of [['chrome','/run/current-system/sw/bin/google-chrome-stable'],['firefox','/run/current-system/sw/bin/firefox']])test(`${engine}: archived combat data, aligned rates and synchronized detail replay actions`,{
 skip:process.env.SP_E2E!=='1'||!existsSync(executablePath),timeout:120000,
},async()=>{
 const server=await startServer({host:'127.0.0.1',port:0,workers:0,userFile:':memory:',quiet:true,announcementsFile:null,assetIndex:false,clientBuild:process.env.SP_E2E_BUILD==='1'});
 const out=process.env.SP_E2E_OUT||'/tmp/sp-archive-details';mkdirSync(out,{recursive:true});let browser;
 try{
  const matchId=randomUUID(),fixture={...fixtures['coop4-hard'],matchId},matchKey='archive-test:'+matchId;
  const local=buildRecord(fixture,{myId:'p_0',roomMode:'coop',now:Date.now()});
  const cache={version:1,matchKey,records:[350,650].map((damage,i)=>['field-'+i,{round:12+i,seconds:10,owners:['p_0','p_1'],rows:[
   {key:'unit',ownerId:'p_0',defId:fixture.players[0].lineup[0].id,name:'归档测试干员',kind:'op',damage,healing:10,types:{phys:damage,arts:0,true:0,elemental:0}},
   {key:'other',ownerId:'p_1',defId:fixture.players[0].lineup[0].id,name:'队友干员',kind:'op',damage:999999,healing:0,types:{phys:999999,arts:0,true:0,elemental:0}},
  ]}])};
  browser=await puppeteer.launch({browser:engine,executablePath,headless:true,args:engine==='chrome'?['--no-sandbox','--mute-audio','--no-proxy-server']:[]});
  const page=await browser.newPage(),errors=[],replayReads=[];page.on('pageerror',e=>errors.push(e.message));
  await localFontsOnly(page);
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/user/replay')replayReads.push(r.url());});
  await page.setViewport({width:1920,height:1080,hasTouch:engine==='chrome'});
  await page.evaluateOnNewDocument(({local,cache,version})=>{
   localStorage.setItem('sp.name','档案详情验证');sessionStorage.setItem('sp.entered','1');
   localStorage.setItem('sp.pref.stats',JSON.stringify({v:version,records:[local]}));localStorage.setItem('sp.combat-history.v1',JSON.stringify(cache));
  },{local,cache,version:STATS_VERSION});
  await page.goto(server.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__SP__?.store.get().connection.status==='online');
  const id=await page.evaluate(()=>JSON.parse(localStorage.getItem('sp.pref.doctorProfile')).id);
  const {players,...frame}=fixture;
  const replay={v:1,duration:10,cs:server.content.cs,players:players.map(({playerId,name,seat})=>({playerId,name,seat})),fields:[],events:[{at:0,kind:'view',key:'public',full:{matchId,combatHistoryKey:matchKey}}]};
  const record=async(gameId,bandId,victory,t,body)=>server.users.call('record',{id:gameId,endedAt:t,mode:frame.modeId,difficulty:frame.difficulty,source:'server',replay:body,rows:[{userId:id,playerId:'p_0',rounds:14,victory,payload:{...players[0],bandId,frame:{...frame,matchId:gameId,roomMode:'coop'}}}]});
  await record(matchId,players[0].bandId,true,Date.now(),replay);
  await record('rates-a',players[0].bandId,true,Date.now()-10000);
  await record('rates-b',players[0].bandId,false,Date.now()-11000);
  await record('rates-c','band_amiya',true,Date.now()-12000);
  const settle=()=>page.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  const shot=async name=>{await settle();await page.screenshot({path:path.join(out,engine+'-'+name+'.png')});};
  await page.locator('.stats-entry').click();await page.locator('.st-tab[data-tab="bands"]').click();await page.waitForSelector('.st-rate .st-bar');await settle();
  const rates=await page.$$eval('.st-rate .st-bar',els=>els.map(e=>({left:e.getBoundingClientRect().left,align:getComputedStyle(e.parentElement).textAlign,value:e.nextElementSibling.textContent})));
  assert.deepEqual(rates.map(r=>r.value).sort(),['100%','67%']);assert.ok(rates.every(r=>r.align==='left'&&Math.abs(r.left-rates[0].left)<=1),JSON.stringify(rates));await shot('strategy-rates');
  await page.locator('.st-tab[data-tab="history"]').click();await page.waitForSelector('.st-replay-status');
  const open=async()=>{await page.locator('.st-table--history tbody tr:first-child').click();await page.waitForSelector('.st--replay .result__actions');await settle();};
  const back=async()=>{await page.locator('.st--replay > .app-header .app-back').click();await page.waitForSelector('.st-table--history');};
  const geometry=async()=>page.$eval('.st--replay',e=>{
   const header=e.querySelector('.app-header').getBoundingClientRect(),result=e.querySelector('.result-view').getBoundingClientRect(),buttons=[...e.querySelectorAll('.result__actions > .btn')].map(b=>b.getBoundingClientRect().toJSON()),players=e.querySelector('.result__players');
   return{gap:result.top-header.bottom,buttons,scroll:players.scrollHeight-players.clientHeight,pageOverflow:document.documentElement.scrollWidth-innerWidth};
  });
  await open();let layout=await geometry();assert.ok(Math.abs(layout.gap)<=1,'no replay-only row above the details');
  const checkActions=layout=>{
   assert.equal(layout.buttons.length,3);
   for(const button of [layout.buttons[0],layout.buttons[2]])assert.ok(Math.abs(button.width-button.height)<=1,'statistics and menu buttons are square');
   assert.ok(layout.buttons.every(button=>Math.abs(button.top-layout.buttons[0].top)<=1&&Math.abs(button.height-layout.buttons[0].height)<=1),'statistics, playback and menu share one action row: '+JSON.stringify(layout));
  };
  checkActions(layout);
  assert.ok(layout.scroll<=1,'four-member report fits its original desktop viewport: '+JSON.stringify(layout));await shot('details-desktop');
  await page.locator('.st--replay .gm__metrics').click();await page.waitForSelector('.combat-metrics__row');assert.equal(replayReads.length,1,'legacy identity is verified through the owned replay once');
  assert.equal(await page.$eval('.combat-metrics__totals b',e=>e.textContent),'650');
  await page.locator('button[aria-label="上一回合"]').click();assert.equal(await page.$eval('.combat-metrics__totals b',e=>e.textContent),'350');
  await page.evaluate(()=>[...document.querySelectorAll('.combat-metrics__scopes button')].find(e=>e.textContent==='本局累计').click());
  await page.waitForFunction(()=>document.querySelector('.combat-metrics__totals b')?.textContent==='1,000');await shot('archived-combat');
  assert.equal(await page.$$('.combat-metrics__row').then(rows=>rows.length),1,'teammate damage is excluded');
  await page.keyboard.press('Escape');await page.waitForSelector('.combat-metrics',{hidden:true});assert.ok(await page.$('.st--replay'),'Escape closes statistics before the history report');
  await back();await page.evaluate(cache=>localStorage.setItem('sp.combat-history.v1',JSON.stringify(cache)),{...cache,matchId});
  await open();await page.locator('.gm__metrics').click();await page.waitForSelector('.combat-metrics__row');assert.equal(replayReads.length,1,'UUID caches need no replay request');
  await page.keyboard.press('Escape');await back();await page.evaluate(cache=>localStorage.setItem('sp.combat-history.v1',JSON.stringify(cache)),{...cache,matchId:'different-match'});
  await open();await page.locator('.gm__metrics').click();await page.waitForSelector('.combat-metrics__empty');
  await page.waitForFunction(()=>document.querySelector('.combat-metrics__empty')?.textContent.includes('尚未记录'));assert.equal(await page.$eval('.combat-metrics__totals b',e=>e.textContent),'—');await page.keyboard.press('Escape');
  const menu=async()=>{await page.locator('.result__actions .st-history-menu-trigger').click();await page.waitForSelector('.doctor-replay-menu');};
  const choose=async label=>{
   await page.evaluate(label=>[...document.querySelectorAll('.doctor-replay-menu button')].find(button=>button.textContent.trim()===label).click(),label);
   const next={'固定':'取消固定','取消固定':'固定','设为公开':'设为私密','设为私密':'设为公开'}[label];
   if(next){
    await page.waitForFunction(label=>[...document.querySelectorAll('.doctor-replay-menu button')].some(button=>button.textContent.trim()===label&&!button.disabled),{},next);
    assert.ok(await page.$('.doctor-replay-menu'),'non-navigation action keeps the menu open: '+label);
   }
  };
  const closed=()=>page.waitForSelector('.doctor-replay-menu',{hidden:true});
  const marks=()=>page.$$eval('.result__actions .st-replay-marks title',els=>els.map(e=>e.textContent));
  await menu();
  assert.deepEqual(await page.$$eval('.doctor-replay-menu button',els=>els.map(e=>e.textContent.trim())),['固定','设为公开','复制回放链接','公开设置'],'detail menu omits the direct playback action and current settlement');
  assert.equal(await page.$eval('.doctor-replay-menu button:nth-child(3)',e=>e.disabled),true);
  await choose('固定');assert.deepEqual(await marks(),['固定']);
  assert.equal(await page.$eval('.doctor-replay-menu button:first-child',e=>e.getAttribute('aria-pressed')),'true','detail menu immediately reflects pin state');
  await choose('设为公开');assert.deepEqual(await marks(),['固定'],'global sharing disabled hides the public marker');
  assert.equal(await page.$eval('.doctor-replay-menu button:nth-child(2)',e=>e.textContent.trim()),'设为私密');
  await choose('公开设置');await page.waitForSelector('.st-body[data-tab="privacy"]');assert.equal(await page.$('.st--replay'),null,'privacy settings are not hidden underneath details');
  await page.locator('[data-visibility="replays"]').click();await page.waitForSelector('[data-visibility="replays"][aria-checked="true"]');
  await page.locator('.st-tab[data-tab="history"]').click();await page.waitForSelector('.st-replay-status');
  assert.deepEqual(await page.$$eval('.st-table--history tbody tr:first-child .st-replay-marks title',els=>els.map(e=>e.textContent)),['固定','公开'],'detail changes also update the history row');
  await open();assert.deepEqual(await marks(),['固定','公开']);
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedReplay=text;}}}));
  await menu();assert.equal(await page.$eval('.doctor-replay-menu button:nth-child(3)',e=>e.disabled),false);await choose('复制回放链接');
  const copied=new URL(await page.evaluate(()=>window.__copiedReplay));assert.equal(copied.searchParams.get('replay'),matchId);assert.equal(copied.searchParams.get('doctor'),await page.evaluate(()=>JSON.parse(localStorage.getItem('sp.pref.doctorProfile')).publicId));
  await shot('detail-menu-desktop');await page.keyboard.press('Escape');await closed();assert.ok(await page.$('.st--replay'),'Escape only closes the replay menu');
  await menu();await choose('取消固定');assert.deepEqual(await marks(),['公开']);await page.keyboard.press('Escape');await closed();
  await back();assert.deepEqual(await page.$$eval('.st-table--history tbody tr:first-child .st-replay-marks title',els=>els.map(e=>e.textContent)),['公开']);
  await open();await menu();await choose('固定');assert.deepEqual(await marks(),['固定','公开']);await page.keyboard.press('Escape');await closed();
  for(const [width,height] of [[1366,768],[844,390],[640,360]]){
   await page.setViewport({width,height,hasTouch:engine==='chrome'});await settle();layout=await geometry();assert.ok(layout.pageOverflow<=1);
   checkActions(layout);
   const actionBounds=await page.$eval('.result__actions',e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,buttons:[...e.querySelectorAll(':scope > .btn')].map(b=>b.getBoundingClientRect().toJSON())}));
   assert.ok(actionBounds.buttons.every(b=>b.left>=actionBounds.left-1&&b.right<=actionBounds.right+1),'action buttons stay inside the left information column');
   await page.$eval('.gm__metrics',e=>e.scrollIntoView({block:'nearest'}));await shot('details-'+width);
   await page.locator('.gm__metrics').click();await page.waitForSelector('.combat-metrics');await shot('statistics-'+width);await page.keyboard.press('Escape');
   await menu();await settle();assert.ok(await page.$$eval('.doctor-replay-menu button',buttons=>buttons.every(button=>button.getBoundingClientRect().height>=44)),'menu buttons keep a real 44px touch target on short screens');
   assert.ok(await page.$eval('.doctor-replay-menu',menu=>{
    const close=menu.closest('.utility-modal').querySelector('.utility-modal__close').getBoundingClientRect();
    return !!document.elementFromPoint(close.left+close.width/2,close.top+close.height/2)?.closest('.modal')&&!!document.elementFromPoint(20,20)?.closest('.modal');
   }),'the menu and its backdrop cover the header; the close control remains reachable');
   await shot('detail-menu-'+width);await page.keyboard.press('Escape');await closed();
  }
  await menu();await choose('设为私密');assert.deepEqual(await marks(),['固定']);await page.keyboard.press('Escape');await closed();
  await back();assert.deepEqual(await page.$$eval('.st-table--history tbody tr:first-child .st-replay-marks title',els=>els.map(e=>e.textContent)),['固定']);
  await page.setViewport({width:1920,height:1080,hasTouch:engine==='chrome'});await page.locator('.st-table--history tbody tr:nth-child(2)').click();await page.waitForSelector('.st--replay .result__actions');
  assert.equal(await page.$$('.result__actions > .btn').then(buttons=>buttons.length),1,'records without a replay only retain their statistics action');
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
