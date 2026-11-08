import {useEffect,useState} from '../../vendor/hooks.module.js';
import {useStore} from '../store.js';
import {profileStore,initProfile,userRequest} from './profile.js';
import {aggregateStats,peekStatsRecords,recordsOfVersion,strategyBadgeIds} from './stats.js';
import {strategyBadgesFromCounts} from '../../../shared/userStats.js';

export const NO_STRATEGY_PROGRESS=Object.freeze({won:Object.freeze({}),badges:new Set(),trophies:0});
const victories=aggregate=>Object.fromEntries(Object.entries(aggregate?.bands || {}).map(([id,b])=>[id,b.wins|0]).filter(([,n])=>n>0));

/** Local-only fallback. A rule version is a scope, never a request to merge seasons. */
export function draftRecords(records,bands,version=null) {
  const scoped=recordsOfVersion(records,version),aggregate=aggregateStats(scoped);
  return {won:victories(aggregate),badges:new Set(strategyBadgeIds(scoped.filter(r=>!r.content),bands)),trophies:aggregate.trophies || 0};
}

/** Read the complete server aggregate, not the fifty records on its current history page. */
export function accountDraftRecords(account,userId,version,bands) {
  if(!userId||account?.userId!==userId||account.withModded)throw Error('Account statistics identity mismatch');
  const scoped=account.byVersion?.[version];
  if(!scoped?.aggregate?.bands)throw Error('Version statistics unavailable');
  return {won:victories(scoped.aggregate),badges:new Set(strategyBadgesFromCounts(scoped.strategyClears,bands)),trophies:scoped.aggregate.trophies || 0};
}

export function useStrategyProgress({version,matchId,bands}) {
  const profile=useStore(s=>s,Object.is,profileStore);
  const userId=profile.user?.id;
  const local=!profile.enabled&&profile.status==='disabled',offline=profile.status==='offline';
  const [refresh,setRefresh]=useState(0),[result,setResult]=useState(null);
  const key=JSON.stringify([profile.enabled,userId,local,version,matchId,refresh]);
  useEffect(()=>{
    const controller=new AbortController();let cancelIdle;
    setResult({key,status:'loading'});
    if(local){
      const load=()=>{if(!controller.signal.aborted)setResult({key,status:'ready',records:peekStatsRecords()});};
      if(typeof requestIdleCallback==='function'){
        const id=requestIdleCallback(load,{timeout:1200});cancelIdle=()=>cancelIdleCallback(id);
      }else{const id=setTimeout(load,300);cancelIdle=()=>clearTimeout(id);}
    }else if(profile.enabled&&userId){
      userRequest('/api/user/stats',undefined,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(5000)])})
        .then(account=>{
          accountDraftRecords(account,userId,version,[]);
          if(!controller.signal.aborted)setResult({key,status:'ready',account});
        }).catch(()=>{if(!controller.signal.aborted)setResult({key,status:'error'});});
    }else if(offline)setResult({key,status:'error'});
    return()=>{controller.abort();cancelIdle?.();};
  },[key,offline]);
  const retry=async()=>{await initProfile();setRefresh(n=>n+1);};
  // An account / version change must never paint the previous identity for one frame.
  if(result?.key!==key||result.status!=='ready')return {...NO_STRATEGY_PROGRESS,source:local?'local':'server',status:result?.key===key?result.status:'loading',retry};
  const progress=local?draftRecords(result.records,bands,version):accountDraftRecords(result.account,userId,version,bands);
  return {...progress,source:local?'local':'server',status:'ready',retry};
}
