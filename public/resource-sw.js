// public/resource-sw.js — the runtime asset cache and optional bulk-preload Service Worker.
//
// Registered with `type: 'module'` for every supported session. Turning bulk preload off stops downloads but does not
// disable this worker. Its scope is "/", but it only ever touches GET requests for the resource trees
// (`/assets/**`, `/fonts/**`, and the extension-less `/media/**` audio route the game asks audio through — site paths or
// CDN URLs): code, game data, API calls and WebSocket upgrades pass straight through to the network, so a stale worker
// can never serve a stale game.
// ZIP mirror routing updates common.js validation; deploy this worker with the matching client modules.

import { isResourcePath } from './js/resources/common.js';
import { handleResourceRequest } from './js/resources/service.js';

self.addEventListener('install', (event) => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (!isResourcePath(url.pathname)) return;
  event.respondWith(handleResourceRequest(request, { waitUntil: (promise) => event.waitUntil(promise) })
    .then((response) => response || fetch(request))
    .catch(() => fetch(request)));
});
