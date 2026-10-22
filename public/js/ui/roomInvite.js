// Invitation feedback uses the same lifecycle as main.js's pending deep-link join.
import {html,Modal,Button,Icon,Spinner,useTicker} from './components.js';
import {useStore} from '../store.js';
import {CLIENT_ERR_TEXT} from '../net.js';
import {t} from '../../../shared/i18n.js';

export const inviteActive=s=>!!(s.session.entered&&s.ui.pendingJoin&&!s.room&&!s.match.public);

/** Status is based on the socket and the actual request, never an optimistic room membership. */
export function inviteStatus(conn,busy,error,spectate=false){
 if(error)return{text:t(error.text),retry:true,failed:true};
 if(conn.status==='closed')return{text:t(conn.lastError?.text||'连接已关闭'),retry:true,failed:true};
 if(conn.status==='connected'&&conn.lastError)return{text:t(conn.lastError.text),retry:true,failed:true};
 if(busy||conn.status==='online')return{text:spectate?t('正在进入观战…'):t('正在加入同盟…'),retry:false,failed:false};
 if(conn.status==='reconnecting')return{text:t('连接中断，正在重连…'),retry:true,failed:false};
 if(conn.status==='handshaking'||conn.status==='connected')return{text:t('正在确认博士身份…'),retry:false,failed:false};
 return{text:t('正在连接服务器…'),retry:false,failed:false};
}

export function RoomInviteHost({onCancel,onRetry,onSpectate}){
 const open=useStore(inviteActive),conn=useStore(s=>s.connection),ui=useStore(s=>s.ui);
 useTicker(open&&conn.status==='reconnecting'?500:0);
 const status=inviteStatus(conn,ui.pendingJoinBusy,ui.pendingJoinError,ui.pendingSpectate);
 const refresh=conn.lastError?.text===CLIENT_ERR_TEXT.VERSION;
 const canSpectate=ui.pendingJoinError?.code==='ACCOUNT_ACTIVE'&&!ui.pendingSpectate;
 const seconds=Math.max(0,Math.ceil((conn.retryAt-Date.now())/1000));
 return html`<${Modal} open=${open} title=${ui.pendingSpectate?t('进入观战'):t('加入同盟')} micro="ALLIANCE INVITATION"
   utility=${true} class="room-invite" width="min(6.4rem, 94vw)" closeOnBackdrop=${false} onClose=${ui.pendingJoinBusy?undefined:onCancel}
   actions=${html`${canSpectate?html`<${Button} variant="primary" icon="eye" data-testid="invite-spectate" onClick=${onSpectate}>${t('改为观战')}<//>`:null}
    ${status.retry&&!ui.pendingJoinBusy&&!canSpectate?html`<${Button} variant="primary" icon="refresh" data-testid="invite-retry"
     onClick=${refresh?()=>location.reload():onRetry}>${refresh?t('刷新页面'):t('重试')}<//>`:null}
    <${Button} variant="secondary" disabled=${ui.pendingJoinBusy} data-testid="invite-cancel" onClick=${onCancel}>${status.failed?t('返回大厅'):t('取消邀请')}<//>`}>
   <div class="room-invite__key"><span><${Icon} name="key" />${t('同盟密钥')}</span><b class="num">${ui.pendingJoin}</b></div>
   <div class=${`room-invite__status${status.failed?' room-invite__error':''}`} role=${status.failed?'alert':'status'} aria-live="polite">
    ${status.failed?html`<${Icon} name="warn" />`:html`<${Spinner} size="sm" />`}<strong>${status.text}</strong>
   </div>
   <p class="room-invite__hint">${canSpectate?t('请返回原页面继续游玩，或在此页面观战。')
     :ui.pendingJoinError?.code==='ROOM_NOT_FOUND'?t('请与房主核对密钥，同盟结束后邀请链接即失效。')
     :ui.pendingJoinError?t('可以重试，或返回大厅选择其他同盟。')
       :ui.pendingJoinBusy?t('正在等待服务器确认，请稍候。')
         :ui.pendingSpectate?t('连接成功后将自动观战，不占用博士席位。'):t('连接成功后将自动加入此同盟。')}</p>
   ${conn.status==='reconnecting'&&!ui.pendingJoinError?html`<p class="room-invite__hint num">${t('第 {attempt} 次 · {secs}s',{attempt:conn.attempt,secs:seconds})}</p>`:null}
  <//>`;
}
