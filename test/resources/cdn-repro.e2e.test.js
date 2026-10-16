// scratch reproduction against the real asset tree + the built client (the real deployment shape).
// RESOURCE_E2E=1 node --test test/resources/cdn-repro.e2e.test.js
import { test, describe, before, after } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const enabled = process.env.RESOURCE_E2E === '1' && fs.existsSync(CHROME);
const skip = enabled ? false : 'set RESOURCE_E2E=1 (needs Chrome)';

const MIME = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.skel': 'application/octet-stream',
  '.atlas': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg', '.json': 'application/json', '.woff2': 'font/woff2',
  '.css': 'text/css; charset=utf-8', '.bin': 'application/octet-stream', '.ogg': 'audio/ogg', '.obj': 'text/plain' };

describe('real app + CDN', { skip }, () => {
  let srv;
  let cdn;
  let browser;
  let cdnBase;

  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const { startServer } = await import('../../server/index.js');
    const publicDir = path.join(ROOT, 'public');
    cdn = http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const abs = path.join(publicDir, rel);
      if (!abs.startsWith(publicDir) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=31536000, immutable' });
      res.end(fs.readFileSync(abs));
    });
    await new Promise((resolve) => cdn.listen(0, '127.0.0.1', resolve));
    cdnBase = `http://127.0.0.1:${cdn.address().port}`;
    srv = await startServer({
      port: 0, host: '127.0.0.1', quiet: true, store: null,
      assetsCdn: cdnBase,
      log: { info() {}, warn() {}, error() {}, debug() {} },
    });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
    console.log('GAME', `http://127.0.0.1:${srv.port}`, 'CDN', cdnBase);
  });

  after(async () => {
    await browser?.close();
    await new Promise((r) => cdn?.close(r));
    await srv?.close();
  });

  test('built client: asset request origin vs preload cache origin', async () => {
    const page = await browser.newPage();
    const requests = [];
    page.on('request', (r) => requests.push(r.url()));
    page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE ERROR:', m.text().slice(0, 200)); });
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 200)));
    await page.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: 'domcontentloaded' });
    console.log('HTML', await page.evaluate(() => document.documentElement.outerHTML.slice(0, 300)));

    // the runtime CDN module the built client imports
    console.log('asset-cdn.js =', (await page.evaluate(() => fetch('/js/asset-cdn.js').then((r) => r.text()))).trim());

    // wait for the title screen and turn the preload on through the real pill
    await page.waitForSelector('.res-pill__head', { timeout: 30000 });
    await page.evaluate(() => document.querySelector('.res-pill__head').click());
    await new Promise((r) => setTimeout(r, 12000));

    const info = await page.evaluate(async () => {
      const name = (await caches.keys()).find((n) => n.startsWith('stronghold-resources-v1-'));
      const cache = await caches.open(name);
      const keys = (await cache.keys()).map((k) => k.url);
      const assets = keys.filter((u) => u.includes('/assets/'));
      return { total: keys.length, assets: assets.length, assetOrigins: [...new Set(assets.map((u) => new URL(u).origin))],
        sample: assets.slice(0, 5), manifestOrigin: (await (await fetch('/data/resource-manifest.json')).json()).files.filter((f) => f.url.includes('/assets/')).slice(0, 3).map((f) => f.url) };
    });
    console.log('CACHE', info);
    const gameAssets = [...new Set(requests.filter((u) => /\/assets\//.test(u)))];
    console.log('GAME ASSET REQUEST ORIGINS', [...new Set(gameAssets.map((u) => new URL(u).origin))], 'count', gameAssets.length);
    console.log('GAME ASSET SAMPLE', gameAssets.slice(0, 5));
    await page.close();
  });
});
