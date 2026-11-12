import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainFx } from '../../public/js/render/vfx/terrainfx.js';

test('map effects retain pending fallbacks, avoid recreating steady loops and cancel on area/quality changes', () => {
  const spawned = [], killed = [], grounds = [];
  const ofx = {active:true, tier:'full', lib:{has:()=>true}, update(){}, clear(){},
    setGround(heightAt, key){grounds.push({heightAt,key});},
    spawn(key, place, opts) { const handle = {effect:null, kill(){killed.push(key);}};
      spawned.push({key,place,opts,handle}); return handle; }};
  const board = {official:{key:'map-9',doc:{tileEffects:{w:'red-module'}}},areaKey:'left',
    board:{grid:[[{drawn:true,glyph:'w',h:0},{drawn:false,glyph:'w',h:0.7}],
      [{drawn:true,glyph:'H',h:0.4}]]},
    setNativeTerrain(glyphs){this.shown=[...glyphs];}};
  const terrain = new TerrainFx(ofx);
  terrain.update(board, 0.1);
  assert.equal(spawned.length,1);
  assert.equal(grounds[0].heightAt(1,0),0.4,'the raised bench occludes the road effect');
  assert.equal(grounds[0].heightAt(0,1),0,'hidden board parts do not occlude');
  assert.equal(grounds[0].heightAt(50,50),0);
  assert.deepEqual(spawned[0].place.pos,[-10,-9,-0]);
  assert.deepEqual(board.shown,[], 'the fallback remains during resource loading');
  spawned[0].handle.effect = {done:false};
  terrain.update(board,0.1);
  assert.deepEqual(board.shown,['w']);
  assert.equal(spawned.length,1,'steady frames do not recreate loops');
  assert.equal(grounds.length,1,'steady frames reuse the depth geometry');
  board.areaKey = 'right'; terrain.update(board,0.1);
  assert.equal(grounds.length,2,'a new visible area refreshes the depth geometry');
  assert.equal(killed.length,1,'camera change cancels old handles, including late resource arrivals');
  ofx.active = false; terrain.update(board,0.1);
  assert.deepEqual(board.shown,[]);
  assert.equal(killed.length,2);
});

test('a missing original effect does not hide its fallback or create a pending loop', () => {
  let spawned=0;
  const fx = new TerrainFx({active:true,tier:'lite',lib:{has:()=>false},clear(){},setGround(){},update(){},spawn(){spawned++;}});
  const board={official:{key:'missing',doc:{tileEffects:{m:'mud'}}},areaKey:'a',board:{grid:[[{glyph:'m',drawn:true,h:0}]]},
    setNativeTerrain(s){assert.equal(s.size,0);}};
  fx.update(board,0.1); assert.equal(spawned,0);
  fx.update(null,0.1);
});
