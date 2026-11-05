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
// CONTENT_NOT_READY), and a plugin mode the host chose shows beside the mode name in the top bar (the orange chip).
// 名片干员 (PR #643 split 6): a doctor's seat card shows an operator's portrait — the one the player picked (更换立绘 on
// one's own seat opens the picker: search, rarity, 默认; kept as a pref — ui/seatArt.js cardStore — and sent as
// room.card by ui/loadoutSync.js installCardSync, so the room sees it as seats[].card), else one of the 5★/6★ operators
// chosen by the player id (ui/seatArt.js), the same on every client. [ASSUMED] The pick made here and kept in this
// browser stands in for the event's account assistant (名片形象); [ASSUMED] the default by player id is a remake rule.
// Outfits (docs/SKINS.md; the maintainer's decision 4 of 2026-10-21): the portrait wears the player's outfit — one's own
// card this browser's choice at once, another doctor's the map that seat published (room.state seats[].skins) unless
// 「显示其他玩家的皮肤」 is off; an outfit this page's appearance plugins do not have draws the default art (ui/seatArt.js
// seatCardSkin). The picker is one's own picker, so its tiles wear one's own outfits too (like 干员调配's).
// Without the art pack the card keeps its avatar frame; a bot keeps its robot frame.
// Official versions (DESIGN §35.23, M1; versions.js): a room plays one version (room.state.version; absent = 第二期下半).
// Another version's name shows beside the mode in the top bar (ui/pluginTag.js VersionTag) and every page loads and checks
// its data like a gameplay plugin's content set (content.js) — the seat tags read 版本数据载入中 / 就绪 / 校验失败 and
// 准备就绪 / 开始模拟 wait for it (needsContent: gameplay plugins or another version; 非官方 stays the plugins' alone).
// The version pill beside the difficulty (and ⚙'s 版本 row in co-op) opens the version picker (ui/versionPicker.js): the
// host's pick proposes the switch (room.proposeVersion: a lone human's room switches at once; otherwise the seated humans
// vote — ui/versionVote.js, the strip between the 观战席 and the footer); everybody else reads it (由创建者发起). It is off
// during a vote, with gameplay plugins on (they play 第二期下半 only) and offline. A switch is told to everybody (a toast,
// never on entering a room), and a room whose version is not this browser's lobby choice says that leaving restores it.
// Texts go through t() (docs/I18N.md).

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { DIFFICULTY_NAMES, DIFFICULTY_COLORS, MAX_SEATS, MAX_SPECTATORS } from '../../../shared/constants.js';
import {
  html, Button, Icon, MicroLabel, AvatarFrame, DifficultyTag, DifficultyIcon, Tooltip, Spinner, TextField, doctorNo, PingPill, Modal, confirmDialog,
} from '../ui/components.js';
import { toast, toastError } from '../ui/toasts.js';
import { TestMark } from '../ui/testConsole.js';
import { copyText } from '../ui/clipboard.js';
import { openStats } from './stats.js';
import { LoadoutButton } from './loadout.js';
import { PluginTag, VersionTag, isModdedRoom, roomRulesLabel } from '../ui/pluginTag.js';
import { VersionVote, versionVoteOf } from '../ui/versionVote.js';
import { VersionPicker } from '../ui/versionPicker.js';
import { DEFAULT_VERSION, lobbyVersion, needsContent, offeredDifficulties, roomVersion, serverDefaultVersion, soloTimedOf, soloTimeMsgid, versionLabel } from '../versions.js';
import { hasScriptConsent, rememberScriptConsent, pageVersion } from '../content.js';
import { net } from '../net.js';
import { store, useStore, shallowEqual, emptyMatch, isSpectating, savePref } from '../store.js';
import { difficultyInfo, ProtocolSelect } from './lobby.js';
import { data, useData, getConfig } from '../data.js';
import { cardOperators, seatPortrait } from '../ui/seatArt.js';
import { useMyCard, setCardOperator } from '../ui/playerCard.js';
import { PortraitPicker } from '../ui/opPicker.js';
import { useRise } from '../ui/transitions.js';
import { chessAvatarUrl, chessPortraitUrl } from '../ui/assetUrls.js';
import { cardContext, seatOperator, seatCardSkin, seatArtSrc } from '../ui/seatArt.js';
import { skinsStore, SKINS_KEY, ownerSkin } from '../ui/skins.js';
import { settingsStore } from '../ui/settingsStore.js';
import { t, tc } from '../../../shared/i18n.js';
import {DoctorName} from '../ui/doctorLinks.js';

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
  // a room with gameplay plugins (DESIGN §32.6) or another official version (§35.23): every player's page has loaded and
  // checked its content (the host's too); `modded` (非官方) is the plugins' alone
  const modded = isModdedRoom(room);
  const loadsContent = needsContent(room);
  const contentReady = !loadsContent || humans.every((s) => s.content === 'ready');
  return {
    seats, occupied, humans, mine, isHost, readyHumans, isReady,
    emptySeats: seats.filter((s) => !s).length,
    canStart: !versionVoteOf(room) && isHost && othersReady && !!mine && contentReady && (!room?.content?.trusted || humans.every(s => room.content.trusted.consent[s.seat])),
    othersReady,
    modded,
    needsContent: loadsContent,
    // another official version (its seat tags and texts; a gameplay plugin room keeps the plugins' words)
    versionRoom: loadsContent && !modded,
    contentReady,
    myContent: loadsContent ? (mine?.content || 'loading') : 'ready',
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

/** Spectator handover is available only in original default-version co-op rooms, with a host opt-in. */
export function aiTakeoverOption(room, myId) {
  if (!room || room.mode === 'solo' || roomVersion(room) !== DEFAULT_VERSION || room.content?.vanilla === false) return null;
  return { on: room.aiTakeoverEnabled === true, editable: room.hostId != null && room.hostId === myId && !room.inMatch };
}

/**
 * The solo room option 「不限时」 (DESIGN §35.23.10; room.setSoloUnlimited). null unless the room is solo AND `timed`
 * is exactly true (a version whose solo is timed, and whose data is on screen). Off when room.state omits the key.
 * The host switches it; everybody else sees it read-only.
 * @param {any} room room.state payload
 * @param {any} myId
 * @param {boolean | null} timed soloTimedOf(config, room version)
 * @returns {{ on: boolean, editable: boolean } | null}
 */
export function soloUnlimitedOption(room, myId, timed) {
  if (!room || room.mode !== 'solo' || timed !== true) return null;
  return { on: room.soloUnlimited === true, editable: room.hostId != null && room.hostId === myId };
}

/**
 * An AI teammate's name split into its 「AI·」 prefix and the rest, for the plate (room.css hides the prefix on a phone:
 * the avatar's badge and the card's AI 队友 tag say it, and at 特大 the prefix left one character of the name,
 * 「AI·华…」). Null for a human seat and for a name that is only a number after the prefix (`AI·2`).
 * @param {{ isBot?: boolean, name?: string } | null | undefined} seat
 * @returns {[string, string] | null}
 */
export function botNameParts(seat) {
  const m = seat?.isBot ? /^(AI\s*·\s*)(\D.*)$/su.exec(seat.name || '') : null;
  return m ? [m[1], m[2]] : null;
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
  const readyLabel = ready ? isHostSeat ? t('待命中') : t('已就绪') : t('准备中');
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
        ? html`<span class="rseat__box"><${Icon} name="check" /></span>${readyLabel}`
        : html`<span class="rseat__box"></span>${readyLabel}`}</span>
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
        <${DoctorName} player=${seat} class="rseat__name" />
        ${isHostSeat || isMe ? html`<span class="rseat__roles">
          ${isHostSeat ? html`<span class="rseat__role rseat__host">${t('创建者')}</span>` : null}
          ${isMe ? html`<span class="rseat__role rseat__me">${t('我')}</span>` : null}
        </span>` : null}
      </span>
      <span class="rseat__compact-state">${readyLabel}</span>
      ${facts.needsContent && !seat.isBot ? html`<span class=${`seat__content is-${seat.content || 'loading'}`} data-testid="seat-content">
      ${seat.content === 'ready' ? facts.versionRoom ? t('版本数据就绪') : t('插件内容就绪') : seat.content === 'failed' ? t('插件内容校验失败') : t('插件内容载入中')}
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

function InviteBox({ code, name, difficulty, version }) {
  const copy = async (what) => {
    const invite = t('{name}邀请你加入卫戍协议：盟约·{version}【{difficulty}】', { name: name ?? '', version: versionLabel(version || DEFAULT_VERSION), difficulty: DIFFICULTY_NAMES[difficulty] ? t(DIFFICULTY_NAMES[difficulty]) : '' });
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

/** The 「不限时」 switch (a timed solo): the host toggles it, everybody else sees its state. */
function SoloUnlimitedToggle({ option, busy, onToggle }) {
  if (!option) return null;
  return html`<${RoomOptionSwitch} label=${t('不限时')} checked=${option.on} disabled=${!option.editable || !!busy}
    hint=${t('关闭本局休整与机变的计时。官方为休整期每轮 300 秒、机变 150 秒。')} onChange=${onToggle} />`;
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

function AiTakeoverToggle({ option, busy, onToggle }) {
  if (!option) return null;
  return html`<${RoomOptionSwitch} label=${t('允许观战者接替 AI')} checked=${option.on} disabled=${!option.editable || !!busy}
    hint=${t('默认关闭。开启后，观战者可在休整期经同房间真人投票接替 AI；继承记录不计个人统计或奖励。')} onChange=${onToggle} />`;
}

/**
 * ⚙ of the bottom pill (co-op): 同盟设置 — the 模拟难度 (opens 选择模拟协议: the host's 确认, the others' read-only view)
 * and the 「AI 队友最后选择」 switch. Closes on a click outside it or Esc.
 */
function RoomOptions({ option, takeoverOption, onAiTakeover, soloOption = null, room, isHost, busy, onAiLast, onSoloUnlimited, onDifficulty, onClose, version = null }) {
  const info = difficultyInfo(room.mode, room.difficulty);
  const title = soloOption ? t('模拟设置') : t('同盟设置');
  useEffect(() => {
    const away = (e) => { if (!e.target.closest?.('.rs-opts, .rs-pill__gear')) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    addEventListener('pointerdown', away);
    addEventListener('keydown', onKey);
    return () => { removeEventListener('pointerdown', away); removeEventListener('keydown', onKey); };
  }, []);
  return html`<div class="rs-opts" role="dialog" aria-label=${title}>
    <h4>${title}</h4>
    ${soloOption ? null : html`<div class="rs-opts__row" data-testid="room-opt-difficulty">
      <span class="rs-opts__k">${t('模拟难度')}</span>
      <button type="button" class="rs-opts__diff" disabled=${isHost && !!busy} onClick=${onDifficulty}
          title=${isHost ? t('更改模拟难度') : t('由创建者选择')}>
        <${DifficultyIcon} difficulty=${room.difficulty} />${DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : ''}<span class="num rs-pill__code">${info.code}</span>
        ${isHost ? html`<em>${t('更改')}</em>` : null}
      </button>
      ${isHost ? null : html`<span class="t-dim">${t('由创建者选择')}</span>`}
    </div>`}
    ${!soloOption && version ? html`<div class="rs-opts__row" data-testid="room-opt-version">
      <span class="rs-opts__k">${t('版本')}</span>
      <${Tooltip} text=${version.why}>
        <button type="button" class="rs-opts__diff rs-opts__ver" disabled=${version.disabled} onClick=${version.onOpen}
            title=${version.editable ? t('发起切换版本') : t('由创建者发起')}>
          <${Icon} name="book" />${versionLabel(version.id)}${version.editable ? html`<em>${t('切换')}</em>` : null}
        </button>
      <//>
      ${version.editable ? null : html`<span class="t-dim">${t('由创建者发起')}</span>`}
    </div>` : null}
    <${AiTakeoverToggle} option=${takeoverOption} busy=${busy} onToggle=${onAiTakeover} />
    ${soloOption
      ? html`<${SoloUnlimitedToggle} option=${soloOption} busy=${busy} onToggle=${onSoloUnlimited} />`
      : html`<${AiLastToggle} option=${option} busy=${busy} onToggle=${onAiLast} />`}
  </div>`;
}

/** A gear (the pill's ⚙, in the place of the event's 快速搜寻: matchmaking is dropped — the maintainer's PR #643 keep / drop list, 2026-10-15). */
function GearGlyph() {
  return html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill-rule="evenodd" d="M10.3 2h3.4l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5v3.4l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6h-3.4l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9L2 13.7v-3.4l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" /></svg>`;
}

/**
 * The big button of the bottom right (开始模拟 / 准备就绪 / 已就绪 / 观战中), styled like 选择模拟协议's. A disabled reason goes in
 * the project's Tooltip around it (review of PR #813: a native title never shows on touch).
 */
function GoButton({ label, onClick, disabled, loading = false, ready = null, icon = null }) {
  return html`<button type="button" class=${`proto-start rs-go${ready ? ' is-ready' : ''}`} disabled=${disabled} onClick=${onClick}
      aria-busy=${loading ? 'true' : 'false'}>
    ${ready != null
      ? html`<span class="rs-go__box" aria-hidden="true">${ready ? html`<${Icon} name="check" />` : null}</span>`
      : icon
        // (a spectator's 观战中: its eye in the mark's place, so the label keeps the width — §35.18 review)
        ? html`<span class="rs-go__icon" aria-hidden="true"><${Icon} name=${icon} /></span>`
        : html`<span class="proto-start__mark" aria-hidden="true"><span class="proto-start__rook"><i>[</i><${Icon} name="rook" /><i>]</i></span><small>STRONGHOLD<br />PROTOCOL</small></span>`}
    <span class="proto-start__label">${loading ? html`<${Spinner} size="sm" />` : null}${label}</span>
    <span class="proto-start__deco" aria-hidden="true"></span>
  </button>`;
}

/** How long a version proposal refused as too frequent (RATE) waits before it is sent once more [ASSUMED]. */
const PROPOSE_RETRY_MS = 1200;

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
      const minimum=compact?44:128;
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
  // the host's change of difficulty, told to the others (see the header); never on entering a room or switching rooms
  const seenDiff = useRef(room ? `${room.code}|${room.difficulty}` : '');
  useEffect(() => {
    if (!room) return;
    const key = `${room.code}|${room.difficulty}`;
    const before = seenDiff.current;
    seenDiff.current = key;
    if (!before || before === key || !before.startsWith(`${room.code}|`) || room.hostId === me.playerId) return;
    const name = DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : room.difficulty;
    toast(t('创建者已将模拟难度改为「{name}」', { name }), 'info');
  }, [room?.code, room?.difficulty]);
  // official versions (DESIGN §35.23): the room's switch is told to everybody (the host's own page included — a vote's
  // result arrives later than the pick); never on entering a room or switching rooms
  const versions = useStore((s) => s.versions);
  const myLobby = useStore(lobbyVersion);
  const serverDefault = useStore(serverDefaultVersion);
  const [versionOpen, setVersionOpen] = useState(false);
  const seenVersion = useRef(room ? `${room.code}|${roomVersion(room)}` : '');
  useEffect(() => {
    if (!room) return;
    const key = `${room.code}|${roomVersion(room)}`;
    const before = seenVersion.current;
    seenVersion.current = key;
    if (!before || before === key || !before.startsWith(`${room.code}|`)) return;
    setVersionOpen(false);
    toast(t('同盟已切换到「{version}」', { version: versionLabel(roomVersion(room)) }), 'success');
  }, [room?.code, room?.version]);
  // the room sees one's pick once the server has it (seats[].card): ui/loadoutSync.js installCardSync sends it after
  // every pick, welcome and content change and retries a RATE / TIMEOUT / OFFLINE refusal (review of PR #813)

  if (!room) return null;
  const online = conn.status === 'online';
  const coop = room.mode !== 'solo';
  const facts = roomFacts(room, me.playerId);
  const hasBots = facts.occupied.some((s) => s.isBot);
  const canManageConsole = facts.isHost || (room.mode === 'solo' && !!facts.mine);
  const myReady = !!facts.mine?.ready;
  const info = difficultyInfo(room.mode, room.difficulty);

  /** Runs one request at a time; resolves true once the server took it (false: not sent, or refused — toasted). */
  const run = async (kind, fn) => {
    if (inFlight.current) return false;
    if (!online) { toast(t('连接中断，请稍候重试'), 'warn'); return false; }
    inFlight.current = true;
    setBusy(kind);
    try { await fn(); return true; } catch (err) { toastError(err); return false; } finally {
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
  const setDifficulty = (difficulty) => run('diff', () => net.request('room.setDifficulty', { difficulty }));
  const setAiTakeover = (on) => run('aihandover', () => net.request('room.setAiTakeover', { on }));
  const setAiLast = (on) => run('ailast', () => net.request('room.setAiPicksLast', { on }));
  // the room is the authority; the lobby card reads the same pref the next time this browser creates a solo room
  const setSoloUnlimited = async (on) => {
    const sent = await run('solofree', () => net.request('room.setSoloUnlimited', { on }));
    if (sent) savePref('lobby.soloUnlimited', on === true);
  };
  // spectator seats: the host frees one; a spectator takes a free player seat with room.join of this room
  const removeSpectator = (playerId) => run(`rs${playerId}`, () => net.request('room.removeSpectator', { playerId }));
  const sit = () => run('sit', () => net.request('room.join', { code: room.code, ...(room.test ? { testAck: true } : {}) }));
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
    : facts.versionRoom && !facts.contentReady
      ? html`<span class="t-lo">${t('等待所有博士载入「{version}」的数据', { version: versionLabel(roomVersion(room)) })}</span>`
    : facts.needsContent && !facts.contentReady
      ? html`<span class="t-lo">${t('等待所有博士载入房间的插件内容')}</span>`
    : facts.isHost
      ? facts.canStart
        ? html`<span class="t-mint">${t('*同盟人数达标，准许进入模拟')}</span>`
        : html`<span class="t-lo">${t('等待所有博士准备就绪')}</span>`
      : myReady
        ? html`<span class="t-mint">${t('已就绪 · 等待创建者开始模拟')}</span>`
        : html`<span class="t-lo">${t('准备就绪后，创建者即可开始模拟')}</span>`;

  // the room's version (DESIGN §35.23): the pill and ⚙'s row on a server that enables versions (or in a version room)
  const vote = versionVoteOf(room);
  const curVersion = roomVersion(room);
  const soloBrief = soloTimeMsgid('brief', { timed: soloTimedOf(getConfig(), curVersion), unlimited: room.soloUnlimited === true });
  const showVersion = Array.isArray(versions) || curVersion !== DEFAULT_VERSION;
  const versionWhy = !online ? t('连接中断，请稍候重试')
    : vote ? t('切换版本投票进行中，请等投票结束')
    : facts.modded ? t('请先关闭改变玩法的插件')
    : !Array.isArray(versions) || versions.length < 2 ? t('本服务器只启用了这一个版本') : null;
  const versionEditable = facts.isHost && !facts.spectating && !room.inMatch;
  // Keep version details in the existing toolbar control and picker, without adding another row above the seats.
  const bannerText = curVersion !== myLobby && Array.isArray(versions) ? t('本房间为「{room}」，离开后恢复你的大厅版本「{mine}」', { room: versionLabel(curVersion), mine: versionLabel(myLobby) }) : null;
  const versionCtl = showVersion ? {
    id: curVersion, editable: versionEditable, why: [versionEditable ? versionWhy : t('由创建者发起'), bannerText].filter(Boolean).join(' · ') || null,
    disabled: versionEditable ? !!versionWhy || !!busy : !Array.isArray(versions),
    onOpen: () => { setVersionOpen(true); },
  } : null;
  // (a switch makes every page send its settings again, which share the server's budget of heavy messages with
  // room.proposeVersion: a RATE right after one is tried once more a moment later; the server's own 5 s pause after a
  // declined or expired vote answers RATE again and is told)
  const proposeVersion = async (version) => {
    const send = () => net.request('room.proposeVersion', { version });
    const sent = await run('version', async () => {
      try { await send(); } catch (err) {
        if (err?.code !== 'RATE') throw err;
        await new Promise((r) => setTimeout(r, PROPOSE_RETRY_MS));
        await send();
      }
    });
    if (sent && alive.current) { setVersionOpen(false); setConfigDraft(null); }
  };

  const versionPicker = versionOpen && versionCtl ? html`<${VersionPicker} mode="room" versions=${versions || [{ id: curVersion, roomModes: [room.mode] }]} current=${curVersion}
    serverDefault=${serverDefault} roomMode=${room.mode} editable=${versionEditable && !versionWhy} busy=${busy === 'version'}
    note=${[bannerText, versionEditable ? versionWhy || (facts.humans.length > 1 ? t('其他博士同意后才会切换；切换后需要重新准备。') : null) : t('由创建者发起')].filter(Boolean).join(' ')}
    onPick=${proposeVersion} onClose=${() => setVersionOpen(false)} />` : null;

  const currentDraft=(tab='basic')=>({difficulty:room.difficulty,prepChoice:room.prepMultiplier==null?null:room.prepMultiplier===0?0:String(room.prepMultiplier),battleSpeed:room.battleSpeed??2,tab});
  if (configDraft) {
    const readOnly = !facts.isHost || !!room.matching;
    const change = (key, value) => setConfigDraft(d => ({...d, [key]:value}));
    const switchTab=tab=>{
      if(tab===(configDraft.tab||'basic'))return;
      if(tab==='plugins'&&!readOnly)return run('config',async()=>{await net.request('room.setOptions',{difficulty:configDraft.difficulty,prepMultiplier:prepChoiceMultiplier(configDraft.prepChoice),battleSpeed:configDraft.battleSpeed});setConfigDraft(d=>({...d,tab}));});
      setConfigDraft(currentDraft(tab));
    };
    return html`<${RoomOptionsPage} soloTimeLabel=${t(soloBrief)} difficulties=${offeredDifficulties(getConfig(),room.mode)} tab=${configDraft.tab||'basic'} onTabChange=${switchTab}
      pluginContent=${PluginView?html`<${PluginView} open=${true} room=${room} myId=${me.playerId} embedded=${true} />`:html`<p>${t('正在读取插件列表…')}</p>`} mode=${room.mode} difficulty=${readOnly?room.difficulty:configDraft.difficulty} onDifficultyChange=${v=>change('difficulty',v)}
      prepChoice=${readOnly?(room.prepMultiplier==null?null:room.prepMultiplier===0?0:String(room.prepMultiplier)):configDraft.prepChoice} onPrepChange=${v=>change('prepChoice',v)}
      battleSpeed=${readOnly?room.battleSpeed:configDraft.battleSpeed} onSpeedChange=${v=>change('battleSpeed',v)} readOnly=${readOnly} disabled=${!!busy || !online}
      onBack=${()=>setConfigDraft(null)} onSave=${()=>run('config',async()=>{await net.request('room.setOptions',{difficulty:configDraft.difficulty,prepMultiplier:prepChoiceMultiplier(configDraft.prepChoice),battleSpeed:configDraft.battleSpeed});setConfigDraft(null);})}>
      ${(configDraft.tab || 'basic') === 'basic' ? html`<section class="prep-setting">
        <div class="prep-setting__title"><${Icon} name="book" /><span>${t('游戏版本')}</span></div>
        ${versionCtl ? html`<${Tooltip} text=${versionCtl.why}><${Button} size="sm" variant="secondary" icon="book" data-testid="room-version" disabled=${versionCtl.disabled} onClick=${versionCtl.onOpen}>${versionLabel(curVersion)}<//><//>` : null}
        <p class="prep-setting__hint">${bannerText}</p>
        <${AiTakeoverToggle} option=${aiTakeoverOption(room, me.playerId)} busy=${busy} onToggle=${setAiTakeover} />
      </section>` : null}
      ${room.matching?html`<p class="prep-setting__hint">${t('取消匹配后可修改配置')}</p>`:facts.isHost?html`<p class="prep-setting__hint">${t('修改配置后，队友需要重新准备就绪')}</p>`:null}
      ${versionPicker}
    <//>`;
  }
  return html`<div class=${`screen room-screen${coop ? ' room-screen--coop' : ''}`}>
    <${PageHeader} onBack=${leave} backTitle=${t('离开同盟')} backBusy=${busy === 'leave'}
      heading=${html`<${PageHeading} title=${coop ? t('同盟模拟') : t('独立模拟')} micro=${coop ? 'ALLIANCE LOBBY' : 'SOLO SIMULATION'}>
        <span class="app-header__separator" aria-hidden="true"></span><${DifficultyTag} difficulty=${room.difficulty} size="lg" />
        ${room.content?.modeId ? html`<span class="room-mode" data-testid="room-mode">${(room.content.modes || []).find((m) => m.id === room.content.modeId)?.name || room.content.modeId}</span>` : null}
      <//>`} />
    ${coop ? html`<section class="room-invitation" aria-label=${t('同盟密钥')}><${InviteBox} code=${room.code} name=${me.name} difficulty=${room.difficulty} version=${curVersion} /></section>` : null}

    <main ref=${seatsRef} class=${`seats${coop ? '' : ' seats--solo'}`}>
      ${facts.seats.map((s, i) => html`<${SeatCard} key=${s ? `p${s.playerId}` : `e${i}`} seat=${s} index=${i} room=${room} facts=${facts}
        myId=${me.playerId} busy=${busy} onAddBot=${addBot} onRemoveBot=${removeBot} onKick=${kick} searching=${!!room.matching} portraits=${portraits}
        onPickCard=${artReady ? () => setPicking('op') : null} onPickAvatar=${openStats} />`)}
      ${coop ? null : html`<aside class="solo-brief brackets">
        <${MicroLabel} tone="mint">BRIEFING<//>
        <h2>${DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : ''} <span class="num t-dim">${info.code}</span></h2>
        <p>${info.desc}</p>
        <ul>
          ${info.effects.map((e) => html`<li key=${e}>${e}</li>`)}
          <li>${t('共')} <b class="num">${info.rounds}</b> ${tc('rounds', '回合')}${info.hidden ? t('，满足条件时进入隐秘核心') : ''}</li>
          ${soloBrief ? html`<li>${t(soloBrief)}</li>` : null}
        </ul>
      </aside>`}
    </main>
    <${SpectatorBar} facts=${facts} room=${room} myId=${me.playerId} busy=${busy} onRemove=${removeSpectator} onSit=${sit} onSpectate=${spectate} />
    <${VersionVote} room=${room} />

    <footer class="room-bar">
      <div class="room-bar__left">
        <${RoomConfigSummary} soloTimeLabel=${soloTimeMsgid('short', {timed:soloTimedOf(getConfig(),curVersion),unlimited:room.soloUnlimited===true})} mode=${room.mode} difficulty=${room.difficulty} prepMultiplier=${room.prepMultiplier} prepSeconds=${room.prepSeconds} battleSpeed=${room.battleSpeed}
          contentLabel=${curVersion === DEFAULT_VERSION ? roomRulesLabel(room) : facts.modded ? `${versionLabel(curVersion)} ${roomRulesLabel(room)}` : versionLabel(curVersion)}
          editable=${facts.isHost && !room.matching} disabled=${!!busy} onOpen=${()=>setConfigDraft(currentDraft())} />
        <div class="room-bar__tools">
          <${SoloUnlimitedToggle} option=${soloUnlimitedOption(room, me.playerId, soloTimedOf(getConfig(), curVersion))} busy=${busy} onToggle=${setSoloUnlimited} />
          <${CommunicationDock} room=${true} disabled=${facts.spectating} />
          ${canManageConsole || room.consoleEnabled ? html`<${RoomOptionSwitch} label=${t('启用控制台')}
            checked=${!!room.consoleEnabled} disabled=${!canManageConsole || (!room.consoleEnabled && !!room.matching) || !online || !!busy}
            busy=${busy === 'console' || busy === 'console-disable'}
            hint=${canManageConsole ? room.consoleEnabled ? t('关闭控制台') : t('启用控制台') : t('由创建者设置')}
            onChange=${(on) => on ? openConsole() : disableConsole()} />` : null}
          <${AiLastToggle} option=${aiLastOption(room, me.playerId)} busy=${busy} onToggle=${setAiLast} />
          ${facts.isHost && coop && !room.matching ? html`<${RoomOptionSwitch} label=${t('匹配同盟队友')}
            checked=${matchTeammates} disabled=${curVersion !== DEFAULT_VERSION || !!room.consoleEnabled || facts.modded || !!busy || (room.prepSeconds != null || room.prepMultiplier != null || (room.battleSpeed ?? 2) !== 2)}
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
                    disabled=${((room.consoleEnabled || facts.modded || hasBots || (room.prepSeconds != null || room.prepMultiplier != null || (room.battleSpeed ?? 2) !== 2)) && matchTeammates) || (!matchTeammates && !facts.canStart) || !online || !!vote || busy === 'start'} onClick=${start}>${t('立即开始')}<//>
                <//>
              </div>`
            : html`<${Tooltip} text=${facts.canStart ? null : t('仍有博士未准备就绪')}>
                <${Button} variant="primary" size="xl" icon="play" loading=${busy === 'start'} disabled=${!facts.canStart || !online || !!vote || busy === 'start'} onClick=${start}>${t('立即开始')}<//>
              <//>`
          : facts.spectating
            ? html`<${GoButton} label=${t('观战中')} icon="eye" disabled=${true} />`
          : html`<${Tooltip} text=${!myReady && facts.myContent !== 'ready' ? (facts.versionRoom ? t('「{version}」的数据载入并通过校验后才能准备', { version: versionLabel(curVersion) }) : t('房间的插件内容载入并通过校验后才能准备')) : null}>
              <${GoButton} label=${myReady ? t('已就绪') : t('准备就绪')} ready=${myReady} loading=${busy === 'ready'}
                disabled=${!online || !facts.mine || busy === 'ready' || (!myReady && facts.myContent !== 'ready')} onClick=${toggleReady} />
            <//>`}
      </div>
    </footer>
    <${ConsoleWarning} open=${consoleOpen} remaining=${Math.max(0, Math.ceil((consoleReadyAt - consoleNow) / 1000))}
      busy=${busy === 'console'} onCancel=${cancelConsole} onConfirm=${confirmConsole} />
    ${picking === 'op' && facts.mine && !facts.spectating && !room.inMatch ? html`<${PortraitPicker}
      current=${myCard.charId} list=${portraits.pool} m=${portraits.m}
      onPick=${(id) => { setCardOperator(id); setPicking(null); }} onClose=${() => setPicking(null)} />` : null}
    ${versionPicker}
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
