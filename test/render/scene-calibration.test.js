import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { REGULATION_LIGHT, REGULATION_SAND_BLEND, sceneCalibration } from '../../public/js/render/board3d/calibration.js';
import { sceneMaterial, focusUniforms } from '../../public/js/render/board3d/materials.js';

const composite = { layout: 'regulation-composite-v1' };

test('visual calibration covers exactly the imported maps and leaves old, missing and unknown packs neutral', () => {
  assert.equal(Object.keys(REGULATION_LIGHT).length, 10);
  for (const [stage, gain] of Object.entries(REGULATION_LIGHT)) {
    assert.ok(gain.every(v => Number.isFinite(v) && v >= .65 && v <= 1.45));
    assert.deepEqual(sceneCalibration(stage, composite, 'rock').light, gain);
    assert.equal(sceneCalibration(stage, composite, 'rock').blend, null);
    assert.equal(sceneCalibration(stage, composite, 'MT_AutochessSand').blend, REGULATION_SAND_BLEND);
    assert.equal(sceneCalibration(stage, null, 'MT_AutochessSand'), null);
    assert.equal(sceneCalibration(stage, {}, 'MT_AutochessSand'), null);
  }
  for (const stage of ['act2autochess_m01', 'act3autochess_m07', 'toString', '__proto__', undefined]) {
    assert.equal(sceneCalibration(stage, composite, 'MT_AutochessSand'), null);
  }
  assert.ok(REGULATION_SAND_BLEND > 0 && REGULATION_SAND_BLEND < 1, 'preserve some native texture');
});

test('the empirical sand mix scales the native material without changing its source or alpha policy', () => {
  const info = { shader: 'Torappu/Scene/StandardRealtimeShadow', keywords: ['_HG_VERTEX_COLOR_BLEND_ON', '_ALPHATEST_ON'],
    floats: { _BlendStrength: .8, _Cutoff: .4 }, colors: { _BlendRangeCtrl: [.1, .9, 0, 0], _BlendColor: [.5, .4, .2, 1] } };
  const before = JSON.stringify(info);
  const calibration = { light: [1.1, 1.05, .95], blend: .6 };
  const material = sceneMaterial(THREE, { info, calibration, map: new THREE.Texture() }, focusUniforms(THREE));
  assert.equal(material.defines.SCENE_VERTEX_BLEND, 1);
  assert.deepEqual(material.uniforms.uVertexBlend.value.toArray(), [.1, .9, .48]);
  assert.deepEqual(material.uniforms.uSceneGain.value.toArray(), calibration.light);
  assert.equal(material.uniforms.uCutoff.value, .4);
  assert.equal(JSON.stringify(info), before);
  material.dispose();
});

test('legacy and unrelated material variants retain the neutral lighting and original texture', () => {
  const focus = focusUniforms(THREE);
  const old = sceneMaterial(THREE, { info: { keywords: ['_HG_VERTEX_COLOR_BLEND_ON'] } }, focus);
  assert.equal(old.defines.SCENE_VERTEX_BLEND, undefined);
  assert.equal(old.defines.SCENE_CALIBRATED, undefined);
  assert.deepEqual(old.uniforms.uSceneGain.value.toArray(), [1, 1, 1]);
  const other = sceneMaterial(THREE, { info: { shader: 'Unlit/Texture', keywords: [] }, calibration: { light: [1.1, 1, 1], blend: .6 } }, focus);
  assert.equal(other.defines.SCENE_VERTEX_BLEND, undefined);
  assert.equal(other.defines.SCENE_UNLIT, 1);
  old.dispose(); other.dispose();
});
