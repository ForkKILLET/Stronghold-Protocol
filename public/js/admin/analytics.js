import {useEffect,useState} from '../../vendor/hooks.module.js';
import {html,Button} from '../ui/components.js';
import {Select} from '../ui/select.js';
import {analyticsDay,analyticsDate,analyticsRange} from '../../../shared/adminAnalytics.js';
import {t} from '../../../shared/i18n.js';

const number = n => Number.isFinite(n) ? new Intl.NumberFormat().format(n) : '—';
const moment = at => Number.isFinite(at) ? new Intl.DateTimeFormat(undefined,{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'short'}).format(at) : '—';

/** Missing DAU dates split the line; unknown observations must never be plotted as zero. */
export function activitySegments(days) {
  const segments=[];let current=[];
  for(let i=0;i<days.length;i++){
    if(!Number.isFinite(days[i].dau)){if(current.length)segments.push(current);current=[];}
    else current.push({i,value:days[i].dau});
  }
  if(current.length)segments.push(current);
  return segments;
}

function DailyChart({days,activity=false}) {
  const width=720,height=150,left=38,bottom=126,span=width-left-12;
  const values=days.map(d=>activity?d.dau:d.settledGames),max=Math.max(1,...values.filter(Number.isFinite));
  const x=i=>left+(i+.5)*span/Math.max(1,days.length),y=n=>bottom-n/max*(bottom-12);
  const segments=activity?activitySegments(days):[];
  const title=activity?t('每日活跃账户（DAU）'):t('每日已结算对局');
  return html`<section class="ad-section ad-daily-chart"><h2>${title}</h2>
    ${activity&&!values.some(Number.isFinite)?html`<p class="ad-empty">${t('所选日期尚未采集 DAU')}</p>`:html`
      <svg viewBox=${`0 0 ${width} ${height}`} role="img" aria-label=${title}>
        <path class="ad-daily-chart__grid" d=${`M${left} 12H${width-12} M${left} ${bottom}H${width-12}`}/>
        <text x="0" y="17">${number(max)}</text><text x="0" y=${bottom}>0</text>
        ${activity?segments.map((segment,i)=>html`<g key=${i}><polyline class="ad-daily-chart__line" points=${segment.map(p=>`${x(p.i)},${y(p.value)}`).join(' ')}/>
          ${segment.map(p=>html`<circle key=${p.i} class="ad-daily-chart__point" cx=${x(p.i)} cy=${y(p.value)} r="2.5"><title>${days[p.i].date}: ${number(p.value)}</title></circle>`)}</g>`)
          :days.map((d,i)=>html`<rect key=${d.date} class="ad-daily-chart__bar" x=${x(i)-span/days.length*.32} y=${y(d.settledGames)} width=${span/days.length*.64} height=${bottom-y(d.settledGames)}><title>${d.date}: ${number(d.settledGames)}</title></rect>`)}
        <text x=${left} y="146">${days[0]?.date}</text><text x=${width-12} y="146" text-anchor="end">${days.at(-1)?.date}</text>
      </svg>`}
  </section>`;
}

export function Analytics({api,supported,hidden,onExpired}) {
  const [period,setPeriod]=useState('30');
  const [range,setRange]=useState(()=>{const r=analyticsRange();return {from:r.from,to:r.to};});
  const [from,setFrom]=useState(range.from),[to,setTo]=useState(range.to);
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
  useEffect(()=>{
    if(!supported||hidden)return undefined;
    const c=new AbortController();let timer;
    const load=async()=>{
      setBusy(true);
      try{
        const result=await api('analytics?'+new URLSearchParams(range),{signal:c.signal});
        if(!c.signal.aborted){setData(result);setError('');}
      }catch(e){if(!c.signal.aborted){if(e.status===401)onExpired();else setError(e.message);}}
      finally{if(!c.signal.aborted){setBusy(false);timer=setTimeout(load,30000);}}
    };
    void load();return()=>{c.abort();clearTimeout(timer);};
  },[range.from,range.to,supported,hidden,refresh]);
  function preset(value){
    setPeriod(value);if(value==='custom')return;
    const day=analyticsDay(Date.now()),next={from:analyticsDate(day-Number(value)+1),to:analyticsDate(day)};
    setFrom(next.from);setTo(next.to);setRange(next);
  }
  function submit(e){
    e.preventDefault();
    try{analyticsRange({from,to});setRange({from,to});setRefresh(n=>n+1);setError('');}
    catch{setError(t('请选择不超过 366 天且不晚于今天的有效日期范围。'));}
  }
  if(!supported)return html`<section class="ad-section"><h2>${t('多日统计')}</h2><p class="ad-note">${t('游戏服务尚未启用长期统计，请更新游戏服务并启用账户存储。')}</p></section>`;
  const cards=data?[[t('区间活跃账户'),data.totals.activeAccounts],[t('已结算对局'),data.totals.settledGames],
    [t('区间参赛账户'),data.totals.playingAccounts],[t('新增账户'),data.totals.newAccounts]]:[];
  return html`<div class="ad-analytics" aria-busy=${busy}>
    <section class="ad-section"><div class="ad-section__head"><h2>${t('多日统计')}</h2><span class="ad-muted">${t('北京时间（UTC+8）· 每 30 秒更新')}</span></div>
      <form class="ad-date-filter" onSubmit=${submit}>
        <${Select} label=${t('统计范围')} value=${period} options=${[{value:'7',label:t('最近 7 天')},{value:'30',label:t('最近 30 天')},{value:'90',label:t('最近 90 天')},{value:'custom',label:t('自选日期')}]} onChange=${preset}/>
        <label>${t('开始日期')}<input type="date" value=${from} max=${to} required onInput=${e=>{setPeriod('custom');setFrom(e.currentTarget.value);}}/></label>
        <label>${t('结束日期')}<input type="date" value=${to} min=${from} max=${analyticsDate(analyticsDay(Date.now()))} required onInput=${e=>{setPeriod('custom');setTo(e.currentTarget.value);}}/></label>
        <${Button} type="submit" size="sm" loading=${busy}>${t('查询')}</${Button}>
      </form>
      <p class="ad-note">${t('DAU 为当天成功连接游戏的去重账户，包含保持连接的账户；不含 AI、匿名连接及仅浏览公开档案的访客。')}</p>
      <p class="ad-note">${t('参赛人数为当天连接游戏且实际处于对局席位的去重账户，包含当天尚未结算的对局，不含观战席。')}</p>
      <p class="ad-note">${t('对局按结算日期计数，一场多人局只计一场；未结算或强制中止的对局不计。结算玩家数按所选日期内有结算的账户去重。')}</p>
    </section>
    ${error?html`<div class="ad-error ad-error--bar" role="alert">${error}${data?` · ${t('保留最近一次数据，将自动重试')}`:''}</div>`:null}
    ${!data?html`<p class="ad-empty" role="status">${t('正在读取统计数据')}</p>`:html`
      <p class="ad-note">${t('当前展示 {from} 至 {to}',data.range)} · ${t('DAU 开始采集于 {time}',{time:moment(data.coverage.activitySince)})}</p>
      <p class="ad-note">${t('统计更新于 {time}',{time:moment(data.at)})}</p>
      <p class="ad-note">${t('采集前的 DAU 显示 —；采集首日的数字仅包含启用后的活动。今天的数据仍在累计。')}</p>
      <div class="ad-stats">${cards.map(([label,value])=>html`<article class="ad-stat" key=${label}><span class="ad-stat__label">${label}</span><strong>${number(value)}</strong></article>`)}</div>
      <div class="ad-daily-charts"><${DailyChart} days=${data.days} activity/><${DailyChart} days=${data.days}/></div>
      <section class="ad-section"><div class="ad-section__head"><h2>${t('逐日明细')}</h2><span class="ad-muted">${t('同一账户跨日会分别计入当日人数，区间人数不等于逐日人数之和。')}</span></div>
        <div class="ad-table-scroll"><table class="ad-daily-table"><thead><tr><th>${t('日期')}</th><th>DAU</th><th>${t('参赛人数')}</th><th>${t('新增账户')}</th><th>${t('已结算对局')}</th><th>${t('单人模拟')}</th><th>${t('同盟模拟')}</th><th>${t('结算玩家数')}</th></tr></thead>
          <tbody>${[...data.days].reverse().map(d=>html`<tr key=${d.date}><th scope="row">${d.date}${d.partialActivity?html`<span class="ad-tag" title=${t('仅包含启用采集后的活动')}>${t('部分采集')}</span>`:null}</th>
            <td>${number(d.dau)}</td><td>${number(d.playingAccounts)}</td><td>${number(d.newAccounts)}</td><td>${number(d.settledGames)}</td><td>${number(d.soloGames)}</td><td>${number(d.coopGames)}</td><td>${number(d.settledPlayers)}</td></tr>`)}</tbody></table></div>
        ${data.totals.otherGames?html`<p class="ad-note">${t('另有 {n} 场历史对局缺少单人／同盟分类，已计入总对局数。',{n:data.totals.otherGames})}</p>`:null}
      </section>`}
  </div>`;
}
