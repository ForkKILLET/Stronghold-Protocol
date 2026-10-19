// Opt-in real browsers and local split-service proxy; never contacts production players.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {existsSync,mkdirSync} from 'node:fs';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
import {startAdminService} from '../../server/admin/service.js';
import {TestClient} from '../helpers/wsClient.js';

const password='communication-browser-admin-password',token='communication-collector-key-32-characters';
const out=process.env.SP_E2E_OUT || '/tmp/stronghold-admin-communication-shots';
async function splitSite(game,panel){
 const sockets=new Set();
 const server=http.createServer((req,res)=>{
  const target=new URL(req.url.startsWith('/admin')?panel.url:game.url);
  const upstream=http.request({hostname:target.hostname,port:target.port,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
  upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 server.on('upgrade',(req,socket,head)=>{
  const target=new URL(game.url),upstream=net.connect(target.port,target.hostname,()=>{
   upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`+Object.entries(req.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');
   upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);
  });upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>{server.close(r);for(const socket of sockets)socket.destroy();server.closeAllConnections();})};
}
for(const [engine,executablePath] of [['chrome','/run/current-system/sw/bin/google-chrome-stable'],['firefox','/run/current-system/sw/bin/firefox']])test(`${engine}: admin spectator tab and global notification editor`,{
 skip:process.env.SP_E2E!=='1'||!existsSync(executablePath),timeout:90000,
},async()=>{
 mkdirSync(out,{recursive:true});let browser,site,panel,game,host;
 try {
  game=await startServer({host:'127.0.0.1',port:0,quiet:true,workers:0,matchWorkers:1,store:null,userFile:':memory:',nameModeration:null,announcementsFile:null,clientBuild:process.env.SP_E2E_BUILD==='1',adminToken:token,adminPort:0});
  panel=await startAdminService({host:'127.0.0.1',port:0,password,token,gameUrl:game.telemetry.url,publicDir:path.resolve('dist/admin/public')});site=await splitSite(game,panel);
  host=await TestClient.connect(game.url.replace('http:','ws:')+'/ws');await host.hello('测试房主');await host.request({t:'room.create',mode:'coop',difficulty:'NORMAL'});const room=await host.waitFor('room.state');
  await host.request({t:'room.addBot'});await host.request({t:'room.start'});await host.waitFor('m.public',p=>p.phase==='INFO_CHECK');
  browser=await puppeteer.launch({browser:engine,executablePath,headless:true,args:engine==='chrome'?['--no-sandbox','--mute-audio','--no-proxy-server']:[]});
  const original=await browser.newPage();await original.setViewport({width:1366,height:768});await original.goto(site.url,{waitUntil:'domcontentloaded'});await original.waitForSelector('.title-login input');
  await original.type('.title-login input','服主观战');await original.click('.title-login .btn--primary');await original.waitForSelector('.lobby-hub');
  const originalId=await original.evaluate(()=>window.__SP__.store.get().me.playerId);
  const page=await browser.newPage();await page.setViewport({width:1440,height:900});await page.goto(site.url+'/admin',{waitUntil:'domcontentloaded'});await page.waitForSelector('#admin-password');await page.type('#admin-password',password);await page.click('.ad-login .btn--primary');await page.waitForSelector('.ad-stats');
  await page.evaluate(()=>[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='进行中对局').click());await page.waitForSelector('.ad-spectate');
  const link=await page.$eval('.ad-spectate',a=>({target:a.target,rel:a.rel,url:a.href}));assert.equal(link.target,'_blank');assert.match(link.rel,/noopener/);assert.equal(new URL(link.url).searchParams.get('spectate'),room.code);
  await page.screenshot({path:path.join(out,`${engine}-spectate-desktop.png`),fullPage:true});
  const target=browser.waitForTarget(t=>t.url()===link.url);await page.click('.ad-spectate');const spectator=await(await target).page();
  await spectator.waitForFunction(()=>window.__SP__?.store.get().room?.spectators?.some(p=>p.playerId===window.__SP__.store.get().me.playerId),{timeout:20000});
  const state=await spectator.evaluate(()=>{const s=window.__SP__.store.get();return{id:s.me.playerId,code:s.room.code,seated:s.room.seats.some(p=>p?.playerId===s.me.playerId),private:s.match.private};});
  assert.equal(state.code,room.code);assert.notEqual(state.id,originalId);assert.equal(state.seated,false);assert.equal(state.private,null);
  assert.equal(await original.evaluate(()=>window.__SP__.store.get().room),null,'the original tab is left in the lobby');
  await spectator.close();await page.bringToFront();await page.setViewport({width:390,height:844});
  await page.screenshot({path:path.join(out,`${engine}-spectate-mobile.png`),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.setViewport({width:1440,height:1000});
  const tab=async(p,label)=>p.evaluate(label=>[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent===label).click(),label);
  await tab(page,'服务器通知');await page.waitForSelector('.ad-message textarea');
  const message='<b>维护通知</b> 请在当前对局结束后退出。';
  await page.type('.ad-message textarea',message);assert.equal(game.announcements.serverMessage.state().message,null,'typing is only a draft');
  assert.equal(await page.$eval('.ad-message__preview p',e=>e.textContent),message);assert.equal(await page.$('.ad-message__preview b'),null);
  await page.click('.ad-message__actions .btn--primary');await page.waitForFunction(()=>document.querySelector('.ad-message__result')?.textContent.includes('已发布'));
  await host.waitFor('site.announcement',m=>m.announcement?.text===message);
  await original.waitForFunction(text=>window.__SP__.store.get().announcement?.text===text,{},message);
  assert.equal(await original.$('.site-notice b'),null,'notification text never becomes HTML');
  await page.screenshot({path:path.join(out,`${engine}-message-desktop.png`),fullPage:true});
  await original.screenshot({path:path.join(out,`${engine}-message-game.png`)});
  await original.bringToFront();await original.click('.site-notice__close');await original.waitForSelector('.site-notice',{hidden:true});

  // Another connected client receives the current notice before entering a room.
  const late=await browser.newPage();await late.goto(site.url,{waitUntil:'domcontentloaded'});await late.waitForFunction(text=>window.__SP__?.store.get().announcement?.text===text,{},message);await late.close();
  await page.bringToFront();await page.type('.ad-message textarea',' 尚未发布的草稿');
  const second=await browser.newPage();await second.goto(site.url+'/admin',{waitUntil:'domcontentloaded'});await second.waitForSelector('.ad-stats');await tab(second,'服务器通知');await second.waitForSelector('.ad-message textarea');
  await second.$eval('.ad-message textarea',e=>{e.value='新的维护通知';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await second.click('.ad-message__actions .btn--primary');await second.waitForSelector('.ad-message__result');
  await page.bringToFront();await page.waitForSelector('.ad-message__conflict');assert.ok(await page.$eval('.ad-message__actions .btn--primary',e=>e.disabled));
  assert.ok((await page.$eval('.ad-message textarea',e=>e.value)).includes('尚未发布的草稿'),'polling preserves unsaved text');
  await page.screenshot({path:path.join(out,`${engine}-message-conflict.png`),fullPage:true});
  await original.waitForSelector('.site-notice');assert.equal(await original.$eval('.site-notice__accessible',e=>e.textContent),'新的维护通知','a new published version appears after dismissal');
  await page.click('.ad-message__conflict button');await page.waitForFunction(()=>!document.querySelector('.ad-message__conflict'));
  assert.equal(await page.$eval('.ad-message textarea',e=>e.value),'新的维护通知');
  await page.setViewport({width:390,height:844});await page.screenshot({path:path.join(out,`${engine}-message-mobile.png`),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.click('.ad-message__actions .btn--secondary');await page.waitForFunction(()=>document.querySelector('.ad-message__result')?.textContent.includes('已撤下'));
  await original.waitForFunction(()=>window.__SP__.store.get().announcement===null);
  assert.ok(game.lobby.rooms.get(room.code).match,'admin messages leave the match running');await second.close();
  const english=await browser.newPage();await english.setViewport({width:390,height:844});await english.goto(site.url+'/admin?lang=en',{waitUntil:'domcontentloaded'});await english.waitForSelector('.ad-stats');await tab(english,'Server notification');await english.waitForSelector('.ad-message textarea');
  await english.screenshot({path:path.join(out,`${engine}-message-en-mobile.png`),fullPage:true});assert.ok(await english.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await english.close();
  await page.bringToFront();await game.close();await page.waitForSelector('.ad-error--bar');
  assert.ok(await page.$eval('.ad-message__actions .btn--primary',e=>e.disabled),'offline data cannot publish');
  assert.ok(await page.$eval('.ad-message__actions .btn--secondary',e=>e.disabled),'offline data cannot withdraw');
  await page.screenshot({path:path.join(out,`${engine}-message-offline.png`),fullPage:true});


 } catch(error){console.error(engine,error.stack);throw error;} finally {await browser?.close();await site?.close();await panel?.close();await game?.close();await host?.terminate();}
});
