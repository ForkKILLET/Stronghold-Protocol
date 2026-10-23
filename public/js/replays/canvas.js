// A separate read-only renderer/simulation. Never touches the live store, runner or WebSocket.
import {useEffect,useRef,useState} from '../../vendor/hooks.module.js';
import {html,Spinner} from '../ui/components.js';
import {settingsStore} from '../ui/settings.js';
import {prepCameraFor} from '../ui/gameLogic/camera.js';
import {data} from '../data.js';
import {t} from '../../../shared/i18n.js';

export function ReplayCanvas({timeline,state,time,playerId,field,onBuffering}){
 const host=useRef(null),live=useRef(null);live.current={state,time,playerId,field};
 const [error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{
  let alive=true,view=null,sim=null,raf=0,active=null,mode=null,poolIndex=0,pools=[];
  const controller=new AbortController();
  const emit=packet=>{
   for(const s of packet.slices || [])view.pushEvents({t:'b.ev',fieldId:active.fieldId,gt:s.gt,ev:s.ev});
   const snap=packet.snap;
   view.pushEvents({t:'b.ev',fieldId:active.fieldId,gt:snap.t,ev:packet.ev || []});
   view.pushSnapshot({...snap,t:'b.snap',gt:snap.t});
  };
  (async()=>{
   const [{createFieldView},{createAssets},{InPageSimHost,WorkerSimHost},{loadContentSet,hasScriptConsent}]=await Promise.all([
    import('../render/app.js'),import('../assets.js'),import('../battle/simHost.js'),import('../content.js')]);
   if(!alive)return;
   const assets=createAssets();assets.seed(data.getRaw('assets'));
   let content=null,simError='';
   const replay=timeline.replay;
   if(replay.modded){
    try{
     const pack=await loadContentSet(replay.cs,{consent:hasScriptConsent(replay.cs)});
     if(!pack.canSim)throw new Error('consent');
     content={cs:pack.cs,data:Object.fromEntries(pack.values),bounds:pack.bounds,scripts:pack.scripts,hashInput:pack.index,nativeVerified:pack.nativeVerified};
    }catch{simError=t('回放所需的插件内容不可用，仍可查看经营记录。');}
   }else if(replay.cs&&replay.currentCs!==replay.cs)simError=t('战斗规则版本已变化，仍可查看经营记录。');
   const source=content?{get:n=>content.data[n] || data.get(n),lookup:(n,id)=>content.data[n]?.[id] || data.lookup(n,id)}:data;
   const options={data:source,assets,signal:controller.signal,settings:settingsStore.get(),padding:()=>({top:16,bottom:16,left:16,right:16}),hud:()=>({top:0,bottom:0})};
   try{
    if(new URLSearchParams(location.search).get('render')==='fallback')throw new Error('fallback');
    view=await createFieldView(host.current,options);host.current.dataset.renderer='engine';
   }catch(error){
    if(controller.signal.aborted)throw error;
    const {createFallbackView}=await import('../ui/fallbackField.js');view=createFallbackView(host.current,options);host.current.dataset.renderer='fallback';
   }
   if(!alive){view.destroy();return;}
   setLoading(false);host.current.dataset.ready='true';
   const frame=async()=>{
    if(!alive)return;
    try{
     const current=live.current,priv=current.state[current.playerId],pub=current.state.public;
     const stage=source.lookup('stages',current.field?.spec.stageId || pub?.stageId);
     if(stage)view.setStage(stage);
     if(current.field){
      if(simError){setError(simError);onBuffering(false);raf=requestAnimationFrame(frame);return;}
      if(!sim){onBuffering(true);sim=replay.modded?new WorkerSimHost():new InPageSimHost();await sim.load(replay.cs,content);if(!alive)return;}
      const target=timeline.elapsed(current.field,current.time);
      if(active!==current.field||mode!=='battle'||target<(Number(sim.battle?.time)||0)-1/30){
       active=current.field;mode='battle';poolIndex=0;
       pools=replay.events.filter(e=>e.kind==='pool'&&e.at>=active.at&&e.at<=(active.end?.at ?? Infinity)&&Number.isFinite(e.times?.[active.fieldId]));
       sim.battle?.drainEvents();
       await sim.start(active.spec);if(!alive)return;
       view.enterBattle(sim.battle.fieldMeta());view.setCamera(active.kind==='hidden'?'boss':active.kind,{rect:active.spec.rect,instant:true});
       emit({snap:sim.battle.snapshot(),ev:sim.battle.drainEvents()});
      }
      let steps=0;
      while(alive&&!sim.battle.finished&&(Number(sim.battle.time)||0)+1/60<target&&steps<120){
       const gt=Number(sim.battle.time)||0;
       while(poolIndex<pools.length&&pools[poolIndex].times[active.fieldId]<=gt+1/60){const pool=pools[poolIndex++].value;await sim.syncPool(pool.hp,pool.acked?.[active.fieldId] || 0);}
       const next=pools[poolIndex]?.times[active.fieldId] ?? Infinity;
       const ticks=Math.max(1,Math.min(15,Math.ceil((target-gt)*30),Math.ceil((next-gt)*30)));
       const packet=await sim.step(ticks,{slice:5});if(!alive)return;
       if(sim.remote)packet.ev=sim.battle.drainEvents();
       emit(packet);steps+=ticks;
      }
      if(active.end&&target>=active.end.time&&!sim.battle.finished){await sim.forceEnd(active.end.reason);if(!alive)return;emit({snap:sim.battle.snapshot(),ev:sim.battle.drainEvents()});}
      view.setLocalFeed?.({on:true,speed:2});
      host.current.dataset.mode='battle';host.current.dataset.gt=String(sim.battle.time);host.current.dataset.field=active.fieldId;
      onBuffering(!sim.battle.finished&&(Number(sim.battle.time)||0)+1/30<target);
     }else{
      mode='prep';active=null;setError('');onBuffering(false);host.current.dataset.mode='prep';
      if(priv){
       view.setPrep(priv,{editable:false});
       for(const p of priv.board || [])view.setPieceDir?.(p.uid,p.dir);
       const camera=prepCameraFor(pub,current.playerId,true);view.setCamera(camera.kind,{...camera.opts,instant:true});
      }
     }
     raf=requestAnimationFrame(frame);
    }catch{if(alive){setError(t('回放画面加载失败，请返回后重试。'));onBuffering(false);}}
   };
   raf=requestAnimationFrame(frame);
  })().catch(()=>{if(alive){setError(t('回放画面加载失败，请返回后重试。'));setLoading(false);onBuffering(false);}});
  return()=>{alive=false;controller.abort();cancelAnimationFrame(raf);sim?.stop();view?.destroy();onBuffering(false);};
 },[timeline]);
 return html`<div class="replay-field"><div ref=${host} class="replay-canvas" aria-label=${t('回放战场')} />${loading?html`<div class="replay-field-status"><${Spinner} />${t('正在读取…')}</div>`:null}${error?html`<p class="replay-field-status" role="status">${error}</p>`:null}</div>`;
}
