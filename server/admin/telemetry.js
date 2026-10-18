// Game-only collector: a separate, authenticated listener, never mounted on the public game router.
import http from 'node:http';
import {createHash, timingSafeEqual, randomUUID} from 'node:crypto';
import {createAdminSnapshot} from './snapshot.js';
import {sendJson, answerClientError} from '../http/common.js';

export {telemetryToken} from './telemetry-secret.js';
export async function startTelemetry({token, health, diagnostics, data, host='127.0.0.1', port=8001, now=Date.now}) {
  if (!token) return null;
  const wanted=createHash('sha256').update('Bearer '+token).digest(), instance=randomUUID();
  const snapshot=createAdminSnapshot({health,diagnostics,data,now});
  const server=http.createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(req.url!=='/v1/snapshot'){sendJson(req,res,404,{error:'NOT_FOUND'});return;}
    const actual=createHash('sha256').update(String(req.headers.authorization || '')).digest();
    if(!timingSafeEqual(actual,wanted) || req.headers.origin){sendJson(req,res,401,{error:'AUTH'});return;}
    if(req.method!=='GET'){sendJson(req,res,405,{error:'METHOD'});return;}
    try {
      const value=snapshot.capture();
      sendJson(req,res,200,{...value,server:{...value.server,instance}});
    } catch { sendJson(req,res,503,{error:'UNAVAILABLE'}); }
  });
  // Keep the collector's footprint bounded; requests only sample existing lightweight public state.
  server.maxConnections=16;server.headersTimeout=5000;server.requestTimeout=5000;
  server.on('clientError',answerClientError);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  const address=server.address();
  return {url:`http://${host}:${address.port}`,close:()=>new Promise(resolve=>{
    server.close(resolve);server.closeAllConnections();
  })};
}
