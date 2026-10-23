// Read-only timeline over recorded wire views; checkpoints are derived, never stored in the account schema.
import {applyStatePatch} from './stateDelta.js';
export class ReplayTimeline {
 constructor(replay){
  if(replay?.v!==1||!Array.isArray(replay.events)||!Array.isArray(replay.fields)||!Number.isFinite(replay.duration))throw new Error('REPLAY_FORMAT');
  this.replay=replay;this.checkpoints=[];this.rounds=[];this.actions=[];this.clocks=[];let states={},round=null,last=-1;
  replay.events.forEach((e,index)=>{
   if(!Number.isFinite(e.at)||e.at<last)throw new Error('REPLAY_TIMELINE');last=e.at;
   if(e.kind==='view'){
    states={...states,[e.key]:Object.hasOwn(e,'full')?e.full:applyStatePatch(states[e.key],e.patch)};
    if(e.key==='public'){
     const pub=states.public;
     if(pub.round!==round){round=pub.round;this.rounds.push({round,at:e.at});}
     this.clocks.push({at:e.at,speed:pub.paused?0:Number(pub.battleSpeed)||2});
    }
   }
   if(e.kind==='action')this.actions.push(e);
   if(index%100===0)this.checkpoints.push({index,at:e.at,states});
  });
 }
 at(time){
  const ms=Math.max(0,Math.min(this.replay.duration,Number(time)||0));
  let lo=0,hi=this.checkpoints.length-1,point=null;
  while(lo<=hi){const mid=(lo+hi)>>>1;if(this.checkpoints[mid].at<=ms){point=this.checkpoints[mid];lo=mid+1;}else hi=mid-1;}
  let states=point?.states || {};
  for(let i=(point?.index??-1)+1;i<this.replay.events.length&&this.replay.events[i].at<=ms;i++){
   const e=this.replay.events[i];if(e.kind==='view')states={...states,[e.key]:Object.hasOwn(e,'full')?e.full:applyStatePatch(states[e.key],e.patch)};
  }
  return states;
 }
 /** Fixed 30 Hz engine time; original pauses and original room speed remain part of the recorded clock. */
 elapsed(field,time){
  let start=field.at,speed=2,total=0;
  for(const c of this.clocks){
   if(c.at<=start){speed=c.speed;continue;}
   if(c.at>time)break;
   total+=(c.at-start)*speed/1000;start=c.at;speed=c.speed;
  }
  total+=Math.max(0,time-start)*speed/1000;
  return Math.max(0,Math.min(total,field.end?.time ?? Infinity));
 }
}
