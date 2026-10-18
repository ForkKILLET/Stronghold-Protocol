import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
const root=path.resolve(import.meta.dirname,'../../dist/downloads');
const ids=['core','common','voice-cn','voice-jp','voice-en','voice-kr','skins'];
const names=['基础画面包','通用增强包','中文语音包','日语语音包','英语语音包','韩语语音包','干员皮肤包'];
const mb=[395,274,66,86,71,80,346];
const doc={format:'stronghold-resource-downloads',version:1,resourceVersion:'13571b1bd40d',generatedAt:'2026-10-18T10:00:00Z',count:33226,
  packages:ids.map((id,i)=>({id,title:names[i],description:i===0?'地图、棋盘、默认模型、干员与敌人图片、界面和字体':'已部署资源，下载后在游戏内导入',badge:i===0?'基础资源':'按需追加',micro:id.toUpperCase(),
    count:100+i,size:mb[i]*1024**2,sha256:'a'.repeat(64),url:`files/${id}-0123456789ab.zip`,mirrors:[`https://github.com/ForkKILLET/Stronghold-Protocol/releases/download/resources-test/${id}.zip`]}))};
for(const engine of ['chrome','firefox'])test(`${engine}: static download portal, recommended packages, failure/retry and responsive screenshots`,{skip:process.env.SP_E2E!=='1',timeout:60000},async t=>{
  let fail=false;const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/downloads/downloads.json'){res.writeHead(fail?503:200,{'Content-Type':'application/json'});res.end(JSON.stringify(doc));return;}
    const rel=url.pathname.replace(/^\/downloads\//,'');
    try{const file=path.join(root,rel||'index.html');const body=await fs.readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(body);}catch{res.writeHead(404);res.end();}
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await puppeteer.launch({browser:engine,executablePath:engine==='chrome'?'/run/current-system/sw/bin/google-chrome-stable':'/run/current-system/sw/bin/firefox',headless:true,args:engine==='chrome'?['--no-sandbox']:[]});t.after(()=>browser.close());
  const page=await browser.newPage(),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  const base=`http://127.0.0.1:${server.address().port}`;
  const out='/tmp/stronghold-download-shots';await fs.mkdir(out,{recursive:true});
  for(const [width,height] of [[1440,1000],[844,390],[390,844]]){
    await page.setViewport({width,height});await page.goto(base+'/downloads/',{waitUntil:'networkidle0'});
    await page.waitForSelector('.dl-card');assert.equal(await page.$$eval('.dl-card',e=>e.length),7);
    assert.equal(await page.$eval('#recommended-size',e=>e.textContent),'735.0 MiB');
    await page.click('[data-voice="jp"]');assert.equal(await page.$eval('#recommended-size',e=>e.textContent),'755.0 MiB');
    const sizes=await page.evaluate(()=>({w:innerWidth,sw:document.documentElement.scrollWidth,links:[...document.querySelectorAll('.dl-button')].map(e=>e.getBoundingClientRect().height)}));
    assert.ok(sizes.sw<=sizes.w+1,JSON.stringify(sizes));assert.ok(sizes.links.every(h=>h>=40));
    await page.screenshot({path:`${out}/${engine}-${width}.png`,fullPage:true});
  }
  fail=true;await page.reload({waitUntil:'networkidle0'});assert.match(await page.$eval('#notice',e=>e.textContent),/无法读取/);
  fail=false;await page.click('#notice button');await page.waitForSelector('.dl-card');
  assert.deepEqual(errors,[]);assert.equal(requests.some(u=>/\/ws|\/api\/users/.test(u)),false,'download portal creates no player connection');
});
