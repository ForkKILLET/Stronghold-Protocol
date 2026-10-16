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
// Plugins (DESIGN §32 P1a): the tag under the title — 「原版」 or 「插件 ×N」 — opens the 插件 panel (ui/pluginPanel.js:
// the host switches the room's plugins, everybody else reads them). With gameplay plugins (§32.6: a content set of its
// own — the tag reads 「非官方」 too) every seat shows whether its page has loaded and checked the room's content
// (seats[].content: 载入中 / 就绪 / 校验失败), 准备就绪 and 开始模拟 wait for it (the server refuses them before:
// CONTENT_NOT_READY), and a plugin mode the host chose shows beside the difficulty.
// Texts go through t() (docs/I18N.md).

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { DIFFICULTIES, DIFFICULTY_NAMES, DIFFICULTY_COLORS, MAX_SEATS, MAX_SPECTATORS } from '../../../shared/constants.js';
import {
  html, Button, Icon, MicroLabel, PingPill, OnlineCount, AvatarFrame, DifficultyTag, DifficultyIcon, Tooltip, Modal, confirmDialog, doctorNo,
} from '../ui/components.js';
import { toast, toastError } from '../ui/toasts.js';
import { copyText } from '../ui/clipboard.js';
import { GuideButton } from '../ui/guide.js';
import { AnnouncementButton } from '../ui/announcement.js';
import { openStats } from './stats.js';
import { SettingsButton } from '../ui/settings.js';
import { LoadoutButton } from './loadout.js';
import { PluginTag, isModdedRoom } from '../ui/pluginTag.js';
import { hasScriptConsent, rememberScriptConsent } from '../content.js';
import { net } from '../net.js';
import { store, useStore, shallowEqual, emptyMatch, isSpectating } from '../store.js';
import { difficultyInfo } from './lobby.js';
import { data, useData } from '../data.js';
import { cardOperators, seatPortrait, cardAvatarUrl } from '../ui/seatArt.js';
import { useMyCard, setCardOperator, setCardAvatar } from '../ui/playerCard.js';
import { PortraitPicker, AvatarPicker } from '../ui/opPicker.js';
import { useRise } from '../ui/transitions.js';
import { t, tc } from '../../../shared/i18n.js';

/** Room header utilities use the same compact icon-button treatment in solo and co-op rooms. */
export function RoomTools({ coop }) {
  return html`<div class="room-topbar__tools">
    <${Button} variant="secondary" size="sm" square=${true} icon="chart" class="stats-entry" onClick=${openStats}
      title=${t('统计数据')} aria-label=${t('统计数据')} />
    <${SettingsButton} class="room-settings" variant="secondary" square=${true} label=${t('设置')} />
    <${GuideButton} class="room-guide" variant="secondary" square=${true} label=${t('玩法说明')} />
  </div>`;
}

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
      <header class="rseat__strip"><i></i><span class="num">P${index + 1}</span></header>
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
  const avatar = seat.isBot ? null : cardAvatarUrl(seat.card?.avatar, portraits?.m);
  return html`<article class=${`rseat${ready ? ' is-ready' : ''}${flash ? ' is-flash' : ''}${isMe ? ' is-me' : ''}${isHostSeat ? ' is-host' : ''}${offline ? ' is-offline' : ''}${seat.isBot ? ' is-bot' : ''}`}
      style=${`--i:${index}`}>
    <span class="rseat__clip" aria-hidden="true"></span>
    ${consent ? html`<span data-testid="script-consented">${t('已同意')}</span>` : null}
    <header class="rseat__strip"><i></i><span class="num">P${index + 1}</span></header>
    <div class=${`rseat__art${canPick && onPickCard ? ' is-pickable' : ''}`}>
      ${src && !failed(src) ? html`<img key=${src} src=${src} alt="" draggable=${false} loading="lazy" onError=${() => onBad(src)} />`
        : html`<span class="rseat__glyph">${seat.isBot ? html`<${Icon} name="robot" />` : [...(seat.name || '?')][0]}</span>`}
      ${canPick && onPickCard ? html`<button type="button" class="rseat__pick" onClick=${onPickCard}
        title=${t('更换立绘')} aria-label=${t('更换立绘')}><${Icon} name="edit" /><span>${t('更换立绘')}</span></button>` : null}
      ${isHostSeat ? html`<span class="rseat__host">${t('创建者')}</span>` : null}
      ${offline ? html`<span class="rseat__lost"><${Icon} name="wifiOff" />${t('失去信号')}</span>` : null}
      <span class="rseat__state">${ready
        ? html`<span class="rseat__box"><${Icon} name="check" /></span>${isHostSeat && !seat.ready ? t('待命中') : t('已就绪')}`
        : html`<span class="rseat__box"></span>${t('准备中')}`}</span>
    </div>
    ${!seat.isBot && !isMe && facts.isHost ? html`<button type="button" class="rseat__kick" disabled=${busy === `kick${index}`}
      onClick=${() => onKick(index, seat.name, seat.playerId)} title=${t('将该博士移出同盟')} aria-label=${t('移出该博士')}><${Icon} name="user" /><${Icon} name="close" /></button>` : null}
    ${seat.isBot && facts.isHost ? html`<button type="button" class="rseat__kick" disabled=${!!room.matching || busy === `rm${index}`}
      onClick=${() => onRemoveBot(index)} title=${t('移除该 AI 队友')} aria-label=${t('移除 AI 队友')}><${Icon} name="close" /></button>` : null}
    <div class="rseat__plate">
      ${isMe ? html`<span class="rseat__me" title=${t('你')}><${Icon} name="info" /></span>` : null}
      ${canPick && onPickAvatar ? html`<button type="button" class="rseat__avatar" onClick=${onPickAvatar} title=${t('更换头像')} aria-label=${t('更换头像')}>
        <${AvatarFrame} src=${avatar} size="sm" name=${seat.name} seat=${index} self=${true} />
      </button>` : html`<${AvatarFrame} src=${avatar} size="sm" name=${seat.name} seat=${index} bot=${seat.isBot} self=${isMe} />`}
    ${facts.modded && !seat.isBot ? html`<span class=${`seat__content is-${seat.content || 'loading'}`} data-testid="seat-content">
      ${seat.content === 'ready' ? t('插件内容就绪') : seat.content === 'failed' ? t('插件内容校验失败') : t('插件内容载入中')}
    </span>` : null}
      <span class="rseat__who">
        <b class="rseat__name">${seat.name || t('博士')}</b>
      </span>
      <small class="rseat__doc">${seat.isBot ? 'AUTONOMOUS UNIT' : `DOCTOR #${doctorNo(seat.playerId)}`}</small>
    </div>
  </article>`;
}

/** 观战席: the room's spectators (host: ✕ frees a seat), and 入座 for a spectator while a player seat is free. */
function SpectatorBar({ facts, myId, busy, onRemove, onSit }) {
  if (!facts.spectators.length) return null;
  return html`<section class="specbar" aria-label=${t('观战席')}>
    <span class="specbar__label"><${Icon} name="eye" />${t('观战席')}<b class="num">${facts.spectators.length}</b><span class="num t-dim">/${MAX_SPECTATORS}</span></span>
    ${facts.spectators.map((s) => html`<span key=${s.playerId} class=${`specbar__who${s.playerId === myId ? ' is-me' : ''}${s.connected === false ? ' is-offline' : ''}`}>
      ${s.connected === false ? html`<${Icon} name="wifiOff" />` : null}${s.name || t('博士')}${s.playerId === myId ? html`<span class="seat__you">${t('你')}</span>` : null}
      ${facts.isHost ? html`<${Button} variant="ghost" size="sm" square=${true} icon="close" loading=${busy === `rs${s.playerId}`}
        onClick=${() => onRemove(s.playerId)} aria-label=${t('移出观战者 {name}', { name: s.name || '' })} title=${t('移出该观战者')} />` : null}
    </span>`)}
    ${facts.spectating && facts.emptySeats > 0 ? html`<${Button} size="sm" icon="user" loading=${busy === 'sit'} onClick=${onSit}>${t('入座')}<//>` : null}
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

function DifficultyPicker({ room, isHost, busy, onPick }) {
  if (!isHost) {
    return html`<div class="dpick dpick--ro">
      <${DifficultyTag} difficulty=${room.difficulty} size="lg" code=${difficultyInfo(room.mode, room.difficulty).code} />
      <span class="t-dim">${t('由创建者选择')}</span>
    </div>`;
  }
  return html`<div class="dpick" role="radiogroup" aria-label=${t('模拟难度')}>
    ${DIFFICULTIES.map((d) => html`<button key=${d} type="button" role="radio" aria-checked=${room.difficulty === d ? 'true' : 'false'}
        class=${`dpick__opt${room.difficulty === d ? ' is-active' : ''}`} style=${`--d-color:${DIFFICULTY_COLORS[d]}`}
        disabled=${!!busy} onClick=${() => room.difficulty !== d && onPick(d)}>
      <${DifficultyIcon} difficulty=${d} />${t(DIFFICULTY_NAMES[d].replace('模拟', ''))}
    </button>`)}
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

/** The 「AI 队友最后选择」 switch (co-op): the host toggles it, everybody else sees its state. */
function AiLastToggle({ option, busy, onToggle }) {
  if (!option) return null;
  return html`<div class="ailast">
    <${Tooltip} text=${t('策略与机变轮选时，所有博士先于 AI 队友选择')}>
      <button type="button" role="switch" aria-checked=${option.on ? 'true' : 'false'}
          class=${`dpick__opt ailast__opt${option.on ? ' is-active' : ''}`} disabled=${!option.editable || !!busy}
          onClick=${() => option.editable && onToggle(!option.on)}>
        <${Icon} name="check" class=${option.on ? 'is-on' : ''} />${t('AI 队友最后选择')}
      </button>
    <//>
    ${option.editable ? null : html`<span class="t-dim">${t('由创建者设置')}</span>`}
  </div>`;
}

/** Room screen component. */
export function RoomScreen() {
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.me, shallowEqual);
  const conn = useStore((s) => s.connection, shallowEqual);
  const presence = useStore((s) => s.presence, shallowEqual);
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
  useEffect(() => { if (room?.consoleEnabled) setMatchTeammates(false); }, [room?.consoleEnabled]);

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
  const setDifficulty = (difficulty) => run('diff', () => net.request('room.setDifficulty', { difficulty }));
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

  return html`<div class=${`screen room-screen${coop ? ' room-screen--coop' : ''}`}>
    <header class="topbar">
      <div class="topbar__left">
        <${Tooltip} text=${t('离开同盟')} placement="bottom">
          <${Button} variant="danger" size="lg" square=${true} icon="exit" loading=${busy === 'leave'} onClick=${leave} aria-label=${t('离开同盟')} />
        <//>
        <div class="room-ping">
          <div class="connection-status">
            <${PingPill} ms=${conn.ping} online=${online} />
            <${OnlineCount} online=${presence.online} />
            <${AnnouncementButton} variant="ghost" size="sm" class="topbar-announcement" />
          </div>
          <${MicroLabel}>${t('连接状态')}<//>
        </div>
        <${RoomTools} coop=${coop} />
      </div>
      <div class="topbar__center">
        <${MicroLabel} tone="mint">${coop ? 'ALLIANCE LOBBY' : 'SOLO SIMULATION'}<//>
        <h1 class="topbar__title">${coop ? t('同盟模拟') : t('独立模拟')}<span class="topbar__sep"></span><${DifficultyTag} difficulty=${room.difficulty} size="lg" />
          ${room.content?.modeId ? html`<span class="room-mode" data-testid="room-mode">${(room.content.modes || []).find((m) => m.id === room.content.modeId)?.name || room.content.modeId}</span>` : null}</h1>
        <${PluginTag} room=${room} myId=${me.playerId} />
      </div>
      <div class="topbar__right">
        ${coop ? html`<${InviteBox} code=${room.code} name=${me.name} difficulty=${room.difficulty} />` : html`<div class="solo-note"><${MicroLabel}>SINGLE OPERATOR<//><span>${t('仅限 1 名博士')}</span></div>`}
      </div>
    </header>

    <main class=${`seats${coop ? '' : ' seats--solo'}`}>
      ${facts.seats.map((s, i) => html`<${SeatCard} key=${s ? `p${s.playerId}` : `e${i}`} seat=${s} index=${i} room=${room} facts=${facts}
        myId=${me.playerId} busy=${busy} onAddBot=${addBot} onRemoveBot=${removeBot} onKick=${kick} searching=${!!room.matching} portraits=${portraits}
        onPickCard=${artReady ? () => setPicking('op') : null} onPickAvatar=${artReady ? () => setPicking('avatar') : null} />`)}
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
    <${SpectatorBar} facts=${facts} myId=${me.playerId} busy=${busy} onRemove=${removeSpectator} onSit=${sit} />

    <footer class="room-bar">
      <div class="room-bar__left">
        <span class="room-bar__label">${t('模拟难度')}<${MicroLabel}>DIFFICULTY<//></span>
        <${DifficultyPicker} room=${room} isHost=${facts.isHost} busy=${busy} onPick=${setDifficulty} />
        ${canManageConsole ? html`<${Button} variant=${room.consoleEnabled ? 'danger' : 'secondary'} size="lg" icon="terminal"
          class="room-console-btn" disabled=${(!room.consoleEnabled && !!room.matching) || !online} onClick=${room.consoleEnabled ? disableConsole : openConsole}
          title=${room.consoleEnabled ? t('关闭控制台') : t('启用控制台')}>${room.consoleEnabled ? t('关闭控制台') : t('启用控制台')}<//>`
          : room.consoleEnabled ? html`<span class="room-console-status"><${Icon} name="terminal" />${t('控制台已启用')}</span>` : null}
          <${AiLastToggle} option=${aiLastOption(room, me.playerId)} busy=${busy} onToggle=${setAiLast} />
      </div>
      <div class="room-bar__center">
        <div class="ready-count" hidden=${!coop}>
          <span class="t-lo">${t('已就绪')}</span>
          <b class="num">${facts.readyHumans}</b><span class="num t-dim">/${facts.humans.length}</span>
          <span class="ready-count__icons" aria-hidden="true">
            ${facts.humans.map((s) => html`<${Icon} key=${s.playerId} name="user" class=${facts.isReady(s) ? 'is-on' : ''} />`)}
          </span>
        </div>
        <div class="room-bar__status">${statusLine}</div>
      </div>
      <div class="room-bar__right">
        <${LoadoutButton} from="room" size="lg" class="room-loadout" label=${t('干员调配')} />
        ${facts.isHost
          ? coop
            ? room.matching
              ? html`<div class="room-match-actions room-match-actions--active"><span class="room-match-state"><${Icon} name="signal" />${t('正在寻找同盟队友')} <b class="num">${room.matching.count}/${room.matching.capacity}</b></span><${Button} variant="danger" size="lg" icon="close" loading=${busy === 'cancel-match'} onClick=${cancelQueue}>${t('取消匹配')}<//></div>`
              : html`<div class="room-match-actions">
                <div class="room-match-options">
                  <label class="room-match-toggle"><input type="checkbox" checked=${matchTeammates} disabled=${!!room.consoleEnabled || facts.modded}
                    onChange=${(e) => setMatchTeammates(e.currentTarget.checked)} /><span>${t('匹配同盟队友')}</span></label>
                </div>
                <${Tooltip} text=${facts.modded ? t('插件房间不能参加公共匹配') : room.consoleEnabled ? t('控制台已启用，不能匹配同盟队友') : matchTeammates && hasBots ? t('请先移除 AI 队友，再匹配真人队友') : matchTeammates || facts.canStart ? null : t('仍有博士未准备就绪')}>
                  <${Button} variant="primary" size="xl" icon=${matchTeammates ? 'users' : 'play'} loading=${busy === (matchTeammates ? 'match' : 'start')}
                    disabled=${(matchTeammates && (room.consoleEnabled || facts.modded || hasBots)) || (!matchTeammates && !facts.canStart) || !online} onClick=${start}>${t('立即开始')}<//>
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
    ${picking === 'avatar' && facts.mine && !facts.spectating && !room.inMatch ? html`<${AvatarPicker} current=${myCard.avatar} list=${portraits.pool} m=${portraits.m}
      onPick=${(id) => { setCardAvatar(id); setPicking(null); }} onClose=${() => setPicking(null)} />` : null}
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
