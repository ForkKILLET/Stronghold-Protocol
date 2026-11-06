// Isolated source-client layout and interaction checks. Never uses a player's browser profile.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
import {localFontsOnly} from '../helpers/localFonts.js';

for(const [engine,executablePath] of [
  ['chrome',process.env.CHROME_PATH||'/run/current-system/sw/bin/google-chrome-stable'],
  ['firefox',process.env.FIREFOX_PATH||'/run/current-system/sw/bin/firefox'],
]) test(`hub recovery and archive filters fit and work (${engine})`,{
  skip:process.env.SP_E2E!=='1'||!existsSync(executablePath),timeout:120000,
},async()=>{
  const server=await startServer({host:'127.0.0.1',port:0,workers:0,userFile:':memory:',quiet:true,announcementsFile:null,assetIndex:false,
    versions:{enabled:'all'},clientBuild:false});
  const out=new URL(`../e2e/out/post-merge-ui/${engine}/`,import.meta.url);mkdirSync(out,{recursive:true});
  let browser;const errors=[];
  try{
    browser=await puppeteer.launch({browser:engine,executablePath,headless:true,
      ...(engine==='firefox'?{extraPrefsFirefox:{'dom.ipc.processCount':2,'dom.ipc.processCount.webIsolated':1,'dom.ipc.processPrelaunch.enabled':false,'fission.autostart':false}}:{}),args:engine==='chrome'?['--no-sandbox','--mute-audio','--no-proxy-server','--enable-unsafe-swiftshader']:[]});
    const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await localFontsOnly(page);
    const settle=()=>page.evaluate(async()=>{
      await document.fonts.ready;
      for(const animation of document.getAnimations())if(Number.isFinite(animation.effect?.getComputedTiming().endTime))animation.finish();
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    });
    const shot=async name=>{await settle();await page.screenshot({path:new URL(name+'.png',out).pathname});};
    const fits=async selector=>page.$$eval(selector,els=>{
      const boxes=els.filter(e=>e.offsetWidth).map(e=>e.getBoundingClientRect());
      return boxes.every(r=>r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1)
        &&document.documentElement.scrollWidth<=innerWidth+1;
    });
    await page.setViewport({width:1440,height:900});await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('.title-login input');await page.type('.title-login input','界面验证');await page.click('.title-login .btn--primary');
    await page.waitForSelector('[data-testid=version-switch]');
    await page.evaluate(async fixture=>{
      // Only the recovery entry's display metadata is stubbed; no credentials or server seats are changed.
      const {identity}=await import('/js/net.js');identity.recoverable=()=>[{id:'layout-fixture',name:'界面验证',code:'TEST'}];dispatchEvent(new Event('focus'));
      const {importStats,saveStats}=await import('/js/ui/stats.js');saveStats(importStats(fixture).stats);
    },JSON.parse(readFileSync(new URL('fixtures/stats-versions.json',import.meta.url),'utf8')));
    for(const size of [{width:1440,height:900},{width:740,height:360},{width:640,height:360,text:'xl'}]){
      await page.setViewport({width:size.width,height:size.height});
      await page.evaluate(size=>{document.documentElement.dataset.text=size.text||'md';},size);await settle();
      assert.ok(await fits('.hub-entries__context button,.hub-entry'),'lobby actions stay inside the viewport');
      const recovery=await page.$eval('[data-testid=resume-local-match]',e=>({height:e.getBoundingClientRect().height,inActions:!!e.closest('.hub-entries__context'),font:parseFloat(getComputedStyle(e).fontSize)}));
      assert.ok(recovery.inActions&&recovery.height>=44&&recovery.font>=14,JSON.stringify({size,recovery}));
      await shot(`lobby-${size.width}`);
      await page.click('[data-testid=version-switch]');await page.waitForSelector('.verpick');await settle();
      assert.equal(await page.$$eval('.verpick__pick',els=>els.length),4);
      assert.equal(await page.$eval('.verpick__pick',e=>getComputedStyle(e).display),'grid');
      assert.ok(await fits('.modal__box.verpick'),'version picker stays inside the viewport');
      assert.ok(await page.$eval('.verpick .utility-modal__close',e=>{
        const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
      }),'the shared header cannot cover the picker close button');
      await shot(`versions-${size.width}`);await page.keyboard.press('Escape');await page.waitForSelector('.verpick',{hidden:true});
    }
    await page.setViewport({width:1440,height:900});await page.evaluate(()=>{document.documentElement.dataset.text='md';});
    await page.click('[data-testid=resume-local-match]');await page.waitForSelector('.resume-modal');await shot('resume');
    assert.match(await page.$eval('.resume-modal',e=>e.textContent),/TEST/);
    await page.keyboard.press('Escape');await page.waitForSelector('.resume-modal',{hidden:true});
    await page.evaluate(async()=>{(await import('/js/screens/stats.js')).openStats('history');});
    await page.waitForSelector('.st-table--history');
    for(const size of [{width:1440,height:900},{width:740,height:360},{width:640,height:360,text:'xl'}]){
      await page.setViewport({width:size.width,height:size.height});await page.evaluate(size=>{document.documentElement.dataset.text=size.text||'md';},size);await settle();
      assert.ok(await fits('.doctor-filters > *'),'filter controls stay inside the viewport');
      const layout=await page.$eval('.doctor-filters',e=>{
        const children=[...e.children].map(e=>e.getBoundingClientRect());
        return {heights:children.map(r=>r.height),tops:children.map(r=>r.top),left:e.getBoundingClientRect().left,section:e.nextElementSibling.getBoundingClientRect().left};
      });
      assert.ok(layout.heights.every(h=>Math.abs(h-layout.heights[0])<=1),JSON.stringify(layout));
      assert.ok(Math.abs(layout.left-layout.section)<=1,'filters and history share the same content edge');
      await shot(`archive-${size.width}`);
    }
    await page.click('[data-testid=stats-version] [role=combobox]');await page.waitForSelector('.game-select-popover');
    await shot('archive-dropdown-mobile');assert.ok(await fits('.game-select-popover'));
    await page.keyboard.press('End');await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('[data-testid=stats-version]')?.textContent.includes('全部版本'));
    assert.ok(await page.$$eval('.st-table--history tbody tr',els=>els.length>=2),'selecting all versions includes historical records');
    const device=await page.$('.doctor-filter:not(.doctor-modded) input');await device.click();
    assert.equal(await page.$eval('.doctor-filter:not(.doctor-modded) input',e=>e.checked),true);
    await page.click('[data-testid=stats-version] [role=combobox]');await page.waitForSelector('.game-select-popover');await page.keyboard.press('Escape');
    assert.ok(await page.$('.st'),'Escape only closes the filter menu');
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await server.close();}
});
