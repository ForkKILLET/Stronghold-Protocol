import {installReplays} from './replays.js';
import {achievementStats} from '../../shared/achievementStats.js';
import {aggregateStats,accountRecord} from '../../shared/userStats.js';
// The SQLite connection lives off the game/network event loop. Only newly issued credentials are returned; existing credentials are stored as hashes.
import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const hash=s=>createHash('sha256').update(s).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
if(workerData.file!==':memory:')fs.mkdirSync(path.dirname(workerData.file),{recursive:true,mode:0o700});
const db=new DatabaseSync(workerData.file);
if(workerData.file!==':memory:')fs.chmodSync(workerData.file,0o600);
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;');
const version=db.prepare('PRAGMA user_version').get().user_version;
if(version>1)throw new Error('User database is newer than this server');
if(version===0)db.exec(`BEGIN;
 CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL DEFAULT '',avatar_id TEXT,created_at INTEGER NOT NULL);
 CREATE TABLE credentials(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id));
 CREATE TABLE recovery(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE REFERENCES users(id));
 CREATE TABLE games(id TEXT PRIMARY KEY,ended_at INTEGER NOT NULL,mode TEXT,difficulty TEXT,source TEXT NOT NULL);
 CREATE TABLE results(game_id TEXT NOT NULL REFERENCES games(id),user_id TEXT NOT NULL REFERENCES users(id),player_id TEXT NOT NULL,victory INTEGER NOT NULL,rounds INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(game_id,user_id));
 CREATE INDEX results_user ON results(user_id,game_id);
 PRAGMA user_version=1; COMMIT;`);
const replays=installReplays(db,workerData.replays);
const q=sql=>db.prepare(sql);
const profile=id=>q('SELECT id,name,avatar_id AS avatarId,created_at AS createdAt FROM users WHERE id=?').get(id)||null;
function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
function credential(userId){const token=secret();q('INSERT INTO credentials(hash,user_id) VALUES(?,?)').run(hash(token),userId);return token;}
const methods={
 authenticate({token}){if(typeof token!=='string'||token.length!==43)return null;const row=q('SELECT user_id FROM credentials WHERE hash=?').get(hash(token));return row?profile(row.user_id):null;},
 create(){return transaction(()=>{const id=randomUUID();q('INSERT INTO users(id,created_at) VALUES(?,?)').run(id,Date.now());return {user:profile(id),token:credential(id)};});},
 profile({id}){return profile(id);},
 rename({id,name}){q('UPDATE users SET name=? WHERE id=? AND name<>?').run(name,id,name);return true;},
 update({id,name,avatarId}){q('UPDATE users SET name=?,avatar_id=? WHERE id=?').run(name,avatarId,id);return profile(id);},
 recovery({id}){return transaction(()=>{const code='SP-'+secret();q('DELETE FROM recovery WHERE user_id=?').run(id);q('INSERT INTO recovery(hash,user_id) VALUES(?,?)').run(hash(code),id);return {code};});},
 recover({code}){return transaction(()=>{const row=q('SELECT user_id FROM recovery WHERE hash=?').get(hash(code));if(!row)return null;q('DELETE FROM recovery WHERE hash=?').run(hash(code));return {user:profile(row.user_id),token:credential(row.user_id)};});},
 record({id,endedAt,mode,difficulty,source,rows,replay}){return transaction(()=>{
  const fresh=Number(q('INSERT OR IGNORE INTO games(id,ended_at,mode,difficulty,source) VALUES(?,?,?,?,?)').run(id,endedAt,mode,difficulty,source).changes);
  let inserted=0;
  for(const row of rows){if(!profile(row.userId))continue;inserted+=Number(q('INSERT OR IGNORE INTO results(game_id,user_id,player_id,victory,rounds,payload) VALUES(?,?,?,?,?,?)').run(id,row.userId,row.playerId,row.victory?1:0,row.rounds,JSON.stringify(row.payload)).changes);}
  if(fresh)replays.record(id,rows,replay);
  return {inserted};
 });},
 stats({id,before=null,modded=false}){
  const summary=q('SELECT count(*) AS matches,coalesce(sum(victory),0) AS wins,coalesce(max(rounds),0) AS bestRound FROM results WHERE user_id=?').get(id);
  const all=q('SELECT g.id,g.ended_at AS endedAt,g.mode,g.difficulty,g.source,r.player_id AS playerId,r.victory,r.rounds,r.payload FROM results r JOIN games g ON g.id=r.game_id WHERE r.user_id=? ORDER BY g.rowid DESC').all(id);
  const records=all.map(r=>accountRecord({...r,victory:!!r.victory,payload:JSON.parse(r.payload)}));
  const aggregate=aggregateStats(records,{modded});
  const hidden=new Set(workerData.hiddenBonds || []);
  const achievements=achievementStats(modded?records:records.filter(r=>!r.content),{hiddenLayers:id=>hidden.has(id),modded});
  achievements.achievements=achievements.achievements.map(({value:_value,...a})=>a);
  aggregate.missingFrame=all.some(r=>!JSON.parse(r.payload).frame);
  const rows=q(`SELECT g.id,g.ended_at AS endedAt,g.mode,g.difficulty,g.source,r.player_id AS playerId,r.victory,r.rounds,r.payload FROM results r JOIN games g ON g.id=r.game_id WHERE r.user_id=? AND (? IS NULL OR g.rowid<?) ORDER BY g.rowid DESC LIMIT 51`).all(id,before,before);
  const hasMore=rows.length>50;rows.length=Math.min(rows.length,50);
  const last=rows[rows.length-1];const next=hasMore&&last?q('SELECT rowid FROM games WHERE id=?').get(last.id).rowid:null;
  return {userId:id,replays:replays.status(id),summary,aggregate,achievements,...(before===null?{matchIds:all.map(r=>r.id)}:{}),records:rows.map(r=>({...r,replay:replays.entry(id,r.id),victory:!!r.victory,payload:JSON.parse(r.payload)})),next};
 },
 replay(args){return replays.get(args);},
 replayBody(args){return replays.body(args);},
 pinReplay(args){return replays.pin(args);},
 backup({directory}){
  fs.mkdirSync(directory,{recursive:true,mode:0o700});const target=path.join(directory,'users-'+Date.now()+'.sqlite');
  db.prepare('VACUUM INTO ?').run(target);fs.chmodSync(target,0o600);
  const files=fs.readdirSync(directory).filter(x=>/^users-\d+\.sqlite$/.test(x)).sort();
  for(const old of files.slice(0,-7))fs.unlinkSync(path.join(directory,old));return {ok:true};
 },
 close(){db.close();return true;}
};
parentPort.on('message',({id,method,args})=>{try{if(!Object.hasOwn(methods,method))throw new Error('Unknown operation');parentPort.postMessage({id,result:methods[method](args||{})});}catch{parentPort.postMessage({id,error:'User storage operation failed'});}});
parentPort.postMessage({ready:true});
