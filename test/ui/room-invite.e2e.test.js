// Real server and a local proxy delaying only profile/WS setup; never touches production or a user's browser.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import tcp from 'node:net';
import {existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
import {TestClient} from '../helpers/wsClient.js';

async function delayedSite(game){
 const target=new URL(game.url),sockets=new Set(),profiles=[],upgrades=[];
 let holdProfile=true,holdWs=true,wsWaiting=null;
 const forward=(req,res)=>{
  const upstream=http.request({hostname:target.hostname,port:target.port,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
  upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
 };
 const upgrade=(req,socket,head)=>{
  if(socket.destroyed)return;
  const upstream=tcp.connect(Number(target.port),target.hostname,()=>{
   upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`+Object.entries(req.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');
   upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);
  });upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
 };
 const server=http.createServer((req,res)=>{if(holdProfile&&req.url==='/api/user')profiles.push(()=>forward(req,res));else forward(req,res);});
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
 server.on('upgrade',(req,socket,head)=>{if(holdWs){upgrades.push({socket,run:()=>upgrade(req,socket,head)});wsWaiting?.();wsWaiting=null;}else upgrade(req,socket,head);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return{url:`http://127.0.0.1:${server.address().port}`,hold:()=>{holdWs=true;},waitWs:()=>upgrades.length?Promise.resolve():new Promise(resolve=>{wsWaiting=resolve;}),dropWs:()=>upgrades.splice(0).forEach(p=>p.socket.destroy()),releaseProfile:()=>{holdProfile=false;profiles.splice(0).forEach(fn=>fn());},releaseWs:()=>{holdWs=false;upgrades.splice(0).forEach(p=>p.run());},close:()=>new Promise(resolve=>{server.close(resolve);for(const s of sockets)s.destroy();server.closeAllConnections();})};
}
for(const [engine,executablePath] of [['chrome','/run/current-system/sw/bin/google-chrome-stable'],['firefox','/run/current-system/sw/bin/firefox']])test(`${engine}: invitation feedback covers boot, connecting, joining, cancellation and retry`,{
 skip:process.env.SP_E2E!=='1'||!existsSync(executablePath),timeout:120000,
},async()=>{
 const out=process.env.SP_E2E_OUT||'/tmp/stronghold-room-invite';mkdirSync(out,{recursive:true});let server,site,browser,host;
 try{
  server=await startServer({port:0,host:'127.0.0.1',quiet:true,workers:0,userFile:':memory:',clientBuild:process.env.SP_E2E_BUILD==='1',assetIndex:false,announcementsFile:null,nameModeration:null});
  site=await delayedSite(server);
  host=await TestClient.connect(server.url.replace('http:','ws:')+'/ws');await host.hello('邀请测试房主');await host.request({t:'room.create',mode:'coop',difficulty:'NORMAL'});
  const code=(await host.waitFor('room.state')).code;
  browser=await puppeteer.launch({browser:engine,executablePath,headless:true,args:engine==='chrome'?['--no-sandbox','--mute-audio','--no-proxy-server']:[]});
  const errors=[];
  const open=async(query,{entered=true,width=1366,height=768}={})=>{
   site.hold();const context=await browser.createBrowserContext(),page=await context.newPage();
   page.on('pageerror',e=>{
    // Firefox reports our deliberately dropped/abandoned WS handshakes as native page errors.
    if(engine==='firefox'&&e.message.includes(site.url.replace('http:','ws:')+'/ws')&&/can.t establish a connection|interrupted while the page was loading/.test(e.message))return;
    errors.push(e.message);
   });
   let sawProfile;const profile=new Promise(resolve=>{sawProfile=resolve;});page.on('request',r=>{if(new URL(r.url()).pathname==='/api/user')sawProfile();});
   await page.setViewport({width,height});
   await page.evaluateOnNewDocument(entered=>{if(entered){localStorage.setItem('sp.name','邀请验证');sessionStorage.setItem('sp.entered','1');}},entered);
   await page.goto(site.url+'/'+query,{waitUntil:'domcontentloaded'});return{page,context,profile};
  };
  const settle=page=>page.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();await new Promise(requestAnimationFrame);});
  const screenshot=async(page,label)=>{await settle(page);await page.screenshot({path:path.join(out,`${engine}-${label}.png`)});};
  const check=page=>page.$eval('.room-invite',e=>{const r=e.getBoundingClientRect(),buttons=[...e.querySelectorAll('button')].filter(b=>!b.disabled);return{inside:r.top>=0&&r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,overflow:e.scrollWidth>e.clientWidth+1,reachable:buttons.every(b=>{const r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit&&b.contains(hit);})};});
  const first=await open(`?room=${code}`),page=first.page;
  await first.profile;
  const bootText=await page.$eval('#boot',e=>e.textContent);await screenshot(page,'boot');
  site.releaseProfile();await page.waitForSelector('.lobby-hub');await screenshot(page,'connecting-desktop');
  assert.ok(await page.$('.room-invite'),'invite is visible before the WebSocket handshake');assert.ok(bootText.includes(code),'profile initialization identifies the invitation');
  assert.match(await page.$eval('.room-invite',e=>e.textContent),/正在连接服务器/);assert.deepEqual(await check(page),{inside:true,overflow:false,reachable:true});
  await site.waitWs();site.dropWs();await page.waitForFunction(()=>window.__SP__.store.get().connection.status==='reconnecting');await screenshot(page,'reconnecting');
  assert.equal(await page.$('.conn-banner'),null,'invitation owns connection feedback without a duplicate banner');
  await page.locator('[data-testid="invite-retry"]').click();await page.waitForFunction(()=>window.__SP__.store.get().connection.status==='connecting');
  await page.evaluate(()=>{
   const request=window.__SP__.net.request.bind(window.__SP__.net);window.__inviteCalls=0;
   window.__SP__.net.request=async(t,fields)=>{if(t==='room.join'){window.__inviteCalls++;await new Promise(resolve=>{window.__releaseJoin=resolve;});}return request(t,fields);};
  });
  site.releaseWs();await page.waitForFunction(()=>typeof window.__releaseJoin==='function');await screenshot(page,'joining');
  assert.match(await page.$eval('.room-invite',e=>e.textContent),/正在加入同盟/);
  await page.keyboard.press('Escape');assert.ok(await page.$('.room-invite'),'cannot cancel a request that may already have reached the server');
  await page.evaluate(()=>window.__releaseJoin());await page.waitForSelector('.room-screen');
  assert.equal(await page.evaluate(()=>window.__SP__.store.get().room.code),code);assert.equal(await page.evaluate(()=>window.__inviteCalls),1);
  assert.equal(await page.evaluate(()=>new URL(location.href).searchParams.has('room')),false);await first.context.close();

  const lostAck=await open(`?room=${code}`);await lostAck.page.waitForSelector('.room-invite');
  await lostAck.page.evaluate(()=>{
   const request=window.__SP__.net.request.bind(window.__SP__.net);
   window.__SP__.net.request=async(t,fields)=>{const result=await request(t,fields);if(t==='room.join')throw Object.assign(new Error('Simulated lost acknowledgement'),{code:'TIMEOUT'});return result;};
  });site.releaseWs();await lostAck.page.waitForSelector('.room-screen');await lostAck.page.waitForFunction(()=>!window.__SP__.store.get().ui.pendingJoin);await lostAck.context.close();

  const canceled=await open(`?room=${code}&lang=en&keep=1#invite`,{width:844,height:390});
  await canceled.page.waitForSelector('.room-invite');await screenshot(canceled.page,'connecting-mobile');assert.deepEqual(await check(canceled.page),{inside:true,overflow:false,reachable:true});
  assert.match(await canceled.page.$eval('.room-invite',e=>e.textContent),/Connecting/);
  await canceled.page.locator('[data-testid="invite-cancel"]').click();await canceled.page.waitForSelector('.room-invite',{hidden:true});
  site.releaseWs();await canceled.page.waitForFunction(()=>window.__SP__.store.get().connection.status==='online');
  assert.equal(await canceled.page.evaluate(()=>window.__SP__.store.get().room),null);
  assert.equal(await canceled.page.evaluate(()=>location.search+location.hash),'?keep=1#invite');await canceled.context.close();

  const missing=await open('?room=ZZZZ',{width:640,height:360});await missing.page.waitForSelector('.room-invite');
  await missing.page.evaluate(()=>{
   document.documentElement.dataset.text='xl';window.__inviteCalls=0;
   const request=window.__SP__.net.request.bind(window.__SP__.net);window.__SP__.net.request=(t,fields)=>{if(t==='room.join')window.__inviteCalls++;return request(t,fields);};
  });site.releaseWs();
  await missing.page.waitForSelector('.room-invite__error');await screenshot(missing.page,'error-mobile');assert.deepEqual(await check(missing.page),{inside:true,overflow:false,reachable:true});
  assert.equal(await missing.page.evaluate(()=>window.__SP__.store.get().ui.pendingJoin),'ZZZZ','failed invitation is kept for retry');
  await missing.page.locator('[data-testid="invite-retry"]').click();await missing.page.waitForFunction(()=>window.__inviteCalls===2&&!!window.__SP__.store.get().ui.pendingJoinError);
  await missing.page.locator('[data-testid="invite-cancel"]').click();await missing.page.waitForSelector('.room-invite',{hidden:true});await missing.context.close();

  const fresh=await open(`?spectate=${code}`,{entered:false,width:844,height:390});await fresh.page.waitForSelector('.title-invite');
  assert.ok((await fresh.page.$eval('.title-invite',e=>e.textContent)).includes(code));await fresh.page.type('.title-login input','观战验证');await fresh.page.locator('.title-login .btn--primary').click();
  await fresh.page.waitForSelector('.room-invite');assert.match(await fresh.page.$eval('.room-invite',e=>e.textContent),/观战/);
  site.releaseWs();await fresh.page.waitForSelector('.room-screen');assert.ok(await fresh.page.evaluate(()=>window.__SP__.store.get().room.spectators.some(p=>p.playerId===window.__SP__.store.get().me.playerId)));await fresh.context.close();
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await site?.close();await host?.close();await server?.close();}
});
