// SP_E2E=1: real HTTP-cache revalidation and slow caption text, isolated from the user's browser.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';

for(const [engine,executablePath] of [['chrome','/run/current-system/sw/bin/google-chrome-stable'],['firefox','/run/current-system/sw/bin/firefox']]) {
 test(`${engine}: cached captions survive slow revalidation and cold text can arrive after ten seconds`,{
  skip:process.env.SP_E2E!=='1'||!existsSync(executablePath),timeout:90000,
 },async()=>{
  const srv=await startServer({host:'127.0.0.1',port:0,quiet:true,workers:0,userFile:':memory:',clientBuild:false,assetIndex:false,announcementsFile:null});
  const out=new URL('../e2e/out/voice-caption-loading/',import.meta.url);mkdirSync(out,{recursive:true});
  const original=srv.server.listeners('request');assert.equal(original.length,1);
  let mode='seed',browser;const pending=[],requests=[],errors=[],measures={};
  const body=version=>({'char_263_skadi/cn_021':`${version}：听你的。`,'char_102_texas/cn_021':`${version}：给我命令。`});
  const reply=(res,version)=>{if(res.destroyed)return;res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-cache',ETag:`"${version}"`});res.end(JSON.stringify(body(version)));};
  srv.server.removeListener('request',original[0]);
  srv.server.on('request',(req,res)=>{
   if(req.url!=='/data/voice-captions/zh.json'){original[0].call(srv.server,req,res);return;}
   requests.push({mode,conditional:req.headers['if-none-match']||null});
   if(mode==='seed')reply(res,'cached');
   else if(mode==='hold')pending.push(res);
   else {const timer=setTimeout(()=>reply(res,'cold'),12000);res.on('close',()=>clearTimeout(timer));}
  });
  try {
   browser=await puppeteer.launch({browser:engine,executablePath,headless:true,args:engine==='chrome'?['--no-sandbox','--mute-audio','--no-proxy-server']:[]});
   const prepare=async page=>{
    page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1484,height:780});
    await page.goto(srv.url+'/dev/game-mock.html?render=fallback&shot=1&phase=COMBAT',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!window.__MOCK__&&window.__SP_VIEW__?.kind==='fallback');
    await page.click('.gm__gear[aria-label="设置"]');await page.waitForSelector('.settings-modal');await page.keyboard.press('Escape');await page.waitForSelector('.settings-modal',{hidden:true});
    await page.evaluate(async()=>{
     const {audio}=await import('/js/audio.js');audio._unlock();await audio.ctx.resume();
     audio.getManifest=()=>({audio:{voice:Object.fromEntries(['char_263_skadi','char_102_texas'].map(id=>[id,{select:`/assets/audio/voice/cn/${id}/cn_021.mp3`}]))}});
     audio._buffer=async()=>audio.ctx.createBuffer(1,audio.ctx.sampleRate*25,audio.ctx.sampleRate);
     const {updateSettings}=await import('/js/ui/settings.js');updateSettings({voiceSubtitles:false,voiceSubtitleMode:'ui',voiceLang:'cn',voice:.8,muted:false,textSize:'sm'});
    });
   };
   const play=(page,id)=>page.evaluate(async id=>{const {audio}=await import('/js/audio.js');audio.previewVoice(id,'cn');},id);
   const end=page=>page.evaluate(async()=>{const {audio}=await import('/js/audio.js');audio.voiceNode.src.onended();});
   const enable=async page=>{
    await page.evaluate(async()=>{const {updateSettings}=await import('/js/ui/settings.js');updateSettings({voiceSubtitles:true});await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
   };
   const page=await browser.newPage();await prepare(page);
   await page.evaluate(()=>fetch('/data/voice-captions/zh.json',{cache:'reload'}).then(r=>r.json()));
   mode='hold';const started=Date.now();await enable(page);await play(page,'char_263_skadi');
   await page.waitForSelector('.voice-subtitles',{visible:true,timeout:2500});
   measures.cachedMs=Date.now()-started;
   assert.match(await page.$eval('.voice-subtitles',e=>e.textContent),/cached/);
   assert.equal(pending.length,1,'network validation runs once in the background');
   assert.equal(requests[1].conditional,'"cached"','background validation keeps the HTTP validator');
   await page.screenshot({path:new URL(`${engine}-cached-during-revalidation.png`,out).pathname});
   await play(page,'char_102_texas');
   await page.waitForFunction(()=>document.querySelector('.voice-subtitles__speaker')?.textContent.includes('德克萨斯'));
   await end(page);await page.waitForSelector('.voice-subtitles',{hidden:true});
   const updated=page.waitForResponse(r=>r.url().endsWith('/data/voice-captions/zh.json')).then(r=>r.text());
   pending.splice(0).forEach(res=>reply(res,'updated'));await updated;
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   assert.equal(await page.$('.voice-subtitles'),null,'late table update cannot resurrect ended speech');
   await play(page,'char_102_texas');await page.waitForFunction(()=>document.querySelector('.voice-subtitles')?.textContent.includes('updated'));
   assert.match(await page.$eval('.voice-subtitles__speaker',e=>e.textContent),/德克萨斯/);
   await page.close();

   // A fresh browser context has no HTTP table. A twelve-second response must not be cut off at ten seconds.
   mode='cold';const context=await browser.createBrowserContext(),cold=await context.newPage();await prepare(cold);
   const coldStart=Date.now();await enable(cold);await play(cold,'char_263_skadi');
   await cold.waitForSelector('.voice-subtitles',{visible:true,timeout:17000});measures.coldMs=Date.now()-coldStart;
   assert.ok(measures.coldMs>=11000,'cold request really crossed the old timeout');
   assert.match(await cold.$eval('.voice-subtitles',e=>e.textContent),/cold/);
   await cold.screenshot({path:new URL(`${engine}-cold-recovered.png`,out).pathname});
   await context.close();assert.deepEqual(errors,[]);
  } finally {
   pending.forEach(res=>res.destroy());await browser?.close();await srv.close();
   writeFileSync(new URL(`${engine}-measurements.json`,out),JSON.stringify({measures,requests,errors},null,2));
  }
 });
}
