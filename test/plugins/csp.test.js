import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Writable } from 'node:stream';
import { once } from 'node:events';
import { createRequestHandler } from '../../server/http/routes.js';
import { createStaticHandler } from '../../server/http/static.js';
import { createPluginRegistry } from '../../server/plugins/registry.js';
import {scriptFixture} from '../helpers/scriptFixtures.js';
import {createContentSets} from '../../server/plugins/contentSets.js';
import {getData} from '../../server/data.js';

const publicDir = path.resolve('public');
function request(handler, url, headers = {}) {
  const body = [], result = { headers: {}, status: 0 };
  const res = new Writable({ write(chunk, _, done) { body.push(chunk); done(); } });
  res.setHeader = (name, value) => { result.headers[name.toLowerCase()] = value; };
  res.getHeader = name => result.headers[name.toLowerCase()];
  res.writeHead = (status, fields) => { result.status = status; for (const [k, v] of Object.entries(fields || {})) res.setHeader(k, v); };
  const done = once(res, 'finish').then(() => ({ ...result, body: Buffer.concat(body).toString() }));
  handler({ url, method: 'GET', headers }, res);
  return done;
}
function handler() {
  const serveStatic = createStaticHandler({ publicDir, dataDir: path.resolve('data'), sharedDir: path.resolve('shared') });
  return createRequestHandler({ serveStatic, health: {}, log: console });
}
test('pages, health, errors and simulation Workers do not send CSP', async () => {
  const serve = handler();
  for (const url of ['/', '/index.html', '/healthz', '/missing-csp-check', '/js/battle/simWorker.js']) {
    const response = await request(serve, url);
    assert.equal(response.headers['content-security-policy'], undefined, url);
    assert.equal(response.headers['x-content-type-options'], 'nosniff', url);
    assert.equal(response.headers['referrer-policy'], 'same-origin', url);
  }
  const source = fs.readFileSync(path.resolve('server/index.js'), 'utf8');
  assert.doesNotMatch(source, /SP_CSP|siteCsp/);
});

test('native script HTTP routes serve exact descriptor bytes and JavaScript MIME without CSP',async t=>{
  const f=scriptFixture(t);
  f.put('native',"import {kit} from 'sp:sdk@1'; export default sp => {};",
    {class:'trusted',permissions:['sim.code','trusted.page'],entry:{sim:'index.js',client:'page.js'}},{'page.js':'globalThis.nativeTest = true;'});
  const contents=createContentSets({registry:f.registry,vanillaData:getData()});
  const r=contents.resolve(['native']);assert.ok(r.ok,JSON.stringify(r));
  const set=r.set,cs16=set.cs.slice(0,16);
  const serveStatic=createStaticHandler({publicDir,dataDir:path.resolve('data'),sharedDir:path.resolve('shared'),contents});
  const serve=createRequestHandler({serveStatic,health:{},log:console});
  for(const rel of ['index.js','page.js']) {
    const url=`/cs/${cs16}/scripts/native/${rel}`,a=await request(serve,url);
    assert.equal(a.status,200);assert.match(a.headers['content-type'],/^text\/javascript/);
    assert.equal(a.body,set.scripts[0].browserSources[rel]);assert.equal(a.headers['content-security-policy'],undefined);
    assert.equal((await request(serve,url,{'if-none-match':a.headers.etag})).status,304);
  }
  assert.match(set.scripts[0].browserSources['index.js'],/\/shared\/plugins\/sdk.js/);
  assert.equal((await request(serve,`/cs/${cs16}/scripts/native/not-listed.js`)).status,404);
  fs.writeFileSync(f.pluginsDir+'/native/page.js','globalThis.nativeTest = false;');
  assert.equal((await request(serve,`/cs/${cs16}/scripts/native/page.js`)).body,'globalThis.nativeTest = true;','immutable held bytes');
});
test('Worker ranges and encoded aliases keep cache behavior without CSP', async () => {
  const serve = handler();
  const a = await request(serve, '/js/battle/simWorker.js');
  assert.equal(a.status, 200);
  assert.equal(a.headers['content-security-policy'], undefined);
  for (const headers of [{ range: 'bytes=0-20' }, { 'if-none-match': a.headers.etag }]) {
    const b = await request(serve, '/js/battle/sim%57orker.js', headers);
    assert.equal(b.status, headers.range ? 206 : 304);
    assert.equal(b.headers['content-security-policy'], undefined);
  }
});

test('UI plugin responses omit CSP on 200/206/304', async t => {
  const pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-p3b-frame-csp-'));
  t.after(() => fs.rmSync(pluginsDir, { recursive: true, force: true }));
  fs.cpSync(path.resolve('plugins/_template/ui'), path.join(pluginsDir, 'damage-meter'), { recursive: true });
  const dirs = { publicDir, pluginsDir, sharedDir: path.resolve('shared'), dataDir: path.resolve('data'), packsDir: path.join(pluginsDir, 'packs') };
  const registry = createPluginRegistry(dirs); registry.refresh(true);
  const file = registry.plugin('damage-meter').ui.served.get('ui/index.html');
  const url = `/p/damage-meter/${file.sha256.slice(0, 8)}/ui/index.html`;
  {
    const serve = createRequestHandler({ serveStatic: createStaticHandler({ ...dirs, packs: registry }), health: {}, log: console });
    const first = await request(serve, url);
    assert.equal(first.status, 200); assert.equal(first.headers['content-security-policy'], undefined);
    for (const headers of [{ range: 'bytes=0-20' }, { 'if-none-match': first.headers.etag }]) {
      const next = await request(serve, url, headers);
      assert.equal(next.status, headers.range ? 206 : 304); assert.equal(next.headers['content-security-policy'], undefined);
    }
  }
});
