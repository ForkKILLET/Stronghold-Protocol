// SP_E2E=1; SP_E2E_BUILD=1 tests the production client. Local messages only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync} from 'node:fs';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
for(const [engine,executablePath] of [['chrome','/run/current-system/sw/bin/google-chrome-stable'],['firefox','/run/current-system/sw/bin/firefox']])test(`${engine}: dismissed notifications remain readable until expiry or withdrawal`,{
 skip:process.env.SP_E2E!=='1'||!existsSync(executablePath),timeout:90000,
},async()=>{
 const built=process.env.SP_E2E_BUILD==='1';
 const game=await startServer({host:'127.0.0.1',port:0,quiet:true,workers:0,userFile:':memory:',announcementsFile:null,clientBuild:built,assetIndex:false});
 const out=new URL('../e2e/out/',import.meta.url);mkdirSync(out,{recursive:true});let browser;
 const publish=async(text,durationSeconds=900,level='warning')=>game.announcements.serverMessage.update({revision:game.announcements.serverMessage.state().revision,message:text===null?null:{text,level,durationSeconds}});
 try {
  browser=await puppeteer.launch({browser:engine,executablePath,headless:true,args:engine==='chrome'?['--no-sandbox','--mute-audio','--no-proxy-server']:[]});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const open=async()=>{await page.click('.topbar-announcement');await page.waitForSelector('.announcement-modal');};
  const close=async()=>{await page.click('.announcement-modal .modal__actions button');await page.waitForSelector('.announcement-modal',{hidden:true});};
  const selected=()=>page.$eval('.announcement-sections [aria-selected=true]',e=>e.textContent);
  const panelText=()=>page.$eval('.announcement-sections__panel',e=>e.textContent);
  const settle=()=>page.evaluate(async()=>{await document.fonts.ready;document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a=>a.finish());await new Promise(requestAnimationFrame);});
  await page.setViewport({width:1366,height:768});await page.goto(game.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.__SP__);
  const message='<b>维护通知</b> '+('请在当前对局结束后退出，感谢配合。'.repeat(25));await publish(message);
  await page.waitForSelector('.site-notice');await page.click('.site-notice__close');await page.waitForSelector('.site-notice',{hidden:true});
  const dismissed=await page.evaluate(()=>localStorage.getItem('sp.pref.announcementDismissed'));
  await open();assert.equal(await selected(),'当前通知');assert.ok((await panelText()).includes(message));assert.equal(await page.$('.announcement-notification b'),null);
  assert.ok(await page.$('.announcement-notification time'));
  for(const [width,height,large] of [[1366,768,false],[844,390,false],[320,720,false],[1366,768,true]]) {
   await page.setViewport({width,height});await page.evaluate(large=>large?document.documentElement.style.setProperty('--t','150px'):document.documentElement.style.removeProperty('--t'),large);await settle();
   const bounds=await page.$eval('.announcement-modal',e=>{const box=s=>{const r=e.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};const panel=e.querySelector('[role=tabpanel]');return {head:box('.modal__head'),tabs:box('[role=tablist]'),panel:box('[role=tabpanel]'),footer:box('.modal__actions'),overflow:panel.scrollWidth-panel.clientWidth};});
   assert.ok(bounds.head.bottom<=bounds.tabs.top+1 && bounds.tabs.bottom<=bounds.panel.top+1 && bounds.panel.bottom<=bounds.footer.top+1,'reading content stays between tabs and actions');
   assert.ok(bounds.overflow<=1 && bounds.tabs.left>=0 && bounds.tabs.right<=width+1,'no horizontal reading overflow');
   await page.screenshot({path:new URL(`notification-recall-${engine}-${width}-${large?'large':'normal'}-${built?'build':'source'}.png`,out).pathname});
  }
  await page.evaluate(()=>document.documentElement.style.removeProperty('--t'));await page.setViewport({width:1366,height:768});await close();
  assert.equal(await page.$('.site-notice'),null,'reading does not undo banner dismissal');
  assert.equal(await page.evaluate(()=>localStorage.getItem('sp.pref.announcementDismissed')),dismissed);
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(text=>window.__SP__?.store.get().announcement?.text===text,{},message);
  assert.equal(await page.$('.site-notice'),null,'reload keeps the current version hidden');await open();assert.equal(await selected(),'当前通知');assert.ok((await panelText()).includes(message));
  await page.evaluate(()=>{window.__recallReplay=0;window.__SP__.net.on('site.announcement',()=>window.__recallReplay++);window.__SP__.net.reconnectNow();});
  await page.waitForFunction(()=>window.__recallReplay>0);assert.ok((await panelText()).includes(message));assert.equal(await page.$('.site-notice'),null,'reconnect does not restore the dismissed banner');
  await publish('更新后的通知',900,'urgent');await page.waitForFunction(()=>document.querySelector('.announcement-notification')?.textContent.includes('更新后的通知'));
  assert.ok(await page.$('.announcement-notification__level.is-urgent'));assert.ok(await page.$('.site-notice'),'new published versions show their banner');
  await close();game.announcements.rows=[{id:'recall-long-form',type:'popup',enabled:true,level:'info',title:'长期公告标题',text:'长期公告正文',startAt:0,endAt:null,autoPopup:true}];game.announcements.refresh();
  await page.waitForSelector('.announcement-content__title');assert.equal(await selected(),'服务器公告','automatic popups keep their original tab');
  await close();await open();assert.equal(await selected(),'当前通知','manual viewing still prefers the current notification');
  await publish(null);await page.waitForFunction(()=>document.querySelector('.announcement-sections__panel')?.textContent==='暂无有效通知');assert.equal(await selected(),'当前通知');
  await publish('即将到期的通知',2);await page.waitForFunction(()=>document.querySelector('.announcement-notification')?.textContent.includes('即将到期的通知'));
  await page.evaluate(()=>window.__SP__.net.close());await page.waitForFunction(()=>document.querySelector('.announcement-sections__panel')?.textContent==='暂无有效通知');
  assert.equal(await page.evaluate(()=>window.__SP__.store.get().announcement?.text),'即将到期的通知','client clock expires the content without a withdrawal frame');
  await close();await publish('Maintenance notice: please leave after your current match.');
  await page.setViewport({width:320,height:720});await page.goto(game.url+'/?lang=en',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.documentElement.lang==='en');
  await page.waitForSelector('.site-notice');await page.click('.site-notice__close');await open();await settle();
  assert.equal(await selected(),'Current notification');assert.ok((await panelText()).includes('Maintenance notice'));
  assert.ok(await page.$eval('.announcement-sections__panel',e=>e.scrollWidth<=e.clientWidth+1));
  await page.screenshot({path:new URL(`notification-recall-${engine}-320-en-${built?'build':'source'}.png`,out).pathname});
  game.announcements.rows.push({id:'recall-schedule',type:'scroll',enabled:true,level:'info',text:'Scheduled notice restored',startAt:Date.now()-1000,endAt:Date.now()+600000});
  await publish(null);
  await page.waitForFunction(()=>document.querySelector('.announcement-notification')?.textContent.includes('Scheduled notice restored'));
  assert.ok(await page.$('.announcement-notification time'),'withdrawing an override restores the scheduled notification and its expiry');
  assert.deepEqual(errors,[]);
 } finally {await browser?.close();await game.close();}
});
