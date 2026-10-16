import {useState,useRef} from '../../vendor/hooks.module.js';
import {html,Button,TextField,AvatarFrame} from './components.js';
import {BandIcon} from './gameComponents.js';
import {createStore,useStore,loadPref,savePref} from '../store.js';
import {data,useData} from '../data.js';
import {identity,net} from '../net.js';
import {toast} from './toasts.js';
import {copyText} from './clipboard.js';
import {t} from '../../../shared/i18n.js';
import {NAME_MAX_LEN} from '../../../shared/constants.js';
import {bandIconUrl} from './assetUrls.js';

export const profileStore=createStore({enabled:false,user:null,open:false,tab:'overview',status:'idle'});
export async function userRequest(path,body){
 const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});
 const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error),{userCode:result.error});return result;
}
function remember(user){profileStore.set({user,status:'saved'});savePref('doctorProfile',user);if(user.name)identity.saveName(user.name);}
export async function initProfile(){
 try{const {user}=await userRequest('/api/user');profileStore.set({enabled:true});remember(user);return user;}
 catch(e){
  const cached=loadPref('doctorProfile',null);
  if(e.userCode!=='USER_STORAGE_DISABLED'&&cached?.id){profileStore.set({enabled:true,user:cached,status:'offline'});return cached;}
  return null;
 }
}
export async function persistProfileName(name){
 if(!profileStore.get().enabled)return;
 try{const {user}=await userRequest('/api/user/name',{name});remember(user);}
 catch(e){if(e.userCode==='NAME_REJECTED'||e.userCode==='PROFILE')throw e;profileStore.set({status:'offline'});}
}
export function openProfile(tab='overview'){profileStore.set({open:true,tab});}
export function ProfileButton({onClose}){
 return html`<${Button} variant="secondary" size="md" icon="user" onClick=${()=>{onClose?.();openProfile();}}>${t('博士档案')}<//>`;
}
export function DoctorAvatar({size='sm',name,seat=0,self=true}){
 const user=useStore(s=>s.user,Object.is,profileStore);useData('assets');
 return html`<${AvatarFrame} size=${size} name=${user?.name || name} seat=${seat} self=${self} src=${user?.avatarId?bandIconUrl(data.get('assets'),user.avatarId):null} />`;
}
function useOperation(){
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const inFlight=useRef(false);
 const run=async fn=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError(e.userCode==='ACTIVE_MATCH'?t('请先结束当前对局，再切换档案'):e.userCode==='RECOVERY_CODE'?t('恢复码无效或已使用'):e.userCode==='NAME_REJECTED'?t('该名称不可用'):t('操作失败，请稍后重试'));}finally{inFlight.current=false;setBusy(false);}};
 return {busy,error,run};
}
export function ProfileEditor({user}){
 useData('bands','assets');
 const [name,setName]=useState(user.name || identity.loadName() || '');
 const [avatar,setAvatar]=useState(user.avatarId);const {busy,error,run}=useOperation();
 const bands=Object.values(data.get('bands') || {}).sort((a,b)=>(a.sortId||0)-(b.sortId||0));
 const save=()=>run(async()=>{const {user:next}=await userRequest('/api/user/profile',{name,avatarId:avatar});remember(next);if(net.status==='online')net.setName(next.name);toast(t('个人档案已保存'),'ok');});
 return html`<section class="doctor-editor"><h3 class="st-sec__h">${t('个人资料')}</h3>
  <p class="profile-note">${t('无需登录，档案自动保存。头像和昵称将在下一局完整生效。')}</p>
  ${error?html`<p class="profile-error" role="alert">${error}</p>`:null}
  <div class="profile-summary"><${AvatarFrame} name=${name} src=${avatar?bandIconUrl(data.get('assets'),avatar):null} size="lg" />
   <${TextField} label=${t('昵称')} value=${name} maxLength=${NAME_MAX_LEN} onInput=${setName} /></div>
  <div class="profile-avatars" role="group" aria-label=${t('选择头像')}>
   <button type="button" class=${avatar===null?'is-on':''} aria-pressed=${avatar===null} onClick=${()=>setAvatar(null)}>${t('默认')}</button>
   ${bands.map(b=>html`<button type="button" key=${b.bandId} class=${avatar===b.bandId?'is-on':''} aria-pressed=${avatar===b.bandId} aria-label=${b.name} title=${b.name} onClick=${()=>setAvatar(b.bandId)}><${BandIcon} bandId=${b.bandId} size="sm" /></button>`)}
  </div><div class="doctor-actions"><${Button} variant="primary" icon="check" disabled=${busy||!name.trim()} onClick=${save}>${t('保存资料')}<//></div>
 </section>`;
}
export function ProfileRecovery(){
 const [code,setCode]=useState('');const [restoreCode,setRestoreCode]=useState('');const {busy,error,run}=useOperation();
 return html`<section class="doctor-recovery"><h3 class="st-sec__h">${t('在其他设备使用')}</h3>
  <p class="profile-note">${t('清除浏览器数据前，请保存恢复码。恢复码可在另一台设备找回此档案，用后失效；重新生成会使旧码失效。')}</p>
  ${error?html`<p class="profile-error" role="alert">${error}</p>`:null}
  <${Button} variant="secondary" disabled=${busy} onClick=${()=>run(async()=>setCode((await userRequest('/api/user/recovery',{})).code))}>${t('保存恢复码')}<//>
  ${code?html`<div class="profile-code"><code>${code}</code><${Button} variant="secondary" icon="copy" onClick=${()=>copyText(code)}>${t('复制')}<//></div>`:null}
  <h3 class="st-sec__h doctor-section">${t('找回已有档案')}</h3>
  <${TextField} label=${t('恢复码')} value=${restoreCode} onInput=${setRestoreCode} />
  <p class="profile-note">${t('找回后将切换到对应档案，当前匿名档案不会合并。')}</p>
  <${Button} variant="primary" disabled=${busy||!restoreCode.trim()} onClick=${()=>run(async()=>{await userRequest('/api/user/recover',{code:restoreCode.trim()});location.reload();})}>${t('找回档案')}<//>
 </section>`;
}
