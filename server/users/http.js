import {sendJson} from '../http/common.js';
import {sanitizeName,clientAddress,limitKeyOf,isLocalIp} from '../net.js';
export const USER_COOKIE='sp_user';
export function userToken(req){const values=String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(USER_COOKIE+'='));return values.length===1?values[0].slice(USER_COOKIE.length+1):null;}
export function sameOrigin(req){
 if(req.headers['sec-fetch-site']==='cross-site')return false;
 try{return !req.headers.origin || new URL(req.headers.origin).host===req.headers.host;}catch{return false;}
}
export function createUserApi({users,registry,lobby,data,moderation,trustProxy,log,network}){
 const limits=new Map();
 const json=(req,res,status,data)=>{res.setHeader('Cache-Control','no-store');sendJson(req,res,status,data);};
 const cookie=(req,res,token)=>{
  // TLS flag is emitted for direct TLS or the configured trusted proxy's https request.
  const secure=!!req.socket.encrypted || ((trustProxy===true || (trustProxy==='auto' && isLocalIp(req.socket.remoteAddress))) && req.headers['x-forwarded-proto']==='https');
  res.setHeader('Set-Cookie',`${USER_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secure?'; Secure':''}`);
 };
 function allowed(req,kind){
  const now=Date.now();const key=kind+':'+limitKeyOf(clientAddress(req,trustProxy));
  if(limits.size>4096){for(const [k,v] of limits)if(v.until<now)limits.delete(k);if(limits.size>4096)return false;}
  let v=limits.get(key);if(!v||v.until<now){v={until:now+60000,count:0};limits.set(key,v);}
  return ++v.count<=(kind==='recover'?8:60);
 }
 async function body(req){
  if(!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type']||'')))throw Object.assign(new Error(),{status:415});
  let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8192)throw Object.assign(new Error(),{status:413});chunks.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(chunks));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw Object.assign(new Error(),{status:400});}
 }
 function active(id){return [...registry.all()].some(s=>s.userId===id&&lobby.activeMatchOf(s)?.match&&!lobby.activeMatchOf(s)?.ended);}
 return async(req,res,pathname)=>{
  if(!pathname.startsWith('/api/user'))return false;
  if(!users){json(req,res,503,{error:'USER_STORAGE_DISABLED'});return true;}
  if(!sameOrigin(req)){json(req,res,403,{error:'ORIGIN'});return true;}
  if(!allowed(req,pathname==='/api/user/recover'?'recover':'user')){json(req,res,429,{error:'RATE'});return true;}
  try{
   const token=userToken(req);let user=token?await users.call('authenticate',{token}):null;
   if(pathname==='/api/user'&&req.method==='GET'){
    if(!user){const created=await users.call('create');user=created.user;cookie(req,res,created.token);}else cookie(req,res,token);
    json(req,res,200,{user});return true;
   }
   if(!user){json(req,res,401,{error:'AUTH'});return true;}
   if(pathname==='/api/user/stats'&&req.method==='GET'){
    const cursor=new URL(req.url,'http://local').searchParams.get('before');
    const before=cursor==null?null:Number(cursor);if(before!=null&&(!Number.isSafeInteger(before)||before<1)){json(req,res,400,{error:'CURSOR'});return true;}
    json(req,res,200,await users.call('stats',{id:user.id,before}));return true;
   }
   if(req.method!=='POST'){json(req,res,405,{error:'METHOD'});return true;}
   const input=await body(req);
   if(pathname==='/api/user/profile' || pathname==='/api/user/name'){
    const name=sanitizeName(input.name);const avatarId=pathname==='/api/user/name'?user.avatarId:input.avatarId;
    if(!name || (pathname==='/api/user/profile' && !(avatarId===null || (typeof avatarId==='string' && Object.hasOwn(data['profile-avatars']?.avatars||{},avatarId))))){json(req,res,400,{error:'PROFILE'});return true;}
    if(moderation){const verdict=await moderation.check(name,limitKeyOf(clientAddress(req,trustProxy)));if(verdict?.allowed!==true&&verdict?.code==='NAME_REJECTED'){json(req,res,400,{error:'NAME_REJECTED'});return true;}}
    if(pathname==='/api/user/name'){await users.call('rename',{id:user.id,name});user=await users.call('profile',{id:user.id});}
    else user=await users.call('update',{id:user.id,name,avatarId});
    for(const connection of network.conns.values())if(connection.userProfile?.id===user.id)connection.userProfile=user;
    for(const session of registry.all())if(session.userId===user.id){
     session.name=name;session.avatarId=avatarId;
     const room=lobby.roomOf(session);const seat=room?.seatOf(session.playerId)||room?.spectatorOf(session.playerId);
     if(seat){seat.avatarId=avatarId;if(!room.match)seat.name=name;lobby.broadcastState(room);}
    }
    json(req,res,200,{user});return true;
   }
   if(pathname==='/api/user/recovery'){
    json(req,res,200,await users.call('recovery',{id:user.id}));return true;
   }
   if(pathname==='/api/user/recover'){
    if(active(user.id)){json(req,res,409,{error:'ACTIVE_MATCH'});return true;}
    if(typeof input.code!=='string'||!/^SP-[A-Za-z0-9_-]{43}$/.test(input.code.trim())){json(req,res,400,{error:'RECOVERY_CODE'});return true;}
    const recovered=await users.call('recover',{code:input.code.trim()});
    if(!recovered){json(req,res,400,{error:'RECOVERY_CODE'});return true;}
    cookie(req,res,recovered.token);json(req,res,200,{user:recovered.user});return true;
   }
   json(req,res,404,{error:'NOT_FOUND'});return true;
  }catch(e){if(!e.status)log.warn?.('[users] request failed');json(req,res,e.status||503,{error:e.status?'BAD_REQUEST':'USER_STORAGE_UNAVAILABLE'});return true;}
 };
}
