import {REPLAY_DEFAULTS} from './users/replays.js';
// Operator settings only. No gameplay data, credentials, global env mutation or hot reload.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NET_DEFAULTS} from './net.js';
import {LOBBY_DEFAULTS} from './lobby.js';
import {SAVE_MS} from './persist.js';
import {workerSettings} from './workers/pool.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const integer=(min,max)=>value=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const limit=integer(0,1_000_000),duration=integer(1,7*86400_000);
const workerDefaults=()=>workerSettings({});
// JSON path, existing startServer option, env name, default, validator. Keep defaults owned by upstream modules.
export const SERVER_FIELDS=Object.freeze([
 ['limits.maxConnections','maxConnections','SP_MAX_CONNECTIONS',NET_DEFAULTS.maxConnections,limit],
 ['limits.maxConnectionsPerAddr','maxConnectionsPerAddr','SP_MAX_CONNECTIONS_PER_ADDR',NET_DEFAULTS.maxConnectionsPerAddr,limit],
 ['limits.maxSessions','maxSessions','SP_MAX_SESSIONS',NET_DEFAULTS.maxSessions,integer(1,1_000_000)],
 ['limits.maxRooms','maxRooms','SP_MAX_ROOMS',LOBBY_DEFAULTS.maxRooms,limit],
 ['limits.maxRoomsPerAddr','maxRoomsPerAddr','SP_MAX_ROOMS_PER_ADDR',LOBBY_DEFAULTS.maxRoomsPerAddr,limit],
 ['limits.maxMatchesPerAddr','maxMatchesPerAddr','SP_MAX_MATCHES_PER_ADDR',LOBBY_DEFAULTS.maxMatchesPerAddr,limit],
 ['reconnect.coopMs','reconnectWindowMs','SP_RECONNECT_WINDOW_MS',NET_DEFAULTS.reconnectWindowMs,duration],
 ['reconnect.soloMs','soloReconnectWindowMs','SP_SOLO_RECONNECT_MS',LOBBY_DEFAULTS.soloReconnectWindowMs,value=>value===null||duration(value)],
 ['reconnect.lobbyMs','lobbyGraceMs','SP_LOBBY_GRACE_MS',LOBBY_DEFAULTS.lobbyGraceMs,duration],
 ['network.heartbeatMs','heartbeatMs','SP_HEARTBEAT_MS',NET_DEFAULTS.heartbeatMs,duration],
 ['network.helloTimeoutMs','helloTimeoutMs','SP_HELLO_TIMEOUT_MS',NET_DEFAULTS.helloTimeoutMs,duration],
 ['network.resyncMinGapMs','resyncMinGapMs','SP_RESYNC_MIN_GAP_MS',LOBBY_DEFAULTS.resyncMinGapMs,duration],
 ['network.ratePerSec','ratePerSec','SP_RATE_PER_SEC',NET_DEFAULTS.ratePerSec,limit],
 ['network.rateBurst','rateBurst','SP_RATE_BURST',NET_DEFAULTS.rateBurst,limit],
 ['network.heavyPerSec','heavyPerSec','SP_HEAVY_PER_SEC',NET_DEFAULTS.heavyPerSec,limit],
 ['network.heavyBurst','heavyBurst','SP_HEAVY_BURST',NET_DEFAULTS.heavyBurst,limit],
 ['network.abuseDropsPerSec','abuseDropsPerSec','SP_ABUSE_DROPS_PER_SEC',NET_DEFAULTS.abuseDropsPerSec,limit],
 ['persistence.saveMs','saveMs','SP_REDIS_SAVE_MS',SAVE_MS,integer(1000,7*86400_000)],
 ['workers.simulation','workers','SP_WORKERS',()=>workerDefaults().size,integer(0,32)],
 ['workers.rooms','roomWorkers','SP_ROOM_WORKERS',0,integer(0,32)],
 ['workers.matches','matchWorkers','SP_MATCH_WORKERS',0,integer(0,32)],
 ['workers.maxQueue','workerQueue','SP_WORKER_QUEUE',()=>workerDefaults().maxQueue,integer(0,10000)],
 ['workers.timeoutMs','workerTimeoutMs','SP_WORKER_TIMEOUT_MS',()=>workerDefaults().timeoutMs,integer(1,3600_000)],
 ['replays.perUser','replayLimit','SP_REPLAY_LIMIT',REPLAY_DEFAULTS.perUser,integer(0,100)],
 ['replays.maxBytes','replayMaxBytes','SP_REPLAY_MAX_BYTES',REPLAY_DEFAULTS.maxBytes,integer(65536,64*1024*1024)],
 ['shutdown.timeoutMs','shutdownTimeoutMs','SP_SHUTDOWN_TIMEOUT_MS',60_000,integer(1000,300_000)],
].map(Object.freeze));
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

/** Validate the entire file, including values overridden later; typos must never silently select defaults. */
export function validateServerConfig(doc){
 if(!object(doc))throw new TypeError('server config must be a JSON object');
 const fields=new Map(SERVER_FIELDS.map(([key,,,fallback,valid])=>[key,{fallback,valid}]));
 const groups=new Set(SERVER_FIELDS.map(([key])=>key.split('.')[0]));
 for(const [group,entries] of Object.entries(doc)){
  if(!groups.has(group))throw new TypeError(`unknown server config group: ${group.slice(0,80)}`);
  if(!object(entries))throw new TypeError(`server config ${group} must be an object`);
  for(const [key,value] of Object.entries(entries)){
   const field=fields.get(`${group}.${key}`);
   if(!field)throw new TypeError(`unknown server config key: ${group}.${key.slice(0,80)}`);
   if(!field.valid(value))throw new RangeError(`invalid server config value: ${group}.${key}`);
  }
 }
 return doc;
}

/** Priority: explicit options > env > file > module default. Reads once, before resources or listeners open.
 * `serverConfigFile:null` disables file loading; missing default file is optional, an explicit path is required.
 */
export function resolveServerConfig(options={}, {env=process.env,root=ROOT,log=null}={}){
 const selected=options.serverConfigFile!==undefined?options.serverConfigFile:env.SP_SERVER_CONFIG;
 if(selected!==undefined&&selected!==null&&selected!==false&&typeof selected!=='string')throw new TypeError('serverConfigFile must be a path or null');
 const enabled=selected!==null&&selected!==false;
 const explicit=typeof selected==='string'&&selected.trim()!=='';
 const file=enabled?path.resolve(root,explicit?selected:path.join('config','server.json')):null;
 let doc={},loaded=false;
 if(file){
  try{
   const bytes=fs.readFileSync(file);
   if(bytes.length>65536)throw new RangeError('server config exceeds 64 KiB');
   try{doc=JSON.parse(bytes.toString('utf8'));}catch{throw new TypeError('server config is not valid JSON');}
   validateServerConfig(doc);loaded=true;
  }catch(error){if(error.code!=='ENOENT'||explicit)throw error;}
 }
 const resolved={...options},values={},sources={};
 for(const [key,option,envKey,fallback,valid] of SERVER_FIELDS){
  const [group,name]=key.split('.');
  let value=typeof fallback==='function'?fallback():fallback,source='default';
  if(Object.hasOwn(doc[group]||{},name)){value=doc[group][name];source='file';}
  const raw=env[envKey];
  if(raw!=null&&String(raw).trim()!==''){
   const parsed=Number(raw);
   if(valid(parsed)){value=parsed;source=`env:${envKey}`;}
   else if(envKey.startsWith('SP_MAX_'))log?.warn?.(`[http] ${envKey}=${String(raw).slice(0,80)} ignored: a non-negative integer is required (docs/DEPLOY.md §3.4)`);
   else log?.warn?.(`[config] ${envKey} ignored: invalid value`);
  }
  if(options[option]!=null||(option==='soloReconnectWindowMs'&&options[option]===null)){
   if(!valid(options[option]))throw new RangeError(`invalid server option: ${option}`);
   value=options[option];source=`option:${option}`;
  }
  resolved[option]=value;
  (values[group]??={})[name]=value;sources[key]=source;
 }
 if(resolved.roomWorkers>resolved.workers)throw new RangeError('roomWorkers cannot exceed workers');
 for(const group of Object.values(values))Object.freeze(group);
 return{options:resolved,config:Object.freeze({file:loaded?file:null,values:Object.freeze(values),sources:Object.freeze(sources)})};
}
