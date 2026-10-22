// Shared waiting-room / draft disclosure of the battle communication UI.
import {useLayoutEffect,useRef,useState} from '../../vendor/hooks.module.js';
import {html,useTicker} from './components.js';
import {EmoteWheel,EmoteBubble} from './emotes.js';
import {useStore} from '../store.js';
import {net} from '../net.js';
import {actions} from './gameActions.js';
import {toastError} from './toasts.js';

export function CommunicationDock({room=false,disabled=false}) {
 const [open,setOpen]=useState(false);
 const root=useRef(null);
 // Pre-game screens can shrink under the mobile keyboard. Keep the shared composer
 // within the visible viewport instead of letting a clipped footer own its coordinates.
 useLayoutEffect(()=>{
  if(!open)return undefined;
  const host=root.current,dialog=host?.querySelector('.ewheel__dialog'),button=host?.querySelector('.ewheel__btn');
  if(!dialog||!button)return undefined;
  const viewport=window.visualViewport;
  let frame=0;
  const place=()=>{
   frame=0;
   const screen=host.closest('.screen'),bounds=screen?.getBoundingClientRect();
   const header=screen?.querySelector('.app-header')?.getBoundingClientRect();
   const viewTop=viewport?.offsetTop||0,viewLeft=viewport?.offsetLeft||0;
   const bottom=viewTop+(viewport?.height||innerHeight)-8;
   const top=Math.max(viewTop+8,Math.min((header?.bottom??viewTop)+8,bottom-64));
   const left=Math.max(viewLeft+8,(bounds?.left??viewLeft)+8);
   const right=Math.min(viewLeft+(viewport?.width||innerWidth)-8,(bounds?.right??innerWidth)-8);
   const anchor=button.getBoundingClientRect(),above=Math.min(anchor.top-6,bottom)-top;
   dialog.style.position='fixed';dialog.style.bottom='auto';
   dialog.style.maxWidth=`${Math.max(0,right-left)}px`;
   dialog.style.maxHeight=`${Math.max(0,above>=64?above:bottom-top)}px`;
   const size=dialog.getBoundingClientRect();
   dialog.style.left=`${Math.max(left,Math.min(anchor.left,right-size.width))}px`;
   dialog.style.top=`${Math.max(top,Math.min(anchor.top-6-size.height,bottom-size.height))}px`;
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
   cancelAnimationFrame(frame);observer.disconnect();
   window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);
   viewport?.removeEventListener('resize',schedule);viewport?.removeEventListener('scroll',schedule);
   host.removeEventListener('focusin',schedule);
  };
 },[open]);
 const connection=useStore(s=>s.connection.status);
 const history=useStore(s=>s.chatHistory);
 const myId=useStore(s=>s.me.playerId);
 const send=async(kind,value)=>{
  if(!room)return kind==='chat'?actions.chat(value):actions.emote(value);
  try{await net.request(`room.${kind}`,{[kind==='chat'?'text':'id']:value});return true;}catch(e){toastError(e);return false;}
 };
 return html`<div class="communication-dock" ref=${root}><${EmoteWheel} open=${open} onToggle=${setOpen}
   onSend=${id=>send('emote',id)} onChat=${text=>send('chat',text)} history=${history} myId=${myId} disabled=${disabled || connection!=='online'} /></div>`;
}
export function CommunicationBubble({playerId}) {
 const events=useStore(s=>s.emotes);
 const latest=events.slice().reverse().find(e=>e.playerId===playerId);
 const fresh=latest && Date.now()-latest.at<3000;
 useTicker(fresh?250:0);
 if(!fresh)return null;
 return html`<${EmoteBubble} key=${latest.seq} id=${latest.id} text=${latest.text} at=${latest.at} class="communication-bubble" />`;
}

export function CommunicationActivity({players=[]}) {
 const events=useStore(s=>s.emotes);
 const latest=events[events.length-1];
 const fresh=latest && Date.now()-latest.at<3000;
 useTicker(fresh?250:0);
 const player=players.find(p=>p.playerId===latest?.playerId);
 return fresh && player ? html`<div class="communication-activity"><b>${player.name}</b><${CommunicationBubble} playerId=${player.playerId} /></div>` : null;
}
