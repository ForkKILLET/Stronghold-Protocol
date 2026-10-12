// public/js/resources/service.js — the Service Worker side of the asset preload: answer a request from Cache Storage, or
// say "not mine" so the worker falls back to the network (docs/ASSETS.md「Preload」).
//
// Only /assets/**, /fonts/** and the extension-less /media/** audio route (site paths or CDN URLs) are ever answered, and
// only from caches this app wrote (`X-SP-Resource`): code, data, API responses, manifests and WebSocket traffic never
// pass through this module.

import { CACHE_NAME, CACHE_PREFIX, absoluteUrl, isResourcePath, mediaCandidates, rangeResponse, resourceType } from './common.js';
import { queueRuntimeIndexEntry } from './runtimeIndex.js';

/**
 * @param {Request} request
 * @param {{ caches?: any, fetcher?: typeof fetch, waitUntil?: (promise: Promise<any>) => void }} [opts]
 * @returns {Promise<Response|null>} a reply, or null when the request is not a resource
 */
export async function handleResourceRequest(request, { caches = globalThis.caches, fetcher = globalThis.fetch?.bind(globalThis), waitUntil } = {}) {
  if (!caches || !request || request.method !== 'GET') return null;
  let url;
  try { url = new URL(request.url); } catch { return null; }
  if (!isResourcePath(url.pathname)) return null;
  const range = request.headers.get('Range');
  if (isAudioRequest(url)) {
    try {
      const network = await fetcher(request);
      if ((network?.ok || network?.type === 'opaque') && (network.type === 'opaque' || network.status === 200) && !range) cacheInBackground(url, network, caches, waitUntil);
      return network;
    } catch {
      const hit = await matchResource(url, caches);
      return hit ? cachedReply(hit, range) : null;
    }
  }
  const hit = await matchResource(url, caches);
  if (hit) return cachedReply(hit, range);
  try {
    const network = await fetcher(request);
    if ((network?.ok || network?.type === 'opaque') && (network.type === 'opaque' || network.status === 200)) cacheInBackground(url, network, caches, waitUntil);
    return network;
  } catch {
    return null;
  }
}

async function cachedReply(hit, range) {
  if (!range) return hit;
  try { return await rangeResponse(hit, range); } catch { return hit; }
}

function isAudioRequest(url) {
  return url.pathname.startsWith('/media/') || resourceType(url.pathname)?.startsWith('audio/') === true;
}

function cacheAllowed(response) {
  // Cross-origin CDN assets requested by <img>, <audio> or @font-face are often
  // opaque responses. Cache Storage can safely retain those responses even though
  // their status/headers are hidden from the worker.
  if (!response || (!response.ok && response.type !== 'opaque') || (response.type !== 'opaque' && response.status !== 200)) return false;
  if (response.type === 'opaque') return true;
  const cc = response.headers.get('cache-control') || '';
  return !/(?:^|,)\s*(?:no-store|private)(?:\s*(?:,|$))/i.test(cc)
    && response.headers.get('vary') !== '*';
}

function cacheInBackground(url, response, caches, waitUntil) {
  if (!cacheAllowed(response)) return;
  const candidate = url.pathname.startsWith('/media/') ? mediaCandidates(url.pathname)[0] : url.href;
  const key = absoluteUrl(candidate || url.href);
  if (!key) return;
  // Clone before returning the network response to the browser. Once the
  // response is returned, the browser may start consuming its body before the
  // asynchronous cache task gets a chance to call clone().
  let copy;
  try { copy = response.clone(); } catch (err) {
    console.warn('[resources] runtime cache clone failed', key, err);
    return;
  }
  const write = async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(new Request(key, { method: 'GET' }), copy);
    await queueRuntimeIndexEntry(cache, globalThis.location?.origin, key);
  };
  // Do not race a clear, ZIP import or preload writer. Respond to the browser
  // immediately; when another owner holds the lock, skip this optional write.
  const locks = globalThis.navigator?.locks;
  const task = (locks?.request
    ? locks.request('stronghold-resources-preload', { mode: 'shared', ifAvailable: true }, (lock) => lock ? write() : undefined)
    : write())
    .catch((err) => {
      // Runtime caching is best-effort, but keep the reason visible when a
      // browser rejects an opaque/CDN response or runs out of storage.
      console.warn('[resources] runtime cache write failed', key, err);
    });
  if (typeof waitUntil === 'function') waitUntil(task);
}

/**
 * The cache keys a request may be answered from. Usually just its own URL — but the game fetches audio through the
 * extension-less `/media/bgm/act1` route (shared/media.js, `server/index.js serveMedia`), and the preload stores the
 * canonical `/assets/audio/….mp3` the manifest lists, so such a request also looks for those.
 * @param {URL} url
 * @returns {string[]}
 */
function cacheKeys(url) {
  const candidates = mediaCandidates(url.pathname);
  if (!candidates.length) {
    const key = absoluteUrl(url.href);
    const legacy = key.replace(/%5B/gi, '[').replace(/%5D/gi, ']');
    return key === legacy ? [key] : [key, legacy];
  }
  const keys = [];
  for (const path of candidates) {
    try { keys.push(new URL(path, url).href); } catch { /* one impossible candidate less */ }
  }
  return keys.length ? keys : [url.href];
}

/**
 * First cache entry for a request across every cache this app owns: the current cache first, then the caches of earlier
 * builds (the pre-hash layout). Those are still answered while an update migrates them into `CACHE_NAME` — and the
 * order matters, because a stale entry left in an older cache must never shadow the fresh file of the current one.
 */
async function matchResource(url, caches) {
  const keys = cacheKeys(url);
  const names = (await caches.keys()).filter((n) => n.startsWith(CACHE_PREFIX));
  names.sort((a, b) => (a === CACHE_NAME ? -1 : b === CACHE_NAME ? 1 : 0));
  for (const name of names) {
    const cache = await caches.open(name);
    for (const key of keys) {
      const res = await cache.match(key);
      if (res) return res;
    }
  }
  return null;
}
