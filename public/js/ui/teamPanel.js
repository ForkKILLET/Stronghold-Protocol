// Left team panel (research 06 §11.1, research 09 §3.1): one row per seat — avatar (band icon once picked), name, LP
// tower, status glyph (… acting / ✓ ready / ⌛ deciding / ⚔ combat / door left / ✕ dead), AI badge, "you" marker, the
// field being watched (avatar highlight), and emote bubbles. In a boss round the viewer's pair is framed in green from the
// round's start (gameLogic teamFrameIds; community report of 2026-10-06, item 51).
// Avatar interaction: the first click selects a player and opens alliance information; clicking that avatar again
// watches their field. The own avatar returns home on one click; navigation closes the information.
// Live LP (user playtest #3 item 2): during a normal round's battle each row's tower shows lp − the loss that player's
// leaks so far will cost (red, −N): the own row the top bar's live value (`self`, ui/hud.js liveLp), a teammate's row
// m.public players[].pendingLp (server/match/match/views.js, ~1 Hz). 联防 (user playtest #6 item 7): a leaker's row adds the
// runner tag ×N — its enemies still standing on the 联防 field, uncapped and live (falling as the helpers kill them,
// rising when one splits) — next to lp − min(lpCapPerRound, N): the own row the top bar's value, a teammate's row the
// local 联防 replica's count while it is on screen (`uniteLocal`: the battle runner's state().uniteLeft, the same battle
// the player watches, so the number moves with the kills on screen), else m.public players[].uniteLeft (the authority's
// report, ~1 Hz).
// 完美连胜 / 领袖伤害 (DESIGN §37.148, every version; ui/avatarBadges.js): the streak badge on the avatar's top-right corner
// (the own row's "you" marker moves to the bottom-left corner while it shows), the leader-damage scan over the avatar
// during a leader fight; `badges` = { pack, still } (the theme's avatar prefabs, else ac_n_initial's; null pack: CSS).

import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { PHASE } from '../../../shared/constants.js';
import { html, Icon, Tooltip, BondDisc } from './components.js';
import { PlayerAvatar, LpTower, GIcon, LocalSprite, UnitThumb, BandIcon, RichText } from './gameComponents.js';
import { DoctorName } from './doctorLinks.js';
import { EmoteBubble } from './emotes.js';
import { STATUS_META, sortedPlayers, teamFrameIds, stripBondList, bondCountCap } from './gameLogic.js';
import { bondDisplay } from './bondStrip.js';
import { MissTag, uniteRemaining } from './hud.js';
import { WinStreakBadge, BossDamageBadge, avatarBadgeTips } from './avatarBadges.js';
import { localAsset, data } from '../data.js';
import { bondIconUrl } from './assetUrls.js';
import { t } from '../../../shared/i18n.js';
import { usePresence } from './transitions.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Official status glyphs (ui/battle) per m.public players[].status; CSS glyph fallback. */
const STATUS_SPRITE = { ready: 'icon_ready', deciding: 'icon_waiting', done: 'icon_complete', dead: 'icon_dead' };

/**
 * A row's LP tower: the settled LP and the pending loss of the round's battle (0 outside COMBAT / UNITE). The own row
 * takes the top bar's live value when there is one (its m.private lp: the same number as the top bar). `left`: during
 * 联防 a leaker's enemies still standing (the ×N tag), else null — for a teammate the local 联防 replica's count when
 * one is given (`uniteLocal`, the runner's state().uniteLeft: { [playerId]: n }, absent = none left; the pending loss
 * is then min(cap, left)), else m.public players[].uniteLeft / pendingLp.
 * @param {any} p m.public players[] entry @param {any} pub m.public
 * @param {{ lp?: number|null, pending: number, unite: boolean, left?: number|null } | null} [self] the own live value (only for the own row)
 * @param {{ uniteLocal?: Record<string, number> | null, cap?: number }} [opts]
 * @returns {{ lp: number|null, pending: number, unite: boolean, left: number|null }}
 */
export function rowLp(p, pub, self = null, { uniteLocal = null, cap = 10 } = {}) {
  const pubLp = Number.isFinite(p?.lp) ? p.lp : null;
  if ((pub?.phase !== PHASE.COMBAT && pub?.phase !== PHASE.UNITE) || p?.alive === false) return { lp: pubLp, pending: 0, unite: false, left: null };
  const lp = self && Number.isFinite(self.lp) ? self.lp : pubLp;
  const leaker = pub.phase === PHASE.UNITE && Array.isArray(pub.unite?.leakers) && pub.unite.leakers.includes(p.playerId);
  const local = !self && leaker && uniteLocal && typeof uniteLocal === 'object' ? uniteRemaining(uniteLocal[p.playerId] ?? 0, null) : null;
  const rawLeft = pub.phase !== PHASE.UNITE ? null : self ? self.left : local != null ? local : p.uniteLeft;
  const left = Number.isFinite(rawLeft) && rawLeft >= 0 ? Math.trunc(rawLeft) : null;
  if (lp == null) return { lp, pending: 0, unite: false, left };
  const raw = self ? self.pending : local != null ? Math.min(cap, local) : p.pendingLp;
  const pending = Math.min(lp, Math.max(0, Math.trunc(Number(raw) || 0)));
  return { lp, pending, unite: (pending > 0 || left != null) && (self ? !!self.unite : pub.phase === PHASE.UNITE), left };
}

/** True when `watching` is already this teammate's field (their live field, or the prep scout `n:<id>`). */
export function teammateFieldShown(watching, player) {
  if (!watching || !player) return false;
  return watching === player.fieldId || watching === `n:${player.playerId}`;
}

/** Teammates open information before watching; the own avatar returns home immediately. */
export function playerAvatarAction({ openPid = null, player, self = false, observe = null, watching = null, askedRecently = false }) {
  if (self) {
    const away = observe ? observe.observing : watching && !teammateFieldShown(watching, player);
    if (away) return askedRecently ? 'close' : observe ? 'back' : 'watch';
    if (openPid !== null && openPid !== player.playerId) return 'close';
  }
  if (openPid !== player.playerId) return 'open';
  if (askedRecently || self || teammateFieldShown(watching, player)) return 'close';
  return 'watch';
}

/** Suppress repeated navigation requests while the watched field is updating. */
const AVATAR_CLICK_GAP_MS = 500;

/**
 * Tooltip of a row's LP tower with a pending loss (null without one).
 * @param {{ lp: number|null, pending: number, unite: boolean, left: number|null } | null} lp rowLp(...)
 * @param {number} [cap] lpCapPerRound
 */
export function rowLpTip(lp, cap = 10) {
  if (!lp || !(lp.pending > 0)) return null;
  if (lp.unite && lp.left != null) return t('目标生命值 {lp}，联防中：漏过的敌人还剩 {left} 个，按现在结算扣除 {pending} 点（每回合至多 {cap} 点）', { lp: lp.lp, left: lp.left, pending: lp.pending, cap });
  return lp.unite ? t('目标生命值 {lp}，联防中，结算时扣除至多 {pending} 点', { lp: lp.lp, pending: lp.pending })
    : t('目标生命值 {lp}，结算时扣除 {pending} 点', { lp: lp.lp, pending: lp.pending });
}

// ---- 「同盟盟约速查」浮窗 ----------------------------------------------------------------
//
// 队伍栏右缘的一列紧凑浮窗：每个座位一行，显示该座位已激活的盟约（仅图标，排序同顶栏）、其场上干员与本局策略。
// 它不复用顶栏的 BondStrip：那个组件会画名字和槽位数，空态文案也是给横条用的，都不适合这里的一行。
//
// 数据按观众裁剪（PR #922 批注）：m.public 不携带 boardOps（它是一条广播，会绕过 g.watch）；自己的干员来自
// m.private.boardOps，队友的来自 g.peek → m.peek（server/match/match/peek.js，状态通道：只读名册流、常开、
// 除自己外所有座位），或来自屏上的侦察 / 战场视图（game.js flyOpsFor，屏上优先）。场上没有干员的座位
// （已淘汰、已离场）仍显示盟约（本就是公开的），干员列为空。
// 侧边栏展开的干员只需要上场的干员和干员是否精英化的情况，优化逻辑为独立消息通道，不越界传输g.watch的详细战场信息

/** charId → display name, from the same chess records the thumbnails use (a composed record has no name of its own). */
let charNames = null;
let charNamesSrc = null;
function charName(id) {
  const chess = data.get('chess');
  if (chess !== charNamesSrc) {
    charNamesSrc = chess;
    charNames = new Map();
    for (const rec of Object.values(chess || {})) {
      if (rec?.charId && rec.name && !charNames.has(rec.charId)) charNames.set(rec.charId, rec.name);
    }
  }
  return charNames.get(id) || null;
}

/**
 * Build a chess-shaped record for the thumbnail when `boardOps` sends a char id (not a chess id, which UnitThumb
 * already knows how to look up). Exported for the UI tests.
 */
export function flyOpRec(u, lookup = (id) => data.lookup('chess', id), nameOf = charName) {
  if (!u?.id || lookup(u.id)) return null;
  return { charId: u.id, name: nameOf(u.id) || u.id, assets: { avatar: u.id }, isGolden: !!u.golden };
}

/**
 * The chess id of a flyout operator, for the operator card (`resolveDetail` reads chess records, not char ids).
 * `boardOps` sends a char id (server/match/match/views.js `_boardOps`), a chess id when the seat's field record is
 * missing. A golden operator resolves to its golden chess record when there is one. Exported for the UI tests.
 */
export function flyOpChessId(u, lookup = (id) => data.lookup('chess', id), chess = () => data.get('chess')) {
  if (!u?.id) return null;
  if (lookup(u.id)) return u.id;
  let plain = null;
  for (const [cid, rec] of Object.entries(chess() || {})) {
    if (rec?.charId !== u.id) continue;
    if (u.golden ? rec.isGolden : !rec.isGolden) return cid;
    if (!plain) plain = cid;
  }
  return plain;
}

/**
 * 屏上战场能给的干员（PR #922 评审）：自己的座位读 m.private.boardOps，队友只取「当前屏上那张战场」——准备期
 * 侦察（`n:<pid>`）或自己可观看的战斗（g.watch 已拒绝其余战场）——且只含场上棋子。结果形如
 * `{ [playerId]: [{ id, golden? }] }`。
 *
 * 这不是浮窗的完整数据源，只是它的**优先层**：队友的名册本来常开（g.peek → m.peek，server/match/match/peek.js），
 * 屏上这张战场只是能给出更实时的布局；调用方用 mergeFlyOps 把两层合起来（屏上优先，peek 补其余座位）。
 * 因此「队友的干员要前往查看才看得到」已不成立：不访问也能看到，只是名册为 peek 的快照。
 *
 * A prep scout (`prep: true`, fieldId `n:<pid>`) carries its board in the meta itself: no battle runs yet, so the
 * runner has nothing for it (client-combat matches still have `cc` true in prep — reading the runner there would empty
 * the row while that board is plainly on screen). A battle reads the runner's board in client combat, else the meta's.
 * Exported for the tests.
 */
export function flyOpsFor({ myId, priv = null, field = null, players = null, cc = false, runner = null, lookup = (id) => data.lookup('chess', id) }) {
  const out = {};
  const own = priv?.boardOps;
  if (Array.isArray(own) && own.length) out[myId] = own;
  if (!field?.fieldId) return out;
  // the field's members: a normal field / prep board is `n:<pid>`; a shared (府/联防) field lists them in `players` or sides
  const onField = (pid) => {
    if (Array.isArray(field.players)) return field.players.includes(pid);
    if (field.fieldId === `n:${pid}`) return true;
    return !!field.sides && typeof field.sides === 'object' && Object.prototype.hasOwnProperty.call(field.sides, pid);
  };
  for (const p of Array.isArray(players) ? players : []) {
    const pid = p.playerId;
    if (!pid || pid === myId || p.alive === false || !onField(pid)) continue;
    const units = (!field.prep && cc && runner ? runner.ownerOps?.(pid, field.fieldId) : field.units) || field.units || [];
    const ops = [];
    for (const u of units) {
      if (!u || u.kind !== 'op' || (u.ownerId && u.ownerId !== pid)) continue;
      if (u.area && u.area !== 'board') continue;
      const id = u.avatar || u.diy?.charId || u.defId || u.id;
      // the runner's entries (battle/simHost.js ownerOps: { kind, ownerId, defId, items?, standInFor?, diy? }) carry no
      // `golden`: the elite bit is the chess record's, as UnitThumb reads it — without it this on-screen row would win
      // over m.peek's `golden: 1` (mergeFlyOps) and drop the elite frame (PR #922 review)
      const golden = !!u.golden || (typeof u.defId === 'string' && !!lookup(u.defId)?.isGolden);
      if (id) ops.push({ id, ...(golden ? { golden: 1 } : {}) });
    }
    if (ops.length) out[pid] = ops;
  }
  return out;
}

/**
 * 浮窗的干员总表：屏上能显示的座位（game.js flyOpsFor）优先，其余——战场不在屏上的队友——取自 peek
 * （m.peek，server/match/match/peek.js）。空列表不覆盖非空列表（`m.peek` 在座位淘汰时发 `[]`：
 * 此时屏上本来也没有该行）。
 * 导出供 UI 测试使用。
 */
export function mergeFlyOps(base, peek) {
  const out = {};
  for (const [pid, list] of Object.entries(peek || {})) if (Array.isArray(list) && list.length) out[pid] = list;
  for (const [pid, list] of Object.entries(base || {})) if (Array.isArray(list) && list.length) out[pid] = list;
  return out;
}

/**
 * A seat's bonds as its flyout row shows them: sorted like the top strip, without the mode-off bonds (`off`, the
 * strip's grey 本局禁用 discs — a mode can disable half the core bonds, which would double a row this narrow) and,
 * like the strip (BondStrip), without the zero-count mapped rows: a strategy that replaces a bond's effect adds that
 * bond with count 0 so the popup can resolve it, also for a seat with no member of it — not a disc.
 * Exported for the bond popup's ‹ › (bondPopupNav) and the UI tests.
 */
export function flyBondList(bonds, lookup = (id) => data.lookup('bonds', id)) {
  return stripBondList(Array.isArray(bonds) ? bonds : [], lookup).filter((b) => !b.off);
}

/**
 * The bond popup's ‹ › list: the bonds of the place it was opened from, and whose they are. A disc of the top strip
 * (`from: 'strip'`) walks the strip's discs (stripBondList: no zero-count mapped row, §37.348); a disc of this flyout (`from: 'fly'`) walks that seat's row only — the
 * strip's list names another player's bonds, so ‹ › used to jump to the viewer's own strip (PR #922 review). Every
 * other popup (a card's chip, 本局信息) has no arrows.
 * @param {{ id?: string, ownerId?: string|null, from?: string }|null} open the open popup (game.js bondOpen)
 * @param {{ stripBonds?: any[]|null, stripOwnerId?: string|null, players?: any[]|null, seatBonds?: Record<string, any[]>|null,
 *   lookup?: (id:string)=>any }} [o] — `seatBonds`: the flyout's rows (game.js flyBonds), so ‹ › walk the discs as drawn
 * @returns {{ ids: string[], ownerId: string|null }}
 */
export function bondPopupNav(open, { stripBonds = null, stripOwnerId = null, players = null, seatBonds = null, lookup = (id) => data.lookup('bonds', id) } = {}) {
  if (open?.from === 'strip') return { ids: stripBondList(stripBonds, lookup).map((b) => b.bondId), ownerId: stripOwnerId ?? null };
  if (open?.from === 'fly') {
    const seat = (Array.isArray(players) ? players : []).find((p) => p?.playerId === open.ownerId);
    // an eliminated seat draws no row (m.public sends it no bonds; your own m.private ones go on): no arrows either
    const bonds = seat && seat.alive !== false && Array.isArray(seatBonds?.[open.ownerId]) ? seatBonds[open.ownerId] : seat?.bonds;
    return { ids: flyBondList(bonds, lookup).map((b) => b.bondId), ownerId: open.ownerId ?? null };
  }
  return { ids: [], ownerId: null };
}

/** The seat's bonds, icon only — no names, no empty-state copy (the reviewer's point against reusing BondStrip).
 * Each disc is the strip's disc for the same entry (bondStrip.js bondDisplay, §37.342): the ring by the version's rule
 * (盟约: N_N of the first threshold once active; 规程: the unbroken 1_1), the k-of-N member ring while inactive, the
 * stack count with the temporary layers (`total`, gold like the strip's: `has-temp-layers`), the tooltip's count over the first threshold (bondCountCap, the
 * popup's denominator). No stage numeral: the row is icon only. `bonds` are the entries the popup a disc opens reads
 * (game.js `flyBonds`: watchBonds.js playerBonds with the live / temporary layers), so the disc and the card agree.
 * `layersDisabled` (联防 / boss: layers no longer stack) freezes the pips as the top strip does.
 * Exported for the UI tests. */
export function FlyBonds({ bonds, ownerId, onBond = null, layersDisabled = false }) {
  const m = data.get('assets');
  const list = flyBondList(bonds);
  return list.map((b) => {
    const { record: rec, thresholds: th, count, tier, phased, tempLayers, total } = bondDisplay(b.bondId, b);
    const name = rec?.name || b.bondId;
    const cap = bondCountCap(th);
    const title = `${name} ${count}/${cap ?? '-'}${b.harmony > 0 ? t('（含调和 +{harmony}）', { harmony: b.harmony }) : ''}`;
    return html`<${BondDisc} key=${b.bondId} name=${name} icon=${bondIconUrl(m, b.bondId)}
      layers=${rec?.noStack ? undefined : total} tier=${tier} members=${count} minCount=${th[0] ?? 0}
      active=${!!b.active} phased=${phased} size="sm" showName=${false} layersDisabled=${layersDisabled} title=${title}
      class=${tempLayers > 0 ? 'has-temp-layers' : null} onClick=${onBond ? () => onBond(b.bondId, ownerId) : undefined} />`;
  });
}

/**
 * The operators a seat has on its field; the cell around this list is the sideways scroller. A click opens that
 * operator's card (`onOp`), the same TeamDetailPanel a bench / hand operator opens.
 */
function FlyOps({ ops, onOp = null }) {
  const list = Array.isArray(ops) ? ops : [];
  const thumb = (u) => html`<${UnitThumb} kind="chess" id=${u.id} rec=${flyOpRec(u)} size="xs" golden=${!!u.golden} class="team__fly-op" />`;
  return list.map((u, i) => {
    if (!onOp) return html`<${UnitThumb} key=${`${u.id}:${i}`} kind="chess" id=${u.id} rec=${flyOpRec(u)} size="xs"
      golden=${!!u.golden} class="team__fly-op" />`;
    const name = data.lookup('chess', u.id)?.name || charName(u.id) || u.id;
    return html`<button type="button" key=${`${u.id}:${i}`} class="team__fly-opbtn" title=${name} aria-label=${name}
      onClick=${() => onOp(u)}>${thumb(u)}</button>`;
  });
}

/** Strategy details open on mouse hover or keyboard focus; touch devices can tap to toggle. */
function FlyBand({ bandId, owner = null, shown = false, onOpen = null, onClose = null, onLeave = null }) {
  const touch = useRef(false);
  const b = typeof bandId === 'string' && bandId ? data.lookup('bands', bandId) : null;
  if (!b) return html`<div class="team__fly-band" role="group" aria-label=${t('策略')}></div>`;
  const show = (el) => onOpen?.(bandId, owner, el);
  return html`<button type="button" class="team__fly-band is-clickable" aria-label=${b.name || t('策略')}
    aria-describedby=${shown ? 'team-strategy-tip' : undefined}
    onPointerEnter=${(e) => { if (e.pointerType === 'mouse') show(e.currentTarget); }}
    onPointerLeave=${(e) => { if (e.pointerType === 'mouse') onLeave?.(); }}
    onFocus=${(e) => { if (!touch.current) show(e.currentTarget); }}
    onBlur=${() => onLeave?.()}
    onKeyDown=${(e) => { if (e.key === ' ') e.stopPropagation(); }}
    onPointerDown=${(e) => { touch.current = e.pointerType !== 'mouse'; }}
    onClick=${(e) => {
      if (touch.current) { touch.current = false; if (shown) onClose?.(); else show(e.currentTarget); }
      else if (e.detail === 0) show(e.currentTarget);
    }}><${BandIcon} bandId=${bandId} /></button>`;
}

/** Fixed positioning keeps the hover card outside the flyout's scrolling cells. */
function BandPopup({ band, onHold, onLeave }) {
  const box = useRef(null);
  const [pos, setPos] = useState(null);
  const b = data.lookup('bands', band.bandId);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !band.anchor) return undefined;
    const place = () => {
      const r = band.anchor.getBoundingClientRect();
      const vw = globalThis.innerWidth, vh = globalThis.innerHeight;
      const left = Math.max(8, Math.round(r.right + 8));
      const maxWidth = Math.max(0, vw - left - 8);
      el.style.maxWidth = `${maxWidth}px`;
      const top = Math.max(8, Math.min(Math.round(r.top), vh - el.getBoundingClientRect().height - 8));
      setPos(old => old?.left === left && old?.top === top && old?.maxWidth === maxWidth ? old : { left, top, maxWidth });
    };
    const observer = new ResizeObserver(place);
    observer.observe(el);
    observer.observe(band.anchor);
    const flyWindow = band.anchor.closest('.team__fly-window');
    if (flyWindow) observer.observe(flyWindow);
    globalThis.addEventListener('resize', place);
    place();
    return () => { observer.disconnect(); globalThis.removeEventListener('resize', place); };
  }, [band]);
  if (!b) return null;
  return html`<div ref=${box} class="team__fly-bandpop" id="team-strategy-tip" role="tooltip"
      onPointerEnter=${(e) => { if (e.pointerType === 'mouse') onHold(); }}
      onPointerLeave=${(e) => { if (e.pointerType === 'mouse') onLeave(); }}
      style=${pos ? `left:${pos.left}px;top:${pos.top}px;max-width:${pos.maxWidth}px` : 'visibility:hidden'}>
    <header class="team__fly-bandpop__head">
      <${BandIcon} bandId=${b.bandId} size="md" />
      <div class="team__fly-bandpop__titles">
        <small class="team__fly-bandpop__kicker">STRATEGY // ${band.owner ? t('{bandOwner} 的策略', { bandOwner: band.owner }) : t('我的策略')}</small>
        <b>${b.name}${b.effectName ? html` <small>${b.effectName}</small>` : null}</b>
      </div>
    </header>
    <${RichText} as="p" text=${b.descRaw || b.desc} class="team__fly-bandpop__desc" />
  </div>`;
}

/**
 * 「同盟盟约速查」: the avatar-opened window. A row is a three-column grid — bonds 1fr, on-field operators 1fr,
 * the strategy square — so both halves take the same width and the strategy always shares its row. Rows mirror the
 * roster heights (`rowH`, measured by TeamPanel), so each player stays aligned with their information. Every cell
 * pans sideways on its own (mouse drag or native touch pan); each close/reopen starts at the leftmost bond again.
 */
function BondsFlyout({ players, myId, open, onBond = null, flyOps = null, seatBonds = null, onOp = null, rowH = null, layersDisabled = false }) {
  const [mounted, leaving] = usePresence(open, 200);
  const rows = useRef(null);
  const drag = useRef(null);
  const dragged = useRef(false);
  const [bandPop, setBandPop] = useState(null);
  const bandTimer = useRef(null);
  const holdBand = () => clearTimeout(bandTimer.current);
  const closeBand = () => { holdBand(); setBandPop(null); };
  const leaveBand = () => { holdBand(); bandTimer.current = setTimeout(() => setBandPop(null), 150); };
  useEffect(() => () => clearTimeout(bandTimer.current), []);
  useEffect(() => { if (!open) closeBand(); }, [open]);
  // a click anywhere but the card / the square itself dismisses the band card (pointerdown, like the flyout's own)
  useLayoutEffect(() => {
    if (!bandPop) return undefined;
    const away = (e) => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest('.team__fly-bandpop') || e.target.closest('.team__fly-band')) return;
      closeBand();
    };
    const key = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.modal, .guide, .st, .offerov[role="dialog"]')) return;
      e.stopPropagation();
      closeBand();
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [bandPop]);
  useEffect(() => {
    if (!open || !rows.current) return;
    for (const cell of rows.current.querySelectorAll('.team__fly-cell')) cell.scrollLeft = 0;
  }, [open]);
  const openBand = (bandId, owner, el, playerId) => {
    holdBand();
    setBandPop(old => old?.anchor === el ? old : { bandId, owner: owner || null, anchor: el, playerId });
  };
  const cellAt = (e) => (e.target instanceof Element ? e.target.closest('.team__fly-cell') : null);
  const down = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const cell = cellAt(e);
    if (!cell || cell.scrollWidth <= cell.clientWidth + 1) return; // nothing to pan: leave the disc's click alone
    drag.current = { id: e.pointerId, x: e.clientX, left: cell.scrollLeft, cell, moved: false };
  };
  const move = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 4) {
      d.moved = true;
      dragged.current = true;
      d.cell.classList.add('is-dragging');
      // capture only once this is really a drag: capturing on pointerdown retargets the click and the disc never fires
      try { d.cell.setPointerCapture(e.pointerId); } catch { /* not captured */ }
    }
    if (d.moved) d.cell.scrollLeft = d.left - dx;
  };
  const up = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    d.cell.classList.remove('is-dragging');
    if (d.moved) { try { d.cell.releasePointerCapture(e.pointerId); } catch { /* already released */ } }
  };
  const clickCapture = (e) => {
    if (!dragged.current) return;
    dragged.current = false;
    e.preventDefault();
    e.stopPropagation();
  };
  const cell = (cls, empty, children) => html`<div class=${cx('team__fly-cell', cls, empty && 'is-empty')}>
    <div class="team__fly-track">${empty ? null : children}</div>
  </div>`;
  const row = (p) => {
    const h = rowH?.[p.playerId];
    const dead = p.alive === false;
    return html`<div key=${p.playerId} class=${cx('team__fly-row', p.playerId === myId && 'is-self')}
        style=${h ? `--fly-row-h:${h}px` : undefined}>
      ${cell('team__fly-bonds', dead, html`<${FlyBonds} bonds=${seatBonds?.[p.playerId] ?? p.bonds} ownerId=${p.playerId} onBond=${onBond} layersDisabled=${layersDisabled} />`)}
      ${cell('team__fly-ops', dead, html`<${FlyOps} ops=${flyOps?.[p.playerId]} onOp=${onOp ? (u) => onOp(u, p) : null} />`)}
      <${FlyBand} bandId=${dead ? null : p.bandId} owner=${p.playerId === myId ? null : p.name}
        shown=${bandPop?.playerId === p.playerId} onOpen=${(id, owner, el) => openBand(id, owner, el, p.playerId)}
        onClose=${closeBand} onLeave=${leaveBand} />
    </div>`;
  };
  return html`<div class=${cx('team__fly', open && 'is-open', leaving && 'is-leaving')}>
    ${mounted ? html`<div class="team__fly-window" id="team-bonds" role="region" aria-label=${t('同盟盟约速查')}
        aria-hidden=${open ? undefined : 'true'} inert=${!open}>
      <div class="team__fly-rows" ref=${rows} onPointerDown=${down} onPointerMove=${move}
        onPointerUp=${up} onPointerCancel=${up} onClickCapture=${clickCapture}>${players.map(row)}</div>
    </div>` : null}
    ${open && bandPop ? html`<${BandPopup} band=${bandPop} onHold=${holdBand} onLeave=${leaveBand} />` : null}
  </div>`;
}

/**
 * @param {{ pub:any, myId:string, watching:string|null, bubbles: Map<string,{id?:string,text?:string,seq:number,at?:number}>, onWatch:(p:any)=>void,
 *   compact?: boolean, teamLp?: number|null, self?: { lp?: number|null, pending: number, unite: boolean, left?: number|null } | null,
 *   cap?: number, uniteLocal?: Record<string, number> | null,
 *   flyOps?: Record<string, Array<{ id:string, golden?:number }>> | null, seatBonds?: Record<string, any[]> | null,
 *   onBond?: ((bondId:string, ownerId:string)=>void) | null,
 *   observe?: null | { observing: boolean, onBack: () => void },
 *   badges?: { pack: any, still?: boolean } | null }} props
 *   uniteLocal: the local 联防 replica's per-leaker counts while it is on screen (battle runner state().uniteLeft), else null
 *   badges: how the 完美连胜 / 领袖伤害 badges are drawn (ui/avatarBadges.js); null draws the CSS stand-ins
 *   flyOps: the per-viewer on-field operators (game.js flyOpsFor + mergeFlyOps); a seat missing here gets no operator column
 *   seatBonds: each seat's bond entries as the popup reads them (game.js flyBonds: watchBonds.js playerBonds with the live /
 *     temporary layers); a seat missing here uses its m.public `bonds`
 *   onBond: opens the bond detail popup for that seat (game.js openBond, `from: 'fly'`: its ‹ › walk that row, bondPopupNav)
 *   onOp: opens a flyout operator's card, called `(u, player)` (game.js setDetail, the bench operator's panel)
 *   layersDisabled: 联防 / boss — layers no longer stack, so the flyout discs freeze their pips like the top strip
 *   onFlyToggle: 浮窗展开 / 收起（game.js actions.peek → g.peek），服务端据此订阅 / 解除；观战席不传（服务端拒绝其 g.peek，
 *     它的干员列只显示屏上的战场）
 *   online: 连接是否在线 —— false → true 的边沿会收起浮窗（服务端此时已丢弃订阅）
 */
export function TeamPanel({ pub, myId, watching, bubbles, onWatch, compact = false, observe = null, self: selfLive = null, cap = 10, uniteLocal = null, spMarks = null, flyOps = null, seatBonds = null, onBond = null, onOp = null, layersDisabled = false, onFlyToggle = null, online = null, badges = null }) {
  const [openPid, setOpenPid] = useState(null);
  const bondsOpen = openPid !== null;
  const selected = useRef(null);
  const select = (pid) => { selected.current = pid; setOpenPid(pid); };
  const [rowH, setRowH] = useState({});
  const aside = useRef(null);
  // The last navigation target, to avoid duplicate requests while its watched field is updating.
  const askedAt = useRef(/** @type {{ id: string|null, at: number }} */ ({ id: null, at: 0 }));
  const phaseKey = `${pub?.phase}:${pub?.round}`;
  // 同盟盟约速查（g.peek）：浮窗展开 / 收起时告知服务端，由它回各座位的干员名单。挂载时（以及从未展开过时）
  // 不发 `open: false`：那时没有订阅可解除，每次进入对局画面都会白发一个请求
  const flyAsked = useRef(false);
  useEffect(() => {
    if (!onFlyToggle || (!bondsOpen && !flyAsked.current)) return;
    flyAsked.current = true;
    onFlyToggle(bondsOpen);
  }, [bondsOpen]);
  // 进入新的阶段 / 回合即结束这次速查：浮窗在此收起，服务端也在同一回合 / 阶段边界丢弃订阅
  // （MatchPeek._flushPeek）——服务端这半是冗余保险，覆盖从未发送 close 的客户端
  const phaseRef = useRef(phaseKey);
  useEffect(() => {
    if (phaseRef.current === phaseKey) return;
    phaseRef.current = phaseKey;
    select(null);
  }, [phaseKey]);
  // 连接恢复：断线时服务端已丢弃订阅；回到对局的玩家想先看到战场，而不是一个显示着过期速查的面板
  const onlineRef = useRef(online);
  useEffect(() => {
    const was = onlineRef.current;
    onlineRef.current = online;
    if (online === true && was === false) select(null);
  }, [online]);
  const players = sortedPlayers(pub);
  // Mirror roster row heights without adding a row for navigation actions. ResizeObserver also follows nearby controls.
  useEffect(() => {
    if (!players.length) return undefined;
    const el = aside.current;
    if (!el) return undefined;
    const anchor = () => {
      const box = el.getBoundingClientRect();
      let widest = box.width;
      for (const row of el.querySelectorAll('.team__row')) {
        widest = Math.max(widest, row.getBoundingClientRect().right - box.left);
      }
      return Math.round(widest);
    };
    // Keep the last measured anchor through the fade-out. The next opening measures the roster again.
    if (!bondsOpen) return undefined;
    let frame = null;
    // The strategy is as tall as the shortest row. The hover card and two scrolling halves share the space
    // between the widest roster row and the command column.
    const layout = (heights) => {
      const box = el.getBoundingClientRect();
      const gutter = 6;
      const vw = globalThis.innerWidth || document.documentElement.clientWidth || 1920;
      const square = heights.length ? Math.round(Math.min(...heights)) : 64;
      const left = anchor();
      // the right-hand 指令 / 效果 column (game.js .gm__effects): keep its width free, plus a small gutter
      const fx = el.closest('.gm__hud')?.querySelector('.gm__effects') || document.querySelector('.gm__effects');
      const fxRect = fx ? fx.getBoundingClientRect() : null;
      const reserve = fxRect && fxRect.width > 0 ? Math.round(vw - fxRect.left) + 8 : 18;
      el.style.setProperty('--fly-left', `${left}px`);
      el.style.setProperty('--fly-square', `${square}px`);
      // the strategy square is a column of the window's row, so only the reserved gutters come off the width
      let width = Math.round(vw - box.left - left - gutter - reserve);
      // a short viewport (640×360) lifts the shop's 剩余可放置角色 / 冻结 / 刷新 into the roster's height: the window ends
      // left of them, so a tap there still reaches the button (and closes the flyout) instead of landing in `.team`
      const start = box.left + left + gutter;
      for (const tool of document.querySelectorAll('.shopbar__tools .toolbtn, .shopbar__tools .shopbar__remain')) {
        const r = tool.getBoundingClientRect();
        if (r.width > 0 && r.top < box.bottom && r.bottom > box.top && r.right > start) width = Math.min(width, Math.round(r.left - start - 8));
      }
      // The cells scroll individually; a minimum window width would push the strategy off a narrow viewport.
      // Keep the strategy reachable: two cells have four padding edges, plus 36px for gaps and rounding.
      const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const cell = el.querySelector('.team__fly-cell');
      const cellPadding = cell ? parseFloat(getComputedStyle(cell).paddingLeft) : 0;
      const tipReserve = Math.max(0, Math.min(rootSize * 3.4, vw * .44, width - square - 4 * cellPadding - 36));
      el.style.setProperty('--fly-w', `${Math.max(0, width - tipReserve - 8)}px`);
    };
    const measure = () => {
      frame = null;
      const next = {};
      for (const row of el.querySelectorAll('.team__row[data-pid]')) {
        next[row.dataset.pid] = Math.round(row.getBoundingClientRect().height * 10) / 10;
      }
      layout(Object.values(next));
      setRowH((old) => {
        const keys = Object.keys(next);
        return keys.length === Object.keys(old).length && keys.every((k) => old[k] === next[k]) ? old : next;
      });
    };
    const schedule = () => { if (frame == null) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    for (const row of el.querySelectorAll('.team__row')) observer.observe(row);
    // Commands and shop tools can change size while the flyout stays open, independently of the roster.
    for (const obstacle of (el.closest('.gm') || document).querySelectorAll('.gm__effects, .shopbar, .shopbar__tools')) {
      observer.observe(obstacle);
    }
    measure();
    globalThis.addEventListener('resize', schedule);
    return () => {
      observer.disconnect();
      globalThis.removeEventListener('resize', schedule);
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [bondsOpen, phaseKey, openPid, watching, players.length]);
  // A click anywhere outside the open flyout closes it — the command column, the shop, 升级 / 冻结 / 刷新, the bench,
  // 查看迎击单位, 本局信息. The roster keeps it open, as do a
  // click in the flyout's own gaps (between rows / cells, the window's padding) and the bond popup / operator card.
  useLayoutEffect(() => {
    if (!bondsOpen) return undefined;
    const onDown = (e) => {
      const target = e.target;
      // `.bpop-nav`: the popup's ‹ › arrows sit beside the `.bpop` card, not inside it
      if (target instanceof Element && target.closest('.team, .bpop, .bpop-nav, .dpanel')) return;
      select(null);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.bpop, .dpanel, .team__fly-bandpop, .modal, .guide, .st, .offerov[role="dialog"]')) return;
      e.stopPropagation();
      select(null);
      const row = [...(aside.current?.querySelectorAll('.team__row') || [])].find(el => el.dataset.pid === openPid);
      row?.querySelector('.team__btn')?.focus();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [bondsOpen, openPid]);
  if (!players.length) return null;
  // a boss round: the viewer's pair framed in green from the round's start (item 51 — the official bg_team_border,
  // tinted like the official green; a plain green ring without the local art)
  const team = teamFrameIds(pub, myId);
  const frameArt = team.size ? localAsset('ui/battle', 'bg_team_border') : null;
  const askedRecently = (p) => askedAt.current.id === p?.playerId && Date.now() - askedAt.current.at < AVATAR_CLICK_GAP_MS;
  const noteAsked = (p) => { askedAt.current = { id: p.playerId, at: Date.now() }; };
  const click = (p, self) => {
    const action = playerAvatarAction({ openPid: selected.current, player: p, self, observe, watching, askedRecently: askedRecently(p) });
    if (action === 'open') { select(p.playerId); return; }
    select(null);
    if (action === 'back') { noteAsked(p); observe.onBack(); }
    else if (action === 'watch') { noteAsked(p); onWatch(p); }
  };
  return html`<aside ref=${aside} class=${cx('team', compact && 'team--compact')} aria-label=${t('同盟成员')}>
    ${players.map((p) => {
      const self = p.playerId === myId;
      const status = p.alive === false ? 'dead' : p.status;
      const meta = STATUS_META[status] || STATUS_META.acting;
      const watched = teammateFieldShown(watching, p);
      const bubble = bubbles?.get(p.playerId);
      const offline = p.connected === false && !p.isBot;
      const open = bondsOpen && openPid === p.playerId;
      const back = self && (observe ? observe.observing : !!watching && !teammateFieldShown(watching, p));
      const returning = self && (back || (bondsOpen && openPid !== myId));
      const viewing = !self && open;
      const title = returning ? t('返回战场') : viewing ? t('前往查看') : `${t('同盟盟约速查')} · ${p.name}`;
      const lp = rowLp(p, pub, self ? selfLive : null, { uniteLocal, cap });
      const inTeam = team.has(p.playerId);
      const streakLevel = p.alive === false ? 0 : Math.trunc(Number(p.winStreakLevel) || 0);
      const damageLevel = p.alive === false ? 0 : Math.trunc(Number(p.bossDamageLevel) || 0);
      const tip = [inTeam && !self ? `${title} · ${t('与你在同一战场')}` : title, ...avatarBadgeTips(p)].join('\n');
      return html`<div key=${p.playerId} data-pid=${p.playerId} class=${cx('team__row', self && 'is-self', inTeam && 'is-team', watched && 'is-watched', p.alive === false && 'is-dead', open && 'is-open')}>
        <button type="button" class=${cx('team__btn', (returning || viewing) && 'has-action')} onClick=${() => click(p, self)} title=${tip} aria-expanded=${String(bondsOpen)} aria-controls="team-bonds"
          onKeyDown=${(e) => { if (e.key === ' ') e.stopPropagation(); }}>
          <${PlayerAvatar} player=${p} self=${self} />
          ${damageLevel > 0 ? html`<${BossDamageBadge} pack=${badges?.pack || null} level=${damageLevel} still=${!!badges?.still} />` : null}
          ${inTeam ? html`<span class=${cx('team__frame', !frameArt && 'team__frame--plain')} style=${frameArt ? `--frame:url("${frameArt}")` : undefined} aria-hidden="true"></span>` : null}
          <span class="team__seat num">P${(p.seat ?? 0) + 1}</span>
          ${p.isBot ? html`<span class="team__ai">AI</span>` : null}
          ${self ? html`<span class=${cx('team__you', streakLevel > 0 && 'is-low')}><${Icon} name="user" /></span>` : null}
          ${streakLevel > 0 ? html`<${WinStreakBadge} pack=${badges?.pack || null} level=${streakLevel} streak=${p.winStreak} still=${!!badges?.still} />` : null}
          ${spMarks?.get(p.playerId) === 'done' ? html`<span class="team__spmark is-done" title=${t('已完成选择')}><${Icon} name="check" /></span>`
            : spMarks?.get(p.playerId) === 'turn' ? html`<span class="team__spmark is-turn" title=${t('正在决策…')}><i></i><i></i><i></i></span>` : null}
          ${returning || viewing ? html`<span class=${cx('team__avatar-action', returning ? 'is-return' : 'is-view')} aria-hidden="true">
            <${Icon} name=${returning ? 'return' : 'eye'} /></span>` : null}
        </button>
        <div class="team__info">
          <${DoctorName} player=${p} class="team__name" />
          <div class="team__line">
            <${LpTower} value=${lp.lp} size="sm" tone=${Number.isFinite(lp.lp) && lp.lp - lp.pending <= 5 ? 'danger' : null} pending=${lp.pending}
              tip=${rowLpTip(lp, cap)} />
            ${lp.left != null ? html`<${MissTag} n=${lp.left} name=${self ? null : p.name || t('博士')} />` : null}
            <${Tooltip} text=${offline ? t('连接已断开') : t(meta.text)} placement="right">
              <span class=${cx('team__status', `is-${meta.tone}`, offline && 'is-offline', (offline || STATUS_SPRITE[status]) && localAsset('ui/battle', offline ? 'icon_lost_connect' : STATUS_SPRITE[status]) && 'has-sprite')} aria-label=${t(meta.text)}>
                ${offline ? html`<${LocalSprite} name="icon_lost_connect" fallback=${html`<${Icon} name="wifiOff" />`} />`
                  : STATUS_SPRITE[status] ? html`<${LocalSprite} name=${STATUS_SPRITE[status]} fallback=${html`<${GIcon} name=${meta.glyph} />`} />`
                  : html`<${GIcon} name=${meta.glyph} />`}
              </span>
            <//>
          </div>
        </div>
        ${bubble ? html`<${EmoteBubble} key=${bubble.seq} id=${bubble.id} text=${bubble.text} at=${bubble.at} class="team__bubble" />` : null}
      </div>`;
    })}
    <${BondsFlyout} players=${players} myId=${myId} open=${bondsOpen}
      onBond=${onBond} flyOps=${flyOps} seatBonds=${seatBonds} onOp=${onOp} rowH=${rowH} layersDisabled=${layersDisabled} />
  </aside>`;
}
