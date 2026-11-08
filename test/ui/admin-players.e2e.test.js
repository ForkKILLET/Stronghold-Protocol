// Desktop Firefox, isolated local accounts; never reads production data or recovery codes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import {existsSync,mkdirSync} from 'node:fs';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
import {startAdminService} from '../../server/admin/service.js';
import {TestClient} from '../helpers/wsClient.js';

const executablePath=process.env.FIREFOX_PATH || '/run/current-system/sw/bin/firefox';
test('firefox: unified account roster, profile link, recovery dialog and stale status',{
  skip:process.env.SP_E2E!=='1'||!existsSync(executablePath),timeout:90000,
},async t=>{
  const password='local-player-panel-password',token='local-player-collector-token-32-characters';
  const out=process.env.SP_E2E_OUT || path.resolve('test/e2e/out/admin-players');mkdirSync(out,{recursive:true});
  const game=await startServer({host:'127.0.0.1',port:0,quiet:true,workers:0,matchWorkers:0,store:null,userFile:':memory:',nameModeration:null,announcementsFile:null,clientBuild:false,adminToken:token,adminPort:0});
  const panel=await startAdminService({host:'127.0.0.1',port:0,password,token,gameUrl:game.telemetry.url,publicDir:path.resolve('dist/admin/public')});
  const site=http.createServer((req,res)=>{
    const target=new URL(req.url.startsWith('/admin')?panel.url:game.url);
    const upstream=http.request({hostname:target.hostname,port:target.port,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
    upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
  });
  await new Promise(r=>site.listen(0,'127.0.0.1',r));const siteUrl=`http://127.0.0.1:${site.address().port}`;
  let browser;const clients=[];
  t.after(async()=>{await browser?.close();await new Promise(r=>{site.close(r);site.closeAllConnections();});await panel.close();await game.close();await Promise.all(clients.map(c=>c.terminate()));});
  const accounts=[];
  for(const name of ['罗德岛值守博士','离线档案博士','沉默的守望者','公开资料测试','长代号的博士测试','另一位博士']){
    const account=await game.users.call('create');accounts.push(account);
    await game.users.call('update',{id:account.user.id,name,avatarId:'avatar:Avatar_def_01'});
  }
  const live=await TestClient.connect(game.url.replace('http:','ws:')+'/ws',{wsOptions:{headers:{Cookie:'sp_user='+accounts[0].token}}});clients.push(live);await live.hello('罗德岛值守博士');
  const temp=await TestClient.connect(game.url.replace('http:','ws:')+'/ws');clients.push(temp);await temp.hello('临时游玩博士');
  browser=await puppeteer.launch({browser:'firefox',executablePath,headless:true,
    extraPrefsFirefox:{'dom.ipc.processCount':1,'dom.ipc.processCount.webIsolated':1,'fission.autostart':false,'media.volume_scale':'0.0'}});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:1440,height:1000});await page.goto(siteUrl+'/admin',{waitUntil:'networkidle0'});await page.bringToFront();
  const click=async text=>{
    await page.waitForFunction(text=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===text&&!b.disabled),{},text);
    await page.evaluate(text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text&&!b.disabled).click(),text);
  };
  await page.type('#admin-password',password);await click('进入面板');await page.waitForSelector('.ad-stats');
  await page.click('.ad-stat');await page.waitForFunction(()=>document.querySelectorAll('.ad-list-row--account').length===2);
  assert.ok((await page.$eval('[role=combobox]',e=>e.textContent)).includes('在线'),'overview opens online filter');
  await click('玩家');await page.waitForFunction(()=>document.querySelectorAll('.ad-list-row--account').length===7);
  const shot=async label=>{
    await page.evaluate(()=>{for(const a of document.getAnimations())if(a.effect?.getComputedTiming().iterations!==Infinity)a.finish();});
    await page.screenshot({path:path.join(out,'firefox-'+label+'.png'),fullPage:true});
  };
  assert.deepEqual(await page.$$eval('.ad-player-counts b',es=>es.map(e=>e.textContent)),['6','1','5','1']);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const columns=await page.$$eval('.ad-list-row--account > .ad-tag',es=>es.map(e=>e.getBoundingClientRect().left));
  assert.ok(Math.max(...columns)-Math.min(...columns)<1,'temporary and persistent rows share columns');
  await page.waitForFunction(()=>[...document.querySelectorAll('.ad-avatar img')].every(i=>i.complete&&i.naturalWidth>0));
  await shot('players');
  const links=await page.$$eval('.ad-account-actions a',es=>es.map(e=>({href:e.getAttribute('href'),target:e.target})));
  assert.equal(links.length,6);assert.ok(links.every(l=>/^\/\?doctor=[A-Z0-9]{4}$/.test(l.href)&&l.target==='_blank'));
  await page.type('input[type=search]',accounts[1].user.publicId.toLowerCase());
  await page.waitForFunction(()=>document.querySelectorAll('.ad-list-row--account').length===1);
  await page.click('.ad-account-actions button');await page.waitForSelector('[role=dialog]');await shot('management');
  await click('生成新恢复码');await shot('recovery-confirm');
  await click('确认签发');await page.waitForSelector('.ad-recovery-code input');await shot('recovery-issued');
  const code=await page.$eval('.ad-recovery-code input',e=>e.value);assert.match(code,/^SP-/);
  assert.equal((await game.users.call('recover',{code})).user.id,accounts[1].user.id);
  await click('完成');await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
  assert.ok(!(await page.content()).includes(code));assert.ok(!(await page.evaluate(()=>JSON.stringify(localStorage))).includes(code));
  await page.click('.ad-account-actions button');await click('生成新恢复码');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
  // Independently deploying the panel before the game must not call retained sessions temporary accounts.
  await page.evaluate(()=>{
    const original=window.fetch;window.__adminOriginalFetch=original;
    window.fetch=async(url,options)=>{
      const response=await original(url,options);
      if(!response.ok || !/\/admin\/api\/(overview|list)/.test(String(url)))return response;
      const value=await response.json();
      if(String(url).includes('/overview')){delete value.capabilities.players;delete value.capabilities.playerRecovery;}
      else {delete value.counts;for(const row of value.items){delete row.persistent;delete row.publicId;}}
      return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
    };
  });
  await page.waitForFunction(()=>document.querySelector('.ad-list > .ad-note')?.textContent.includes('游戏服务尚未更新'));
  assert.equal(await page.$eval('.ad-account-id',e=>e.textContent),'会话玩家');
  assert.equal(await page.$('.ad-account-actions a'),null);
  await page.click('.ad-account-actions button');assert.equal(await page.$('.ad-player-modal .btn--danger'),null);await shot('pending-game-update');await click('完成');
  await page.evaluate(()=>{window.fetch=window.__adminOriginalFetch;});
  await page.waitForSelector('.ad-account-actions a');
  // Game downtime keeps the roster visible but marks state unknown and disables credentials.
  await game.close();await page.waitForSelector('.ad-error--bar');
  assert.equal(await page.$eval('.ad-list-row--account > .ad-tag',e=>e.textContent),'状态未知');
  await page.click('.ad-account-actions button');assert.equal(await page.$eval('.ad-player-modal .btn--danger',e=>e.disabled),true);
  await shot('offline');await click('完成');await click('退出登录');await page.waitForSelector('#admin-password');
  assert.equal(await page.$('.ad-list-row--account'),null);assert.deepEqual(errors,[]);
});
