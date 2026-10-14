// Shared waiting-room / draft disclosure of the battle communication UI.
import {useState} from '../../vendor/hooks.module.js';
import {html,useTicker} from './components.js';
import {EmoteWheel,EmoteBubble} from './emotes.js';
import {useStore} from '../store.js';
import {net} from '../net.js';
import {actions} from './gameActions.js';
import {toastError} from './toasts.js';

export function CommunicationDock({room=false,disabled=false}) {
 const [open,setOpen]=useState(false);
 const connection=useStore(s=>s.connection.status);
 const history=useStore(s=>s.chatHistory);
 const myId=useStore(s=>s.me.playerId);
 const send=async(kind,value)=>{
  if(!room)return kind==='chat'?actions.chat(value):actions.emote(value);
  try{await net.request(`room.${kind}`,{[kind==='chat'?'text':'id']:value});return true;}catch(e){toastError(e);return false;}
 };
 return html`<div class="communication-dock"><${EmoteWheel} open=${open} onToggle=${setOpen}
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
