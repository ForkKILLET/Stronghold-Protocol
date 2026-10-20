import {test} from 'node:test';
import assert from 'node:assert/strict';
import {managementScale,managementLength,updateManagementViewport} from '../../public/js/ui/managementScale.js';

test('management units fit the layout viewport and safe areas without changing battlefield rem',()=>{
  for(const [width,height] of [[1920,1080],[1440,900],[844,390],[761,360],[760,360],[640,360],[390,844]]) {
    for(const [left,right,top,bottom] of [[0,0,0,0],[44,44,0,21]]) {
      const rem=Math.max(40,Math.min(240,width/19.2,height/10.8));
      const {unit,factor}=managementScale({width,height,rem,left,right,top,bottom});
      assert.ok(unit<=rem&&factor<=1);
      assert.ok(unit*19.2<=width-left-right+.0001);
      assert.ok(unit*10.8<=height-top-bottom+.0001);
      if(width===640&&!left)assert.ok(unit<40);
    }
  }
});

test('utility modal widths use local units with an unchanged rem fallback',()=>{
  assert.equal(managementLength('7.4rem'),'calc(7.4 * var(--ui-unit, 1rem))');
  assert.equal(managementLength('min(9.6rem, calc(100vw - .4rem))'),
    'min(calc(9.6 * var(--ui-unit, 1rem)), calc(100vw - calc(.4 * var(--ui-unit, 1rem))))');
  assert.equal(managementLength('94vw'),'94vw');
});

test('keyboard pan changes visible offsets without rescaling the layout or user text preference',()=>{
  const values=new Map();
  const win={innerWidth:844,innerHeight:390,visualViewport:{height:390,width:844,offsetTop:0,offsetLeft:0},
    document:{documentElement:{style:{setProperty:(k,v)=>values.set(k,v)}}},
    getComputedStyle:()=>({fontSize:'40px',getPropertyValue:k=>k==='--sa-l'?'44px':'0px'})};
  updateManagementViewport(win);
  const unit=values.get('--sp-ui-unit'),scale=values.get('--sp-ui-scale');
  win.visualViewport.height=200;win.visualViewport.offsetTop=90;win.visualViewport.offsetLeft=4;
  updateManagementViewport(win);
  assert.equal(values.get('--sp-ui-unit'),unit);assert.equal(values.get('--sp-ui-scale'),scale);
  assert.equal(values.get('--sp-vtop'),'90px');assert.equal(values.get('--sp-vleft'),'4px');
  assert.ok(!values.has('--t')&&!values.has('font-size'));
});
