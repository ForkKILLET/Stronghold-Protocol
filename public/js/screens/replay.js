import {useEffect,useMemo,useRef,useState} from '../../vendor/hooks.module.js';
import {html,Button,MicroLabel,Spinner} from '../ui/components.js';
import {Select} from '../ui/select.js';
import {PageHeader} from '../ui/pageHeader.js';
import {chessAvatarUrl} from '../ui/assetUrls.js';
import {Img,GAME_FILES} from '../ui/gameComponents.js';
import {data,useData} from '../data.js';
import {ReplayTimeline} from '../../../shared/replays.js';
import {ReplayCanvas} from '../replays/canvas.js';
import {t,N_} from '../../../shared/i18n.js';

const ACTIONS={
 'g.buy':N_('招募'), 'g.refresh':N_('刷新'), 'g.freeze':N_('冻结／解冻'), 'g.levelUp':N_('升级调度中心'),
 'g.sell':N_('出售'), 'g.move':N_('调整部署'), 'g.equip':N_('配发装备'), 'g.art':N_('使用战术道具'),
 'g.destroy':N_('销毁'), 'g.reward':N_('领取奖励'), 'g.choice':N_('选择奖励'), 'g.band':N_('选择策略'),
 'g.bandSkip':N_('跳过策略'), 'g.ready':N_('准备就绪'), 'g.infoReady':N_('确认情报'),
 'g.autoplay':N_('调整托管'), 'g.pause':N_('暂停／继续'),
};
const PHASES={INFO_CHECK:N_('情报确认'),BAND_DRAFT:N_('策略选择'),BATTLE_CHECK:N_('协议启动'),ROUND_START:N_('回合开始'),PREP:N_('休整期'),SP_DRAFT:N_('选择奖励'),COMBAT:N_('作战'),UNITE:N_('联防'),SETTLE:N_('回合结算'),FINAL_ASSAULT:N_('最终攻势'),HIDDEN_CORE:N_('隐秘核心'),RESULT:N_('对局结算')};
const stamp=ms=>{const s=Math.floor(ms/1000);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
function Piece({piece}){
 if(!piece)return html`<span class="replay-piece is-empty">—</span>`;
 const kind=piece.kind==='item'?'items':piece.kind==='token'?'tokens':'chess',record=data.lookup(kind,piece.id);
 const assets=data.get('assets');
 const src=kind==='chess'?chessAvatarUrl(assets,record):null;
 return html`<span class=${`replay-piece${piece.sold?' is-sold':''}`}><${Img} src=${src} alt="" fallback=${null} /><span>${record?.name || piece.id}${piece.sold?html`<small>${t('已招募')}</small>`:null}
 ${piece.items?.length?html`<small>${piece.items.map(it=>data.lookup('items',it.id)?.name || it.id).join('、')}</small>`:null}</span>${piece.price!=null?html`<b class="num">${piece.price}</b>`:null}</span>`;
}

export function ReplayScreen({replay,selfId,onBack}){
 const ready=useData(...GAME_FILES);
 const timeline=useMemo(()=>new ReplayTimeline(replay),[replay]);
 const [cursor,setCursor]=useState(Math.min(1,replay.duration)),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1);
 const [playerId,setPlayerId]=useState(replay.players.some(p=>p.playerId===selfId)?selfId:replay.players[0]?.playerId);
 const [fieldId,setFieldId]=useState('auto'),[buffering,setBuffering]=useState(false);
 const live=useRef(null);live.current={playing,speed,buffering};
 const buffer=value=>{live.current.buffering=value;setBuffering(value);};
 useEffect(()=>{
  let raf=0,last=performance.now();
  const step=now=>{const d=live.current;if(d.playing&&!d.buffering&&!document.hidden)setCursor(t=>{const next=Math.min(replay.duration,t+Math.min(250,now-last)*d.speed);if(next>=replay.duration)setPlaying(false);return next;});last=now;raf=requestAnimationFrame(step);};
  raf=requestAnimationFrame(step);return()=>cancelAnimationFrame(raf);
 },[replay]);
 const state=useMemo(()=>timeline.at(cursor),[timeline,cursor]);
 const pub=state.public || {},priv=state[playerId],prep=['PREP','ROUND_START','INFO_CHECK','BAND_DRAFT','SP_DRAFT','BATTLE_CHECK','RESULT'].includes(pub.phase);
 const candidates=prep?[]:replay.fields.filter(f=>f.at<=cursor&&f.round===pub.round);
 const field=candidates.findLast(f=>f.fieldId===fieldId) || candidates.findLast(f=>f.spec.players.some(p=>p.playerId===playerId)) || candidates.at(-1) || null;
 const actions=timeline.actions.filter(a=>a.at<=cursor&&a.playerId===playerId).slice(-12).reverse();
 const seek=at=>{setPlaying(false);setCursor(at);};
 const relevant=timeline.actions.filter(a=>a.playerId===playerId);
 const previous=relevant.findLast(a=>a.at<cursor-1e-6),next=relevant.find(a=>a.at>cursor+1e-6);
 const slots=priv?.shop?.rewardOffer?.slots || priv?.shop?.slots || [];
 return html`<div class="st st--playback" role="dialog" aria-modal="true" aria-label=${t('对局回放')}>
  <${PageHeader} onBack=${onBack} title=${t('对局回放')} micro="MATCH REPLAY" />
  <div class="replay-toolbar">
   <label>${t('观看玩家')}<${Select} value=${playerId} options=${replay.players.map(p=>({value:p.playerId,label:p.name || p.playerId}))} onChange=${id=>{setPlayerId(id);setFieldId('auto');}} /></label>
   <label>${t('回合')}<${Select} value=${String(pub.round??0)} options=${timeline.rounds.map(r=>({value:String(r.round),label:t('第 {n} 回合',{n:r.round})}))} onChange=${round=>seek(timeline.rounds.find(r=>String(r.round)===round)?.at || 0)} /></label>
   <label>${t('战场')}<${Select} value=${fieldId} options=${[{value:'auto',label:t('跟随玩家')},...candidates.map(f=>({value:f.fieldId,label:t(PHASES[f.kind==='unite'?'UNITE':f.kind==='boss'?'FINAL_ASSAULT':f.kind==='hidden'?'HIDDEN_CORE':'COMBAT'])+' · '+f.spec.players.map(p=>replay.players.find(x=>x.playerId===p.playerId)?.name || p.playerId).join(' / ')}))]} onChange=${setFieldId} /></label>
   <span class="replay-phase">${t(PHASES[pub.phase] || '正在读取…')}</span>
  </div>
  <main class="replay-main">
   ${ready?html`<${ReplayCanvas} timeline=${timeline} state=${state} time=${cursor} playerId=${playerId} field=${field} onBuffering=${buffer} />`:html`<div class="replay-field"><div class="replay-field-status"><${Spinner} />${t('正在读取…')}</div></div>`}
   <aside class="replay-intel">
    <${MicroLabel}>OPERATION RECORD<//><h3>${replay.players.find(p=>p.playerId===playerId)?.name}</h3>
    <dl><div><dt>${t('目标生命')}</dt><dd class="num">${priv?.lp ?? '—'}</dd></div><div><dt>${t('资金')}</dt><dd class="num">${priv?.funds ?? '—'}</dd></div><div><dt>${t('调度中心')}</dt><dd class="num">${priv?.shop?.level ?? '—'}</dd></div></dl>
    <p class="replay-band">${data.lookup('bands',priv?.bandId)?.name || t('未选择策略')}</p>
    ${pub.draft?html`<div class="replay-choices">${t('策略选择')}<pre>${replay.players.map(p=>p.name+': '+(data.lookup('bands',pub.draft.picks?.[p.playerId] || pub.draft.focus?.[p.playerId])?.name || t('尚未选择'))).join('\n')}</pre></div>`:null}
    ${pub.sp?html`<div class="replay-choices">${pub.sp.name || t('选择奖励')}${pub.sp.cards.map(c=>html`<span>${c.name || c.id}${pub.sp.taken?.[c.idx]?t('（已选）'):''}</span>`)}</div>`:null}
    ${priv?.personalChoice?.cards?html`<div class="replay-choices">${t('选择奖励')}${priv.personalChoice.cards.map(c=>html`<span>${c.name || c.id}</span>`)}</div>`:null}
    ${priv?.board?.length?html`<h4>${t('阵容')}</h4><div class="replay-roster">${priv.board.map(p=>html`<${Piece} key=${p.uid} piece=${p} />`)}</div>`:null}
    <h4>${t('操作记录')}</h4><ol class="replay-actions">${actions.map((a,i)=>html`<li key=${`${a.at}-${i}`}><button type="button" onClick=${()=>seek(a.at)}><time class="num">${stamp(a.at)}</time><span>${t(ACTIONS[a.action] || '调整部署')}</span></button></li>`)}</ol>
   </aside>
  </main>
  <section class="replay-prep" aria-label=${t('经营记录')}>
   <div class="replay-stock"><span>${priv?.shop?.rewardOffer?t('领取奖励'):t('调度中心')} ${priv?.shop?.frozen?t('已冻结'):''}</span><div>${slots.map((p,i)=>html`<${Piece} key=${i} piece=${p} />`)}</div></div>
   <div class="replay-stock"><span>${t('手牌／临时区')}</span><div>${[...(priv?.hand || []),...(priv?.temp || [])].filter(Boolean).map((p,i)=>html`<${Piece} key=${i} piece=${p} />`)}</div></div>
  </section>
  <footer class="replay-controls">
   <div><${Button} size="sm" variant="secondary" icon="chevronLeft" disabled=${!previous} aria-label=${t('上一步操作')} onClick=${()=>seek(previous.at)} />
    <${Button} size="sm" variant="primary" icon=${playing?'pause':'play'} onClick=${()=>{if(cursor>=replay.duration)setCursor(Math.min(1,replay.duration));setPlaying(!playing);}}>${playing?t('暂停'):t('播放')}<//>
    <${Button} size="sm" variant="secondary" icon="chevronRight" disabled=${!next} aria-label=${t('下一步操作')} onClick=${()=>seek(next.at)} /></div>
   <label class="replay-seek"><span class="num">${stamp(cursor)} / ${stamp(replay.duration)}</span><input type="range" min="0" max=${Math.max(1,replay.duration)} step="1" value=${cursor} aria-label=${t('回放进度')} onInput=${e=>seek(Number(e.currentTarget.value))} /></label>
   <${Select} label=${t('回放倍速')} value=${String(speed)} options=${[.5,1,2,4,8].map(n=>({value:String(n),label:`${n}×`}))} onChange=${v=>setSpeed(Number(v))} />
   <span class="replay-buffer" role="status">${buffering?t('正在定位…'):t('只读回放')}</span>
  </footer>
 </div>`;
}
