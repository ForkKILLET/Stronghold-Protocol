// Desktop fork layouts against a real local server and isolated Firefox. No production data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';
import { localFontsOnly } from '../helpers/localFonts.js';

const version='act3autochess@V3_1';
test('Firefox: regulation creation, configuration, preparation HUD and command stay consistent', {
 skip:process.env.SP_E2E!=='1', timeout:180000,
},async t=>{
 const out=process.env.SP_E2E_OUT || path.resolve('.state/merge-dev-20261111/screenshots');mkdirSync(out,{recursive:true});
 const srv=await startServer({host:'127.0.0.1',port:0,quiet:true,workers:0,userFile:':memory:',assetIndex:false,
   announcementsFile:null,clientBuild:false,botRehearsal:0});
 t.after(()=>srv.close());
 const browser=await puppeteer.launch({browser:'firefox',executablePath:'/run/current-system/sw/bin/firefox',headless:true,
  extraPrefsFirefox:{'dom.ipc.processCount':2,'dom.ipc.processCount.webIsolated':1,'dom.ipc.processPrelaunch.enabled':false,'fission.autostart':false}});
 t.after(()=>browser.close());
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 t.after(async()=>{writeFileSync(path.join(out,'page-errors.json'),JSON.stringify(errors));});
 await localFontsOnly(page);await page.setViewport({width:1600,height:1000,deviceScaleFactor:1});
 const wait=selector=>page.waitForSelector(selector,{visible:true});
 const click=async selector=>{await wait(selector);await page.click(selector);};
 const request=(type,fields={})=>page.evaluate(({type,fields})=>window.__SP__.net.request(type,fields),{type,fields});
 const shot=async name=>{
  if(name.startsWith('06-')||name.startsWith('07-')){await page.mouse.move(450,150);await page.waitForFunction(()=>!document.querySelector('.pbanner'));}
  await page.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();await new Promise(requestAnimationFrame);});
  await page.screenshot({path:path.join(out,name+'.png')});
 };
 await page.goto(srv.url,{waitUntil:'domcontentloaded'});await wait('.title-login input');await page.type('.title-login input','UI验证');
 await click('.title-login .btn--primary');await wait('.lobby-hub');
 await page.evaluate(async version=>{const {setLobbyVersion}=await import('/js/versions.js');setLobbyVersion(version);},version);
 await page.waitForFunction(version=>window.__SP__.data.get('config')?.version?.id===version,{},version);
 // Use the visible creation flow, not an injected screen state.
 await page.evaluate(()=>[...document.querySelectorAll('.hub-entry')].find(e=>e.textContent.includes('独立模拟')).click());
 await wait('[data-testid="proto-ladder"]');await click('[data-mode="mode_single_12"]');await shot('01-create-ladder');
 await click('.proto-start');await wait('.room-screen');
 assert.equal(await page.evaluate(()=>window.__SP__.store.get().room.modeId),'mode_single_12');
 await page.evaluate(()=>[...document.querySelectorAll('.room-config-summary button')].find(e=>e.textContent.includes('配置')).click());
 await wait('.room-options-screen');await shot('02-room-configuration');await click('[data-mode="mode_single_13"]');
 await page.evaluate(()=>[...document.querySelectorAll('.room-options__actions button')].find(e=>e.textContent.includes('保存')).click());
 await wait('.room-screen');assert.equal(await page.evaluate(()=>window.__SP__.store.get().room.modeId),'mode_single_13');
 await page.evaluate(async()=>{
  const {setDiyPicks}=await import('/js/ui/loadoutSync.js');
  const {diySlotIds,diySlot}=await import('/shared/diy.js');
  const pack={chess:window.__SP__.data.get('chess'),backups:window.__SP__.data.get('backups')},picks={};
  for(const tier of [5,6]){const slots=diySlotIds(pack).filter(id=>diySlot(id,pack)?.tier===tier);slots.forEach((id,i)=>{picks[id]={charId:pack.backups.diy.prototypes[tier][i]};});}
  setDiyPicks(picks);
 });
 await page.evaluate(async()=>{const {loadoutStore}=await import('/js/ui/loadoutSync.js');for(let i=0;i<100;i++){if(loadoutStore.get().diySync==='synced')break;await new Promise(r=>setTimeout(r,20));}});
 await request('room.start');await wait('.brief');await wait('[data-testid="bond-groups"]');await shot('03-briefing-groups');
 assert.equal(await page.$eval('[data-testid="bond-group-0"]',e=>e.disabled),false);
 await click('[data-testid="bond-group-0"]');await click('.brief-go');await wait('.draft');await shot('04-strategy');
 // The default detail is visible first; choose an active strategy through the same stable grid.
 await click('[data-band="band_fund"]');
 await page.evaluate(()=>[...document.querySelectorAll('.draft button')].find(e=>e.textContent.includes('确认选择')).click());
 await wait('[data-testid="diy-check"]');await wait('[data-testid="diy-check-card"]');await shot('05-custom-check');
 assert.ok(await page.$('[data-testid="preparation-hud"]'));assert.ok(await page.$('[data-testid="preparation-tools"]'));
 await click('[data-testid="diy-check-none"]');await wait('.gm');await wait('[data-testid="band-command"]');await page.waitForFunction(()=>window.__SP__.store.get().match?.public?.phase==='PREP');await shot('06-command-preparation');
 const before=await page.evaluate(()=>window.__SP__.store.get().match.private.funds);
 await click('[data-testid="band-command"]');
 await page.waitForFunction(()=>window.__SP__.store.get().match.private.command.cooldown>0);
 const used=await page.evaluate(()=>window.__SP__.store.get().match.private);assert.ok(used.funds>before);assert.equal(used.command.cooldown,used.funds-before);
 await shot('07-command-used');
 const geometry=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollX:document.documentElement.scrollWidth-innerWidth,
  scrollY:document.documentElement.scrollHeight-innerHeight,phase:window.__SP__.store.get().match.public.phase}));
 assert.ok(geometry.scrollX<=1&&geometry.scrollY<=1,JSON.stringify(geometry));
 assert.deepEqual(errors,[]);writeFileSync(path.join(out,'observations.json'),JSON.stringify({geometry,errors},null,2));
});
