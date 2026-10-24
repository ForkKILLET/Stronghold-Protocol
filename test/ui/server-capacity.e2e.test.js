// Isolated capacity feedback in both supported desktop engines; never connects to production.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync} from 'node:fs';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
import {localFontsOnly} from '../helpers/localFonts.js';

for(const [engine,executablePath] of [['chrome','/run/current-system/sw/bin/google-chrome-stable'],['firefox','/run/current-system/sw/bin/firefox']])test(`${engine}: a full server preserves the invitation and provides a deliberate refresh action`,{
 skip:process.env.SP_E2E!=='1'||!existsSync(executablePath),timeout:60000,
},async()=>{
 const server=await startServer({host:'127.0.0.1',port:0,workers:0,userFile:':memory:',maxConnections:0,quiet:true,announcementsFile:null,clientBuild:process.env.SP_E2E_BUILD==='1'});
 const out=process.env.SP_E2E_OUT||'/tmp/sp-xinhai-capacity';mkdirSync(out,{recursive:true});let browser;
 try{
  browser=await puppeteer.launch({browser:engine,executablePath,headless:true,args:engine==='chrome'?['--no-sandbox','--mute-audio','--no-proxy-server']:[]});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await localFontsOnly(page);
  await page.evaluateOnNewDocument(()=>{localStorage.setItem('sp.name','容量验证');sessionStorage.setItem('sp.entered','1');});
  await page.setViewport({width:1366,height:768});
  await page.goto(server.url+'/?room=ABCD',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('.app-header__connection')?.textContent.includes('当前服务器容量已满'));
  assert.equal(await page.$eval('.title-login .btn--primary',e=>e.textContent.trim()),'刷新页面');
  assert.equal(await page.$eval('.title-login input',e=>e.value),'容量验证');
  assert.equal(new URL(page.url()).searchParams.get('room'),'ABCD');
  assert.equal(server.registry.size,0);assert.equal(server.network.onlineCount,0);
  for(const size of [{width:1366,height:768},{width:740,height:360}]){
   await page.setViewport(size);await new Promise(r=>setTimeout(r,180));
   assert.ok(await page.$eval('.app-header',e=>e.getBoundingClientRect().right<=innerWidth+1),'header stays inside the viewport');
   assert.ok(await page.$eval('.app-header__connection',e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth;}),'capacity feedback is visible');
   await page.screenshot({path:out+'/'+engine+'-'+size.width+'.png'});
  }
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('.title-login .btn--primary').click()]);
  await page.waitForFunction(()=>document.querySelector('.app-header__connection')?.textContent.includes('当前服务器容量已满'));
  assert.equal(new URL(page.url()).searchParams.get('room'),'ABCD');assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
