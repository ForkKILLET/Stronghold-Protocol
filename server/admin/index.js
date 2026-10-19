// Independent administrator authentication and bounded operational controls. Disabled without an explicit secret.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,scrypt,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {adminBody as body} from './body.js';
import {sendJson,sendError} from '../http/common.js';
import {clientAddress,limitKeyOf,isLocalIp} from '../net.js';
import {sameOrigin} from '../users/http.js';

const derive = promisify(scrypt);
export const ADMIN_COOKIE = 'sp_admin';
const TTL = 8*60*60*1000;
const hash = value => createHash('sha256').update(value).digest('hex');
export function adminPassword(value) {
  if (value === undefined) value = process.env.SP_ADMIN_PASSWORD_FILE
    ? fs.readFileSync(process.env.SP_ADMIN_PASSWORD_FILE,'utf8').replace(/\r?\n$/,'') : process.env.SP_ADMIN_PASSWORD;
  if (!value) return null;
  if (typeof value !== 'string' || value.length < 16 || Buffer.byteLength(value) > 512) throw new Error('Administrator password requires at least 16 characters and at most 512 bytes');
  return value;
}
function tokenOf(req) {
  const cookies = String(req.headers.cookie || '').split(';').map(v=>v.trim()).filter(v=>v.startsWith(ADMIN_COOKIE+'='));
  return cookies.length===1 && /^sp_admin=[0-9a-f]{64}$/.test(cookies[0]) ? cookies[0].slice(ADMIN_COOKIE.length+1) : null;
}

export function createAdmin({password,publicDir,snapshot,trustProxy,now=Date.now}) {
  if (!password) return null;
  const salt=randomBytes(16), expected=scryptSync(password,salt,32);
  const sessions=new Map(), attempts=new Map();
  let activeLogins=0, globalAttempts={until:0,count:0},closed=false;
  const json=(req,res,status,data)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Cookie');sendJson(req,res,status,data);};
  function cookie(req,res,token) {
    const secure=!!req.socket.encrypted || ((trustProxy===true || (trustProxy==='auto' && isLocalIp(req.socket.remoteAddress))) && req.headers['x-forwarded-proto']==='https');
    res.setHeader('Set-Cookie',`${ADMIN_COOKIE}=${token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${token?TTL/1000:0}${secure?'; Secure':''}`);
  }
  function loginAllowed(req) {
    const at=now(),key=limitKeyOf(clientAddress(req,trustProxy).ip);
    for (const [k,v] of attempts) if (v.until<=at) attempts.delete(k);
    if (globalAttempts.until<=at) globalAttempts={until:at+60000,count:0};
    if (++globalAttempts.count>60 || activeLogins>=4 || attempts.size>=4096 && !attempts.has(key)) return false;
    let limit=attempts.get(key);
    if (!limit) {limit={until:at+60000,count:0};attempts.set(key,limit);}
    return ++limit.count<=8;
  }
  function session(req) {
    const at=now();
    for (const [key,value] of sessions) if (value.expires<=at) sessions.delete(key);
    const token=tokenOf(req);
    return token ? sessions.get(hash(token)) : null;
  }
  function readAllowed(value) {
    const at=now();
    if (value.until<=at) {value.until=at+60000;value.reads=0;}
    return ++value.reads<=120;
  }
  return {
    async handle(req,res,pathname) {
      res.setHeader('Cache-Control','no-store');
      res.setHeader('X-Robots-Tag','noindex, nofollow');
      res.setHeader('Content-Security-Policy',"frame-ancestors 'none'");
      if (closed) {json(req,res,503,{error:'UNAVAILABLE'});return;}
      if (['/admin','/admin/','/admin/index.html'].includes(pathname)) {
        if (!['GET','HEAD'].includes(req.method)) {json(req,res,405,{error:'METHOD'});return;}
        const html=fs.readFileSync(path.join(publicDir,'admin/index.html'));
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':html.length});res.end(req.method==='HEAD'?undefined:html);return;
      }
      if (!pathname.startsWith('/admin/api/')) {sendError(req,res,404,'Not found');return;}
      if (!sameOrigin(req)) {json(req,res,403,{error:'ORIGIN'});return;}
      try {
        if (pathname==='/admin/api/login' && req.method==='POST') {
          if (!loginAllowed(req)) {res.setHeader('Retry-After','60');json(req,res,429,{error:'RATE'});return;}
          const input=await body(req);
          if (typeof input.password!=='string' || Buffer.byteLength(input.password)>512) {json(req,res,400,{error:'INPUT'});return;}
          activeLogins++;
          let actual;
          try {actual=await derive(input.password,salt,32);} finally {activeLogins--;}
          if (closed) {json(req,res,503,{error:'UNAVAILABLE'});return;}
          if (!timingSafeEqual(expected,actual)) {json(req,res,401,{error:'AUTH'});return;}
          const token=randomBytes(32).toString('hex');
          const old=tokenOf(req);if(old)sessions.delete(hash(old));
          if(sessions.size>=64)sessions.delete(sessions.keys().next().value);
          sessions.set(hash(token),{expires:now()+TTL,until:now()+60000,reads:0});
          cookie(req,res,token);json(req,res,200,{ok:true});return;
        }
        const current=session(req);
        if (!current) {json(req,res,401,{error:'AUTH'});return;}
        if (pathname==='/admin/api/logout' && req.method==='POST') {
          sessions.delete(hash(tokenOf(req)));cookie(req,res,'');json(req,res,200,{ok:true});return;
        }
        if (pathname==='/admin/api/server-message') {
          if(!['GET','POST'].includes(req.method)){json(req,res,405,{error:'METHOD'});return;}
          if(!readAllowed(current)){json(req,res,429,{error:'RATE'});return;}
          if(req.method==='GET'){json(req,res,200,await snapshot.serverMessage());return;}
          if(!current.writeUntil || current.writeUntil<=now()){current.writeUntil=now()+60000;current.writes=0;}
          if(++current.writes>10){res.setHeader('Retry-After','60');json(req,res,429,{error:'RATE'});return;}
          json(req,res,200,await snapshot.updateServerMessage(await body(req,4096)));return;
        }
        if (req.method!=='GET') {json(req,res,405,{error:'METHOD'});return;}
        if (!readAllowed(current)) {json(req,res,429,{error:'RATE'});return;}
        if (pathname==='/admin/api/session') {json(req,res,200,{ok:true,expires:current.expires});return;}
        if (pathname==='/admin/api/overview') {json(req,res,200,await snapshot.overview());return;}
        if (pathname==='/admin/api/list') {
          const params=new URL(req.url,'http://local').searchParams;
          const kind=params.get('kind'),page=Number(params.get('page') || 1),query=params.get('q') || '',status=params.get('status') || 'all';
          if (!['matches','queue','players','rooms'].includes(kind) || !Number.isInteger(page) || page<1 || page>100000 || query.length>80 ||
              !['all','online','disconnected','match','queue','waiting','lobby','spectating'].includes(status) || status!=='all' && kind!=='players') {
            json(req,res,400,{error:'INPUT'});return;
          }
          json(req,res,200,await snapshot.list(kind,{page,query,status}));return;
        }
        json(req,res,404,{error:'NOT_FOUND'});
      } catch(error) {json(req,res,error.status || 503,{error:error.status===409?'CONFLICT':error.status?'INPUT':'UNAVAILABLE'});}
    },
    close() {closed=true;sessions.clear();attempts.clear();snapshot.close?.();},
  };
}
