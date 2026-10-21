import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceCaptionTables} from '../../public/js/voiceCaptionTables.js';

const response = table => ({ok:true,json:async()=>table});
const tick = () => new Promise(resolve=>setImmediate(resolve));
const opts = {delay:async()=>{}};

test('cached subtitles resolve while conditional revalidation is still pending; later reads use the updated text',async()=>{
 const requests=[],fresh=Promise.withResolvers();let changes=0;
 const tables=createVoiceCaptionTables({...opts,fetcher:async(url,init)=>{requests.push([url,init.cache]);return init.cache==='force-cache'?response({line:'cached'}):fresh.promise;}});
 const off=tables.subscribe(()=>changes++);
 assert.deepEqual(await tables.load('zh'),{line:'cached'});
 assert.deepEqual(await tables.load('zh'),{line:'cached'});
 assert.deepEqual(requests,[['/data/voice-captions/zh.json','force-cache'],['/data/voice-captions/zh.json','no-cache']]);
 assert.equal(changes,1);
 fresh.resolve(response({line:'updated'}));await tick();
 assert.deepEqual(await tables.load('zh'),{line:'updated'});assert.equal(requests.length,2);assert.equal(changes,2);
 off();
});

test('cold loads and retries are shared by warmup, speech and repeated calls',async()=>{
 const first=Promise.withResolvers(),requests=[];let calls=0;
 const tables=createVoiceCaptionTables({...opts,fetcher:async(url,init)=>{requests.push(init.cache);if(++calls===1)return first.promise;return response({line:'ready'});}});
 const a=tables.load('zh'),b=tables.load('zh');assert.equal(a,b);
 first.reject(Error('temporary outage'));
 assert.deepEqual(await a,{line:'ready'});assert.deepEqual(await b,{line:'ready'});await tick();
 assert.deepEqual(requests,['force-cache','no-cache','no-cache']);
 assert.deepEqual(await tables.load('zh'),{line:'ready'});assert.equal(requests.length,3);
});

test('refresh failure retains cached lines and retries after cooldown without hammering every utterance',async()=>{
 let clock=0,calls=0;
 const tables=createVoiceCaptionTables({...opts,now:()=>clock,refreshRetryMs:100,fetcher:async(url,init)=>{
  calls++;if(init.cache==='force-cache')return response({line:'cached'});
  if(clock<100)throw Error('offline');return response({line:'reconnected'});
 }});
 await tables.load('zh');await tick();assert.equal(calls,3);
 for(let i=0;i<5;i++)assert.deepEqual(await tables.load('zh'),{line:'cached'});
 assert.equal(calls,3);
 clock=100;assert.deepEqual(await tables.load('zh'),{line:'cached'});await tick();
 assert.deepEqual(await tables.load('zh'),{line:'reconnected'});assert.equal(calls,4);
});

test('malformed cached data is retried against the network and cannot poison later speech',async()=>{
 for(const bad of [null,[],{},{line:123}]){
  const modes=[];
  const tables=createVoiceCaptionTables({...opts,fetcher:async(url,init)=>{modes.push(init.cache);return response(modes.length===1?bad:{line:'valid'});}});
  assert.deepEqual(await tables.load('zh'),{line:'valid'});await tick();
  assert.deepEqual(modes,['force-cache','no-cache','no-cache']);
 }
});

test('failed cold load can recover on a later call; unsupported languages make no requests',async()=>{
 let offline=true,calls=0;
 const tables=createVoiceCaptionTables({...opts,fetcher:async()=>{calls++;if(offline)throw Error('offline');return response({line:'ready'});}});
 assert.equal(await tables.load('it'),null);assert.equal(calls,0);
 assert.equal(await tables.load('zh'),null);assert.equal(calls,2);
 offline=false;assert.deepEqual(await tables.load('zh'),{line:'ready'});
});

test('a timed-out cold request is aborted and its replacement can finish',async()=>{
 let calls=0,aborted=false;
 const tables=createVoiceCaptionTables({...opts,timeoutMs:10,fetcher:async(url,init)=>{
  if(++calls!==1)return response({line:'retry'});
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>resolve(response({line:'late'})),100);
   init.signal.addEventListener('abort',()=>{aborted=true;clearTimeout(timer);reject(init.signal.reason);},{once:true});
  });
 }});
 assert.deepEqual(await tables.load('zh'),{line:'retry'});assert.equal(aborted,true);
});
