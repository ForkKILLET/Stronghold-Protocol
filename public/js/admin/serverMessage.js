import {useEffect,useRef,useState} from '../../vendor/hooks.module.js';
import {html,Button,Icon} from '../ui/components.js';
import {Select} from '../ui/select.js';
import {t} from '../../../shared/i18n.js';
const draftOf=state=>{
  const seconds=state?.message ? (state.message.endAt-state.message.startAt)/1000 : 900;
  return {text:state?.message?.text || '',level:state?.message?.level || 'info',duration:String([300,900,3600,21600,86400].includes(seconds)?seconds:900)};
};
export function ServerMessageEditor({state,supported,connected,api,onChanged,onExpired}) {
  const [draft,setDraft]=useState(()=>draftOf(state)),[base,setBase]=useState(state?.revision);
  const dirty=useRef(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState('');
  useEffect(()=>{if(!dirty.current && base!==state?.revision){setDraft(draftOf(state));setBase(state?.revision);}},[state?.revision]);
  const edit=(key,value)=>{setDraft(v=>({...v,[key]:value}));dirty.current=true;setError('');setResult('');};
  const conflict=dirty.current && !!base && base!==state?.revision,limit=[...draft.text].length;
  const available=supported && connected && state?.available && !busy;
  async function submit(withdraw=false){
    if(!available || conflict)return;
    setBusy(true);setError('');setResult('');
    try {
      const next=await api('server-message',{body:{revision:base,message:withdraw?null:{text:draft.text,level:draft.level,durationSeconds:Number(draft.duration)}}});
      setBase(next.revision);setDraft(draftOf(next));dirty.current=false;onChanged(next);
      setResult(withdraw?t('通知已撤下'):t('通知已发布给所有在线玩家'));
    }catch(e){
      if(e.status===401)onExpired();
      else if(e.status===409){setError(t('通知已被其他管理员修改，请载入最新版本。'));try{onChanged(await api('server-message'));}catch{}}
      else setError(e.status===503?t('游戏服务暂时不可用，通知未更改。'):e.message);
    }finally{setBusy(false);}
  }
  if(!supported)return html`<section class="ad-section"><h2>${t('服务器通知')}</h2><p class="ad-note">${t('当前游戏版本尚不支持通知编辑，请先更新游戏服务。')}</p></section>`;
  return html`<section class="ad-section ad-message"><div class="ad-section__head"><h2>${t('服务器通知')}</h2><span class=${`ad-tag ${state?.active?'':'ad-tag--warn'}`}>${state?.active?t('正在展示'):t('当前无有效通知')}</span></div>
    <p class="ad-note">${t('发布后实时显示给所有在线玩家，包括对局中与后来连接的玩家；有效期结束或手动撤下后恢复原公告排期。')}</p>
    <div class="ad-message__current"><span class="ad-micro">${t('当前通知')}</span><p>${state?.message?.text || t('尚未发布通知')}</p>
      ${state?.message?html`<span class="ad-muted">${t('有效至')} <time>${new Date(state.message.endAt).toLocaleString()}</time>${!state.active?` · ${t('已到期')}`:''}</span>`:null}
      <span class="ad-muted">${state?.persistent?t('有效期内重启后继续展示'):t('仅本次运行有效，重启后清空')}</span></div>
    ${!connected?html`<p class="ad-error" role="alert">${t('游戏服务未连接，暂时无法发布或撤下。')}</p>`:!state?.available?html`<p class="ad-error" role="alert">${t('通知存储不可用，请检查游戏服务日志。')}</p>`:null}
    ${conflict?html`<div class="ad-message__conflict"><p class="ad-error" role="alert">${t('通知已被其他管理员修改，请载入最新版本。')}</p><${Button} size="sm" onClick=${()=>{setDraft(draftOf(state));setBase(state.revision);dirty.current=false;setError('');}}>${t('载入最新版本')}</${Button}></div>`:null}
    <form onSubmit=${e=>{e.preventDefault();submit();}}><label class="ad-message__text"><span>${t('通知内容')}<small class=${limit>500?'ad-error':'ad-muted'}>${limit} / 500</small></span>
      <textarea rows="4" value=${draft.text} disabled=${busy} placeholder=${t('例如：服务器将在今晚进行维护，请在当前对局结束后退出。')} onInput=${e=>edit('text',e.currentTarget.value)} maxlength="2000" required/></label>
      <div class="ad-message__options"><label><span>${t('通知等级')}</span><${Select} label=${t('通知等级')} disabled=${busy} value=${draft.level} options=${[{value:'info',label:t('普通')},{value:'warning',label:t('提醒')},{value:'urgent',label:t('紧急通知')}]} onChange=${v=>edit('level',v)}/></label>
        <label><span>${t('展示时长')}</span><${Select} label=${t('展示时长')} disabled=${busy} value=${draft.duration} options=${[{value:'300',label:t('5 分钟')},{value:'900',label:t('15 分钟')},{value:'3600',label:t('1 小时')},{value:'21600',label:t('6 小时')},{value:'86400',label:t('24 小时')}]} onChange=${v=>edit('duration',v)}/></label></div>
      <div class=${`ad-message__preview ad-message__preview--${draft.level}`}><span><${Icon} name="info"/>${t('通知预览')}</span><p>${draft.text.trim().replace(/\s+/g,' ') || t('输入通知内容后查看预览')}</p></div>
      ${error?html`<p class="ad-error" role="alert">${error}</p>`:null}${result?html`<p class="ad-message__result" role="status">${result}</p>`:null}
      <div class="ad-message__actions"><${Button} type="submit" variant="primary" icon="check" loading=${busy} disabled=${!available||conflict||!draft.text.trim()||limit>500}>${state?.active?t('更新通知'):t('发布通知')}</${Button}>
        <${Button} type="button" variant="secondary" icon="close" disabled=${!available||!state?.active||conflict} onClick=${()=>submit(true)}>${t('撤下通知')}</${Button}></div>
      <p class="ad-note">${t('此处发布临时纯文本通知；长期公告与更新日志仍在游戏公告中查看。')}</p>
    </form></section>`;
}
