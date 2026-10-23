import {Worker} from 'node:worker_threads';
import path from 'node:path';
export async function openUserStore(file,{backups=file===':memory:'?null:path.join(path.dirname(file),'backups'),log=console,hiddenBonds=[],replays}={}) {
 const worker=new Worker(new URL('./worker.js',import.meta.url),{workerData:{file,hiddenBonds,replays},execArgv:[]});
 let seq=0;let dead=false;const pending=new Map();
 const rejectAll=()=>{dead=true;for(const p of pending.values())p.reject(new Error('User storage unavailable'));pending.clear();};
 worker.on('error',rejectAll);worker.on('exit',rejectAll);
 const ready=new Promise((resolve,reject)=>{worker.once('error',reject);worker.on('message',m=>{if(m.ready)resolve();});});
 worker.on('message',m=>{const p=pending.get(m.id);if(!p)return;pending.delete(m.id);if(m.error)p.reject(new Error(m.error));else p.resolve(m.result);});
 await ready;
 const call=(method,args={})=>new Promise((resolve,reject)=>{
  if(dead||pending.size>=512){reject(new Error('User storage unavailable'));return;}
  const id=++seq;pending.set(id,{resolve,reject});worker.postMessage({id,method,args});
 });
 const timer=backups?setInterval(()=>{call('backup',{directory:backups}).catch(()=>log.warn?.('[users] scheduled backup failed'));},24*60*60*1000):null;timer?.unref();
 return {call,async close(){clearInterval(timer);if(!dead)await call('close');await worker.terminate();}};
}
