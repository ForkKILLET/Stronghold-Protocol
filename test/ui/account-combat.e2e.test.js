// A fresh browser has no local combat cache. History must load the private, persisted account attachment.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
const fixture=JSON.parse(fs.readFileSync(new URL('../fixtures/stats-results.json',import.meta.url),'utf8'))['coop4-hard'];
for(const [engine,executablePath] of [['chrome','/run/current-system/sw/bin/google-chrome-stable'],['firefox','/run/current-system/sw/bin/firefox']])test(`${engine}: server combat details work in a fresh browser without any local combat cache`,{
  skip:process.env.SP_E2E!=='1'||!fs.existsSync(executablePath),timeout:120000,
},async()=>{
  const server=await startServer({host:'127.0.0.1',port:0,workers:0,userFile:':memory:',quiet:true,announcementsFile:null,clientBuild:process.env.SP_E2E_BUILD==='1'});
  let browser;
  try {
    const {user,token}=await server.users.call('create'),matchId='account-combat-test',cs=server.content.cs;
    await server.users.call('update',{id:user.id,name:'统计持久化验证',avatarId:null});
    const {players,...frame}=fixture;
    const fields=[12,13].map(round=>({battleId:'b'+round,round,fieldId:'f1',cs,players:['p_0'],seconds:10}));
    await server.users.call('record',{id:matchId,endedAt:Date.now(),mode:frame.modeId,difficulty:frame.difficulty,source:'server',combat:{v:1,fields},
      rows:[{userId:user.id,playerId:'p_0',rounds:14,victory:true,payload:{...players[0],frame:{...frame,matchId,roomMode:'coop'}}}]});
    for(const [i,field] of fields.entries()) await server.users.call('putCombat',{id:user.id,matchId,record:{...field,v:1,complete:true,
      rows:[{key:'one',ownerId:'p_0',defId:players[0].lineup[0].id,name:'归档验证干员',kind:'op',damage:i?650:350,healing:10,
        types:{phys:i?650:350,arts:0,true:0,elemental:0}}]}});
    browser=await puppeteer.launch({browser:engine,executablePath,headless:true,args:engine==='chrome'?['--no-sandbox','--mute-audio','--no-proxy-server']:[]});
    const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await context.setCookie({name:'sp_user',value:token,domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Strict'});
    await page.evaluateOnNewDocument(()=>{localStorage.setItem('sp.name','统计持久化验证');sessionStorage.setItem('sp.entered','1');});
    await page.setViewport({width:1920,height:1080});await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__SP__?.store.get().connection.status==='online');
    assert.equal(await page.evaluate(()=>localStorage.getItem('sp.combat-history.v1')),null);
    await page.locator('.stats-entry').click();await page.locator('.st-tab[data-tab="history"]').click();await page.waitForSelector('.st-table--history tbody tr');
    await page.locator('.st-table--history tbody tr:first-child').click();await page.waitForSelector('.st--replay .gm__metrics');
    await page.locator('.st--replay .gm__metrics').click();await page.waitForSelector('.combat-metrics__row');
    assert.equal(await page.$eval('.combat-metrics__totals b',e=>e.textContent),'650');
    assert.match(await page.$eval('.combat-metrics__note',e=>e.textContent),/服务器已保存完整明细/);
    await page.locator('button[aria-label="上一回合"]').click();assert.equal(await page.$eval('.combat-metrics__totals b',e=>e.textContent),'350');
    const out=process.env.SP_E2E_OUT || '/tmp/sp-account-combat';fs.mkdirSync(out,{recursive:true});
    for(const [width,height] of [[1920,1080],[844,390]]) {
      await page.setViewport({width,height});await page.evaluate(async()=>{await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
      const bounds=await page.$eval('.combat-metrics',el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};});
      assert.ok(bounds.top>=-1 && bounds.bottom<=height+1 && bounds.left>=-1 && bounds.right<=width+1,JSON.stringify(bounds));
      const headerBottom=await page.$eval('.st--replay > .app-header',el=>el.getBoundingClientRect().bottom);
      assert.ok(bounds.top>=headerBottom,'archive statistics must remain below the shared header');
      assert.ok(await page.$eval('.combat-metrics__values b',el=>parseFloat(getComputedStyle(el).fontSize))>=12,'saved values stay readable on short screens');
      await page.screenshot({path:path.join(out,`${engine}-${width}.png`)});
    }
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();await server.close();}
});
