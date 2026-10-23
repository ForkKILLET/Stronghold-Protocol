import {useEffect,useLayoutEffect,useMemo,useRef,useState} from '../../vendor/hooks.module.js';
import {html,Button,AvatarFrame,Icon,Spinner,MicroLabel,DifficultyTag} from '../ui/components.js';
import {PageHeader} from '../ui/pageHeader.js';
import {publicDoctorStore,doctorLink,ensureDoctorStyles} from '../ui/doctorLinks.js';
import {userRequest} from '../ui/profile.js';
import {useStore,selectRoute} from '../store.js';
import {data,useData} from '../data.js';
import {makeLookups,BandIcon} from '../ui/gameComponents.js';
import {profileAvatarUrl} from '../ui/assetUrls.js';
import {Overview,Bands,CombatSums,StatCard,dateTime,ReplayStatus,HistoryMenu} from './stats.js';
import {AchievementMark} from '../ui/achievements.js';
import {ACHIEVEMENT_GROUPS} from '../../../shared/achievementStats.js';
import {formatDoctorId} from '../../../shared/publicProfiles.js';
import {copyText} from '../ui/clipboard.js';
import {toast} from '../ui/toasts.js';
import {useDocClass} from '../ui/device.js';
import {useLang} from '../ui/lang.js';
import {t,N_} from '../../../shared/i18n.js';

const TABS=[['overview',N_('总览')],['achievements',N_('成就')],['bands',N_('策略')],['totals',N_('战斗累计')],['history',N_('对局记录')],['replays',N_('公开回放')]];
const date=dateTime;
function PrivateSection(){return html`<p class="st-empty public-doctor__private"><${Icon} name="shield" />${t('该博士未公开此项信息')}</p>`;}
function PublicDoctorScreen({publicId,replayId,standalone,preview}){
 const ready=useData('config','bands','assets'),gd=useMemo(()=>makeLookups(ready),[ready,data.locale()]);
 const [tab,setTab]=useState(replayId?'replays':'overview'),[page,setPage]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(null);
 const [revision,refresh]=useState(0),[playback,setPlayback]=useState(null),[busy,setBusy]=useState(false);
 const live=useRef(true),flight=useRef(false),scope=useRef(0),box=useRef(null),playbackRef=useRef(null),initialReplay=useRef(replayId);playbackRef.current=playback;
 const inMatch=useStore(s=>selectRoute(s)==='game');
 const matchAtOpen=useRef(inMatch);
 useDocClass('sp-public-doctor-open');
 const close=()=>{if(standalone)location.assign(location.pathname);else publicDoctorStore.set({open:false});};
 useEffect(()=>{if(!matchAtOpen.current&&inMatch&&!standalone)close();matchAtOpen.current=inMatch;},[inMatch]);
 const section=tab==='replays'?'replays':'history';
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 useEffect(()=>{
  const controller=new AbortController();scope.current++;setLoading(true);setError(null);setPage(null);
  userRequest('/api/doctors/'+publicId+'?section='+section,undefined,{signal:controller.signal})
   .then(result=>{if(!controller.signal.aborted)setPage(result);})
   .catch(e=>{if(!controller.signal.aborted)setError(e.userCode==='DOCTOR_NOT_FOUND'?t('未找到该博士档案'):t('档案读取失败，请稍后重试。'));})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[publicId,section,revision]);
 const play=async matchId=>{
  if(flight.current||inMatch)return;flight.current=true;setBusy(true);
  try{
   const [{replay},{ReplayScreen}]=await Promise.all([userRequest('/api/doctors/'+publicId+'/replay?matchId='+encodeURIComponent(matchId),undefined,{timeoutMs:30000}),import('./replay.js')]);
   if(live.current)setPlayback({replay,Screen:ReplayScreen});
  }catch{if(live.current)toast(t('回放未公开或已被替换，请刷新档案。'),'warn');}
  finally{flight.current=false;if(live.current)setBusy(false);}
 };
 useEffect(()=>{if(!loading&&page&&initialReplay.current){const id=initialReplay.current;initialReplay.current=null;play(id);}},[loading,page]);
 useLayoutEffect(()=>{
  const previous=document.activeElement;
  const key=e=>{if(e.key!=='Escape'||document.querySelector('.modal,.game-select-popover'))return;e.preventDefault();e.stopImmediatePropagation();if(playbackRef.current)setPlayback(null);else close();};
  window.addEventListener('keydown',key,true);box.current?.focus();
  return()=>{window.removeEventListener('keydown',key,true);previous?.focus?.();};
 },[]);
 const more=async()=>{
  if(!page?.next||busy)return;const version=scope.current;setBusy(true);
  try{const next=await userRequest('/api/doctors/'+publicId+'?section='+section+'&before='+page.next);if(live.current&&version===scope.current)setPage({...next,records:[...page.records,...next.records]});}
  catch{if(live.current&&version===scope.current)toast(t('档案读取失败，请稍后重试。'),'warn');}
  finally{if(live.current)setBusy(false);}
 };
 if(playback)return html`<div class="public-doctor-playback"><${playback.Screen} replay=${playback.replay} selfId=${playback.replay.perspectives[0]} onBack=${()=>setPlayback(null)} visitor=${standalone} /></div>`;
 const visibility=page?.visibility || {},doctor=page?.doctor;
 const permitted=tab==='overview'?visibility.statistics:['bands','totals'].includes(tab)?visibility.statistics:visibility[tab];
 return html`<div class="st public-doctor" role="dialog" aria-modal="true" aria-label=${t('公开博士档案')} tabindex="-1" ref=${box}>
  <div class="st__bg" aria-hidden="true"></div><${PageHeader} onBack=${close} title=${t('博士档案')} micro="PUBLIC DOCTOR ARCHIVE" visitor=${standalone} />
  <header class="st-top doctor-top"><div class="doctor-identity"><${AvatarFrame} name=${doctor?.name || t('博士')} size="md" src=${profileAvatarUrl(data.get('assets'),doctor?.avatarId)} />
   <div><h2>${doctor?.name || t('博士')}</h2><span class="doctor-number num">${formatDoctorId(publicId)}</span></div><span class="doctor-public-tag">${preview?t('公开预览'):t('只读档案')}</span></div>
   <div class="st-top__right"><${Button} variant="secondary" size="sm" icon="copy" disabled=${!doctor} onClick=${async()=>{const ok=await copyText(doctorLink(publicId));toast(ok?t('已复制档案链接'):t('复制失败，请手动复制'),ok?'success':'warn');}}>${t('复制档案链接')}<//>
    <${Button} variant="ghost" size="sm" icon="refresh" disabled=${loading} onClick=${()=>refresh(n=>n+1)}>${t('刷新')}<//></div>
   <nav class="st-tabs doctor-tabs" role="tablist" aria-label=${t('博士档案')}>${TABS.map(([id,label])=>html`<button type="button" role="tab" key=${id} data-tab=${id} aria-selected=${tab===id} class=${`st-tab${tab===id?' is-on':''}`} onClick=${()=>setTab(id)}>${t(label)}</button>`)}</nav>
  </header>
  <p class="st-note"><${Icon} name="info" />${preview?t('这里与其他玩家看到的公开档案相同，不包含本机记录。'):t('仅展示该博士允许公开的服务器数据。')}</p>
  <main class="st-body" data-tab=${tab}>
   ${error?html`<p class="st-empty profile-error" role="alert">${error}</p>`:loading||!ready?html`<div class="st-loading"><${Spinner} /></div>`:html`
    ${tab==='overview'?html`<section class="public-doctor__trophies">${visibility.trophies?html`<${StatCard} label=${t('奖杯')} micro="TROPHIES" value=${page.trophies} tone="gold" />`:html`<p class="st-hint">${t('杯数未公开')}</p>`}</section>`:null}
    ${!permitted?html`<${PrivateSection} />`:tab==='overview'?html`<${Overview} agg=${page.aggregate} gd=${gd} account=${true} />`
     :tab==='bands'?html`<${Bands} agg=${page.aggregate} gd=${gd} />`:tab==='totals'?html`<${CombatSums} agg=${page.aggregate} />`
     :tab==='achievements'?html`<section class="doctor-achievements">${ACHIEVEMENT_GROUPS.filter(([id])=>page.achievements.some(a=>a.group===id)).map(([id,label,icon])=>html`<div key=${id} class="ach-list"><h3 class="st-sec__h">${t(label)}</h3><div class="ach-marks ach-marks--list">${page.achievements.filter(a=>a.group===id).map(a=>html`<${AchievementMark} key=${a.id} a=${a} icon=${icon} />`)}</div></div>`)}</section>`
     :html`<section class="st-sec"><h3 class="st-sec__h"><span>${tab==='replays'?t('公开回放'):t('对局记录')}</span><${MicroLabel}>${tab==='replays'?'PUBLIC REPLAYS':'MATCH HISTORY'}<//></h3>
      ${page.records?.length?html`<div class="st-tablewrap"><table class="st-table st-table--history st-table--actions"><thead><tr><th>${t('时间')}</th><th>${t('难度')}</th><th>${t('模式')}</th><th>${t('策略')}</th><th>${t('结果')}</th><th class="st-round">${t('回合')}</th><th>${t('回放')}</th><th class="st-history-actions" aria-label=${t('对局操作')}></th></tr></thead>
       <tbody>${page.records.map(row=>html`<tr key=${row.matchId}><td>${date(row.t)}</td><td><${DifficultyTag} difficulty=${row.difficulty} size="sm" /></td><td>${row.roomMode==='solo'?t('单人'):t('同盟')}</td><td><span class="st-band"><${BandIcon} bandId=${row.bandId} size="xs" />${gd.band(row.bandId)?.name || '—'}</span></td><td>${row.victory?t('胜'):t('负')}${row.modded?html`<em class="st-chip">${t('非官方')}</em>`:null}</td><td class="st-round num">${row.rounds}</td>
        <td><${ReplayStatus} available=${!!row.replay} shared=${!!row.replay} unavailableLabel=${t('未公开')} /></td>
        <td class="st-history-actions"><${HistoryMenu} rec=${{matchId:row.matchId,replay:{available:!!row.replay}}} readOnly=${true} busy=${busy} locked=${inMatch} onPlay=${()=>play(row.matchId)} /></td></tr>`)}</tbody></table></div>`:html`<p class="st-empty">${t('暂无公开记录')}</p>`}
      ${page.next?html`<div class="st-more"><${Button} variant="secondary" loading=${busy} onClick=${more}>${t('加载更早的对局')}<//></div>`:null}
      ${inMatch?html`<p class="st-hint">${t('请先结束当前对局，再播放回放。')}</p>`:null}</section>`}
   `}
  </main>
 </div>`;
}
export function PublicDoctorHost(){
 useLang();const state=useStore(s=>s,Object.is,publicDoctorStore);
 useEffect(()=>{if(state.open)ensureDoctorStyles();},[state.open]);
 return state.open?html`<${PublicDoctorScreen} key=${state.publicId} ...${state} />`:null;
}
