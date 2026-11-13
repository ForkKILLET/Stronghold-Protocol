/* global document, Image, requestAnimationFrame */
import * as THREE from 'three';
import { BoardScene } from '../../public/js/render/board3d/scene.js';
import { parseSceneChunks, sceneGroupRects } from '../../public/js/render/board3d/load.js';
import { makeTexture } from '../../public/js/render/board3d/materials.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { presentationStage } from '../../public/js/render/app/stage.js';
import { restView } from '../../public/js/render/app/view.js';

const payload = JSON.parse(document.getElementById('payload').textContent);
const status = document.getElementById('status'), host = document.getElementById('host');
const buttons = Object.fromEntries(['run', 'old', 'fixed', 'save'].map(id => [id, document.getElementById(id)]));
const W = Math.min(1920, Math.max(960, globalThis.innerWidth || 1280)), H = Math.round(W * 9 / 16);
let board, originalTexture, targets, decoded, pack, report, currentKind = 'normal';
const errors = [];
globalThis.addEventListener('error', e => { errors.push(String(e.message)); });
const bytesOf = row => Uint8Array.from(atob(row.base64), c => c.charCodeAt(0));
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

async function imageOf(key) {
  const file = payload.files[key];
  const url = URL.createObjectURL(new Blob([bytesOf(file)], { type: file.mime }));
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image(); image.decoding = 'async';
      const finish = error => {
        clearTimeout(timer); image.onload = image.onerror = null;
        if (error) { image.src = ''; reject(error); } else resolve(image);
      };
      const timer = setTimeout(() => finish(new Error('Decode timeout: ' + key)), 20000);
      image.onload = () => finish(null); image.onerror = () => finish(new Error('Decode failed: ' + key));
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

async function prepare() {
  if (pack) return;
  decoded = {};
  const keys = [...new Set([...Object.values(payload.images.tex), ...Object.values(payload.images.data),
    ...payload.images.lm, payload.images.env, payload.originalPath].filter(Boolean))];
  for (const key of keys) decoded[key] = await imageOf(key);
  const parts = payload.binaryPaths.map(key => bytesOf(payload.files[key]));
  const binary = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0; for (const part of parts) { binary.set(part, offset); offset += part.length; }
  const chunks = parseSceneChunks(payload.doc, binary.buffer);
  if (!chunks?.length) throw new Error('Invalid embedded geometry');
  pack = { key: 'offline-snow-comparison', stage: payload.stage.id, doc: payload.doc, chunks,
    groups: sceneGroupRects(chunks, payload.doc), images: {
      tex: Object.fromEntries(Object.entries(payload.images.tex).map(([k, p]) => [k, decoded[p]])),
      data: Object.fromEntries(Object.entries(payload.images.data).map(([k, p]) => [k, decoded[p]])),
      lm: payload.images.lm.map(p => decoded[p]), env: payload.images.env ? decoded[payload.images.env] : null } };
}

function dispose() {
  board?.destroy(); originalTexture?.dispose(); board = originalTexture = null;
  host.replaceChildren();
}

function setup(antialias, kind = 'normal') {
  dispose();
  currentKind = kind;
  const canvas = document.createElement('canvas'); host.append(canvas);
  board = new BoardScene(THREE, { images: {} }, { canvas, antialias });
  board.resize(W, H, 1);
  board.setScenePack(payload.stage.id, pack);
  const view = restView(kind, payload.stage);
  board.setArea(view.area); board.setStage(presentationStage(payload.stage, kind));
  if (board.official !== pack) throw new Error('Official scene did not become active');
  const resources = board.sceneRes.get(pack.key);
  targets = [...resources.mats.values()].filter(m => m.uniforms?.uMap?.value === resources.tex[payload.fixedName])
    .map(material => ({ material, fixed: material.uniforms.uMap.value, shader: material.fragmentShader }));
  if (!targets.length) throw new Error('No affected snow materials');
  const aniso = Math.min(8, board.renderer.capabilities.getMaxAnisotropy() || 1);
  originalTexture = makeTexture(THREE, decoded[payload.originalPath], { aniso, repeat: true });
  const gl = board.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  return { attributes: gl.getContextAttributes(), renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    width: W, height: H, kind, aniso, targetMaterials: targets.length, threeRevision: THREE.REVISION };
}

function draw({ original = false, forceAlpha = false, aniso } = {}) {
  for (const target of targets) {
    const texture = original ? originalTexture : target.fixed;
    target.material.uniforms.uMap.value = texture;
    if (aniso !== undefined && texture.anisotropy !== aniso) { texture.anisotropy = aniso; texture.needsUpdate = true; }
    const fragment = forceAlpha ? target.shader.replace('vec4(c * focusMask(vWorld.xy), a.a)', 'vec4(c * focusMask(vWorld.xy), 1.0)') : target.shader;
    if (forceAlpha && fragment === target.shader) throw new Error('Opaque alpha control could not be applied');
    if (target.material.fragmentShader !== fragment) { target.material.fragmentShader = fragment; target.material.needsUpdate = true; }
  }
  const camera = presetCamera(currentKind, { width: W, height: H }, { config: presentationStage(payload.stage, currentKind).config });
  board.render(camera, 1);
  const gl = board.renderer.getContext(), pixels = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const glError = gl.getError(); if (glError || gl.isContextLost()) throw new Error('GL readback failed: ' + glError);
  return pixels;
}

function compare(reference, value) {
  let changed = 0, significant = 0, maxError = 0, sumError = 0;
  const examples = [];
  for (let i = 0; i < reference.length; i += 4) {
    const error = Math.max(...[0, 1, 2].map(c => Math.abs(reference[i + c] - value[i + c])));
    maxError = Math.max(maxError, error); sumError += error;
    if (error) changed++;
    if (error > 2) {
      significant++;
      if (examples.length < 8) examples.push({ x: (i / 4) % W, y: H - 1 - Math.floor(i / 4 / W),
        fixed: Array.from(reference.slice(i, i + 4)), actual: Array.from(value.slice(i, i + 4)) });
    }
  }
  return { changedPixels: changed, significantPixels: significant, maxError, meanMaxError: sumError / (W * H), examples };
}

buttons.run.addEventListener('click', async () => {
  Object.values(buttons).forEach(b => { b.disabled = true; });
  try {
    status.textContent = '正在解码内嵌资源……'; await prepare();
    errors.length = 0;
    report = { format: payload.format, version: payload.version, time: new Date().toISOString(), userAgent: navigator.userAgent,
      scope: 'Actual MAP9 / BoardScene / sceneMaterial, without Pixi, actors, official FX or live match state',
      sceneSha256: payload.sceneSha256, sources: payload.identities, tests: [], errors };
    try { report.browserVersion = await navigator.userAgentData?.getHighEntropyValues(['fullVersionList']) || null; }
    catch { report.browserVersion = null; }
    for (const kind of ['normal', 'unite', 'boss']) for (const antialias of [true, false]) {
      status.textContent = `正在比较 ${kind}，抗锯齿=${antialias}`; const context = setup(antialias, kind);
      await nextFrame(); draw({ aniso: context.aniso });
      await nextFrame(); const fixed = draw({ aniso: context.aniso });
      let fixedAnisoOne;
      for (const [name, options] of [['fixed-repeat', { aniso: context.aniso }], ['original', { original: true, aniso: context.aniso }],
        ['original-alpha-one', { original: true, forceAlpha: true, aniso: context.aniso }],
        ['fixed-aniso-one', { aniso: 1 }], ['original-aniso-one', { original: true, aniso: 1 }]]) {
        await nextFrame(); const frame = draw(options);
        const reference = name === 'original-aniso-one' ? fixedAnisoOne : fixed;
        if (!reference) throw new Error('Missing matching filter reference');
        report.tests.push({ name, kind, antialias, context,
          reference: name === 'original-aniso-one' ? 'fixed-aniso-one' : 'fixed-default-aniso',
          equalityExpected: name !== 'fixed-aniso-one', differenceFromReference: compare(reference, frame), stats: board.stats() });
        if (name === 'fixed-aniso-one') fixedAnisoOne = frame;
      }
    }
    setup(true); draw({ original: true, aniso: Math.min(8, board.renderer.capabilities.getMaxAnisotropy() || 1) });
    status.textContent = JSON.stringify(report, null, 2);
    buttons.old.disabled = buttons.fixed.disabled = buttons.save.disabled = false;
  } catch (e) { status.textContent = String(e.stack || e); }
  finally { buttons.run.disabled = false; }
});
buttons.old.addEventListener('click', () => { draw({ original: true, aniso: Math.min(8, board.renderer.capabilities.getMaxAnisotropy() || 1) }); });
buttons.fixed.addEventListener('click', () => { draw({ aniso: Math.min(8, board.renderer.capabilities.getMaxAnisotropy() || 1) }); });
buttons.save.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'snow-scene-diagnostic.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
globalThis.addEventListener('pagehide', dispose);
