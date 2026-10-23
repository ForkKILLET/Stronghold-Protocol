// Bounded account-scoped retry outbox. Never changes game messages, results or the currently signed-in account.
import {HISTORY_KEY,archivedCombatReader} from './combatHistory.js';
export const COMBAT_OUTBOX='sp.combat-outbox.v1';
let active=null;
export function syncArchivedCombat({matchId,local,combat}) {
  if(!active) return;
  for(const record of local.records || []) {
    const field=combat.fields?.find(f=>f.battleId===record.battleId && f.round===record.round);
    if(!field || !record.owners.includes(combat.playerId)) continue;
    active.enqueue({matchId,record:{...record,...field,v:1,seconds:record.seconds,complete:record.complete===true,
      rows:record.rows.filter(r=>r.ownerId===combat.playerId)}},true);
  }
  void active.flush();
}
// Mirror the 64 KiB server attachment cap without adding UI budgets to the simulation content hash.
const RECORD_BYTES=65536,MAX_BYTES=2*1024*1024,MAX_MATCHES=10,MAX_AGE=7*86400_000;
const size=value=>new TextEncoder().encode(JSON.stringify(value)).length;
export function installCombatSync({runner,store,profile,request,storage,win=globalThis.window,
  now=Date.now,setInterval=globalThis.setInterval,clearInterval=globalThis.clearInterval}) {
  let stopped=false,inFlight=false;
  const pending=new Map(),offs=[];
  const key=item=>JSON.stringify([item.userId,item.matchId,item.record.battleId]);
  try {
    const saved=JSON.parse(storage?.getItem(COMBAT_OUTBOX) || 'null');
    if(saved?.v===1 && Array.isArray(saved.entries) && size(saved)<=MAX_BYTES) for(const item of saved.entries) {
      if(typeof item.userId==='string' && typeof item.matchId==='string' && item.record?.v===1 && typeof item.record.battleId==='string' &&
        Number.isFinite(item.at) && now()-item.at<MAX_AGE) pending.set(key(item),{...item,ready:true,next:0});
    }
  } catch { /* Private browsing, storage quotas or damaged caches do not interrupt a match. */ }
  function persist() {
    try {
      const matches=new Set();let bytes=0;
      for(const [k,item] of [...pending].reverse()) {
        matches.add(item.userId+':'+item.matchId);bytes+=size(item);
        if(matches.size>MAX_MATCHES || bytes>MAX_BYTES || now()-item.at>MAX_AGE) pending.delete(k);
      }
      storage?.setItem(COMBAT_OUTBOX,JSON.stringify({v:1,entries:[...pending.values()]}));
    } catch { /* Queue remains usable in memory when storage is unavailable. */ }
  }
  const account=()=>profile.get()?.enabled?profile.get().user?.id:null;
  function enqueue({matchId,record},ready=false) {
    const userId=account();if(!userId || !matchId || record?.v!==1 || !Array.isArray(record.rows) || size(record)>RECORD_BYTES) return;
    const item={userId,matchId,record,ready,at:now(),next:0},k=key(item),old=pending.get(k);
    if(old && (old.record.complete>record.complete || (old.record.complete===record.complete && old.record.seconds>=record.seconds))) return;
    item.ready ||= old?.ready || false;pending.set(k,item);persist();
  }
  async function flush() {
    if(inFlight || stopped || !account()) return;
    inFlight=true;
    try {
      let sent=0;
      for(const [k,item] of pending) {
        if(stopped || sent>=8) break;
        if(item.userId!==account() || !item.ready || item.next>now()) continue;
        sent++;
        try {
          await request('/api/user/combat',{matchId:item.matchId,record:item.record});
          if(pending.get(k)===item) pending.delete(k);
        } catch(error) {
          if(['COMBAT_INPUT','COMBAT_SIZE'].includes(error.userCode)) {if(pending.get(k)===item) pending.delete(k);}
          else {item.failures=(item.failures || 0)+1;item.next=now()+Math.min(60000,1000*2**item.failures);}
        }
      }
    } finally {inFlight=false;persist();}
  }
  const follow=state=>{
    const matchId=state?.match?.result?.matchId;
    if(!matchId) return;
    for(const item of pending.values()) if(item.userId===account() && item.matchId===matchId) item.ready=true;
    persist();void flush();
  };
  offs.push(runner?.on('combat',enqueue),store.subscribe(follow));
  const online=()=>void flush();win?.addEventListener?.('online',online);
  const timer=setInterval(()=>void flush(),15000);timer?.unref?.();
  follow(store.get());void flush();
  const api={enqueue,flush,pending:()=>pending.size,close(){stopped=true;clearInterval(timer);for(const off of offs)off?.();win?.removeEventListener?.('online',online);if(active===api)active=null;}};
  active=api;
  // On upgrade/reload, a UUID-scoped latest-match cache can fill gaps once its ownership is confirmed by the API.
  try {
    const cache=JSON.parse(storage?.getItem(HISTORY_KEY) || 'null'),userId=account();
    if(userId && cache?.matchId) request('/api/user/combat?matchId='+encodeURIComponent(cache.matchId)).then(({combat})=>{
      if(!stopped && account()===userId) syncArchivedCombat({matchId:cache.matchId,local:archivedCombatReader(storage,{matchId:cache.matchId}),combat});
    }).catch(()=>{});
  } catch { /* A legacy cache without a UUID is resolved only when viewing its owned history/replay. */ }
  return api;
}
