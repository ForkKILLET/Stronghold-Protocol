import {useEffect,useState,useRef} from '../../vendor/hooks.module.js';
import {html,Button,Modal,TextField,AvatarFrame} from './components.js';
import {BandIcon} from './gameComponents.js';
import {createStore,useStore} from '../store.js';
import {data,useData} from '../data.js';
import {identity,net} from '../net.js';
import {toast} from './toasts.js';
import {copyText} from './clipboard.js';
import {t} from '../../../shared/i18n.js';
import {NAME_MAX_LEN} from '../../../shared/constants.js';
import {bandIconUrl} from './assetUrls.js';
export const profileStore=createStore({enabled:false,user:null,open:false});
export async function userRequest(path,body){
 const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});
 const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error),{userCode:result.error});return result;
}
export async function initProfile(){
 try{const {user}=await userRequest('/api/user');profileStore.set({enabled:true,user});if(user.name)identity.saveName(user.name);return user;}
 catch{return null;}
}
export async function persistProfileName(name){
 if(!profileStore.get().enabled)return;
 const {user}=await userRequest('/api/user/name',{name});profileStore.set({user});
}
export function ProfileButton({onClose}){
 const enabled=useStore(s=>s.enabled,Object.is,profileStore);
 return enabled?html`<${Button} variant="secondary" icon="user" onClick=${()=>{onClose?.();profileStore.set({open:true});}}>${t('个人档案')}<//>`:null;
}
const close=()=>profileStore.set({open:false});
function ProfilePanel({user}){
 useData('bands','assets');
 const [name,setName]=useState(user.name || identity.loadName() || '');
 const [avatar,setAvatar]=useState(user.avatarId);
 const [busy,setBusy]=useState(false);
 const inFlight=useRef(false);
 const [stats,setStats]=useState(null);
 const [code,setCode]=useState('');
 const [restoreCode,setRestoreCode]=useState('');
 const [error,setError]=useState('');
 const [tab,setTab]=useState('profile');
 useEffect(()=>{userRequest('/api/user/stats').then(setStats).catch(()=>setError(t('暂时无法读取服务器数据，请稍后重试')));},[]);
 const bands=Object.values(data.get('bands') || {}).sort((a,b)=>(a.sortId||0)-(b.sortId||0));
 const run=async fn=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError(e.userCode==='ACTIVE_MATCH'?t('请先结束当前对局，再切换档案'):e.userCode==='RECOVERY_CODE'?t('恢复码无效或已使用'):e.userCode==='NAME_REJECTED'?t('该名称不可用'):t('操作失败，请稍后重试'));}finally{inFlight.current=false;setBusy(false);}};
 const save=()=>run(async()=>{const {user:next}=await userRequest('/api/user/profile',{name,avatarId:avatar});identity.saveName(next.name);profileStore.set({user:next});if(net.status==='online')net.setName(next.name);toast(t('个人档案已保存'),'ok');});
 return html`<${Modal} open=${true} utility=${true} width="8rem" title=${t('个人档案')} micro="USER PROFILE" onClose=${close} class="profile-modal"
  actions=${html`<${Button} variant="secondary" onClick=${close}>${t('关闭')}<//>${tab==='profile'?html`<${Button} variant="primary" icon="check" disabled=${busy||!name.trim()} onClick=${save}>${t('保存')}<//>`:null}`}>
  <nav class="profile-tabs">${[['profile',t('个人资料')],['stats',t('服务器战绩')],['recovery',t('数据找回')]].map(([key,label])=>html`<button type="button" class=${tab===key?'is-on':''} onClick=${()=>setTab(key)}>${label}</button>`)}</nav>
  ${error?html`<p class="profile-error" role="alert">${error}</p>`:null}
  ${tab==='profile'?html`<div class="profile-summary"><${AvatarFrame} name=${name} src=${avatar?bandIconUrl(data.get('assets'),avatar):null} size="lg" /><p>${t('无需登录，档案自动保存到服务器。')}<small>${t('昵称和头像将在下一局完整生效。')}</small></p></div>
   <${TextField} label=${t('昵称')} value=${name} maxLength=${NAME_MAX_LEN} onInput=${setName} />
   <div class="profile-avatars" role="group" aria-label=${t('选择头像')}><button type="button" class=${avatar===null?'is-on':''} onClick=${()=>setAvatar(null)}>${t('默认')}</button>
    ${bands.map(b=>html`<button type="button" key=${b.bandId} class=${avatar===b.bandId?'is-on':''} aria-pressed=${avatar===b.bandId} aria-label=${b.name} title=${b.name} onClick=${()=>setAvatar(b.bandId)}><${BandIcon} bandId=${b.bandId} size="sm" /></button>`)}</div>`:null}
  ${tab==='stats'?html`<p class="profile-note">${t('服务器记录的新对局；原有本机统计仍保留在统计数据中。')}</p>
   ${stats?html`<div class="profile-counters"><span>${t('已完成对局')}<b>${stats.summary.matches}</b></span><span>${t('胜利')}<b>${stats.summary.wins}</b></span><span>${t('最高回合')}<b>${stats.summary.bestRound}</b></span></div>
    <div class="profile-records">${stats.records.map(r=>html`<article key=${r.id}><span>${new Date(r.endedAt).toLocaleString()}</span><b class=${r.victory?'t-mint':''}>${r.victory?t('胜利'):t('未通关')}</b><span>${r.difficulty} · ${r.rounds} ${t('回合')}</span></article>`)}</div>
    ${stats.next?html`<${Button} variant="secondary" disabled=${busy} onClick=${()=>run(async()=>{const next=await userRequest('/api/user/stats?before='+stats.next);setStats(s=>({...next,records:[...s.records,...next.records]}));})}>${t('加载更多')}<//>`:null}`:html`<p>${t('正在读取…')}</p>`}`:null}
  ${tab==='recovery'?html`<p class="profile-note">${t('清除浏览器数据前，请保存恢复码。恢复码可在另一台设备找回此档案，用后失效；重新生成会使旧码失效。')}</p>
    <${Button} variant="secondary" disabled=${busy} onClick=${()=>run(async()=>setCode((await userRequest('/api/user/recovery',{})).code))}>${t('生成新的恢复码')}<//>
    ${code?html`<div class="profile-code"><code>${code}</code><${Button} variant="secondary" icon="copy" onClick=${()=>copyText(code)}>${t('复制')}<//></div>`:null}
    <hr /><${TextField} label=${t('恢复码')} value=${restoreCode} onInput=${setRestoreCode} />
    <p class="profile-note">${t('找回后将切换到对应档案，当前匿名档案不会合并。')}</p>
    <${Button} variant="primary" disabled=${busy||!restoreCode.trim()} onClick=${()=>run(async()=>{await userRequest('/api/user/recover',{code:restoreCode.trim()});location.reload();})}>${t('找回档案')}<//>`:null}
 <//>`;
}
export function ProfileHost(){
 const state=useStore(s=>s,Object.is,profileStore);
 useEffect(()=>{if(!state.open||document.querySelector('link[data-profile-css]'))return;const link=document.createElement('link');link.rel='stylesheet';link.href='/css/profile.css';link.dataset.profileCss='';document.head.append(link);},[state.open]);
 return state.open&&state.user?html`<${ProfilePanel} user=${state.user} />`:null;
}
