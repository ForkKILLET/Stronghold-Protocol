// Panel-side collector client: one fixed target, no browser-supplied URLs, cookies or redirects.
export function createAdminUpstream({url,token,now=Date.now,fetch:doFetch=fetch,maxBytes=8*1024*1024}) {
  const target=new URL('/v1/snapshot',url);
  if(!['http:','https:'].includes(target.protocol) || target.username || target.password) throw Error('Invalid collector URL');
  let cached=null,checkedAt=-Infinity,inflight=null,closed=false,lastSuccessAt=null,reason=null;
  const history=[];
  async function refresh(){
    if(closed)throw Error('Panel closed');
    if(inflight)return inflight;
    if(now()-checkedAt<2500)return cached;
    checkedAt=now();
    inflight=(async()=>{
      try{
        const response=await doFetch(target,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(4000)});
        if(!response.ok)throw Error('UNAVAILABLE');
        let size=0;const chunks=[];
        for await(const chunk of response.body){size+=chunk.byteLength;if(size>maxBytes)throw Error('SIZE');chunks.push(chunk);}
        const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(value.schema!==1)throw Error('SCHEMA');
        if(!Number.isFinite(value.at)||!value.server||!value.counts||!value.resources||
           !['matches','rooms','queue','players'].every(k=>Array.isArray(value[k])))throw Error('FORMAT');
        if(cached?.server.instance!==value.server.instance)history.length=0;
        if(!history.length || value.resources.at>history.at(-1).at)history.push(value.resources);
        while(history.length>101 || history[0]?.at<value.at-300000)history.shift();
        cached=value;lastSuccessAt=now();reason=null;
      }catch(error){reason=error.message==='SCHEMA'?'SCHEMA':'UNAVAILABLE';}
      return cached;
    })().finally(()=>{inflight=null;});
    return inflight;
  }
  async function current(){
    const value=await refresh();
    if(!value)throw Error('Collector unavailable');
    return value;
  }
  const connection=()=>({ok:!reason,checkedAt,lastSuccessAt,error:reason});
  return {
    async overview(){const value=await current();return {at:value.at,server:value.server,counts:value.counts,resources:value.resources,history:[...history],connection:connection()};},
    async list(kind,{page=1,query='',status='all'}={}){
      const value=await current();let rows=value[kind];
      if(!Array.isArray(rows))throw Error('Invalid list kind');
      if(status!=='all')rows=rows.filter(r=>status==='online'?r.connected:status==='disconnected'?!r.connected:r.state===status);
      if(query){const q=query.toLocaleLowerCase();rows=rows.filter(row=>[row.id,row.roomCode,row.name,row.host,...(row.players||[]).flatMap(p=>[p.name,p.playerId])].some(v=>typeof v==='string'&&v.toLocaleLowerCase().includes(q)));}
      const pages=Math.max(1,Math.ceil(rows.length/50));page=Math.min(page,pages);
      return {at:value.at,items:rows.slice((page-1)*50,page*50),total:rows.length,page,pages,connection:connection()};
    },
    close(){closed=true;},
  };
}
