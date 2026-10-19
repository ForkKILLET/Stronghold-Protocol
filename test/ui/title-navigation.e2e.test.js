// SP_E2E=1 runs both browsers; SP_E2E_BUILD=1 uses the compiled client.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync} from 'node:fs';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';

for(const [engine,executablePath] of [
  ['chrome',process.env.CHROME_PATH || '/run/current-system/sw/bin/google-chrome-stable'],
  ['firefox',process.env.FIREFOX_PATH || '/run/current-system/sw/bin/firefox'],
]) test(`title navigation and connection layout (${engine})`,{
  skip:process.env.SP_E2E!=='1' || !existsSync(executablePath),timeout:120000,
},async()=>{
  const built=process.env.SP_E2E_BUILD==='1';
  const srv=await startServer({host:'127.0.0.1',port:0,quiet:true,workers:0,userFile:':memory:',clientBuild:built,assetIndex:false,announcementsFile:null});
  const out=new URL('../e2e/out/',import.meta.url);mkdirSync(out,{recursive:true});
  let browser;
  try {
    browser=await puppeteer.launch({browser:engine,executablePath,headless:true,args:engine==='chrome'?['--no-sandbox','--mute-audio','--no-proxy-server']:[]});
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const settle=()=>page.evaluate(async()=>{
      await document.fonts.ready;
      document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a=>a.finish());
      await new Promise(requestAnimationFrame);
    });
    await page.setViewport({width:1440,height:900});
    await page.goto(srv.url,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__SP__?.store.get().connection.status==='connected');
    await page.waitForSelector('.title-screen .app-header');
    assert.equal(await page.evaluate(()=>[...document.scripts].some(s=>s.src.includes('/build/assets/index-'))),built);
    assert.equal(await page.$eval('.app-header__connection',e=>e.textContent.trim()),'已连接');
    assert.equal(await page.$('.app-header .ping'),null,'no latency before hello');
    assert.equal(await page.$('.app-header .online-count'),null,'no invented player count');
    assert.equal(await page.$('.title-login .settings-btn'),null,'login form only contains entry actions');
    await page.evaluate(()=>{const event=new Event('beforeinstallprompt',{cancelable:true});event.prompt=async()=>({outcome:'dismissed'});window.dispatchEvent(event);});
    await page.waitForSelector('.app-header [data-testid="pwa-install"]');
    const tools=()=>page.$$eval('.app-header__tools > button',els=>els.map(e=>[e.getAttribute('aria-label'),e.getBoundingClientRect().height]));
    const titleTools=await tools();
    await page.type('.title-login input','导航验证');
    await page.click('.title-login .btn--primary');
    await page.waitForSelector('.lobby-hub .app-header');
    assert.deepEqual(await tools(),titleTools,'same tools and dimensions in the lobby');
    await page.click('.lobby-hub .app-back');
    await page.waitForSelector('.title-screen .app-header .ping');
    await page.waitForSelector('.app-header .online-count');
    // Reproduce the original wrapping path: return from lobby with live ping and presence.
    for(const [width,height,size] of [[1440,900,'md'],[1440,900,'xl'],[844,390,'md'],[640,360,'xl'],[320,720,'md'],[320,720,'xl']]) {
      await page.setViewport({width,height});
      await page.evaluate(size=>document.documentElement.dataset.text=size,size);await settle();
      const measure=await page.evaluate(()=>{
        const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};};
        const label=document.querySelector('.app-header__connection > span:last-child'),range=document.createRange();range.selectNodeContents(label);
        const rects=[...document.querySelectorAll('.app-header__connection,.app-header .ping,.app-header .online-count,.topbar-announcement,.app-header__tools > button,.app-header__language,.app-header__identity')].map(box);
        return {lines:range.getClientRects().length,rects,width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,
          header:box(document.querySelector('.app-header')),main:box(document.querySelector('.title-main')),start:box(document.querySelector('.title-login .btn--primary'))};
      });
      await page.screenshot({path:new URL(`title-navigation-${engine}-${width}-${size}-${built?'build':'source'}.png`,out).pathname});
      assert.equal(measure.lines,1,'connection label stays on one line');
      assert.ok(measure.overflow<=1,'no horizontal page overflow');
      assert.ok(measure.main.y>=measure.header.bottom-1,'hero stays below navigation');
      for(let i=0;i<measure.rects.length;i++) {
        const a=measure.rects[i];assert.ok(a.x>=0 && a.right<=width+1,'header controls remain in viewport');
        for(const b of measure.rects.slice(i+1)) assert.ok(Math.min(a.right,b.right)-Math.max(a.x,b.x)<1 || Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)<1,'header controls do not overlap');
      }
      await page.$eval('.title-login .btn--primary',e=>e.scrollIntoView({block:'center'}));
      assert.ok(await page.$eval('.title-login .btn--primary',e=>{const r=e.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight;}),'start action remains reachable');
      await page.$eval('.title-screen',e=>{e.scrollTop=0;});
    }
    await page.setViewport({width:1440,height:900});
    await page.evaluate(()=>document.documentElement.dataset.text='md');await settle();
    for(const [entry,modal] of [['.settings-btn','.settings-modal'],['.guide-btn','.guide'],['.topbar-announcement','.announcement-modal'],['.stats-entry','.st']]) {
      await page.click(`.title-screen ${entry}`);
      await page.waitForSelector(modal);
      if(modal==='.st') await page.click('.st .app-back');else await page.keyboard.press('Escape');
      await page.waitForSelector(modal,{hidden:true});
    }
    // Reconnection status remains readable; English is also verified through the visible language control.
    await page.evaluate(()=>window.__SP__.store.patch('connection',{status:'reconnecting'}));
    await page.waitForFunction(()=>document.querySelector('.app-header__connection')?.textContent.trim()==='重连中');
    await page.click('.app-header__language [role=combobox]');
    await page.waitForSelector('.game-select-popover [role=option][lang=en]');
    await page.click('.game-select-popover [role=option][lang=en]');
    await page.waitForFunction(()=>document.documentElement.lang==='en');
    await page.evaluate(()=>window.__SP__.store.patch('connection',{status:'reconnecting'}));
    await page.waitForFunction(()=>document.querySelector('.app-header__connection')?.textContent.trim()==='Reconnecting');
    await page.setViewport({width:320,height:720});await settle();
    assert.equal(await page.$eval('.app-header__connection > span:last-child',e=>{const r=document.createRange();r.selectNodeContents(e);return r.getClientRects().length;}),1);
    await page.screenshot({path:new URL(`title-navigation-${engine}-320-en-${built?'build':'source'}.png`,out).pathname});
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();await srv.close();}
});
