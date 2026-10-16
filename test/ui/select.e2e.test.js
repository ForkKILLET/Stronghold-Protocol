import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import {startServer} from '../../server/index.js';
const chrome=process.env.CHROME_PATH || '/run/current-system/sw/bin/google-chrome-stable';
test('styled select: keyboard, modal focus, disabled rows and short viewport bounds', {skip:process.env.SP_E2E!=='1'||!existsSync(chrome)}, async()=>{
const srv=await startServer({port:0,host:'127.0.0.1',quiet:true,workers:0,clientBuild:false});let browser;
try {
 browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--mute-audio']});
 const page=await browser.newPage();page.on('pageerror',e=>console.log('PAGEERROR',e.message));await page.setViewport({width:844,height:390});
 await page.goto(srv.url,{waitUntil:'networkidle0'});
 await page.evaluate(async()=>{
  const {render}=await import('/vendor/preact.module.js');const{useState}=await import('/vendor/hooks.module.js');
  const {html,Modal}=await import('/js/ui/components.js');const {Select}=await import('/js/ui/select.js');
  const root=document.createElement('div');document.body.append(root);globalThis.__selectClosed=0;globalThis.__selectPicked='0';
  function Demo(){const[v,setV]=useState('0');return html`<${Modal} open=${true} title="Select check" onClose=${()=>globalThis.__selectClosed++}>
   <div style="height:70px;overflow:auto"><${Select} label="Pick" value=${v} onChange=${v=>{globalThis.__selectPicked=v;setV(v);}}
    options=${Array.from({length:24},(_,i)=>({value:String(i),label:`Choice ${i}`,disabled:i===2}))} /></div>
   <button type="button" class="outside-select">Outside</button><//>`;}
  render(html`<${Demo} />`,root);
 });
 await page.waitForSelector('[role=combobox][aria-label=Pick]');await page.click('[role=combobox][aria-label=Pick]');
 await page.waitForSelector('[role=listbox]');
 assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('role')),'combobox');
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 assert.equal(await page.evaluate(()=>globalThis.__selectPicked),'1');
 await page.click('[role=combobox][aria-label=Pick]');await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>globalThis.__selectClosed),0);assert.equal(await page.$('[role=listbox]'),null);
 await page.click('[role=combobox][aria-label=Pick]');await page.keyboard.press('End');await page.keyboard.press('Enter');
 assert.equal(await page.evaluate(()=>globalThis.__selectPicked),'23');
 await page.click('[role=combobox][aria-label=Pick]');await page.keyboard.press('Home');await page.keyboard.press('Enter');
 assert.equal(await page.evaluate(()=>globalThis.__selectPicked),'0');
 await page.click('[role=combobox][aria-label=Pick]');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 assert.equal(await page.evaluate(()=>globalThis.__selectPicked),'3','keyboard skips the disabled row');
 await page.click('[role=combobox][aria-label=Pick]');
 const bounds=await page.$eval('.game-select-popover',e=>{const r=e.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight};});
 assert.ok(bounds.left>=0&&bounds.top>=0&&bounds.right<=bounds.w&&bounds.bottom<=bounds.h,JSON.stringify(bounds));
 mkdirSync(new URL('../e2e/out/',import.meta.url),{recursive:true});
 await page.screenshot({path:new URL('../e2e/out/select-short.png',import.meta.url).pathname});
 await page.click('.outside-select');assert.equal(await page.$('[role=listbox]'),null);
 await page.click('[role=combobox][aria-label=Pick]');await page.keyboard.press('Tab');assert.equal(await page.$('[role=listbox]'),null);
 console.log(JSON.stringify({keyboard:true,disabledRow:true,escapeKeepsModal:true,focus:true,outside:true,tab:true,bounds}));
}finally{await browser?.close();await srv.close();}

});
