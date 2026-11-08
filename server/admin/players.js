// Bounded account controls on the game service. The independent panel never opens SQLite.
import {normalizeDoctorId} from '../../shared/publicProfiles.js';

export const PLAYER_STATES=['all','online','offline','disconnected','match','queue','waiting','lobby','spectating'];
export function playerQuery(params) {
  const page=Number(params.get('page') || 1),query=params.get('q') || '',status=params.get('status') || 'all';
  if(!Number.isInteger(page)||page<1||page>100000||query.length>80||!PLAYER_STATES.includes(status))
    throw Object.assign(Error('INPUT'),{status:400});
  return {page,query,status};
}
export function recoveryInput(input) {
  if(!input || normalizeDoctorId(input.publicId)!==input.publicId || typeof input.name!=='string' || input.name.length>256)
    throw Object.assign(Error('INPUT'),{status:400});
  return {publicId:input.publicId,name:input.name};
}
export function createAdminPlayers({users,registry,snapshot,data,now=Date.now,log=console}) {
  return {
    async list(options) {
      const active=snapshot.capture().players.map(p=>({...p,accountId:registry.byId(p.id)?.userId || null}));
      let result;
      if(users)result=await users.call('adminPlayers',{...options,active});
      else {
        const {query='',status='all'}=options;
        const q=query.toLocaleLowerCase();
        const rows=active.filter(p=>(!q||p.name.toLocaleLowerCase().includes(q)) &&
          (status==='all'||status==='online'&&p.connected||status==='offline'&&!p.connected||status===p.state||p.connected&&p.locations.some(l=>l.state===status)));
        const pages=Math.max(1,Math.ceil(rows.length/50)),page=Math.min(options.page || 1,pages);
        result={items:rows.slice((page-1)*50,page*50).map(({accountId:_accountId,...p})=>({...p,persistent:false,publicId:null})),
          counts:{accounts:0,online:0,offline:0,temporary:active.length},total:rows.length,page,pages};
      }
      result.items=result.items.map(({avatarId,...row})=>{
        const entry=data.assets?.profileAvatars?.[avatarId],url=typeof entry==='string'?entry:entry?.url;
        const avatar=typeof url==='string'&&url.startsWith('/assets/profile-avatars/')&&!url.includes('..')?url:row.avatar || null;
        return {...row,avatar,sessionCount:row.sessionCount || 0,locations:row.locations || []};
      });
      return {...result,at:now()};
    },
    async recovery(input) {
      if(!users)throw Object.assign(Error('UNAVAILABLE'),{status:503});
      const target=recoveryInput(input),result=await users.call('adminRecovery',target);
      if(result.error)throw Object.assign(Error(result.error),{status:result.error==='NOT_FOUND'?404:409});
      log.info?.('[admin] recovery code issued for doctor '+target.publicId);
      return result;
    },
  };
}
