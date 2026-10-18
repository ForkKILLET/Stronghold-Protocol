// SP_E2E=1 opts into real browsers; SP_E2E_BUILD=1 exercises the compiled client.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync} from 'node:fs';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';

const browsers=[
  ['chrome',process.env.CHROME_PATH || '/run/current-system/sw/bin/google-chrome-stable'],
  ['firefox',process.env.FIREFOX_PATH || '/run/current-system/sw/bin/firefox'],
];
const text=Array.from({length:50},(_,i)=>`- 第 ${i+1} 条公告：对局和更新记录应当在页签下方独立滚动。`).join('\n');

for(const [engine,executablePath] of browsers) test(`announcement scroll boundaries (${engine})`,{
  skip:process.env.SP_E2E!=='1' || !existsSync(executablePath),
},async()=>{
  const built=process.env.SP_E2E_BUILD==='1';
  const srv=await startServer({host:'127.0.0.1',port:0,quiet:true,workers:0,clientBuild:built,assetIndex:false,announcementsFile:null});
  let browser;
  const out=new URL('../e2e/out/',import.meta.url);
  mkdirSync(out,{recursive:true});
  try {
    browser=await puppeteer.launch({browser:engine,executablePath,headless:true,args:engine==='chrome'?['--no-sandbox','--mute-audio','--no-proxy-server']:[]});
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request',request=>new URL(request.url()).pathname==='/api/changelog'
      ?request.respond({status:200,contentType:'application/json',body:JSON.stringify({source:'https://github.com/ForkKILLET/Stronghold-Protocol/blob/deployment/genshin/CHANGELOG.md',entries:[
        {date:'2026-10-19',title:'长更新日志',text},
        {date:'2026-10-18',title:'较早更新',text:'- 保留日期折叠操作。'},
      ]})}):request.continue());
    await page.setViewport({width:1366,height:768});
    await page.goto(srv.url,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!window.__SP__);
    assert.equal(await page.evaluate(()=>[...document.scripts].some(s=>s.src.includes('/build/assets/index-'))),built);
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='公告').click());
    await page.waitForSelector('.announcement-markdown');
    const tab=name=>page.evaluate(name=>[...document.querySelectorAll('.announcement-sections [role=tab]')].find(b=>b.textContent===name).click(),name);
    const measure=()=>page.$eval('.announcement-modal',element=>{
      const rect=selector=>{const r=element.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
      const panel=element.querySelector('[role=tabpanel]');
      return {head:rect('.modal__head'),tabs:rect('[role=tablist]'),panel:rect('[role=tabpanel]'),footer:rect('.modal__actions'),
        bodyScroll:element.querySelector('.modal__body').scrollTop,panelScroll:panel.scrollTop,
        overflow:panel.scrollWidth-panel.clientWidth};
    });
    for(const [width,height,largeText] of [[1366,768,false],[844,390,false],[1366,768,true]]) {
      await page.setViewport({width,height});
      await page.evaluate(large=>large?document.documentElement.style.setProperty('--t','150px'):document.documentElement.style.removeProperty('--t'),largeText);
      for(const section of ['history','notice']) {
        if(section==='notice') {
          await page.evaluate(text=>window.__SP__.store.set({popupAnnouncement:{id:'scroll-test',type:'popup',title:'服务器公告',text,format:'markdown',startAt:0,endAt:null,autoPopup:false}}),text);
          await tab('服务器公告');
        } else await tab('更新日志');
        await page.waitForSelector('.announcement-markdown');
        await page.evaluate(()=>document.querySelector('.announcement-modal').getAnimations().forEach(animation=>animation.finish()));
        await page.evaluate(()=>{document.querySelector('.announcement-modal .modal__body').scrollTop=0;document.querySelector('.announcement-modal [role=tabpanel]').scrollTop=0;});
        const before=await measure();
        const p=before.panel;
        await page.mouse.move((p.left+p.right)/2,Math.min(p.top+30,before.footer.top-15));
        await page.mouse.wheel({deltaY:460});
        await page.waitForFunction(()=>Math.max(document.querySelector('.announcement-modal .modal__body').scrollTop,document.querySelector('.announcement-modal [role=tabpanel]').scrollTop)>100);
        const after=await measure();
        await page.screenshot({path:new URL(`announcement-scroll-${engine}-${width}-${largeText?'large':'normal'}-${section}-${built?'build':'source'}.png`,out).pathname});
        assert.ok(after.head.bottom<=after.tabs.top+1,'tabs stay below the modal title');
        assert.ok(after.tabs.bottom<=after.panel.top+1,'scrolling text must stay below the tabs');
        assert.ok(after.panel.bottom<=after.footer.top+1,'scrolling text stays above close actions');
        assert.ok(Math.abs(after.tabs.top-before.tabs.top)<=1,'tabs do not move when reading');
        assert.ok(after.overflow<=1,'no horizontal scrollbar');
        assert.ok(after.panelScroll>100,'wheel scrolls the reading pane');
        await page.focus('.announcement-modal [role=tabpanel]');
        const previous=after.panelScroll;
        await page.keyboard.press('PageDown');
        await page.waitForFunction(previous=>document.querySelector('.announcement-modal [role=tabpanel]').scrollTop>previous,{},previous);
        const next=section==='history'?'服务器公告':'更新日志';
        await tab(next);
        await page.waitForFunction(label=>document.querySelector('.announcement-modal [role=tabpanel]')?.getAttribute('aria-label')===label,{},next);
        assert.equal((await measure()).panelScroll,0,'switching sections starts at the top');
      }
    }
    await page.keyboard.press('Escape');
    await page.waitForSelector('.announcement-modal',{hidden:true});
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();await srv.close();}
});
