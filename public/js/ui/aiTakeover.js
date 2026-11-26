import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, useTicker } from './components.js';
import { useStore } from '../store.js';
import { net } from '../net.js';
import { toast, toastError } from './toasts.js';
import { RoomVoteControl, VoteCard } from './roomVotes.js';
import { t } from '../../../shared/i18n.js';
export function AiTakeoverPanel() {
  const room = useStore(s => s.room), pub = useStore(s => s.match.public), myId = useStore(s => s.me.playerId);
  const connected = useStore(s => s.connection.status === 'online');
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [finished, setFinished] = useState([]);
  const previous = useRef([]);
  const requests = room?.aiTakeoverVotes || [];
  useTicker(requests.length ? 250 : 0);
  const now = net.serverNow();
  const enabled = !!room && room.aiTakeoverEnabled === true && room.mode === 'coop' && room.content?.vanilla !== false;
  const spectator = !!room?.spectators?.some(s => s.playerId === myId);
  const players = pub?.players || [];
  const bots = players.filter(p => p.isBot && p.alive && !p.left);
  const relevant = requests.filter(v => v.applicantId === myId || v.eligible.includes(myId));
  const live = relevant.filter(v => v.expiresAt > now);
  const mayApply = enabled && connected && spectator && pub?.phase === 'PREP' && bots.length > 0;
  const resetKey = `${room?.code}:${pub?.phase}:${pub?.round}:${!!pub?.paused}`;
  useEffect(() => { previous.current = []; setFinished([]); setOpen(false); }, [resetKey]);
  useEffect(() => {
    const ended = previous.current.filter(v => !requests.some(next => next.id === v.id)).map(v => {
      const seat = players.find(p => p.playerId === v.botId);
      const status = seat && !seat.isBot ? t('接替成功') : now >= v.expiresAt ? t('申请已过期') : t('申请已结束');
      return { ...v, status, target: Number.isInteger(seat?.seat) ? `P${seat.seat + 1}` : v.botId };
    });
    if (ended.length) { setFinished(ended); for (const v of ended) toast(v.status, 'info'); }
    previous.current = relevant;
  }, [requests, players, myId]);
  const run = async (kind, body) => { if (busy) return; setBusy(true); try { await net.request(kind, body); } catch (e) { toastError(e); } finally { setBusy(false); } };
  const name = id => players.find(p => p.playerId === id)?.name || room?.seats?.find(p => p?.playerId === id)?.name || id;
  const visible = enabled && connected && (mayApply || relevant.length > 0 || open);
  return html`<${RoomVoteControl} title=${t('AI 协作')} icon="users" badge=${live.length} testId="ai-collaboration"
    visible=${visible} resetKey=${resetKey} onOpenChange=${value => { setOpen(value); if (!value) setFinished([]); }}>
    ${mayApply ? html`<div class="room-vote-requests">
      <p>${t('观战者申请接替AI，同房间在线且未托管的真人过半同意后在休整期加入；无合格队友时由在线房主决定。')}</p>
      ${bots.map(p => html`<${Button} key=${p.playerId} disabled=${busy || requests.some(v => v.botId === p.playerId || v.applicantId === myId)}
        onClick=${() => run('room.aiRequest', { botId: p.playerId })}>${t('申请接替')} P${p.seat + 1} · ${p.name}<//>`)}
    </div>` : null}
    ${relevant.map(v => html`<${VoteCard} key=${v.id} title=${`${v.applicantName} → ${name(v.botId)}`} yes=${v.yes} no=${v.no}
      eligible=${v.eligible} required=${Math.floor(v.eligible.length / 2) + 1} players=${players} myId=${myId}
      note=${html`${t('过半同意后接替 AI')} · ${now >= v.expiresAt ? t('申请已过期') : t('剩余 {seconds} 秒', { seconds: Math.max(0, Math.ceil((v.expiresAt - now) / 1000)) })}`}>
      ${v.eligible.includes(myId) ? html`<${Button} variant=${v.yes.includes(myId) ? 'primary' : 'default'}
        disabled=${busy || pub?.phase !== 'PREP' || now >= v.expiresAt} aria-pressed=${v.yes.includes(myId)} onClick=${() => run('room.aiVote', { voteId: v.id, approve: true })}>${t('同意')}<//>
        <${Button} variant=${v.no.includes(myId) ? 'danger' : 'default'} disabled=${busy || pub?.phase !== 'PREP' || now >= v.expiresAt} aria-pressed=${v.no.includes(myId)}
          onClick=${() => run('room.aiVote', { voteId: v.id, approve: false })}>${t('不同意')}<//>` : null}
    <//>`)}
    ${finished.map(v => html`<p key=${v.id} class="room-vote-result" role="status">${v.applicantName} → ${v.target} · ${v.status}</p>`)}
    <p class="room-vote-panel__note">${t('申请在退出、断线、投票资格或阶段变化时取消。接替后的席位数据含 AI 此前表现，不计入你的个人统计或奖励。')}</p>
  <//>`;
}
