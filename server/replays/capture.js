// Server-confirmed views + BattleSpecs. Never record chat, credentials, user IDs or arbitrary client input.
import {diffState} from '../../shared/stateDelta.js';
import {buildBattleSpec} from '../sim/spec.js';
import {captureCombatSpec,captureCombatEnd} from '../users/combatCapture.js';
const ACTIONS=new Set(['g.buy','g.refresh','g.freeze','g.levelUp','g.sell','g.move','g.equip','g.art','g.destroy','g.reward','g.choice','g.band','g.bandSkip','g.ready','g.infoReady','g.autoplay','g.pause']);
const clone=value=>JSON.parse(JSON.stringify(value));
function archive(m){
 if(!m.replayMaxBytes)return null;
 m.replayArchive??={v:1,events:[],fields:[],states:{},bytes:0,start:m.sched.now()};
 return m.replayArchive.unavailable||m.replayArchive.finished?null:m.replayArchive;
}
const at=(m,a)=>Math.max(a.events.length?a.events.at(-1).at+.001:0,Math.round(m.sched.now()-a.start));
function add(m,a,event){
 const bytes=Buffer.byteLength(JSON.stringify(event));
 if(a.bytes+bytes>m.replayMaxBytes||a.events.length>=100000){a.unavailable='size';a.events=[];a.fields=[];a.states={};return false;}
 a.bytes+=bytes;a.events.push(event);return true;
}
export function recordFrame(m,pid,msg){
 try{
  const a=archive(m);if(!a||!['m.public','m.private','b.pool'].includes(msg?.t))return;
  if(msg.t==='m.private'&&!m.players.has(pid))return;
  if(msg.t==='b.pool'){
   add(m,a,{at:at(m,a),kind:'pool',value:clone(msg),times:Object.fromEntries(m.fields.map(f=>[f.fieldId,f.cc?m._fieldElapsed(f):Number(f.battle?.time)||0]))});return;
  }
  const key=msg.t==='m.public'?'public':pid;
  const next=clone(msg);const previous=a.states[key];const patch=previous?diffState(previous,next):null;
  if(patch?.length===0)return;
  const full=JSON.stringify(next);const delta=patch&&JSON.stringify(patch);
  const event={at:at(m,a),kind:'view',key,...(delta&&delta.length<full.length?{patch}:{full:next})};
  if(add(m,a,event))a.states[key]=next;
 }catch{disable(m);}
}
export function recordViews(m){
 if(!archive(m))return;
 try{recordFrame(m,null,m.publicView());for(const ps of m.order)recordFrame(m,ps.playerId,ps.privateView());}catch{disable(m);}
}
export function recordAction(m,ps,msg){
 if(!ACTIONS.has(msg.t)||!archive(m))return;
 recordViews(m);
 const a=archive(m);if(a)add(m,a,{at:at(m,a),kind:'action',playerId:ps.playerId,action:msg.t});
}
export function recordSpec(m,opts){
 captureCombatSpec(m,opts);
 try{
  const a=archive(m);if(!a)return;
  // Every actual field is recorded once, regardless of human connectivity or viewer changes.
  const spec=buildBattleSpec({...opts,content:m.battleContent,cs:m.cs,vs:m.vs,
   boss:opts.boss || (opts.sharedBoss?{poolHp:opts.sharedBoss.hp,poolMax:opts.sharedBoss.maxHp}:null)});
  const field={at:at(m,a),round:m.round,fieldId:spec.fieldId,kind:spec.kind,spec};
  const bytes=Buffer.byteLength(JSON.stringify(field));
  if(a.bytes+bytes>m.replayMaxBytes){disable(m,'size');return;}
  a.bytes+=bytes;a.fields.push(field);
 }catch{disable(m);}
}
export function recordEnd(m,f,result){
 captureCombatEnd(m,f,result);
 try{
  const a=archive(m);if(!a)return;
  const entry=a.fields.findLast(x=>x.round===m.round&&x.fieldId===f.fieldId);if(!entry||entry.end)return;
  entry.end={at:at(m,a),time:Math.max(0,Number((Number(result?.time)>0?result.time:null) ?? f.endGt ?? f.battle?.time ?? (f.cc?m._fieldElapsed(f):0))||0),reason:result?.reason || 'forced'};
 }catch{disable(m);}
}
function disable(m,reason='capture'){
 if(m.replayArchive){m.replayArchive.unavailable=reason;m.replayArchive.events=[];m.replayArchive.fields=[];m.replayArchive.states={};}
 m.log?.warn?.('[replay] recording unavailable; settlement is unaffected');
}
export function finishReplay(m){
 recordViews(m);
 const a=archive(m);if(!a)return null;
 for(const f of m.fields)recordEnd(m,f,f.result);
 a.finished=true;
 const {states:_states,bytes:_bytes,start:_start,finished:_finished,...body}=a;
 return {...body,duration:at(m,a),cs:m.cs,vs:m.vs,modded:m.requireCs,
  players:m.order.map(p=>({playerId:p.playerId,name:p.name,seat:p.seat,isBot:!!p.isBot})),modeId:m.modeId,difficulty:m.difficulty};
}
