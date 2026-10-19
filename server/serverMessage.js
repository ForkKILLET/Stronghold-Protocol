// One operator notification, kept separate from the read-only announcement schedule.
import {open,writeFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {announcementFromMessage,announcementLive,parseAnnouncements} from '../shared/announcements.js';
const fail=status=>Object.assign(new Error('Server message rejected'),{status});
export class ServerMessage {
  constructor({file=null,now=Date.now,onChange=()=>{},log=console}={}) {
    this.file=file;this.now=now;this.onChange=onChange;this.log=log;
    this.value={schema:1,revision:randomUUID(),message:null};this.pending=Promise.resolve();this.available=true;this.stopped=false;
  }
  async start() {
    if(!this.file)return;
    try {
      const handle=await open(this.file,'r');
      let bytes;
      try {
        const stat=await handle.stat();if(!stat.isFile() || stat.size>8192)throw Error('SIZE');
        const buffer=Buffer.alloc(8193);let size=0;
        while(size<buffer.length){const r=await handle.read(buffer,size,buffer.length-size,null);if(!r.bytesRead)break;size+=r.bytesRead;}
        if(size>8192)throw Error('SIZE');bytes=buffer.subarray(0,size);
      } finally {await handle.close();}
      const value=JSON.parse(bytes.toString('utf8'));
      if(value.schema!==1 || typeof value.revision!=='string' || !/^[0-9a-f-]{36}$/.test(value.revision)
        || value.message!==null && !announcementFromMessage({announcement:value.message}))throw Error('FORMAT');
      this.value={schema:1,revision:value.revision,message:value.message===null?null:announcementFromMessage({announcement:value.message})};
    } catch(error) {
      if(error.code!=='ENOENT'){this.available=false;this.log.warn('[server-message] cannot load saved notification; editor disabled');}
    }
  }
  state(){return {revision:this.value.revision,message:this.value.message,active:announcementLive(this.value.message,this.now()),persistent:!!this.file,available:this.available&&!this.stopped};}
  update(input) {
    const operation=this.pending.then(async()=>{
      if(this.stopped || !this.available)throw fail(503);
      if(!input || Object.keys(input).some(k=>!['revision','message'].includes(k)) || typeof input.revision!=='string')throw fail(400);
      if(input.revision!==this.value.revision)throw fail(409);
      let message=null;
      if(input.message!==null){
        const row=input.message;
        if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!['text','level','durationSeconds'].includes(k))
          || typeof row.text!=='string' || [...row.text].some(c=>{const n=c.codePointAt(0);return n>=0xd800&&n<=0xdfff;}))throw fail(400);
        try {message=parseAnnouncements({announcements:[{...row,id:'server-message-'+randomUUID(),startAt:new Date(this.now()).toISOString()}]})[0];}
        catch {throw fail(400);}
        const {enabled,...notice}=message;message=notice;
      }
      const next={schema:1,revision:randomUUID(),message};
      if(this.file){
        const temporary=this.file+'.'+randomUUID()+'.tmp';
        try {await writeFile(temporary,JSON.stringify(next)+'\n',{flag:'wx',mode:0o600});await rename(temporary,this.file);}
        catch {throw fail(503);}
        finally {await unlink(temporary).catch(()=>{});}
      }
      this.value=next;this.onChange();return this.state();
    });
    this.pending=operation.catch(()=>{});return operation;
  }
  async stop(){this.stopped=true;await this.pending;}
}
