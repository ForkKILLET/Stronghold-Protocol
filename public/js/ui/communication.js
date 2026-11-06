// Shared waiting-room / draft disclosure of the battle communication UI.
import {useLayoutEffect,useRef} from '../../vendor/hooks.module.js';
import {html,useTicker} from './components.js';
import {EmoteWheel,EmoteBubble} from './emotes.js';
import {createStore,useStore} from '../store.js';
import {net} from '../net.js';
import {actions} from './gameActions.js';
import {toastError} from './toasts.js';

// Only the current room owns this preference; a new room starts fixed on history again.
const disclosure=createStore({key:null,open:true,pinned:true});
export function CommunicationDock({room=false,disabled=false}) {
 const key=useStore(s=>s.room?.code||null);
 const saved=useStore(s=>s,Object.is,disclosure);
 const state=saved.key===key?saved:{key,open:true,pinned:true};
 const {open,pinned}=state;
 const setOpen=value=>disclosure.set({key,open:value,pinned:value?disclosure.get().pinned:false});
 const setPinned=value=>disclosure.set({key,pinned:value,open:value});
 useLayoutEffect(()=>{if(disclosure.get().key!==key)disclosure.set({key,open:true,pinned:true});},[key]);
 const root=useRef(null);
 // Pre-game screens can shrink under the mobile keyboard. Keep the shared composer
 // within the visible viewport instead of letting a clipped footer own its coordinates.
 useLayoutEffect(()=>{
  if(!open)return undefined;
  const host=root.current,dialog=host?.querySelector('.ewheel__dialog');
  if(!dialog)return undefined;
  const viewport=window.visualViewport;
  let frame=0;
  const place=()=>{
   frame=0;
   const screen=host.closest('.screen');
   const compressed=(viewport?.height||innerHeight)<260 || (viewport?.height||innerHeight)+48<innerHeight;
   screen?.classList.toggle('communication-keyboard',compressed);
   if(!compressed){
    for(const property of ['position','bottom','width','max-width','max-height','left','top'])dialog.style.removeProperty(property);
    return;
   }
   const bounds=screen?.getBoundingClientRect();
   const header=screen?.querySelector('.app-header, .preparation-hud')?.getBoundingClientRect();
   const viewTop=viewport?.offsetTop||0,viewLeft=viewport?.offsetLeft||0;
   const bottom=viewTop+(viewport?.height||innerHeight)-8;
   const top=Math.max(viewTop+8,Math.min((header?.bottom??viewTop)+8,bottom-64));
   const left=Math.max(viewLeft+8,(bounds?.left??viewLeft)+8);
   const right=Math.min(viewLeft+(viewport?.width||innerWidth)-8,(bounds?.right??innerWidth)-8);
   const anchor=host.getBoundingClientRect();
   dialog.style.position='fixed';dialog.style.bottom='auto';
   dialog.style.maxWidth=`${Math.max(0,right-left)}px`;
   dialog.style.width=`${Math.min(288,Math.max(0,right-left))}px`;
   dialog.style.maxHeight=`${Math.max(0,bottom-top)}px`;
   const size=dialog.getBoundingClientRect();
   dialog.style.left=`${Math.max(left,Math.min(anchor.left,right-size.width))}px`;
   dialog.style.top=`${Math.max(top,bottom-size.height)}px`;
   const input=dialog.querySelector('input');
   if(input===document.activeElement){
    const field=input.getBoundingClientRect(),panel=dialog.getBoundingClientRect();
    if(field.bottom>panel.bottom-4)dialog.scrollTop+=field.bottom-panel.bottom+4;
    else if(field.top<panel.top+4)dialog.scrollTop-=panel.top-field.top+4;
   }
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(place);};
  const observer=new ResizeObserver(schedule);
  for(const element of [host,host.parentElement,dialog])if(element)observer.observe(element);
  window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);
  viewport?.addEventListener('resize',schedule);viewport?.addEventListener('scroll',schedule);
  host.addEventListener('focusin',schedule);place();
  return()=>{
   cancelAnimationFrame(frame);observer.disconnect();host.closest('.screen')?.classList.remove('communication-keyboard');
   window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);
   viewport?.removeEventListener('resize',schedule);viewport?.removeEventListener('scroll',schedule);
   host.removeEventListener('focusin',schedule);
  };
 },[open,pinned]);
 const connection=useStore(s=>s.connection.status);
 const history=useStore(s=>s.chatHistory);
 const myId=useStore(s=>s.me.playerId);
 const send=async(kind,value)=>{
  if(!room)return kind==='chat'?actions.chat(value):actions.emote(value);
  try{await net.request(`room.${kind}`,{[kind==='chat'?'text':'id']:value});return true;}catch(e){toastError(e);return false;}
 };
 return html`<div class=${`communication-dock${open ? ' is-open' : ''}${pinned ? ' is-pinned' : ''}`} ref=${root}><${EmoteWheel} open=${open} onToggle=${setOpen} pinned=${pinned} onPinChange=${setPinned} initialView="history"
   onSend=${id=>send('emote',id)} onChat=${text=>send('chat',text)} history=${history} myId=${myId} disabled=${disabled || connection!=='online'} /></div>`;
}
export function CommunicationBubble({playerId,emotesOnly=false}) {
 const events=useStore(s=>s.emotes);
 const latest=events.slice().reverse().find(e=>e.playerId===playerId&&(!emotesOnly||e.id));
 const fresh=latest && Date.now()-latest.at<3000;
 useTicker(fresh?250:0);
 if(!fresh)return null;
 return html`<${EmoteBubble} key=${latest.seq} id=${latest.id} text=${latest.text} at=${latest.at} class="communication-bubble" />`;
}

export function CommunicationActivity({players=[],emotesOnly=false}) {
 const events=useStore(s=>s.emotes);
 const latest=emotesOnly?events.slice().reverse().find(e=>e.id):events[events.length-1];
 const fresh=latest && Date.now()-latest.at<3000;
 useTicker(fresh?250:0);
 const player=players.find(p=>p.playerId===latest?.playerId);
 return fresh && player ? html`<div class="communication-activity"><b>${player.name}</b><${CommunicationBubble} playerId=${player.playerId} emotesOnly=${emotesOnly} /></div>` : null;
}
