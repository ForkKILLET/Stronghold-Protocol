// Independent HTTP service; importing or starting it never starts the game or creates a player.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {adminPassword,createAdmin} from './index.js';
import {telemetryToken} from './telemetry-secret.js';
import {createAdminUpstream} from './upstream.js';
import {setSecurityHeaders,sendJson,sendError,answerClientError} from '../http/common.js';

const mime={'.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml',
  '.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.otf':'font/otf','.ttf':'font/ttf'};
export async function startAdminService(opts={}){
  const password=adminPassword(opts.password), token=telemetryToken(opts.token);
  if(!password || !token)throw Error('Administrator password and collector token are required');
  const publicDir=path.resolve(opts.publicDir || path.join(import.meta.dirname,'public'));
  const upstream=createAdminUpstream({url:opts.gameUrl || process.env.SP_ADMIN_GAME_URL || 'http://stronghold-protocol:8001',token,now:opts.now});
  const controller=createAdmin({password,publicDir,snapshot:upstream,trustProxy:opts.trustProxy ?? 'auto',now:opts.now});
  const server=http.createServer((req,res)=>{
    setSecurityHeaders(res);
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('X-Robots-Tag','noindex, nofollow');
    const run=async()=>{
      if((req.url || '').length>4096){sendError(req,res,414,'URI too long');return;}
      const url=new URL(req.url,'http://local');
      const pathname=decodeURIComponent(url.pathname);
      if(pathname==='/healthz'||pathname==='/admin/healthz'){sendJson(req,res,200,{ok:true,service:'stronghold-admin',revision:process.env.SP_ADMIN_REVISION || 'development'});return;}
      if(pathname.startsWith('/admin/assets/')){
        if(!['GET','HEAD'].includes(req.method)){sendError(req,res,405,'Method not allowed');return;}
        const name=pathname.slice('/admin/assets/'.length),file=path.resolve(publicDir,name);
        if(!file.startsWith(publicDir+path.sep) || !mime[path.extname(file)]){sendError(req,res,404,'Not found');return;}
        let bytes;try{bytes=await fs.promises.readFile(file);}catch{sendError(req,res,404,'Not found');return;}
        res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Content-Length':bytes.length,'Cache-Control':'public, max-age=31536000, immutable'});
        res.end(req.method==='HEAD'?undefined:bytes);return;
      }
      if(pathname==='/admin'||pathname.startsWith('/admin/')){await controller.handle(req,res,pathname);return;}
      sendError(req,res,404,'Not found');
    };
    run().catch(()=>sendError(req,res,500,'Internal error'));
  });
  server.headersTimeout=5000;server.requestTimeout=10000;server.on('clientError',answerClientError);
  const host=opts.host ?? process.env.HOST ?? '127.0.0.1',port=opts.port ?? Number(process.env.PORT || 8000);
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});}
  catch(error){controller.close();throw error;}
  let closing;
  return {url:`http://${host}:${server.address().port}`,server,close(){return closing ||= new Promise(resolve=>{controller.close();server.close(resolve);server.closeAllConnections();});}};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const service=await startAdminService();
  console.log('[admin] listening');
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await service.close();process.exit(0);});
}
