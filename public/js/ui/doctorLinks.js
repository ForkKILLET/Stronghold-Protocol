import {createStore} from '../store.js';
import {html} from './components.js';
import {normalizeDoctorId} from '../../../shared/publicProfiles.js';
import {t} from '../../../shared/i18n.js';

export const publicDoctorStore=createStore({open:false,publicId:null,replayId:null,standalone:false,preview:false});
export function openPublicDoctor(publicId,options={}){
 const id=normalizeDoctorId(publicId);if(!id)return;
 publicDoctorStore.set({open:true,publicId:id,replayId:null,standalone:false,preview:false,...options});
}
export function doctorLink(publicId,replayId=null){
 const id=normalizeDoctorId(publicId);if(!id)return '';
 const url=new URL(globalThis.location?.pathname || '/',globalThis.location?.origin || 'http://localhost');
 url.searchParams.set('doctor',id);if(replayId)url.searchParams.set('replay',replayId);return url.href;
}
export function ensureDoctorStyles(){
 if(document.querySelector('link[data-profile-css]'))return;
 const link=document.createElement('link');link.rel='stylesheet';link.href='/css/profile.css';link.dataset.profileCss='';document.head.append(link);
}
export function DoctorName({player,class:cls='',children}){
 const enabled=!player?.isBot&&!!normalizeDoctorId(player?.publicId);
 return enabled?html`<button type="button" class=${`doctor-name-link ${cls}`} title=${t('查看 {name} 的博士档案',{name:player.name})} aria-label=${t('查看 {name} 的博士档案',{name:player.name})}
  onClick=${e=>{e.stopPropagation();openPublicDoctor(player.publicId);}}>${children || player.name || t('博士')}</button>`
  :html`<span class=${cls}>${children || player?.name || t('博士')}</span>`;
}
