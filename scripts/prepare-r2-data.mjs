import fs from 'node:fs/promises';
import path from 'node:path';
import { createResourceIndex } from '../server/resources.js';
import { rewriteAssetPaths } from '../shared/cdn.js';
import { parseResourcePackRoutes, routeResourcePacks } from '../shared/resourcePackRoutes.js';

const [dataDir, publicDir, assetsCdn = '', routesValue = ''] = process.argv.slice(2);
if (!dataDir || !publicDir) throw new Error('usage: prepare-r2-data.mjs <staged-data-dir> <public-dir> [assets-cdn] [pack-routes-json]');

const routes = parseResourcePackRoutes(routesValue);
const assetsBase = assetsCdn.replace(/\/+$/, '');
const packIndexPath = path.join(dataDir, 'resource-packs.json');
let packDoc;
try { packDoc = JSON.parse(await fs.readFile(packIndexPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const packDir = path.join(publicDir, 'resource-packs');
if (packDoc) {
  if (packDoc.format !== 'stronghold-resource-pack-index' || packDoc.version !== 1 || !Array.isArray(packDoc.packs)) {
    throw new Error('Invalid resource-packs.json; regenerate transport packs before uploading');
  }
  for (const pack of packDoc.packs) {
    const file = typeof pack.url === 'string' ? pack.url.split('/').at(-1) : '';
    if (!/^[A-Za-z0-9._-]+\.zip$/.test(file)) throw new Error('Invalid resource pack ZIP filename');
    const stat = await fs.stat(path.join(packDir, file));
    if (!stat.isFile() || stat.size !== pack.size) throw new Error(`Missing or size-mismatched resource pack: ${file}`);
  }
} else {
  const files = await fs.readdir(packDir).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  if (files.some(file => file.endsWith('.zip'))) throw new Error('Resource ZIPs exist without data/resource-packs.json');
}
const resourceIndex = await createResourceIndex({
  dataDir,
  publicDir,
  cdnBase: assetsBase,
  resourcePackRoutes: routes,
  rewrite: (value) => assetsBase ? rewriteAssetPaths(value, assetsBase) : value,
}).get();
await fs.writeFile(path.join(dataDir, 'resource-manifest.json'), `${JSON.stringify(resourceIndex.manifest)}\n`);

if (packDoc) {
  packDoc.packs = routeResourcePacks(packDoc.packs, assetsBase, routes);
  await fs.writeFile(packIndexPath, `${JSON.stringify(packDoc, null, 2)}\n`);
}

console.log(`Prepared ${resourceIndex.manifest.count} resources for ${resourceIndex.manifest.version}.`);
