import {gzipSync,gunzipSync} from 'node:zlib';
export const COMBAT_LIMITS=Object.freeze({recordBytes:65536,matchBytes:524288,fields:128,rows:128});
const finite = n => Number.isFinite(n) && n>=0 && n<=1e15;
const text = (s,max=160) => typeof s==='string' && s.length>0 && s.length<=max;
const types = ['phys','arts','true','elemental'];

export function installCombat(db) {
  const q = sql=>db.prepare(sql);
  db.exec(`CREATE TABLE IF NOT EXISTS combat_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
    INSERT OR IGNORE INTO combat_schema(id,version) VALUES(1,1);
    CREATE TABLE IF NOT EXISTS combat_matches(game_id TEXT NOT NULL,user_id TEXT NOT NULL,manifest TEXT NOT NULL,
      PRIMARY KEY(game_id,user_id),FOREIGN KEY(game_id,user_id) REFERENCES results(game_id,user_id));
    CREATE TABLE IF NOT EXISTS combat_records(game_id TEXT NOT NULL,user_id TEXT NOT NULL,battle_id TEXT NOT NULL,
      seconds REAL NOT NULL,complete INTEGER NOT NULL,bytes INTEGER NOT NULL,body BLOB NOT NULL,
      PRIMARY KEY(game_id,user_id,battle_id),FOREIGN KEY(game_id,user_id) REFERENCES combat_matches(game_id,user_id));`);
  if(q('SELECT version FROM combat_schema WHERE id=1').get().version!==1) throw new Error('Unsupported combat schema');
  function saveManifest(gameId,userId,playerId,archive) {
    if(archive?.v!==1 || !Array.isArray(archive.fields)) return;
    const all=archive.fields.filter(f=>f.players?.includes(playerId));
    const fields=all.slice(0,COMBAT_LIMITS.fields).map(f=>({battleId:f.battleId,round:f.round,fieldId:f.fieldId,cs:f.cs || null,seconds:f.seconds ?? null}));
    q('INSERT OR IGNORE INTO combat_matches(game_id,user_id,manifest) VALUES(?,?,?)').run(gameId,userId,
      JSON.stringify({v:1,playerId,truncated:!!archive.truncated || all.length>fields.length,fields}));
  }
  function manifest(id,matchId) {
    const owner=q('SELECT player_id FROM results WHERE user_id=? AND game_id=?').get(id,matchId);
    if(!owner) return null;
    let row=q('SELECT manifest FROM combat_matches WHERE user_id=? AND game_id=?').get(id,matchId);
    if(!row) {
      // Older settlements can recover the manifest from an owned, retained recording. No rule re-simulation.
      const body=q('SELECT r.body FROM replays r JOIN user_replays u ON u.game_id=r.game_id WHERE u.user_id=? AND r.game_id=?').get(id,matchId)?.body;
      if(body) {
        const replay=JSON.parse(gunzipSync(body,{maxOutputLength:64*1024*1024+32})).replay;
        saveManifest(matchId,id,owner.player_id,{v:1,fields:(replay?.fields || []).map(f=>({
          battleId:f.spec?.battleId || `${f.round}:${f.fieldId}`,round:f.round,fieldId:f.fieldId,
          cs:f.spec?.cs || replay.cs || null,seconds:f.end?.time ?? null,players:(f.spec?.players || []).map(p=>p.playerId),
        }))});
        row=q('SELECT manifest FROM combat_matches WHERE user_id=? AND game_id=?').get(id,matchId);
      }
    }
    return row?JSON.parse(row.manifest):{v:1,playerId:owner.player_id,fields:null};
  }
  return {
    record(gameId,rows,archive) {for(const row of rows) if(q('SELECT 1 FROM results WHERE game_id=? AND user_id=?').get(gameId,row.userId)) saveManifest(gameId,row.userId,row.playerId,archive);},
    get({id,matchId}) {
      const m=manifest(id,matchId); if(!m) return {error:'COMBAT_NOT_FOUND'};
      const records=q('SELECT body FROM combat_records WHERE user_id=? AND game_id=? ORDER BY rowid').all(id,matchId)
        .map(r=>JSON.parse(gunzipSync(r.body,{maxOutputLength:COMBAT_LIMITS.recordBytes})));
      const complete=records.filter(r=>r.complete).length,expected=m.fields?.length ?? null;
      return {combat:{v:1,source:'client',playerId:m.playerId,fields:m.fields,records,
        coverage:{expected,recorded:records.length,complete,missing:expected===null?null:expected-records.length,
          status:expected!==null && !m.truncated && expected>0 && complete===expected?'complete':records.length?'partial':'missing'}}};
    },
    put({id,matchId,record}) {
      const m=manifest(id,matchId); if(!m) return {error:'COMBAT_NOT_FOUND'};
      const f=m.fields?.find(f=>f.battleId===record?.battleId);
      if(!f || record.v!==1 || record.round!==f.round || record.fieldId!==f.fieldId || (record.cs || null)!==f.cs ||
        !finite(record.seconds) || record.seconds>100000 || (f.seconds!==null && record.seconds>f.seconds+.25) ||
        typeof record.complete!=='boolean' || !Array.isArray(record.rows) || record.rows.length>COMBAT_LIMITS.rows) return {error:'COMBAT_INPUT'};
      const keys=new Set(),rows=[];
      for(const row of record.rows) {
        if(!row || row.ownerId!==m.playerId || !text(row.key,256) || keys.has(row.key) || !text(row.defId) || !/^[A-Za-z0-9_:@.-]+$/.test(row.defId) ||
          !['op','token'].includes(row.kind) || typeof row.name!=='string' || row.name.length>128 ||
          !finite(row.damage) || !finite(row.healing) || !row.types || !types.every(t=>finite(row.types[t])) ||
          Math.abs(types.reduce((n,t)=>n+row.types[t],0)-row.damage)>Math.max(1e-6,row.damage*1e-8)) return {error:'COMBAT_INPUT'};
        keys.add(row.key);rows.push({key:row.key,ownerId:m.playerId,defId:row.defId,name:row.name,kind:row.kind,
          damage:row.damage,healing:row.healing,types:Object.fromEntries(types.map(t=>[t,row.types[t]]))});
      }
      const complete=record.complete && f.seconds!==null && Math.abs(record.seconds-f.seconds)<=.25;
      const saved={battleId:f.battleId,round:f.round,fieldId:f.fieldId,cs:f.cs,seconds:record.seconds,complete,owners:[m.playerId],rows};
      const body=JSON.stringify(saved),bytes=Buffer.byteLength(body);
      if(bytes>COMBAT_LIMITS.recordBytes) return {error:'COMBAT_SIZE'};
      const old=q('SELECT seconds,complete,bytes FROM combat_records WHERE user_id=? AND game_id=? AND battle_id=?').get(id,matchId,f.battleId);
      if(old && (old.complete>Number(complete) || (old.complete===Number(complete) && old.seconds>=record.seconds))) return {ok:true,unchanged:true};
      const used=q('SELECT coalesce(sum(bytes),0) n FROM combat_records WHERE user_id=? AND game_id=?').get(id,matchId).n;
      if(used-(old?.bytes || 0)+bytes>COMBAT_LIMITS.matchBytes) return {error:'COMBAT_SIZE'};
      q(`INSERT INTO combat_records(game_id,user_id,battle_id,seconds,complete,bytes,body) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(game_id,user_id,battle_id) DO UPDATE SET seconds=excluded.seconds,complete=excluded.complete,bytes=excluded.bytes,body=excluded.body`)
        .run(matchId,id,f.battleId,record.seconds,Number(complete),bytes,gzipSync(body));
      return {ok:true};
    },
  };
}
