// Private archive: one compressed battle bundle per game, independently retained/pinned by its participants.
import {gzipSync,gunzipSync} from 'node:zlib';

export const REPLAY_DEFAULTS=Object.freeze({perUser:10,maxBytes:8*1024*1024});
export function installReplays(db,{perUser=REPLAY_DEFAULTS.perUser,maxBytes=REPLAY_DEFAULTS.maxBytes}={}){
 const q=sql=>db.prepare(sql);
 db.exec(`CREATE TABLE IF NOT EXISTS replay_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
 INSERT OR IGNORE INTO replay_schema(id,version) VALUES(1,1);
 CREATE TABLE IF NOT EXISTS replays(game_id TEXT PRIMARY KEY REFERENCES games(id),body BLOB NOT NULL);
 CREATE TABLE IF NOT EXISTS user_replays(user_id TEXT NOT NULL,game_id TEXT NOT NULL,pinned INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,game_id),FOREIGN KEY(game_id,user_id) REFERENCES results(game_id,user_id));`);
 if(q('SELECT version FROM replay_schema WHERE id=1').get().version!==1)throw new Error('Unsupported replay schema');
 const gc=()=>db.exec('DELETE FROM replays WHERE NOT EXISTS(SELECT 1 FROM user_replays u WHERE u.game_id=replays.game_id)');
 function trim(id){
  const ordered=q(`SELECT u.game_id,u.pinned FROM user_replays u JOIN games g ON g.id=u.game_id WHERE u.user_id=? ORDER BY g.ended_at DESC,g.rowid DESC`).all(id);
  const pins=ordered.filter(row=>row.pinned).length;
  if(pins>Math.max(0,perUser-1))throw new Error('Replay quota is below existing pins; unpin replays before lowering the quota');
  let remove=Math.max(0,ordered.length-perUser);
  for(const row of ordered.reverse())if(remove){
   // Pinned replays are never implicitly unpinned, including when an operator lowers the quota.
   if(q('SELECT pinned FROM user_replays WHERE user_id=? AND game_id=?').get(id,row.game_id)?.pinned)continue;
   q('DELETE FROM user_replays WHERE user_id=? AND game_id=?').run(id,row.game_id);remove--;
  }
 }
 db.exec('BEGIN IMMEDIATE');
 try{for(const {user_id} of q('SELECT DISTINCT user_id FROM user_replays').all())trim(user_id);gc();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 return {
  // Called inside the settlement transaction, only for a newly inserted game. An outbox retry cannot resurrect eviction.
  record(gameId,rows,replay){
   if(!perUser||!replay||replay.v!==1||replay.unavailable||!Array.isArray(replay.fields)||!Array.isArray(replay.events)||!replay.events.length)return;
   const text=JSON.stringify(replay);if(Buffer.byteLength(text)>maxBytes)return;
   q('INSERT OR IGNORE INTO replays(game_id,body) VALUES(?,?)').run(gameId,gzipSync(JSON.stringify({replay})));
   for(const row of rows)if(q('SELECT 1 FROM results WHERE game_id=? AND user_id=?').get(gameId,row.userId)){
    q('INSERT OR IGNORE INTO user_replays(user_id,game_id) VALUES(?,?)').run(row.userId,gameId);trim(row.userId);
   }
   gc();
  },
  status(id){const row=q('SELECT count(*) AS saved,coalesce(sum(pinned),0) AS pinned FROM user_replays WHERE user_id=?').get(id);return {...row,limit:perUser,pinLimit:Math.max(0,perUser-1)};},
  entry(id,gameId){const row=q('SELECT pinned FROM user_replays WHERE user_id=? AND game_id=?').get(id,gameId);return row?{available:true,pinned:!!row.pinned}:null;},
  get({id,matchId}){
   const row=q('SELECT r.body FROM replays r JOIN user_replays u ON u.game_id=r.game_id WHERE u.user_id=? AND r.game_id=?').get(id,matchId);
   if(!row)return {error:'REPLAY_NOT_FOUND'};
   return JSON.parse(gunzipSync(row.body,{maxOutputLength:64*1024*1024+32}).toString());
  },
  body({id,matchId,gzip}){
   const row=q('SELECT r.body FROM replays r JOIN user_replays u ON u.game_id=r.game_id WHERE u.user_id=? AND r.game_id=?').get(id,matchId);
   if(!row)return {error:'REPLAY_NOT_FOUND'};
   return {body:gzip?row.body:gunzipSync(row.body,{maxOutputLength:64*1024*1024+32})};
  },
  pin({id,matchId,pinned}){
   // The storage Worker serializes all requests; transaction keeps quota check + update indivisible.
   db.exec('BEGIN IMMEDIATE');
   try{
    const entry=this.entry(id,matchId);
    let result;
    if(!entry)result={error:'REPLAY_NOT_FOUND'};
    else if(pinned&&!entry.pinned&&this.status(id).pinned>=Math.max(0,perUser-1))result={error:'REPLAY_PIN_LIMIT'};
    else{q('UPDATE user_replays SET pinned=? WHERE user_id=? AND game_id=?').run(pinned?1:0,id,matchId);result={replay:{available:true,pinned},replays:this.status(id)};}
    db.exec('COMMIT');return result;
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
 };
}
