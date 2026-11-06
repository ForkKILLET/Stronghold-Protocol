// Shared waiting-room / draft disclosure of the battle communication UI.
import {useLayoutEffect} from '../../vendor/hooks.module.js';
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
 const connection=useStore(s=>s.connection.status);
 const history=useStore(s=>s.chatHistory);
 const myId=useStore(s=>s.me.playerId);
 const send=async(kind,value)=>{
  if(!room)return kind==='chat'?actions.chat(value):actions.emote(value);
  try{await net.request(`room.${kind}`,{[kind==='chat'?'text':'id']:value});return true;}catch(e){toastError(e);return false;}
 };
 return html`<div class=${`communication-dock${open ? ' is-open' : ''}${pinned ? ' is-pinned' : ''}`}><${EmoteWheel} open=${open} onToggle=${setOpen} pinned=${pinned} onPinChange=${setPinned} initialView="history"
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
