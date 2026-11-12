// Source development owns one complete local presentation-resource chain. Game/content
// identities remain remote in --remote mode; use the regular static/resource implementation.
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { ROOT } from './config.js';
import { createStaticHandler } from './static.js';
import { PRESENTATION_DATA } from '../plugins/identity.js';
import { AUDIO_EXTS } from '../../shared/media.js';

const MANIFESTS = new Set([...PRESENTATION_DATA, 'asset-hashes', 'resource-manifest', 'resource-packs'].map(n => n + '.json'));
const DEPLOYMENT_METADATA = new Set(['asset-hashes.json', 'resource-manifest.json', 'resource-packs.json']);
const SOURCES = ['assets.json', 'local-assets.json', 'local-fx.json', 'asset-hashes.json', 'resource-packs.json'];
const TREES = ['/assets/', '/fonts/', '/media/', '/resource-packs/', '/downloads/'];

// No fetch handler: an existing development Cache Storage entry must never mask edited art.
// Keep stored resources intact so the preload/ZIP UI can still inspect and test them.
export const DEV_RESOURCE_WORKER = `// Local source development: always use current network resources.\nself.addEventListener('install', event => event.waitUntil(self.skipWaiting()));\nself.addEventListener('activate', event => event.waitUntil(self.clients.claim()));\n`;

function manifestRel(pathname) {
  const match = /^\/data\/((?:versions\/[A-Za-z0-9_-]+\/)?)([^/]+)$/.exec(pathname);
  return match && MANIFESTS.has(match[2]) ? match[1] + match[2] : null;
}

export function isDevResourcePath(pathname, query = '') {
  // Older remote content identities include deployment metadata among their hashed data.
  // Preserve those exact ?v= bytes; ordinary preload requests still use local metadata.
  if (manifestRel(pathname) && DEPLOYMENT_METADATA.has(pathname.split('/').pop()) && new URLSearchParams(query).has('v')) return false;
  return !!manifestRel(pathname) || TREES.some(p => pathname.startsWith(p))
    || pathname === '/js/asset-cdn.js' || pathname === '/resource-sw.js';
}

export async function createDevResources({ publicDir = path.join(ROOT, 'public'), dataDir = path.join(ROOT, 'data'), log = console } = {}) {
  const publicRoot = await realpath(publicDir), dataRoot = await realpath(dataDir);
  const serve = createStaticHandler({ publicDir: publicRoot, dataDir: dataRoot, sharedDir: path.join(ROOT, 'shared'),
    packs: {}, clientBuild: false, cdnBase: '', dataCdnBase: '', log,
    versions: { servedDirs: () => [path.join(dataRoot, 'versions')], file: () => null } });

  const inside = async (root, rel) => {
    try {
      const file = await realpath(path.join(root, rel));
      return file.startsWith(root + path.sep) && (await stat(file)).isFile();
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return true; // normal missing-file response
      throw err;
    }
  };
  const handle = async (req, res, rawPath) => {
    let pathname;
    try { pathname = decodeURIComponent(rawPath); } catch { return false; }
    const query = (req.url || '').split('?').slice(1).join('?');
    if (!isDevResourcePath(pathname, query)) return false;
    if (/[\\\x00-\x1f\x7f]/.test(pathname) || pathname.split('/').some(p => p.startsWith('.') || p === '..')) {
      res.writeHead(400, { 'Cache-Control': 'no-store' }); res.end(); return true;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { 'Cache-Control': 'no-store' }); res.end(); return true;
    }
    const rel = manifestRel(pathname);
    const safe = rel ? await inside(dataRoot, rel)
      : pathname.startsWith('/media/')
        ? (await Promise.all(AUDIO_EXTS.map(ext => inside(publicRoot, 'assets/audio/' + pathname.slice(7).replace(/\.(mp3|m4a|aac|ogg|oga|opus|wav)$/i, '') + ext)))).every(Boolean)
        : pathname.startsWith('/js/') || pathname === '/resource-sw.js'
          || await inside(publicRoot, pathname);
    if (!safe || rel && (await Promise.all(SOURCES.map(name => inside(dataRoot, name)))).some(ok => !ok)) {
      res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end(); return true;
    }
    // The normal server serves immutable packs and ?v= URLs. Development deliberately
    // revalidates neither old deployment validators nor stale browser response bodies.
    delete req.headers['if-none-match']; delete req.headers['if-modified-since'];
    if (pathname === '/resource-sw.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : DEV_RESOURCE_WORKER); return true;
    }
    const writeHead = res.writeHead;
    res.writeHead = function (status, headers) {
      return writeHead.call(this, status, { ...headers, 'Cache-Control': 'no-store' });
    };
    try { await serve(req, res, pathname.split('/').map(encodeURIComponent).join('/'), query); }
    finally { res.writeHead = writeHead; }
    return true;
  };
  handle.close = () => serve.close();
  return handle;
}
