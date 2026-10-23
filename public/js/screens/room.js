import { PageHeader, PageHeading } from '../ui/pageHeader.js';
import {profileAvatarUrl} from '../ui/assetUrls.js';
import {useData as useAvatarData} from '../data.js';
import { CommunicationDock, CommunicationBubble } from '../ui/communication.js';
import { RoomOptionsPage, RoomConfigSummary } from '../ui/roomOptions.js';
import { prepChoiceMultiplier } from '../ui/prepTime.js';
// Room screen (同盟等待室): 4 seat cards (avatar frame, name, ready state, AI badge, host crown),
// host controls (difficulty picker, add/remove AI in co-op, optional teammate matchmaking), invite code with copy
// code / copy link, ready toggle and leave.
//
// Start rule (server/lobby.js): without matchmaking, room.start needs every *other* human connected and ready; the
// host's start counts as the host's ready. With matchmaking selected, the same 立即开始 action sends match.join
// for the whole connected human party and waits for four real players; rooms with AI must remove it first.
// Solo rooms show a single seat.
// Spectator seats (community report #26, a remake feature): a co-op room with spectators shows the 观战席 strip under
// the seats — names, offline marks, the host's ✕ (room.removeSpectator) — and a spectator's own view swaps the ready
// button for 观战中 and offers 入座 (room.join of the room) while a player seat is free.
// Plugins (DESIGN §32 P1a): the configuration page contains the gameplay tab (ui/pluginPanel.js:
// the host switches the room's plugins, everybody else reads them). With gameplay plugins (§32.6: a content set of its
// own — the tag reads 「非官方」 too) every seat shows whether its page has loaded and checked the room's content
// (seats[].content: 载入中 / 就绪 / 校验失败), 准备就绪 and 开始模拟 wait for it (the server refuses them before:
// CONTENT_NOT_READY), and a plugin mode the host chose shows beside the difficulty.
// Texts go through t() (docs/I18N.md).

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { DIFFICULTY_NAMES, MAX_SEATS, MAX_SPECTATORS } from '../../../shared/constants.js';
import {
  html, Button, Icon, MicroLabel, AvatarFrame, DifficultyTag, Tooltip, Modal, confirmDialog,
} from '../ui/components.js';
import { toast, toastError } from '../ui/toasts.js';
import { copyText } from '../ui/clipboard.js';
import { openStats } from './stats.js';
import { LoadoutButton } from './loadout.js';
import { roomRulesLabel, isModdedRoom } from '../ui/pluginTag.js';
import { hasScriptConsent, rememberScriptConsent } from '../content.js';
import { net } from '../net.js';
import { store, useStore, shallowEqual, emptyMatch, isSpectating } from '../store.js';
import { difficultyInfo } from './lobby.js';
import { data, useData } from '../data.js';
import { cardOperators, seatPortrait } from '../ui/seatArt.js';
import { useMyCard, setCardOperator } from '../ui/playerCard.js';
import { PortraitPicker } from '../ui/opPicker.js';
import { useRise } from '../ui/transitions.js';
import { t, tc } from '../../../shared/i18n.js';

/**
 * Seats padded to the room's capacity (co-op 4, solo 1), each null or a seat record.
 * @param {any} room room.state payload
 * @returns {(null | {seat:number, playerId:any, name:string, isBot:boolean, ready:boolean, connected:boolean})[]}
 */
export function normalizeSeats(room) {
  const cap = room?.mode === 'solo' ? 1 : MAX_SEATS;
  const src = Array.isArray(room?.seats) ? room.seats : [];
  const out = [];
  for (let i = 0; i < cap; i++) {
    const s = src[i];
    out.push(s && typeof s === 'object' ? { ...s, seat: Number.isInteger(s.seat) ? s.seat : i } : null);
  }
  return out;
}

/**
 * Derived room facts for the local player.
 * @param {any} room
 * @param {any} myId
 */
export function roomFacts(room, myId) {
  const seats = normalizeSeats(room);
  const occupied = seats.filter(Boolean);
  const humans = occupied.filter((s) => !s.isBot);
  const mine = occupied.find((s) => s.playerId === myId) || null;
  const isHost = room?.hostId != null && room.hostId === myId;
  const others = humans.filter((s) => s.playerId !== myId);
  // The host never readies: starting the match is the host's ready (server rule), so the count
  // treats the host as ready — "已就绪 0/1" next to "准许进入模拟" would contradict itself.
  const isReady = (s) => !!s.ready || s.playerId === room?.hostId;
  const readyHumans = humans.filter(isReady).length;
  const othersReady = others.every((s) => s.ready && s.connected !== false);
  // a room with gameplay plugins (DESIGN §32.6): every player's page has loaded and checked its content (the host's too)
  const modded = isModdedRoom(room);
  const contentReady = !modded || humans.every((s) => s.content === 'ready');
  return {
    seats, occupied, humans, mine, isHost, readyHumans, isReady,
    emptySeats: seats.filter((s) => !s).length,
    canStart: isHost && othersReady && !!mine && contentReady && (!room?.content?.trusted || humans.every(s => room.content.trusted.consent[s.seat])),
    othersReady,
    modded,
    contentReady,
    myContent: modded ? (mine?.content || 'loading') : 'ready',
    // spectator seats (never players: not in `humans`, never counted for ready / start)
    spectators: Array.isArray(room?.spectators) ? room.spectators.filter((s) => s && typeof s === 'object') : [],
    spectating: isSpectating(room, myId),
  };
}

/**
 * The co-op room option 「AI 队友最后选择」 (GitHub #338; room.setAiPicksLast, room.state.aiPicksLast): in the strategy and
 * 机变 drafts every human picks before the AI teammates. null in a solo room (no AI teammates); otherwise its state (off
 * when the server sends none) and whether this player may switch it — the host only, the others see it read-only.
 * @param {any} room room.state payload
 * @param {any} myId
 * @returns {{ on: boolean, editable: boolean } | null}
 */
export function aiLastOption(room, myId) {
  if (!room || room.mode === 'solo') return null;
  return { on: room.aiPicksLast === true, editable: room.hostId != null && room.hostId === myId };
}

/** Invite link for a room code (current page URL with ?room=CODE). */
export function inviteLink(code) {
  const loc = globalThis.location;
  const base = loc ? `${loc.origin}${loc.pathname}` : '';
  return `${base}?room=${encodeURIComponent(code)}`;
}

/**
 * Copy text to the clipboard (async API with a textarea fallback for insecure contexts). Moved to ui/clipboard.js so
 * 干员调配 can use it without importing this screen (which imports loadout.js): re-exported here for existing callers.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export { copyText };

function SeatCard({ seat, index, room, facts, myId, busy, onAddBot, onRemoveBot, onKick, searching, portraits, onPickCard, onPickAvatar }) {
  const [bad, setBad] = useState([]);
  // A new choice (or refreshed manifest) gets a fresh request, even if that art failed before deployment.
  useEffect(() => setBad([]), [seat?.card?.charId, portraits?.m]);
  const flash = useRise(!!seat && (seat.ready || seat.isBot || seat.playerId === room.hostId));
  return html`<${SeatCardView} seat=${seat} index=${index} room=${room} facts=${facts} myId=${myId} busy=${busy}
    onAddBot=${onAddBot} onRemoveBot=${onRemoveBot} onKick=${onKick} searching=${searching} portraits=${portraits}
    bad=${bad} onBad=${(src) => setBad((prev) => prev.includes(src) ? prev : [...prev, src])} flash=${flash} onPickCard=${onPickCard} onPickAvatar=${onPickAvatar} />`;
}

/** Hook-free seat presentation: the existing room handlers remain the only source of actions. */
export function SeatCardView({ seat, index, room, facts, myId, busy, onAddBot, onRemoveBot, onKick, searching, portraits, bad = null, onBad = () => {}, flash = false, onPickCard, onPickAvatar }) {
  if (!seat) {
    const invitable = room.mode !== 'solo' && !facts.spectating;
    return html`<article class=${`rseat rseat--empty${searching ? ' is-searching' : ''}`} style=${`--i:${index}`}>
      <span class="rseat__clip" aria-hidden="true"></span>
      <header class="rseat__strip"><span class="num">P${index + 1}</span><i aria-hidden="true"></i></header>
      <div class="rseat__art">
        ${searching
          ? html`<span class="rseat__wait"><svg viewBox="0 0 40 48" aria-hidden="true"><path d="M20 2l5 5-5 5-5-5z" /><rect x="10" y="16" width="14" height="22" rx="3" /><path d="M24 22h10l-4 7 4 7H24" /></svg><small>STRONGHOLD PROTOCOL</small></span>`
          : invitable
            ? html`<button type="button" class="rseat__invite" onClick=${async () => { const ok = await copyText(room.code); toast(ok ? t('已复制同盟密钥 {code}', { code: room.code }) : t('复制失败，请手动复制'), ok ? 'success' : 'warn'); }} title=${t('复制同盟密钥以邀请队友')}>
                <span class="rseat__plus" aria-hidden="true"></span><b>${t('邀请')}</b><small>${t('复制同盟密钥以邀请队友')}</small></button>`
            : html`<span class="rseat__wait"><small>${t('等待博士加入')}</small></span>`}
        <span class="rseat__noinfo" aria-hidden="true">NOINFO</span>
      </div>
      <div class="rseat__plate rseat__plate--empty rseat__actions">
        ${room.mode !== 'solo' && facts.isHost ? html`<${Button} variant="secondary" size="sm" icon="robot" block=${true} disabled=${!!room.matching} loading=${busy === 'add'} onClick=${onAddBot}>${t('添加 AI 队友')}<//>` : null}
      </div>
    </article>`;
  }
  const consent = room.content?.trusted?.consent?.[seat.seat];
  const isMe = seat.playerId === myId;
  const isHostSeat = seat.playerId === room.hostId;
  const offline = seat.connected === false && !seat.isBot;
  const ready = seat.ready || seat.isBot || isHostSeat;
  const preferred = seat.isBot ? null : seatPortrait(seat, portraits);
  const base = seat.isBot ? null : seatPortrait({ ...seat, card: { ...seat.card, charId: seat.card?.charId?.split('@')[0] } }, portraits);
  const failed = (src) => Array.isArray(bad) ? bad.includes(src) : bad === src;
  const src = failed(preferred) ? base : preferred;
  const canPick = isMe && !seat.isBot && !facts.spectating && !room.inMatch;
  const avatar = seat.isBot || !seat.avatarId ? null : profileAvatarUrl(portraits?.m, seat.avatarId);
  return html`<article class=${`rseat${ready ? ' is-ready' : ''}${flash ? ' is-flash' : ''}${isMe ? ' is-me' : ''}${isHostSeat ? ' is-host' : ''}${offline ? ' is-offline' : ''}${seat.isBot ? ' is-bot' : ''}`}
      style=${`--i:${index}`}>
    <span class="rseat__clip" aria-hidden="true"></span>
    ${consent ? html`<span data-testid="script-consented">${t('已同意')}</span>` : null}
    <header class="rseat__strip"><span class="num">P${index + 1}</span><i aria-hidden="true"></i>
      ${canPick && onPickCard ? html`<button type="button" class="rseat__pick" onClick=${onPickCard}
        title=${t('更换立绘')} aria-label=${t('更换立绘')}><${Icon} name="edit" /></button>` : null}
    </header>
    <div class="rseat__art">
      ${src && !failed(src) ? html`<img key=${src} src=${src} alt="" draggable=${false} loading="lazy" onError=${() => onBad(src)} />`
        : html`<span class="rseat__glyph">${seat.isBot ? html`<${Icon} name="robot" />` : [...(seat.name || '?')][0]}</span>`}
      <${CommunicationBubble} playerId=${seat.playerId} />
      ${offline ? html`<span class="rseat__lost"><${Icon} name="wifiOff" />${t('失去信号')}</span>` : null}
      <span class="rseat__state">${ready
        ? html`<span class="rseat__box"><${Icon} name="check" /></span>${isHostSeat ? t('待命中') : t('已就绪')}`
        : html`<span class="rseat__box"></span>${t('准备中')}`}</span>
    </div>
    ${!seat.isBot && !isMe && facts.isHost ? html`<button type="button" class="rseat__kick" disabled=${busy === `kick${index}`}
      onClick=${() => onKick(index, seat.name, seat.playerId)} title=${t('将该博士移出同盟')} aria-label=${t('移出该博士')}><${Icon} name="user" /><${Icon} name="close" /></button>` : null}
    ${seat.isBot && facts.isHost ? html`<button type="button" class="rseat__kick" disabled=${!!room.matching || busy === `rm${index}`}
      onClick=${() => onRemoveBot(index)} title=${t('移除该 AI 队友')} aria-label=${t('移除 AI 队友')}><${Icon} name="close" /></button>` : null}
    <div class="rseat__plate">
      ${canPick && onPickAvatar ? html`<button type="button" class="rseat__avatar" onClick=${onPickAvatar} title=${t('更换头像')} aria-label=${t('更换头像')}>
        <${AvatarFrame} src=${avatar} size="sm" name=${seat.name} seat=${index} self=${true} />
      </button>` : html`<${AvatarFrame} src=${avatar} size="sm" name=${seat.name} seat=${index} bot=${seat.isBot} self=${isMe} />`}
      <div class="rseat__identity"><span class="rseat__who">
        <b class="rseat__name" title=${seat.name || t('博士')}>${seat.name || t('博士')}</b>
        ${isHostSeat || isMe ? html`<span class="rseat__roles">
          ${isHostSeat ? html`<span class="rseat__role rseat__host">${t('创建者')}</span>` : null}
          ${isMe ? html`<span class="rseat__role rseat__me">${t('我')}</span>` : null}
        </span>` : null}
      </span>
      ${facts.modded && !seat.isBot ? html`<span class=${`seat__content is-${seat.content || 'loading'}`} data-testid="seat-content">
      ${seat.content === 'ready' ? t('插件内容就绪') : seat.content === 'failed' ? t('插件内容校验失败') : t('插件内容载入中')}
    </span>` : null}
      </div>
    </div>
  </article>`;
}

/** 观战席: the room's spectators (host: ✕ frees a seat), and 入座 for a spectator while a player seat is free. */
function SpectatorBar({ facts, room, myId, busy, onRemove, onSit, onSpectate }) {
  if (room.mode === 'solo') return null;
  const reason = room.inMatch ? t('模拟已开始') : room.matching ? t('请先取消匹配')
    : facts.spectators.length >= MAX_SPECTATORS ? t('观战席已满')
      : facts.humans.length < 2 ? t('至少保留一名参赛博士') : '';
  return html`<section class="specbar" aria-label=${t('观战席')}>
    <span class="specbar__label"><${Icon} name="eye" />${t('观战席')}<b class="num">${facts.spectators.length}</b><span class="num t-dim">/${MAX_SPECTATORS}</span></span>
    ${facts.spectators.map((s) => html`<span key=${s.playerId} class=${`specbar__who${s.playerId === myId ? ' is-me' : ''}${s.connected === false ? ' is-offline' : ''}`}>
      ${s.connected === false ? html`<${Icon} name="wifiOff" />` : null}${s.name || t('博士')}${s.playerId === myId ? html`<span class="seat__you">${t('你')}</span>` : null}
      ${facts.isHost ? html`<${Button} variant="ghost" size="sm" square=${true} icon="close" loading=${busy === `rs${s.playerId}`}
        onClick=${() => onRemove(s.playerId)} aria-label=${t('移出观战者 {name}', { name: s.name || '' })} title=${t('移出该观战者')} />` : null}
    </span>`)}
    ${facts.spectating && facts.emptySeats > 0 ? html`<${Button} size="sm" icon="user" disabled=${!!room.matching || room.inMatch} loading=${busy === 'sit'} onClick=${onSit} data-testid="room-sit">${t('入座')}<//>` : null}
    ${facts.mine ? html`<${Button} variant="secondary" size="sm" icon="eye" disabled=${!!reason || !!busy} loading=${busy === 'spectate'}
      title=${reason || t('转为观战')} data-testid="room-spectate" onClick=${onSpectate}>${t('转为观战')}<//>` : null}
  </section>`;
}

function InviteBox({ code, name, difficulty }) {
  const copy = async (what) => {
    // the copied link carries an invitation line (#103): 「{name}邀请你加入卫戍协议：盟约【{difficulty}】」
    const invite = t('{name}邀请你加入卫戍协议：盟约【{difficulty}】', { name: name ?? '', difficulty: DIFFICULTY_NAMES[difficulty] ? t(DIFFICULTY_NAMES[difficulty]) : '' });
    const ok = await copyText(what === 'code' ? code : `${inviteLink(code)} ${invite}`);
    if (ok) toast(what === 'code' ? t('已复制同盟密钥 {code}', { code }) : t('已复制邀请链接'), 'success');
    else toast(t('复制失败，请手动复制'), 'warn');
  };
  return html`<div class="invite brackets">
    <div class="invite__label"><${Icon} name="key" /><span>${t('同盟密钥')}</span><${MicroLabel}>ALLIANCE KEY<//></div>
    <div class="invite__code num selectable" aria-label=${t('同盟密钥 {code}', { code })}>${[...String(code)].map((ch, i) => html`<span key=${i}>${ch}</span>`)}</div>
    <div class="invite__btns">
      <${Button} size="sm" icon="copy" onClick=${() => copy('code')}>${t('复制密钥')}<//>
      <${Button} size="sm" icon="link" onClick=${() => copy('link')}>${t('复制链接')}<//>
    </div>
  </div>`;
}

function ConsoleWarning({ open, remaining, busy, onCancel, onConfirm }) {
  const ready = remaining <= 0;
  return html`<${Modal} open=${open} title=${t('启用控制台')} micro="DEVELOPER CONSOLE" tone="red" closeOnBackdrop=${false} utility=${true}
      onClose=${onCancel}
      actions=${html`<${Button} variant="secondary" onClick=${onCancel}>${t('取消')}<//>
        <${Button} variant="danger" icon="terminal" loading=${busy} disabled=${!ready} onClick=${onConfirm}>${ready ? t('确定启用') : t('请等待 {remaining} 秒', { remaining })}<//>`}>
    <div class="console-warning">
      <${Icon} name="warn" class="console-warning__icon" />
      <p>${t('控制台能让玩家给予自己任何装备和干员，这有可能会严重破坏游戏平衡和大幅缩短游戏寿命，仅在必要时启用。')}</p>
      <p class="t-lo">${t('启用后本房间的模拟都可以使用控制台，私人房间将不能再匹配同盟队友。')}</p>
    </div>
  <//>`;
}

/** Use the settings/plugin panel's square slider for every persistent room option. */
function RoomOptionSwitch({ label, checked, disabled, busy = false, hint, onChange }) {
  return html`<${Tooltip} text=${hint}>
    <button type="button" role="switch" aria-checked=${checked ? 'true' : 'false'} aria-label=${label}
        aria-busy=${busy ? 'true' : undefined} class=${`set-toggle room-option-switch${checked ? ' is-on' : ''}`}
        disabled=${disabled || busy} onClick=${() => onChange(!checked)}>
      <i aria-hidden="true"></i><span>${label}</span>
    </button>
  <//>`;
}

/** Co-op: the host toggles this setting; everybody else sees its state read-only. */
function AiLastToggle({ option, busy, onToggle }) {
  if (!option) return null;
  const description = t('策略与机变轮选时，所有博士先于 AI 队友选择');
  return html`<${RoomOptionSwitch} label=${t('AI 队友最后选择')} checked=${option.on}
    disabled=${!option.editable || !!busy} busy=${busy === 'ailast'} onChange=${onToggle}
    hint=${option.editable ? description : `${description} · ${t('由创建者设置')}`} />`;
}

/** Room screen component. */
export function RoomScreen() {
  useAvatarData('assets');
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.me, shallowEqual);
  const conn = useStore((s) => s.connection, shallowEqual);
  const [configDraft, setConfigDraft] = useState(null);
  const [PluginView,setPluginView]=useState(null);
  const seatsRef=useRef(null);
  useEffect(()=>{
    if(configDraft?.tab!=='plugins'||PluginView)return undefined;
    let live=true;import('../ui/pluginPanel.js').then(m=>{if(live)setPluginView(()=>m.PluginPanel);},toastError);
    return()=>{live=false;};
  },[configDraft?.tab,PluginView]);
  useEffect(()=>{
    const el=seatsRef.current;if(!el)return undefined;
    const fit=()=>{
      let cs=getComputedStyle(el);const cards=[...el.querySelectorAll('.rseat')];if(!cards.length)return;
      const px=v=>parseFloat(v)||0;
      const width=el.clientWidth-px(cs.paddingLeft)-px(cs.paddingRight), height=el.clientHeight-px(cs.paddingTop)-px(cs.paddingBottom);
      const narrow=innerWidth<=560, shortLandscape=innerHeight<=560&&innerWidth>innerHeight;
      const normalColumns=room.mode==='solo'?1:narrow?2:cards.length, normalRows=Math.ceil(cards.length/normalColumns);
      // Decide from the expanded plate's minimum budget, not its already-squeezed height: role wrapping otherwise
      // shrinks the portrait again and again. The avatar, host/self badges and an ellipsized name need 128 px.
      const normalOverhead=Math.max(...cards.map(card=>{
        const plate=card.querySelector('.rseat__plate'),s=getComputedStyle(plate);
        return card.querySelector('.rseat__strip').offsetHeight+(plate.querySelector('.seat__content')?80:56)+px(s.marginTop)+px(s.marginBottom);
      }));
      const normalWidth=Math.min((width-px(cs.columnGap)*(normalColumns-1))/normalColumns,
        ((height-px(cs.rowGap)*(normalRows-1))/normalRows-normalOverhead-8)/2);
      const compact=narrow||shortLandscape||normalWidth<128;
      const compactColumns=room.mode==='solo'?1:shortLandscape?4:narrow?2:(width-3*px(cs.columnGap))/4>=134?4:2;
      el.classList.toggle('seats--compact',compact);
      el.style.setProperty('--room-compact-columns',String(compactColumns));
      cs=getComputedStyle(el);
      const overhead=Math.max(...cards.map(card=>{
        const stacked=getComputedStyle(card).display!=='grid';
        return [...card.children].filter(n=>n.classList.contains('rseat__strip')||(stacked&&n.classList.contains('rseat__plate')))
          .reduce((sum,n)=>{const s=getComputedStyle(n);return sum+n.offsetHeight+px(s.marginTop)+px(s.marginBottom);},0);
      }));
      // Narrow screens use two rows: each card must fit its own row, not the full seats region.
      const columns=room.mode==='solo'?1:Math.min(cards.length,cs.gridTemplateColumns.split(/\s+/).length);
      const rows=Math.ceil(cards.length/columns), rowHeight=(height-px(cs.rowGap)*(rows-1))/rows;
      const minimum=compact?24:128;
      const w=Math.max(minimum,Math.floor(Math.min(240,(width-px(cs.columnGap)*(columns-1))/columns,(rowHeight-overhead-8)/2)));
      if(el.style.getPropertyValue('--room-seat-width')!==w+'px')el.style.setProperty('--room-seat-width',w+'px');
    };
    fit();const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(fit):null;
    observer?.observe(el);el.querySelectorAll('.rseat__strip,.rseat__plate').forEach(n=>observer?.observe(n));window.addEventListener('resize',fit);
    return()=>{observer?.disconnect();window.removeEventListener('resize',fit);};
  },[!!room,!!configDraft,room?.mode,room?.seats?.filter(Boolean).length]);
  const artReady = useData('chess', 'assets');
  const portraits = useMemo(() => ({ pool: cardOperators(data.list('chess')), m: data.get('assets') }), [artReady, data.locale()]);
  const myCard = useMyCard();
  const [picking, setPicking] = useState(null);
  const [busy, setBusy] = useState(null);
  const [matchTeammates, setMatchTeammates] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleReadyAt, setConsoleReadyAt] = useState(0);
  const [consoleNow, setConsoleNow] = useState(() => Date.now());
  const alive = useRef(true);
  const inFlight = useRef(false); // synchronous guard against double clicks (state updates are async)
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    if (!consoleOpen) return undefined;
    const id = setInterval(() => setConsoleNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [consoleOpen]);
  useEffect(() => { if (room?.content?.vanilla === false || room?.consoleEnabled || (room?.prepSeconds != null || room?.prepMultiplier != null || (room?.battleSpeed ?? 2) !== 2)) setMatchTeammates(false); }, [room?.content?.vanilla, room?.consoleEnabled, room?.prepSeconds, room?.prepMultiplier, room?.battleSpeed]);

  if (!room) return null;
  const online = conn.status === 'online';
  const coop = room.mode !== 'solo';
  const facts = roomFacts(room, me.playerId);
  const hasBots = facts.occupied.some((s) => s.isBot);
  const canManageConsole = facts.isHost || (room.mode === 'solo' && !!facts.mine);
  const myReady = !!facts.mine?.ready;
  const info = difficultyInfo(room.mode, room.difficulty);

  const run = async (kind, fn) => {
    if (inFlight.current) return;
    if (!online) { toast(t('连接中断，请稍候重试'), 'warn'); return; }
    inFlight.current = true;
    setBusy(kind);
    try { await fn(); } catch (err) { toastError(err); } finally {
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const toggleReady = () => run('ready', () => net.request('room.ready', { ready: !myReady }));
  const start = () => run(matchTeammates ? 'match' : 'start', () => matchTeammates
    ? net.request('match.join', { mode: 'coop', difficulty: room.difficulty })
    : net.request('room.start', {}));
  const cancelQueue = () => run('cancel-match', () => net.request('match.leave', {}));
  const addBot = () => run('add', () => net.request('room.addBot', {}));
  const removeBot = (seat) => run(`rm${seat}`, () => net.request('room.removeBot', { seat }));
  // the host removes a human before the match (community report #17): asked first; the player may join again. The
  // confirmed player's id goes along: if they left and someone else took the seat meanwhile, the server refuses it.
  const kick = async (seat, name, playerId) => {
    if (inFlight.current) return;
    const ok = await confirmDialog({ utility: true, title: t('移出同盟'), text: t('确定将「{name}」移出同盟吗？对方可以凭同盟密钥重新加入。', { name: name || t('博士') }), okText: t('移出'), danger: true });
    if (ok) run(`kick${seat}`, () => net.request('room.kick', { seat, playerId }));
  };
  const openConsole = () => {
    if (room.consoleEnabled || room.matching || !canManageConsole) return;
    setConsoleReadyAt(Date.now() + 5000);
    setConsoleNow(Date.now());
    setConsoleOpen(true);
  };
  const disableConsole = () => run('console-disable', () => net.request('room.console.disable', {}));
  const confirmConsole = () => run('console', async () => {
    if (Date.now() < consoleReadyAt) return;
    await net.request('room.console.enable', {});
    setConsoleOpen(false);
  });
  const cancelConsole = () => setConsoleOpen(false);
  const setAiLast = (on) => run('ailast', () => net.request('room.setAiPicksLast', { on }));
  // spectator seats: the host frees one; a spectator takes a free player seat with room.join of this room
  const removeSpectator = (playerId) => run(`rs${playerId}`, () => net.request('room.removeSpectator', { playerId }));
  const sit = () => run('sit', () => net.request('room.join', { code: room.code }));
  const spectate = async () => {
    if (inFlight.current) return;
    const ok = await confirmDialog({ utility: true, title: t('转为观战'),
      text: facts.isHost ? t('转入观战席后，创建者身份将移交给其他博士。有空位时可以重新入座。')
        : t('转入观战席后仅观看模拟，有空位时可以重新入座。'), okText: t('转为观战') });
    if (ok) run('spectate', () => net.request('room.spectate', { code: room.code }));
  };
  const leave = async () => {
    if (inFlight.current) return;
    const othersHere = facts.humans.some((s) => s.playerId !== me.playerId);
    if (facts.isHost && othersHere) {
      const ok = await confirmDialog({ utility: true, title: t('离开同盟'), text: t('你是同盟的创建者，离开后创建者身份将移交或同盟解散。确定离开吗？'), okText: t('离开'), danger: true });
      if (!ok) return;
    }
    inFlight.current = true;
    setBusy('leave');
    try {
      await net.request('room.leave', {});
    } catch (err) {
      if (err?.code !== 'NOT_IN_ROOM') toastError(err);
    } finally {
      // Leaving locally is always safe: the server either confirmed or no longer has us in the room.
      store.set({ room: null, match: emptyMatch() });
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const statusLine = !online
    ? html`<span class="t-orange"><${Icon} name="wifiOff" />${t('连接中断，正在重连…')}</span>`
    : room.matching
      ? html`<span class="room-match-state"><${Icon} name="signal" />${t('正在寻找同盟队友')} <b class="num">${room.matching.count}/${room.matching.capacity}</b></span>`
    : facts.spectating
      ? html`<span class="t-lo"><${Icon} name="eye" />${t('观战中 · 不占博士席位，模拟开始后可切换观看各位博士')}</span>`
    : !coop
      ? html`<span class="t-mint">${t('*模拟协议已就绪，准许进入模拟')}</span>`
    : facts.modded && !facts.contentReady
      ? html`<span class="t-lo">${t('等待所有博士载入房间的插件内容')}</span>`
    : facts.isHost
      ? facts.canStart
        ? html`<span class="t-mint">${t('*同盟人数达标，准许进入模拟')}</span>`
        : html`<span class="t-lo">${t('等待所有博士准备就绪')}</span>`
      : myReady
        ? html`<span class="t-mint">${t('已就绪 · 等待创建者开始模拟')}</span>`
        : html`<span class="t-lo">${t('准备就绪后，创建者即可开始模拟')}</span>`;

  const currentDraft=(tab='basic')=>({difficulty:room.difficulty,prepChoice:room.prepMultiplier==null?null:room.prepMultiplier===0?0:String(room.prepMultiplier),battleSpeed:room.battleSpeed??2,tab});
  if (configDraft) {
    const readOnly = !facts.isHost || !!room.matching;
    const change = (key, value) => setConfigDraft(d => ({...d, [key]:value}));
    const switchTab=tab=>{
      if(tab===(configDraft.tab||'basic'))return;
      if(tab==='plugins'&&!readOnly)return run('config',async()=>{await net.request('room.setOptions',{difficulty:configDraft.difficulty,prepMultiplier:prepChoiceMultiplier(configDraft.prepChoice),battleSpeed:configDraft.battleSpeed});setConfigDraft(d=>({...d,tab}));});
      setConfigDraft(currentDraft(tab));
    };
    return html`<${RoomOptionsPage} tab=${configDraft.tab||'basic'} onTabChange=${switchTab}
      pluginContent=${PluginView?html`<${PluginView} open=${true} room=${room} myId=${me.playerId} embedded=${true} />`:html`<p>${t('正在读取插件列表…')}</p>`} mode=${room.mode} difficulty=${readOnly?room.difficulty:configDraft.difficulty} onDifficultyChange=${v=>change('difficulty',v)}
      prepChoice=${readOnly?(room.prepMultiplier==null?null:room.prepMultiplier===0?0:String(room.prepMultiplier)):configDraft.prepChoice} onPrepChange=${v=>change('prepChoice',v)}
      battleSpeed=${readOnly?room.battleSpeed:configDraft.battleSpeed} onSpeedChange=${v=>change('battleSpeed',v)} readOnly=${readOnly} disabled=${!!busy || !online}
      onBack=${()=>setConfigDraft(null)} onSave=${()=>run('config',async()=>{await net.request('room.setOptions',{difficulty:configDraft.difficulty,prepMultiplier:prepChoiceMultiplier(configDraft.prepChoice),battleSpeed:configDraft.battleSpeed});setConfigDraft(null);})}>
      ${room.matching?html`<p class="prep-setting__hint">${t('取消匹配后可修改配置')}</p>`:facts.isHost?html`<p class="prep-setting__hint">${t('修改配置后，队友需要重新准备就绪')}</p>`:null}
    <//>`;
  }
  return html`<div class=${`screen room-screen${coop ? ' room-screen--coop' : ''}`}>
    <${PageHeader} onBack=${leave} backTitle=${t('离开同盟')} backBusy=${busy === 'leave'}
      heading=${html`<${PageHeading} title=${coop ? t('同盟模拟') : t('独立模拟')} micro=${coop ? 'ALLIANCE LOBBY' : 'SOLO SIMULATION'}>
        <span class="app-header__separator" aria-hidden="true"></span><${DifficultyTag} difficulty=${room.difficulty} size="lg" />
        ${room.content?.modeId ? html`<span class="room-mode" data-testid="room-mode">${(room.content.modes || []).find((m) => m.id === room.content.modeId)?.name || room.content.modeId}</span>` : null}
      <//>`} />
    ${coop ? html`<section class="room-invitation" aria-label=${t('同盟密钥')}><${InviteBox} code=${room.code} name=${me.name} difficulty=${room.difficulty} /></section>` : null}

    <main ref=${seatsRef} class=${`seats${coop ? '' : ' seats--solo'}`}>
      ${facts.seats.map((s, i) => html`<${SeatCard} key=${s ? `p${s.playerId}` : `e${i}`} seat=${s} index=${i} room=${room} facts=${facts}
        myId=${me.playerId} busy=${busy} onAddBot=${addBot} onRemoveBot=${removeBot} onKick=${kick} searching=${!!room.matching} portraits=${portraits}
        onPickCard=${artReady ? () => setPicking('op') : null} onPickAvatar=${openStats} />`)}
      ${coop ? null : html`<aside class="solo-brief brackets">
        <${MicroLabel} tone="mint">BRIEFING<//>
        <h2>${DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : ''}<span class="num t-dim"> ${info.code}</span></h2>
        <p>${info.desc}</p>
        <ul>
          ${info.effects.map((e) => html`<li key=${e}>${e}</li>`)}
          <li>${t('共')} <b class="num">${info.rounds}</b> ${tc('rounds', '回合')}${info.hidden ? t('，满足条件时进入隐秘核心') : ''}</li>
          <li>${t('独立模拟中休整期与机变阶段不限时')}</li>
        </ul>
      </aside>`}
    </main>
    <${SpectatorBar} facts=${facts} room=${room} myId=${me.playerId} busy=${busy} onRemove=${removeSpectator} onSit=${sit} onSpectate=${spectate} />

    <footer class="room-bar">
      <div class="room-bar__left">
        <${RoomConfigSummary} mode=${room.mode} difficulty=${room.difficulty} prepMultiplier=${room.prepMultiplier} prepSeconds=${room.prepSeconds} battleSpeed=${room.battleSpeed}
          contentLabel=${roomRulesLabel(room)}
          editable=${facts.isHost && !room.matching} disabled=${!!busy} onOpen=${()=>setConfigDraft(currentDraft())} />
        <div class="room-bar__tools">
          <${CommunicationDock} room=${true} disabled=${facts.spectating} />
          ${canManageConsole || room.consoleEnabled ? html`<${RoomOptionSwitch} label=${t('启用控制台')}
            checked=${!!room.consoleEnabled} disabled=${!canManageConsole || (!room.consoleEnabled && !!room.matching) || !online || !!busy}
            busy=${busy === 'console' || busy === 'console-disable'}
            hint=${canManageConsole ? room.consoleEnabled ? t('关闭控制台') : t('启用控制台') : t('由创建者设置')}
            onChange=${(on) => on ? openConsole() : disableConsole()} />` : null}
          <${AiLastToggle} option=${aiLastOption(room, me.playerId)} busy=${busy} onToggle=${setAiLast} />
          ${facts.isHost && coop && !room.matching ? html`<${RoomOptionSwitch} label=${t('匹配同盟队友')}
            checked=${matchTeammates} disabled=${!!room.consoleEnabled || facts.modded || !!busy || (room.prepSeconds != null || room.prepMultiplier != null || (room.battleSpeed ?? 2) !== 2)}
            hint=${room.consoleEnabled ? t('控制台已启用，不能匹配同盟队友') : facts.modded ? t('插件房间不能参加公共匹配') : (room.prepSeconds != null || room.prepMultiplier != null || (room.battleSpeed ?? 2) !== 2) ? t('自定义房间配置仅支持好友 / AI 组队') : null}
            onChange=${setMatchTeammates} />` : null}
        </div>
      </div>
      <div class="room-bar__center">
        <div class="ready-count" hidden=${!coop}>
          <span class="t-lo">${t('已就绪')}</span>
          <b class="num">${facts.readyHumans}</b><span class="num t-dim">/${facts.humans.length}</span>
        </div>
        <div class="room-bar__status">${statusLine}</div>
      </div>
      <div class="room-bar__right">
        <${LoadoutButton} from="room" size="lg" class="room-loadout" label=${t('干员调配')} />
        ${facts.isHost
          ? coop
            ? room.matching
              ? html`<${Button} variant="danger" size="lg" icon="close" loading=${busy === 'cancel-match'} onClick=${cancelQueue}>${t('取消匹配')}<//>`
              : html`<div class="room-match-actions">
                <${Tooltip} text=${(room.prepSeconds != null || room.prepMultiplier != null || (room.battleSpeed ?? 2) !== 2) && matchTeammates ? t('自定义配置的房间仅支持邀请好友或添加 AI') : facts.modded ? t('插件房间不能参加公共匹配') : room.consoleEnabled ? t('控制台已启用，不能匹配同盟队友') : matchTeammates && hasBots ? t('请先移除 AI 队友，再匹配真人队友') : matchTeammates || facts.canStart ? null : t('仍有博士未准备就绪')}>
                  <${Button} variant="primary" size="xl" icon=${matchTeammates ? 'users' : 'play'} loading=${busy === (matchTeammates ? 'match' : 'start')}
                    disabled=${((room.consoleEnabled || facts.modded || hasBots || (room.prepSeconds != null || room.prepMultiplier != null || (room.battleSpeed ?? 2) !== 2)) && matchTeammates) || (!matchTeammates && !facts.canStart) || !online} onClick=${start}>${t('立即开始')}<//>
                <//>
              </div>`
            : html`<${Tooltip} text=${facts.canStart ? null : t('仍有博士未准备就绪')}>
                <${Button} variant="primary" size="xl" icon="play" loading=${busy === 'start'} disabled=${!facts.canStart || !online} onClick=${start}>${t('立即开始')}<//>
              <//>`
          : facts.spectating
            ? html`<${Button} variant="secondary" size="xl" icon="eye" disabled=${true}>${t('观战中')}<//>`
          : html`<${Tooltip} text=${!myReady && facts.myContent !== 'ready' ? t('房间的插件内容载入并通过校验后才能准备') : null}>
              <${Button} variant=${myReady ? 'primary' : 'secondary'} size="xl" icon=${myReady ? 'check' : 'hourglass'} active=${myReady}
              loading=${busy === 'ready'} disabled=${!online || !facts.mine || (!myReady && facts.myContent !== 'ready')} onClick=${toggleReady}>${myReady ? t('已就绪') : t('准备就绪')}<//>
            <//>`}
      </div>
    </footer>
    <${ConsoleWarning} open=${consoleOpen} remaining=${Math.max(0, Math.ceil((consoleReadyAt - consoleNow) / 1000))}
      busy=${busy === 'console'} onCancel=${cancelConsole} onConfirm=${confirmConsole} />
    ${picking === 'op' && facts.mine && !facts.spectating && !room.inMatch ? html`<${PortraitPicker}
      current=${myCard.charId} list=${portraits.pool} m=${portraits.m}
      onPick=${(id) => { setCardOperator(id); setPicking(null); }} onClose=${() => setPicking(null)} />` : null}
  </div>`;
}

/** Persistent across room/game routes, including spectators who never consent. */
export function TrustedNotice() {
  const state = useStore(s => s);
  const room = state.room, cs = room?.content?.cs, trusted = room?.content?.trusted;
  const seat = room?.seats?.find(s => s && s.playerId === state.me?.playerId);
  const [dismissed,setDismissed] = useState(null);
  const [busy,setBusy] = useState(false);
  const [review,setReview] = useState(false);
  const choose = async accept => {
    setBusy(true);
    try {
      if (seat) await net.request('room.consent',{cs,accept});
      rememberScriptConsent(cs,accept);
      setDismissed(cs); setReview(false);
      if (accept && trusted.plugins.some(p => p.permissions.includes('trusted.page'))) {
        const url = new URL(location.href); url.searchParams.set('cs',cs); url.searchParams.set('room',room.code);
        location.assign(url.href); return;
      }
      store.set({room:{...store.get().room}}); // wake the content loader after local persistence
    } catch (e) { toastError(e); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (trusted && seat && hasScriptConsent(cs) && !trusted.consent?.[seat.seat] && !room.inMatch) {
      net.request('room.consent',{cs,accept:true}).catch(toastError);
    }
  },[cs,seat?.seat,!!trusted?.consent?.[seat?.seat]]);
  if (!trusted) return null;
  return html`<aside class="trusted-banner" data-testid="trusted-banner">
    <strong>${t('受信任插件')}</strong>
    <button onClick=${() => setReview(true)}>${t('查看风险与同意状态')}</button>
    <${Modal} open=${review || (dismissed !== cs && !hasScriptConsent(cs))} title=${t('受信任插件')} tone="red" closeOnBackdrop=${false}
      onClose=${() => room.inMatch ? setReview(false) : choose(false)} actions=${html`<${Button} disabled=${busy} onClick=${() => choose(false)} data-testid="script-decline">${t('拒绝')}<//>
        <${Button} disabled=${busy} onClick=${() => choose(true)} data-testid="script-accept">${t('同意运行')}<//>`}>
      <p>${t('它可以完全控制你的游戏页面')}</p>
      <p>${t('仅在你信任所有作者及以下代码时同意。换了内容组合需要重新同意。')}</p>
      <ul>${trusted.plugins.map(p => html`<li key=${p.id}><strong>${p.id} ${p.version}</strong>
        <p>${t('作者：{authors}',{authors:(p.authors || []).join(', ') || '—'})}</p>
        <p class="trusted-hash">SHA-256: ${p.hash}</p><p>${t('权限：{permissions}',{permissions:p.permissions.join(', ')})}</p></li>`)}</ul>
    <//>
  </aside>`;
}
