import {useState} from '../../vendor/hooks.module.js';
import {html,Button,Icon,Modal} from '../ui/components.js';
import {t} from '../../../shared/i18n.js';

export function playerState(value) {
  return ({online:t('在线'),offline:t('离线'),disconnected:t('已断线'),lobby:t('大厅'),waiting:t('等待室'),
    queue:t('匹配中'),match:t('对局中'),spectating:t('观战中'),unknown:t('状态未知')})[value] || value || '—';
}
const date=value=>Number.isFinite(value)?new Date(value).toLocaleString():'—';
export function PlayerRow({row,connected,canRecover,api,onExpired,Person}) {
  const [stage,setStage]=useState(null),[busy,setBusy]=useState(false),[code,setCode]=useState(''),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  const persistent=!!row.persistent,publicId=row.publicId;
  const temporary=row.persistent===false;
  const close=()=>{if(!busy){setStage(null);setCode('');setError('');setCopied(false);}};
  const places=row.locations || [];
  async function issue() {
    if(busy||!connected||!canRecover)return;
    setBusy(true);setError('');
    try {
      const result=await api('player-recovery',{body:{publicId,name:row.name}});
      setCode(result.code);setStage('code');
    }catch(e){
      if(e.status===401)onExpired();
      else setError(e.status===409?t('玩家资料已变更，请关闭窗口并刷新列表后重试。'):e.status===404?t('账户不存在，请刷新列表。'):e.status===503?t('服务暂时不可用，无法确认签发结果；请勿连续重试。'):e.message);
    }finally{setBusy(false);}
  }
  async function copy() {
    try{await navigator.clipboard.writeText(code);setCopied(true);setError('');}
    catch{setError(t('无法自动复制，请选择恢复码并手动复制。'));}
  }
  return html`<article class="ad-list-row ad-list-row--player ad-list-row--account">
    <div class="ad-account-identity"><${Person} p=${row} showConnection=${false}/><span class="ad-account-id">${publicId?`ID ${publicId}`:temporary?t('临时玩家'):t('会话玩家')}</span></div>
    <span class=${`ad-tag ${connected&&row.connected?'':'ad-tag--warn'}`}>${playerState(connected?row.state:'unknown')}</span>
    <div class="ad-account-context"><span>${row.roomCode?`${t('同盟')} ${row.roomCode}`:row.matchId?t('公共匹配对局'):!connected?t('状态未知'):row.connected?t('当前无对局'):t('当前离线')}${places.length>1?` · ${t('{n} 处活动',{n:places.length})}`:''}</span>
      <small>${row.lastSeen?t('最近会话 {time}',{time:date(row.lastSeen)}):persistent?t('创建于 {time}',{time:date(row.createdAt)}):t('仅保留当前会话')}</small></div>
    <div class="ad-account-actions">${publicId?html`<a class="btn btn--secondary btn--sm" href=${`/?doctor=${encodeURIComponent(publicId)}`} target="_blank" rel="noopener noreferrer"><${Icon} name="user"/>${t('查看档案')}</a>`:null}
      <${Button} size="sm" square icon="dots" aria-label=${t('管理 {name}',{name:row.name || publicId || t('临时玩家')})} onClick=${()=>setStage('actions')}/></div>
    <${Modal} open=${!!stage} title=${stage==='confirm'?t('签发恢复码'):stage==='code'?t('新的恢复码'):t('玩家管理')} micro="PLAYER MANAGEMENT" utility width="560px" onClose=${busy?undefined:close} class="ad-player-modal"
      actions=${stage==='confirm'?html`<${Button} disabled=${busy} onClick=${()=>{setStage('actions');setError('');}}>${t('返回')}</${Button}><${Button} variant="danger" icon="key" loading=${busy} disabled=${!connected||!canRecover} onClick=${issue}>${t('确认签发')}</${Button}>`:html`<${Button} onClick=${close}>${t('完成')}</${Button}>`}>
      <div class="ad-player-target"><strong>${row.name || t('未命名博士')}</strong><span>${publicId?`ID ${publicId}`:temporary?t('临时玩家'):t('会话玩家')}</span></div>
      ${stage==='actions'?html`<dl class="ad-player-facts"><div><dt>${t('连接状态')}</dt><dd>${playerState(connected?row.state:'unknown')}</dd></div>
        <div><dt>${t('保留会话')}</dt><dd>${row.sessionCount || 0}</dd></div>${persistent?html`<div><dt>${t('账户创建时间')}</dt><dd>${date(row.createdAt)}</dd></div>`:null}</dl>
        ${places.length?html`<ul class="ad-player-places">${places.map((p,i)=>html`<li key=${i}><span>${playerState(p.state)}</span><span>${p.roomCode?`${t('同盟')} ${p.roomCode}`:p.matchId?t('公共匹配对局'):'—'}</span></li>`)}</ul>`:null}
        ${persistent?html`<${Button} variant="danger" size="sm" icon="key" disabled=${!connected||!canRecover} onClick=${()=>setStage('confirm')}>${t('生成新恢复码')}</${Button}>`:html`<p class="ad-note">${temporary?t('临时玩家没有持久账户，无法签发恢复码。'):t('游戏服务尚未更新，当前仅显示在线及断线保留会话；全部账户与恢复码功能将在游戏更新后启用。')}</p>`}
        ${persistent&&(!connected||!canRecover)?html`<p class="ad-error">${t('账户服务未连接，暂时无法签发。')}</p>`:null}`:stage==='confirm'?html`
        <p>${t('新码会立即替换旧恢复码，使用一次后失效；不会退出已有登录设备。')}</p>
        <p class="ad-note">${t('请确认玩家身份后再签发，仅将恢复码私下交给本人。恢复码只在本次窗口显示。')}</p>`:stage==='code'?html`
        <p>${t('已签发新恢复码，请复制并私下交给本人。')}</p><label class="ad-recovery-code"><span>${t('恢复码')}</span><input aria-label=${t('恢复码')} readonly value=${code} onFocus=${e=>e.currentTarget.select()}/></label>
        <${Button} size="sm" icon="copy" onClick=${copy}>${copied?t('已复制'):t('复制恢复码')}</${Button}>
        <p class="ad-note">${t('关闭窗口后无法再次查看。旧恢复码已失效，当前登录不受影响。')}</p>`:null}
      ${error?html`<p class="ad-error" role="alert">${error}</p>`:null}
    </${Modal}>
  </article>`;
}
