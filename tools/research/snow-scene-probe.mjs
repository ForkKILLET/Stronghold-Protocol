// Build a self-contained, manually run MAP9 renderer comparison. No game assets are changed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--output') throw new Error('Usage: node tools/research/snow-scene-probe.mjs --output FILE.html');
const output = path.resolve(args[1]);
const stageId = 'act3autochess_m09';
const stage = JSON.parse(await fs.readFile(path.join(root, 'data/versions/act3autochess-v3_1/stages.json'), 'utf8'))[stageId];
if (stage?.id !== stageId || !Array.isArray(stage.rows)) throw new Error('Missing Regulation stage');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'data/local-assets.json'), 'utf8')).groups;
const proof = JSON.parse(await fs.readFile(path.join(root, 'docs/research/snow-albedo-compatibility-20261113.json'), 'utf8'));
const files = {}, identities = [];
const add = async entry => {
  if (!entry?.path?.startsWith('/assets/local/')) throw new Error('Expected installed local resource');
  if (files[entry.path]) return entry.path;
  const target = path.resolve(root, 'public', '.' + entry.path);
  if (!target.startsWith(path.join(root, 'public/assets/local/'))) throw new Error('Resource escapes asset root');
  const bytes = await fs.readFile(target);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  identities.push({ path: entry.path, bytes: bytes.length, sha256 });
  files[entry.path] = { base64: bytes.toString('base64'), mime: entry.path.endsWith('.webp') ? 'image/webp' : 'application/octet-stream' };
  return entry.path;
};
const group = manifest['scene/' + stageId];
const sceneBytes = await fs.readFile(path.join(root, 'public', group.scene.path));
const doc = JSON.parse(sceneBytes);
if (doc.stage !== stageId) throw new Error('Mismatched scene');
const binaryPaths = [];
for (const part of doc.binParts || [{ key: 'bin' }]) binaryPaths.push(await add(group[part.key]));
const images = { tex: {}, data: {}, lm: [] };
for (const info of Object.values(doc.materials)) {
  for (const key of ['map', 'emissionMap', 'normalMap', 'glossMap']) {
    const name = info[key]; if (!name) continue;
    images[key === 'normalMap' || key === 'glossMap' ? 'data' : 'tex'][name] = await add(manifest['scene/tex'][name]);
  }
}
for (let i = 0; i < doc.lightmaps; i++) images.lm.push(await add(group['lm' + i]));
if (doc.env) images.env = await add(group.env);
const originalName = 'TX_icewild_A', fixedName = 'TX_icewild_A_opaque_rgb';
const originalPath = await add(manifest['scene/tex'][originalName]);
const fixedPath = images.tex[fixedName];
if (!fixedPath) throw new Error('Install the verified snow RGB companion first');
for (const [target, expected] of [[originalPath, proof.sourceTexture.sha256], [fixedPath, proof.companion.sha256]]) {
  if (identities.find(row => row.path === target)?.sha256 !== expected) throw new Error('Unexpected comparison input ' + target);
}
const bundled = await build({ entryPoints: [path.join(root, 'tools/research/snow-scene-probe-browser.js')],
  bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022', minify: true,
  external: ['/vendor/three.module.js'], logLevel: 'silent' });
const payload = { format: 'stronghold-snow-scene-probe', version: 1, stage, doc, files, binaryPaths, images,
  originalName, fixedName, originalPath, identities, sceneSha256: createHash('sha256').update(sceneBytes).digest('hex') };
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob: data:; connect-src 'none'">
<title>雪地真实材质 A/B</title><style>body{background:#101816;color:#e6eeeb;font:16px system-ui;margin:24px}button{font:inherit;margin:6px;padding:10px}canvas{display:block;max-width:100%;height:auto;border:1px solid #40564b}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>
<h1>雪地真实材质 A/B</h1><p>手动运行现有 Three.js／MAP9 几何和材质。无干员、Pixi、持续 FX 或网络；不登录、不修改游戏。
自动比较旧／新贴图、关闭各向异性、强制输出 alpha=1、关闭抗锯齿。完成后保存 JSON。</p>
<button id="run">开始比较</button><button id="old" disabled>查看旧贴图</button><button id="fixed" disabled>查看修复图</button><button id="save" disabled>保存 JSON</button>
<div id="host"></div><pre id="status">尚未运行。</pre>
<script id="payload" type="application/json">${JSON.stringify(payload).replaceAll('<', '\\u003c')}</script>
<script>${bundled.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></html>`;
await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, html);
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(html), assets: identities.length, stage: stageId,
  scriptSha256: createHash('sha256').update(bundled.outputFiles[0].text).digest('hex') }));
