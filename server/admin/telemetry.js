// Game-only operational endpoint: snapshots and the bounded notification editor; a separate, authenticated listener, never mounted on the public game router.
import http from 'node:http';
import {createHash, timingSafeEqual, randomUUID} from 'node:crypto';
import {createAdminSnapshot} from './snapshot.js';
import {adminBody} from './body.js';
import {sendJson, answerClientError} from '../http/common.js';
import {createAdminPlayers,playerQuery} from './players.js';

export {telemetryToken} from './telemetry-secret.js';
export async function startTelemetry({token, health, diagnostics, data, users, log, host='127.0.0.1', port=8001, now=Date.now}) {
  if (!token) return null;
  const wanted=createHash('sha256').update('Bearer '+token).digest(), instance=randomUUID();
  const snapshot=createAdminSnapshot({health,diagnostics,data,now});
  const players=createAdminPlayers({users,registry:health.registry,snapshot,data,now,log});
  let writes={until:0,count:0};
  let recoveryWrites={until:0,count:0};
  const controls=diagnostics.announcements?.serverMessage;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    let url;
    try{url=new URL(req.url,'http://local');}catch{sendJson(req,res,400,{error:'INPUT'});return;}
    if(!['/v1/snapshot','/v1/server-message','/v1/players','/v1/player-recovery'].includes(url.pathname)){sendJson(req,res,404,{error:'NOT_FOUND'});return;}
    const actual=createHash('sha256').update(String(req.headers.authorization || '')).digest();
    if(!timingSafeEqual(actual,wanted) || req.headers.origin){sendJson(req,res,401,{error:'AUTH'});return;}
    try {
      if(url.pathname==='/v1/players'){
        if(req.method!=='GET'){sendJson(req,res,405,{error:'METHOD'});return;}
        sendJson(req,res,200,await players.list(playerQuery(url.searchParams)));return;
      }
      if(url.pathname==='/v1/player-recovery'){
        if(req.method!=='POST'){sendJson(req,res,405,{error:'METHOD'});return;}
        if(recoveryWrites.until<=now())recoveryWrites={until:now()+60000,count:0};
        if(++recoveryWrites.count>10){sendJson(req,res,429,{error:'RATE'});return;}
        sendJson(req,res,200,await players.recovery(await adminBody(req,1024)));return;
      }
      if(req.url==='/v1/server-message'){
        if(!controls){sendJson(req,res,404,{error:'UNSUPPORTED'});return;}
        if(req.method==='GET'){sendJson(req,res,200,controls.state());return;}
        if(req.method!=='POST'){sendJson(req,res,405,{error:'METHOD'});return;}
        if(writes.until<=now())writes={until:now()+60000,count:0};
        if(++writes.count>20){sendJson(req,res,429,{error:'RATE'});return;}
        sendJson(req,res,200,await controls.update(await adminBody(req,4096)));return;
      }
      if(req.method!=='GET'){sendJson(req,res,405,{error:'METHOD'});return;}
      const value=snapshot.capture();
      sendJson(req,res,200,{...value,server:{...value.server,instance},
        capabilities:{serverMessage:!!controls,players:true,playerRecovery:!!users},serverMessage:controls?.state() || null});
    } catch(error) {sendJson(req,res,error.status || 503,{error:error.status===409?'CONFLICT':error.status?'INPUT':'UNAVAILABLE'});}

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
