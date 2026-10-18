// Real HTTP authentication and UI in both supported browser engines; never touches production.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
import {startAdminService} from '../../server/admin/service.js';
import {TestClient} from '../helpers/wsClient.js';
const password='admin-browser-fixture-password';
const out=process.env.SP_E2E_OUT || '/tmp/stronghold-admin-shots';
const engines=[['chrome',process.env.CHROME_PATH || '/run/current-system/sw/bin/google-chrome-stable'],['firefox',process.env.FIREFOX_PATH || '/run/current-system/sw/bin/firefox']];
for(const [engine,executablePath] of engines)test(`${engine}: admin authentication, live data, privacy, responsive layouts and recovery`,{
  skip:process.env.SP_E2E!=='1'||!existsSync(executablePath),timeout:120000,
},async t=>{
  mkdirSync(out,{recursive:true});
  const server=await startServer({port:0,host:'127.0.0.1',quiet:true,workers:0,matchWorkers:1,store:null,userFile:'',nameModeration:null,announcementsFile:null,clientBuild:false,adminToken:'browser-collector-token-32-characters',adminPort:0});
  const panel=await startAdminService({port:0,host:'127.0.0.1',password,token:'browser-collector-token-32-characters',gameUrl:server.telemetry.url,publicDir:path.resolve(import.meta.dirname,'../../dist/admin/public')});
  const clients=[];let browser;
  t.after(async()=>{await browser?.close();await panel.close();await server.close();await Promise.all(clients.map(c=>c.terminate()));});
  browser=await puppeteer.launch({browser:engine,executablePath,headless:true,ignoreDefaultArgs:['--hide-scrollbars'],args:engine==='chrome'?['--no-sandbox','--mute-audio']:[]});
  const page=await browser.newPage(),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.setViewport({width:1440,height:1000});await page.goto(panel.url+'/admin',{waitUntil:'networkidle0'});await page.bringToFront();
  const shot=async label=>{
    await page.evaluate(()=>{for(const a of document.getAnimations()){if(a.effect?.getComputedTiming().iterations!==Infinity)a.finish();}});
    await page.screenshot({path:path.join(out,`${engine}-${label}.png`),fullPage:true});
  };
  const clickText=async label=>{
    await page.waitForFunction(label=>[...document.querySelectorAll('button')].some(e=>e.textContent.trim()===label&&!e.disabled),{},label);
    await page.evaluate(label=>[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===label&&!e.disabled).click(),label);
  };
  const fits=async()=>{
    const s=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,inputs:[...document.querySelectorAll('input,button.ad-row-toggle,.ad-person')].map(e=>{
      const r=e.getBoundingClientRect();return {left:r.left,right:r.right};})}));
    assert.ok(s.scroll<=s.width+1,JSON.stringify(s));assert.ok(s.inputs.every(r=>r.left>=0&&r.right<=s.width+1),JSON.stringify(s));
  };
  await page.waitForSelector('#admin-password');await shot('login');
  assert.equal(server.registry.size,0);assert.equal(server.network.connectionCount,0);
  await page.type('#admin-password','wrong');await clickText('进入面板');await page.waitForSelector('.ad-error');
  await page.type('#admin-password',password);await clickText('进入面板');await page.waitForSelector('.ad-stats');
  assert.equal(server.registry.size,0);assert.equal(server.network.connectionCount,0);
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>/admin|password/i.test(k))),false);
  const cookies=await browser.cookies();const cookie=cookies.find(c=>c.name==='sp_admin');assert.ok(cookie?.httpOnly);assert.equal(cookie.path,'/admin');
  assert.equal(await page.evaluate(()=>document.cookie.includes('sp_admin')),false);
  await clickText('进行中对局');await page.waitForSelector('.ad-empty strong');await shot('empty');
  async function player(name){const c=await TestClient.connect(server.url.replace('http:','ws:')+'/ws');const w=await c.hello(name);c.id=w.playerId;clients.push(c);return c;}
  const host=await player('罗德岛值守博士'),guest=await player('测试同盟队友'),queued=await player('等待匹配的博士'),waiting=await player('等待室创建者'),offline=await player('暂时断线的博士');
  assert.equal((await host.request({t:'room.create',mode:'coop',difficulty:'HARD'})).t,'ok');const room=await host.waitFor('room.state');
  await guest.request({t:'room.join',code:room.code});await guest.request({t:'room.ready',ready:true});await host.request({t:'room.addBot'});await host.request({t:'room.start'});await host.waitFor('m.public',p=>p.phase==='INFO_CHECK');
  await host.request({t:'g.pause',on:true});await guest.request({t:'g.pause',on:true});await host.waitFor('m.public',p=>p.paused);
  await queued.request({t:'match.join',mode:'coop',difficulty:'ABYSS'});
  await waiting.request({t:'room.create',mode:'solo',difficulty:'NORMAL'});await waiting.request({t:'room.addBot'});
  await offline.terminate();
  await page.waitForSelector('.ad-row-toggle');await page.click('.ad-row-toggle');await page.waitForSelector('.ad-roster');await shot('matches');await fits();
  await clickText('总览');await page.waitForSelector('.ad-stats');await page.waitForFunction(()=>document.querySelector('.ad-stat strong')?.textContent==='4');
  await new Promise(r=>setTimeout(r,6500));await shot('overview');await fits();
  await clickText('匹配与房间');await page.waitForSelector('.ad-row-toggle');await page.click('.ad-row-toggle');await shot('queue');
  await clickText('全部房间');await page.waitForFunction(()=>document.querySelectorAll('.ad-row-toggle').length===2);await page.click('.ad-row-toggle');await shot('rooms');
  await clickText('玩家');await page.waitForFunction(()=>document.querySelectorAll('.ad-list-row--player').length===5);await shot('players');
  await page.click('[role=combobox]');await page.waitForSelector('[role=listbox]');await shot('player-filter');await page.keyboard.press('End');await page.keyboard.press('Enter');
  await page.waitForSelector('.ad-empty strong');await page.click('[role=combobox]');await page.keyboard.press('Home');await page.keyboard.press('Enter');
  await page.type('input[type=search]','暂时断线');await page.waitForFunction(()=>document.querySelectorAll('.ad-list-row--player').length===1);await shot('search');
  await page.focus('input[type=search]');await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.waitForFunction(()=>document.querySelectorAll('.ad-list-row--player').length===5);
  for(const [width,height] of [[844,390],[390,844]]){
    await page.setViewport({width,height});await fits();await shot(`players-${width}`);
    await clickText('总览');await page.waitForSelector('.ad-stats');await fits();await shot(`overview-${width}`);
    await clickText('进行中对局');await page.waitForSelector('.ad-row-toggle');await page.click('.ad-row-toggle');await fits();await shot(`matches-${width}`);
    await clickText('玩家');await page.waitForSelector('.ad-list-row--player');
  }
  await page.setViewport({width:1440,height:1000});
  // Reproduce a transient backend failure while retaining the last successful snapshot.
  await page.evaluate(()=>{const original=window.fetch;window.__adminFetch=original;window.fetch=(url,opts)=>String(url).includes('/admin/api/overview')?Promise.resolve(new Response('{}',{status:503})):original(url,opts);});
  await page.waitForSelector('.ad-error--bar');assert.equal(await page.$$('.ad-list-row--player').then(x=>x.length),5);await shot('stale');
  await page.evaluate(()=>{window.fetch=window.__adminFetch;});await page.waitForFunction(()=>!document.querySelector('.ad-error--bar'));
  // Visibility pause cancels all polling; on return it fetches immediately.
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  const before=requests.filter(url=>url.includes('/admin/api/overview')).length;await new Promise(r=>setTimeout(r,3500));
  assert.equal(requests.filter(url=>url.includes('/admin/api/overview')).length,before);
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(()=>!document.querySelector('.ad-live')?.textContent.includes('暂停'));
  // A revoked/expired session also removes private data from the visible UI on the next poll.
  await page.evaluate(()=>fetch('/admin/api/logout',{method:'POST'}));
  await page.waitForSelector('#admin-password');assert.equal(await page.$('.ad-content'),null);
  await page.type('#admin-password',password);await clickText('进入面板');await page.waitForSelector('.ad-content');
  await clickText('退出登录');await page.waitForSelector('#admin-password');assert.equal(await page.$('.ad-content'),null);
  const unauth=await page.evaluate(async()=> (await fetch('/admin/api/overview')).status);assert.equal(unauth,401);
  await page.setViewport({width:390,height:844});await page.goto(panel.url+'/admin?lang=en',{waitUntil:'networkidle0'});
  await page.waitForSelector('#admin-password');await fits();await shot('login-en-390');
  await page.type('#admin-password',password);await clickText('Open panel');await page.waitForSelector('.ad-content');await fits();await shot('players-en-390');
  assert.ok(!requests.some(url=>url.includes('/api/user')||url.endsWith('/ws')||url.includes('/js/net.js')||url.includes('/js/profile.js')),requests.filter(url=>url.includes('profile')||url.includes('net.js')));
  assert.ok(requests.every(url=>!url.startsWith(panel.url)||url.startsWith(panel.url+'/admin')),requests);
  assert.equal(server.registry.size,5);assert.equal(server.network.connectionCount,4);assert.deepEqual(errors,[]);
  await server.close();
  await page.waitForFunction(()=>document.querySelector('.ad-error--bar')?.textContent.includes('Game service unavailable'));
  assert.ok(await page.$('.ad-stats'),'retain the last successful snapshot while the game is down');
  assert.equal((await page.evaluate(()=>fetch('/admin/api/session').then(r=>r.status))),200);
  await shot('game-unavailable');
});
