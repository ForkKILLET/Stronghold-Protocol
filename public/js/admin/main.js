// Independent entry point: never import the game boot, network or profile modules.
import {render} from '../../vendor/preact.module.js';
import {useEffect,useRef,useState} from '../../vendor/hooks.module.js';
import {html,Button,Icon,Tabs} from '../ui/components.js';
import {ServerMessageEditor} from './serverMessage.js';
import {Select} from '../ui/select.js';
import {initLang,useLang} from './lang.js';
import {t} from '../../../shared/i18n.js';
import {PHASE_NAMES,DIFFICULTY_NAMES} from '../../../shared/constants.js';

const number = value => Number.isFinite(value) ? new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(value) : '—';
const bytes = value => !Number.isFinite(value) ? '—' : value>=1048576 ? `${number(value/1048576)} MiB` : `${number(value/1024)} KiB`;
function elapsed(at,now) {
  if (!Number.isFinite(at)) return '—';
  const seconds=Math.max(0,Math.floor((now-at)/1000));
  return `${Math.floor(seconds/3600).toString().padStart(2,'0')}:${Math.floor(seconds/60)%60<10?'0':''}${Math.floor(seconds/60)%60}:${(seconds%60).toString().padStart(2,'0')}`;
}
const mode = value => value==='solo'?t('单人模拟'):t('同盟模拟');
const difficulty = value => DIFFICULTY_NAMES[value]?t(DIFFICULTY_NAMES[value]):value || '—';
function stateLabel(value) {
  return ({online:t('在线'),disconnected:t('已断线'),lobby:t('大厅'),waiting:t('等待室'),queue:t('匹配中'),
    match:t('对局中'),spectating:t('观战中')})[value] || value || '—';
}
const errorText = status => status===400?t('通知内容或有效期无效'):status===409?t('通知已变更，请载入最新版本'):status===429?t('请求过于频繁，请稍后重试'):status===401?t('管理员口令不正确或登录已过期'):t('无法读取服务器，请重试');
async function api(route,{signal,body}={}) {
  const response=await fetch(`/admin/api/${route}`,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',
    signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(8000)]),
    ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  if(!response.ok)throw Object.assign(new Error(errorText(response.status)),{status:response.status});
  return response.json();
}
function Person({p,showConnection=true}) {
  return html`<span class="ad-person"><span class="ad-avatar" aria-hidden="true">${p.avatar
    ?html`<img src=${p.avatar} alt="" loading="lazy" onError=${e=>{e.currentTarget.hidden=true;}}/>`
    :html`<${Icon} name=${p.isBot?'robot':'user'}/>`}</span><span class="ad-person__name">${p.name || '—'}</span>
    ${p.isBot?html`<span class="ad-tag">AI</span>`:null}${showConnection&&!p.isBot&&!p.connected?html`<span class="ad-tag ad-tag--warn">${t('已断线')}</span>`:null}</span>`;
}
function Spark({history,field}) {
  const points=history.filter(p=>Number.isFinite(p[field]));
  if(points.length<2)return html`<div class="ad-spark ad-muted">${t('正在积累采样')}</div>`;
  const min=Math.min(...points.map(p=>p[field])),max=Math.max(...points.map(p=>p[field])),range=Math.max(max-min,max*.1,1);
  const start=history[0].at,end=history.at(-1).at;
  const x=point=>((point.at-start)/Math.max(1,end-start)*400).toFixed(1);
  const coords=points.map(p=>`${x(p)},${(53-(p[field]-min)/range*43).toFixed(1)}`).join(' ');
  return html`<svg class="ad-spark" viewBox="0 0 400 64" preserveAspectRatio="none" aria-hidden="true"><path class="ad-spark__grid" d="M0 54H400 M0 28H400"/><polygon points=${`${x(points[0])},64 ${coords} ${x(points.at(-1))},64`} fill="url(#ad-chart-fill)"/><polyline points=${coords}/></svg>`;
}
function Metric({label,value,detail,history,field}) {
  return html`<article class="ad-metric"><span class="ad-muted">${label}</span><strong>${value}</strong><${Spark} history=${history} field=${field}/><small>${detail}</small></article>`;
}
function Overview({data,onTab}) {
  const {counts:c,resources:r,history}=data,p=r.persistence;
  const cards=[['players',t('在线玩家'),c.online,t('断线保留 {n} 人',{n:c.disconnected}),'user'],
    ['matches',t('进行中对局'),c.matches,t('AI 席位 {n} 个',{n:c.bots}),'play'],
    ['matching',t('匹配队伍'),c.queuedTeams,t('排队玩家 {n} 人',{n:c.queuedPlayers}),'search'],
    ['matching',t('等待与对局房间'),c.rooms,t('正在观战 {n} 人',{n:c.spectators}),'users']];
  return html`<div class="ad-overview"><div class="ad-stats">${cards.map(([tab,label,value,detail,icon],i)=>html`
    <button class="ad-stat" key=${label} onClick=${()=>onTab(tab,i===3?'rooms':'queue')}><span class="ad-stat__label"><${Icon} name=${icon}/>${label}</span>
      <strong>${value}</strong><span class="ad-muted">${detail}</span><span class="ad-stat__arrow" aria-hidden="true">↗</span></button>`)}</div>
    <section class="ad-section"><div class="ad-section__head"><h2>${t('进程资源')}</h2><span class="ad-muted">${t('最近 5 分钟 · 每 3 秒采样')}</span></div>
      <div class="ad-metrics"><${Metric} label="CPU" value=${`${number(r.cpuPercent)} %`} history=${history} field="cpuPercent" detail=${t('100% 表示占满一个逻辑核心')}/>
        <${Metric} label=${t('常驻内存')} value=${bytes(r.rss)} history=${history} field="rss" detail=${t('游戏进程，包含 Worker 线程')}/>
        <${Metric} label=${t('事件循环 P99')} value=${`${number(r.eventLoopP99Ms)} ms`} history=${history} field="eventLoopP99Ms" detail=${t('主线程最近 10 秒窗口')}/></div>
      <div class="ad-resource-strip"><span>${t('主线程堆内存')} <b>${bytes(r.heapUsed)} / ${bytes(r.heapTotal)}</b></span><span>WS ↑ <b>${bytes(r.sendBytesPerSec)}/s</b></span>
        <span>WS ↓ <b>${bytes(r.receiveBytesPerSec)}/s</b></span><span>${t('发送缓冲')} <b>${bytes(r.socketBufferedBytes)}</b></span></div>
      <p class="ad-note">${t('不含宿主机及插件独立进程；管理页流量不计入 WS。趋势仅在有人查看面板时采样，重启后清空。')}</p>
    </section>
    <div class="ad-system-grid"><section class="ad-section"><div class="ad-section__head"><h2>${t('执行线程')}</h2><span class="ad-micro">WORKERS</span></div>
      ${[['workers',t('战斗计算')],['matchWorkers',t('完整对局')]].map(([key,label])=>html`<div class="ad-system-row"><span>${label}</span><span>${r[key]
        ?t('线程 {threads} · 忙碌 {busy} · 排队 {queued}',{threads:r[key].threads,busy:r[key].busy,queued:r[key].queued})
        :t('未启用')}</span></div>`)}</section>
      <section class="ad-section"><div class="ad-section__head"><h2>${t('对局持久化')}</h2><span class=${`ad-tag ${p.enabled?'':'ad-tag--warn'}`}>${p.enabled?t('已启用'):t('未启用')}</span></div>
        ${p.enabled?html`<div class="ad-system-row"><span>${t('写入 / 失败')}</span><b>${p.writes} / ${p.failures}</b></div><div class="ad-system-row"><span>${t('检查点 / 待恢复 / 待结算')}</span><b>${p.checkpoints} / ${p.recovery} / ${p.pendingResults}</b></div>`
          :html`<p class="ad-note">${t('当前对局仅保存在内存中。')}</p>`}</section></div>
    <svg width="0" height="0" aria-hidden="true" class="ad-svg-defs"><defs><linearGradient id="ad-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--accent)" stop-opacity=".14"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs></svg>
  </div>`;
}
function Roster({players=[]}) {
  return html`<div class="ad-roster">${players.map((p,i)=>html`<div class="ad-roster__row" key=${p.playerId}><span class="ad-seat">${String((p.seat??i)+1).padStart(2,'0')}</span><${Person} p=${p}/>
    <span class="ad-muted">${p.left?t('已离开'):p.alive===false?t('已淘汰'):Number.isFinite(p.lp)?`LP ${p.lp}`:p.ready?t('已就绪'):''}</span></div>`)}</div>`;
}
function ListRow({kind,row,now}) {
  const [open,setOpen]=useState(false),humans=row.players?.filter(p=>!p.isBot).length,bots=row.players?.filter(p=>p.isBot).length;
  if(kind==='players')return html`<article class="ad-list-row ad-list-row--player"><${Person} p=${row} showConnection=${false}/><span class=${`ad-tag ${row.connected?'':'ad-tag--warn'}`}>${stateLabel(row.state)}</span>
    <span class="ad-row-context">${row.roomCode?`${t('同盟')} ${row.roomCode}`:row.matchId?t('公共匹配对局'):'—'}</span><span class="ad-row-time ad-muted">${row.connected?t('在线'):t('断线 {time}',{time:elapsed(row.disconnectedAt,now)})}</span>
    <details class="ad-player-details"><summary>${t('会话详情')}</summary><span class="ad-muted">${t('公开编号')} ${row.id} · ${t('保留会话 {n} 个',{n:row.sessionCount})}</span></details></article>`;
  const title=row.roomCode || (kind==='queue'?t('公共匹配'):t('公共匹配对局'));
  return html`<article class=${`ad-list-row ${open?'is-open':''}`}><div class="ad-row-head"><button class="ad-row-toggle" aria-expanded=${open} onClick=${()=>setOpen(!open)}>
    <span class="ad-row-title"><span class="ad-micro">${kind==='matches'?'OPERATION':kind==='rooms'?'ALLIANCE':'QUEUE'}</span><strong>${title}</strong></span>
    <span class="ad-row-mode">${mode(row.mode)}<small>${difficulty(row.difficulty)}${row.modded?` · ${t('含插件')}`:''}</small></span>
    <span class="ad-row-phase">${kind==='matches'?html`<span class="ad-tag">${row.paused?t('已暂停'):t(PHASE_NAMES[row.phase] || row.phase || '—')}</span><small>${t('第 {n} 回合',{n:row.round??'—'})}</small>`
      :html`<span class="ad-tag">${kind==='queue'?t('匹配中'):stateLabel(row.state)}</span><small>${t('真人 {humans} · AI {bots}',{humans,bots})}</small>`}</span>
    <span class="ad-row-time"><b>${elapsed(kind==='matches'?row.startedAt:kind==='queue'?row.queuedAt:row.createdAt,now)}</b><small>${kind==='matches'?t('对局时长'):kind==='queue'?t('已等待'):t('创建至今')}</small></span>
    <span class="ad-expand" aria-hidden="true">${open?'−':'+'}</span></button>
    ${['rooms','matches'].includes(kind) && row.mode==='coop' && /^[A-Z0-9]{4}$/.test(row.roomCode || '') ? html`
      <a class="btn btn--secondary btn--sm ad-spectate" href=${`/?spectate=${encodeURIComponent(row.roomCode)}`} target="_blank" rel="noopener noreferrer"
        title=${t('在新标签页观战')} aria-label=${t('观战同盟 {code}',{code:row.roomCode})}><${Icon} name="eye"/>${t('观战')}</a>` : null}</div>
    ${open?html`<div class="ad-row-details"><${Roster} players=${row.players}/>${kind==='rooms'?html`<p class="ad-note">${t('创建者')} ${row.host || '—'} · ${t('战斗倍速')} ${row.battleSpeed || 2}× · ${t('观战人数')} ${row.spectators?.length || 0}</p>`:null}
      ${kind==='matches'?html`<p class="ad-note">${t('公开对局编号')} <span class="ad-id">${row.id}</span></p>`:null}</div>`:null}</article>`;
}
function Dashboard() {
  useLang();
  const [auth,setAuth]=useState('checking'),[loginError,setLoginError]=useState(''),[busy,setBusy]=useState(false);
  const password=useRef(null);
  const [tab,setTab]=useState('overview'),[matching,setMatching]=useState('queue'),[query,setQuery]=useState(''),[search,setSearch]=useState(''),[status,setStatus]=useState('all'),[page,setPage]=useState(1);
  const [overview,setOverview]=useState(null),[list,setList]=useState(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[hidden,setHidden]=useState(document.hidden),[updating,setUpdating]=useState(false);
  const kind=tab==='messages'?'overview':tab==='matching'?matching:tab;
  useEffect(()=>{document.title=`${t('服务器管理')} · Stronghold Protocol`;});
  useEffect(()=>{const c=new AbortController();api('session',{signal:c.signal}).then(()=>setAuth('ready')).catch(e=>{if(!c.signal.aborted){setAuth('login');if(e.status!==401)setLoginError(e.message);}});return()=>c.abort();},[]);
  useEffect(()=>{const timer=setTimeout(()=>{setSearch(query.trim());setPage(1);},300);return()=>clearTimeout(timer);},[query]);
  useEffect(()=>{const listener=()=>setHidden(document.hidden);document.addEventListener('visibilitychange',listener);return()=>document.removeEventListener('visibilitychange',listener);},[]);
  useEffect(()=>{
    if(auth!=='ready'||hidden)return undefined;
    const c=new AbortController();let timer;
    const poll=async()=>{
      setUpdating(true);
      try {
        const results=await Promise.all([api('overview',{signal:c.signal}),kind!=='overview'?api(`list?${new URLSearchParams({kind,q:search,page:String(page),status:kind==='players'?status:'all'})}`,{signal:c.signal}):null]);
        if(c.signal.aborted)return;
        setOverview(results[0]);setList(results[1]);setError(results[0].connection?.ok===false
          ? (results[0].connection.error==='SCHEMA'?t('游戏数据接口版本不匹配'):t('游戏服务暂时不可用，显示最后一次成功读取的数据')) : '');
      }catch(e){if(!c.signal.aborted){if(e.status===401){setAuth('login');setOverview(null);setList(null);setLoginError(t('登录已过期，请重新输入管理员口令'));}else setError(e.message);}}
      finally{if(!c.signal.aborted){setUpdating(false);timer=setTimeout(poll,3000);}}
    };poll();return()=>{c.abort();clearTimeout(timer);};
  },[auth,hidden,kind,search,page,status,refresh]);
  const changeTab=(next,sub)=>{setTab(next);if(sub)setMatching(sub);setPage(1);setQuery('');setSearch('');setStatus('all');setList(null);};
  async function login(e){
    e.preventDefault();if(busy)return;setBusy(true);setLoginError('');
    const value=password.current.value;password.current.value='';
    try{await api('login',{body:{password:value}});setAuth('ready');}catch(error){setLoginError(error.message);password.current?.focus();}finally{setBusy(false);}
  }
  async function logout(){
    if(busy)return;setBusy(true);
    try{await api('logout',{body:{}});setAuth('login');setOverview(null);setList(null);setError('');setLoginError('');}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return html`<div class="ad-shell"><header class="ad-header"><a href="/" class="ad-brand"><span class="ad-brand__mark" aria-hidden="true">◈</span><span>STRONGHOLD<span class="ad-micro">PROTOCOL / OPERATIONS</span></span></a>
    <div class="ad-heading"><span class="ad-micro">SERVER ADMINISTRATION</span><h1>${t('服务器管理')}</h1></div>
    <div class="ad-header__right"><span class="ad-tag">${t('运行管理')}</span>${auth==='ready'?html`<${Button} size="sm" icon="exit" disabled=${busy} onClick=${logout}>${t('退出登录')}</${Button}>`:null}</div></header>
    ${auth!=='ready'?html`<main class="ad-login"><div class="ad-login__mark" aria-hidden="true"><${Icon} name="key"/></div><span class="ad-micro">RESTRICTED ACCESS</span><h2>${t('管理员验证')}</h2><p class="ad-muted">${t('使用独立管理员口令管理服务器')}</p>
      ${auth==='checking'?html`<p role="status">${t('正在验证登录状态')}</p>`:html`<form onSubmit=${login}><label for="admin-password">${t('管理员口令')}</label><input id="admin-password" ref=${password} type="password" name="password" autocomplete="current-password" maxlength="512" required disabled=${busy}/>
      ${loginError?html`<p class="ad-error" role="alert">${loginError}</p>`:null}<${Button} type="submit" variant="primary" loading=${busy} icon="check">${t('进入面板')}</${Button}></form>`}
      <a class="ad-back" href="/">← ${t('返回游戏')}</a></main>`:html`<main class="ad-content"><div class="ad-toolbar"><${Tabs} items=${[{id:'overview',label:t('总览')},{id:'matches',label:t('进行中对局')},{id:'matching',label:t('匹配与房间')},{id:'players',label:t('玩家')},{id:'messages',label:t('服务器通知')}]} value=${tab} onChange=${next=>changeTab(next)}/>
        <div class="ad-live" role="status"><span class=${`ad-live__dot ${error||hidden?'is-stale':''}`}></span><span>${hidden?t('页面隐藏，刷新已暂停'):error?t('数据未更新'):t('每 3 秒刷新')}</span><${Button} size="sm" icon="refresh" title=${t('立即刷新')} aria-label=${t('立即刷新')} disabled=${updating||hidden} onClick=${()=>setRefresh(v=>v+1)} square/></div></div>
      ${error?html`<div class="ad-error ad-error--bar" role="alert">${error} · ${t('保留最近一次数据，将自动重试')}</div>`:null}
      ${!overview?html`<p class="ad-empty" role="status">${error?t('等待重新连接服务器'):t('正在读取服务器状态')}</p>`:tab==='messages'?html`<${ServerMessageEditor} state=${overview.serverMessage} supported=${overview.capabilities?.serverMessage} connected=${!error && overview.connection?.ok!==false} api=${api}
        onChanged=${next=>{setOverview(v=>({...v,serverMessage:next}));setRefresh(v=>v+1);}} onExpired=${()=>{setAuth('login');setOverview(null);setList(null);setLoginError(t('登录已过期，请重新输入管理员口令'));}}/>`:tab==='overview'?html`<${Overview} data=${overview} onTab=${changeTab}/>`:html`
        <section class="ad-section ad-list"><div class="ad-list-tools">${tab==='matching'?html`<${Tabs} size="sm" items=${[{id:'queue',label:t('匹配队列')},{id:'rooms',label:t('全部房间')}]} value=${matching} onChange=${next=>{setMatching(next);setList(null);setPage(1);}}/>`:html`<h2>${tab==='matches'?t('进行中对局'):t('玩家会话')}</h2>`}
          <div class="ad-filters">${tab==='players'?html`<${Select} label=${t('玩家状态')} value=${status} options=${['all','online','disconnected','match','queue','waiting','lobby','spectating'].map(value=>({value,label:value==='all'?t('全部状态'):stateLabel(value)}))} onChange=${next=>{setStatus(next);setPage(1);setList(null);}}/>`:null}
            <label class="ad-search"><${Icon} name="search"/><input type="search" aria-label=${t('搜索昵称或同盟密钥')} placeholder=${t('搜索昵称或同盟密钥')} value=${query} maxLength="80" onInput=${e=>setQuery(e.currentTarget.value)}/></label></div></div>
          <p class="ad-note">${tab==='players'?t('按账户去重；未过期的断线会话单独保留。'):t('点击条目展开成员；时长包含暂停与等待。')}</p>
          <div class="ad-list-items">${!list?html`<p class="ad-empty">${t('正在读取列表')}</p>`:list.items.length?list.items.map(row=>html`<${ListRow} key=${`${kind}:${row.id}`} kind=${kind} row=${row} now=${list.at}/>`)
            :html`<div class="ad-empty"><${Icon} name="search"/><strong>${search||status!=='all'?t('没有符合条件的记录'):t('当前没有记录')}</strong><span>${t('新状态将在下次刷新时显示')}</span></div>`}</div>
          ${list?html`<div class="ad-pagination"><span class="ad-muted">${t('共 {n} 条',{n:list.total})}</span><div><${Button} size="sm" disabled=${list.page<=1} onClick=${()=>setPage(list.page-1)}>${t('上一页')}</${Button}><span>${list.page} / ${list.pages}</span><${Button} size="sm" disabled=${list.page>=list.pages} onClick=${()=>setPage(list.page+1)}>${t('下一页')}</${Button}></div></div>`:null}</section>`}
      ${overview?html`<footer class="ad-footer"><span>v${overview.server.version} · ${overview.server.build}<span class="ad-footer__sep">/</span>${t('运行时长')} ${elapsed(overview.at-overview.server.uptimeSec*1000,overview.at)}</span>
        <span>${t('更新于')} <time>${new Date(overview.at).toLocaleTimeString()}</time></span></footer>`:null}</main>`}
  </div>`;
}
await initLang();
render(html`<${Dashboard}/>`,document.getElementById('app'));
