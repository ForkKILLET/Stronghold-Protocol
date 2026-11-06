import { CommunicationDock, CommunicationActivity } from '../ui/communication.js';
// BAND_DRAFT: compact pre-merge order rows (number, doctor avatar, state and strategy).
// The default strategy, previews, confirmed picks and teammate browsing share a fixed grid/detail layout.
// Picked/previewed teammate strategies can be inspected without changing our authoritative pick;
// doctor avatars keep the existing public-profile entry. Skip and confirm stay beside each other.
// One server-owned turn deadline is shown in StepHeader; solo/soloUntimed do not count down.
// Highlight changes report g.bandFocus. Timeout uses that choice if free, then 华法琳, then the first free strategy.
// 本局信息 reuses MatchInfoDialog; a turn change closes it. The held final screen is inert before BATTLE_CHECK.
// The official corner badge uses strategyBadgeIds (bands victorCount); the detail pane keeps its win count.
// TurnBanner/audio and content/version rules retain their existing behavior.

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel, useTicker, secondsLeft } from '../ui/components.js';
import { useGameData, BandIcon, RichText, PlayerAvatar, LpTower, Sprite } from '../ui/gameComponents.js';
import { StepHeader, ExitModal } from '../ui/matchChrome.js';
import { MatchInfoDialog, matchInfoModel, MatchBondDialog } from '../ui/matchInfo.js';
import { MatchEnemies } from '../ui/matchEnemies.js';
import { actions, act } from '../ui/gameActions.js';
import { normalizeDraft, sortedPlayers } from '../ui/gameLogic.js';
import { useStore } from '../store.js';
import { data } from '../data.js';
import { audio } from '../audio.js';
import { TurnBanner, TURN_BANNER_LATE_MS } from '../ui/turnBanner.js';
import { onBootArt, preloadBootArt } from '../ui/protocolBoot.js';
import { reducedMotion } from '../ui/device.js';
import { aggregateStats, peekStatsRecords, strategyBadgeIds } from '../ui/stats.js';
import { modeOffBonds, bandOffBonds, bandOffLine } from '../ui/gameLogic.js';
import { t, tParts, tName } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** 本局禁用 on a strategy card whose bonds `names` the mode switches off (bandOffBonds); nothing otherwise. */
export function BandOffTag({ names = [] }) {
  return names.length ? html`<span class="dband__off" title=${bandOffLine(names)}>${t('本局禁用')}</span>` : null;
}

/** The detail pane's note for such a strategy: "本局禁用【拉特兰】盟约，此策略效果可能无法发挥" (the bond names struck through). */
export function BandOffNote({ names = [] }) {
  if (!names.length) return null;
  return html`<p class="draft-detail__off" role="note" aria-label=${bandOffLine(names)}><${Icon} name="info" /><span>${tParts('本局禁用{names}盟约，此策略效果可能无法发挥', { names: names.map((n, i) => html`<span key=${i}>${tParts('【{name}】', { name: html`<s class="draft-detail__offname">${n}</s>` })}</span>`) })}</span></p>`;
}

/**
 * Bands selectable in a mode (modeTypeList contains the mode's type), sorted by sortId.
 * @param {any[]} bands
 * @param {string|null} modeType 'SINGLE'|'MULTI'
 */
export function allowedBands(bands, modeType) {
  const sid = (b) => (Number.isFinite(b.sortId) ? b.sortId : 99);
  return (Array.isArray(bands) ? bands : [])
    .filter((b) => b && (!modeType || !Array.isArray(b.modeTypeList) || b.modeTypeList.includes(modeType)))
    .sort((a, b) => sid(a) - sid(b) || (a.bandId < b.bandId ? -1 : a.bandId > b.bandId ? 1 : 0));
}

/** The official default strategy of an automatic assignment (data/config.json bandDraft.timeoutBandId). */
export const DEFAULT_TIMEOUT_BAND = 'band_bldsk';

/**
 * The strategy the server assigns me when my turn times out (server/match/match/phases.js defaultBand): the official default
 * 「华法琳」 while no teammate holds it, else the first free strategy in draft order (sortId) — never one a teammate
 * already picked (队友已选).
 * @param {any[]} bands allowedBands(...) (sortId order)
 * @param {Map<string, any>} taken teammateBands(...)
 * @param {string} [defaultId]
 * @returns {string|null}
 */
export function timeoutBand(bands, taken, defaultId = DEFAULT_TIMEOUT_BAND) {
  const list = Array.isArray(bands) ? bands : [];
  const has = (id) => !!(taken && typeof taken.has === 'function' && taken.has(id));
  if (defaultId && !has(defaultId) && (!list.length || list.some((b) => b.bandId === defaultId))) return defaultId;
  return list.find((b) => !has(b.bandId))?.bandId || defaultId || null;
}

/**
 * Bands taken by teammates (队友已选): bandId → the picking players (never the viewer).
 * @param {Map<string, string>} picks normalizeDraft(...).picks (playerId → bandId)
 * @param {string} myId
 */
export function teammateBands(picks, myId) {
  const out = new Map();
  for (const [pid, bid] of picks instanceof Map ? picks : []) {
    if (pid === myId || typeof bid !== 'string') continue;
    if (!out.has(bid)) out.set(bid, []);
    out.get(bid).push(pid);
  }
  return out;
}

/**
 * The band the detail pane shows (= the highlighted band a turn that runs out takes): the current one, else my pick,
 * else the band a timeout would give me (timeoutBand: 「华法琳」 while free, else the first free one). When it is my
 * turn and the shown band was taken meanwhile (队友已选), that default instead (confirm would be disabled).
 * @param {string|null} sel
 * @param {{ bands: any[], taken: Map<string, any>, myPick: string|null, myTurn: boolean, defaultId?: string }} o
 */
export function draftSelection(sel, { bands, taken, myPick, myTurn, defaultId = DEFAULT_TIMEOUT_BAND }) {
  if (!Array.isArray(bands) || !bands.length) return sel;
  const free = timeoutBand(bands, taken, defaultId) || bands[0].bandId;
  if (!sel) return myPick || free;
  if (!myPick && myTurn && taken.has(sel)) return free;
  return sel;
}

/**
 * The strategy a turn that runs out assigns me (server Match.timeoutBand): the highlighted band while it is one of
 * the mode's and no teammate holds it, else timeoutBand. Null after my pick.
 * @param {string|null} sel the highlighted band
 * @param {{ bands: any[], taken: Map<string, any>, myPick?: string|null, defaultId?: string }} o
 */
export function autoPickBand(sel, { bands, taken, myPick = null, defaultId = DEFAULT_TIMEOUT_BAND }) {
  if (myPick) return null;
  const list = Array.isArray(bands) ? bands : [];
  const has = (id) => !!(taken && typeof taken.has === 'function' && taken.has(id));
  if (sel && !has(sel) && list.some((b) => b.bandId === sel)) return sel;
  return timeoutBand(list, taken, defaultId);
}

/**
 * The tip under the co-op draft order: the one skip, the turn clock and what a turn that runs out assigns me (the
 * highlighted band while free — autoPickBand). Untimed drafts (a single human) name no clock.
 * @param {{ timed: boolean, turnSeconds?: number|null, autoName?: string|null, selected?: boolean }} o
 *   selected: the auto pick is the highlighted band (not the default standing in for a band a teammate holds)
 */
export function draftTip({ timed, turnSeconds = null, autoName = null, selected = true }) {
  const skip = t('联合模拟在选择策略时可以进行一次跳过');
  if (!timed) return t('{skip}；本局不限时', { skip });
  const clock = Number(turnSeconds) > 0 ? t('每位博士有 {n} 秒', { n: Math.round(turnSeconds) }) : t('每位博士限时决策');
  if (!autoName) return t('{skip}；{clock}', { skip, clock });
  return selected ? t('{skip}；{clock}，超时将自动选择当前选中的「{autoName}」', { skip, clock, autoName })
    : t('{skip}；{clock}，超时将自动选择「{autoName}」', { skip, clock, autoName });
}

/**
 * The step header's countdown during the draft: the current turn's (m.public.deadline = draft.turnDeadline) with a
 * turn's length as the gauge total — null when the draft is untimed.
 * @param {any} pub m.public
 * @returns {{ deadline: number, total: number|null } | null}
 */
export function draftClock(pub) {
  const d = pub && typeof pub.draft === 'object' ? pub.draft : null;
  if (!d || d.untimed) return null;
  const deadline = Number(pub.deadline) > 0 ? Number(pub.deadline) : Number(d.turnDeadline) || 0;
  if (!(deadline > 0)) return null;
  return { deadline, total: Number(d.turnSeconds) > 0 ? Number(d.turnSeconds) : null };
}

/**
 * The status line of the 本局信息 dialog: what the draft does while the dialog covers it — my pick, else whose turn it is
 * with the turn's seconds left (the step header's number; none when untimed), warning at ≤ 10 s like the countdown.
 * @param {{ myPick?: string|null, pickName?: string|null, myTurn: boolean, turnName?: string|null, secs?: number|null,
 *   waiting?: boolean }} o waiting: teammates still have to pick after my pick
 * @returns {{ text: string, secs: number|null, tone: 'mint'|'gold'|'warn'|'dim' }}
 */
export function draftInfoStatus({ myPick = null, pickName = null, myTurn, turnName = null, secs = null, waiting = false }) {
  if (myPick) return { text: `${t('已选择「{name}」', { name: pickName || '' })}${waiting ? t('，等待其他博士') : ''}`, secs: null, tone: 'mint' };
  const s = Number.isFinite(secs) ? Math.max(0, Math.round(secs)) : null;
  const tone = s != null && s <= 10 ? 'warn' : 'gold';
  if (myTurn) return { text: t('轮到你决策'), secs: s, tone };
  return { text: turnName ? t('{turnName} 决策中', { turnName }) : t('等待轮到你'), secs: s, tone: s != null ? tone : 'dim' };
}

/** Nothing known yet (before the records are read, or none). */
const NO_RECORDS = Object.freeze({ won: Object.freeze({}), badges: new Set(), trophies: 0 });

/**
 * What the wall shows from this browser's records (ui/stats.js): `won` bandId → runs won with it (the detail pane's
 * 已通过模拟 N 次), `badges` the strategies with the official corner badge — strategyBadgeIds, the stats page's rule: the
 * band's own victorCount (3 for all 40 in activity_table / data/bands.json) of clears, quit, test and 入门协议 runs left
 * out — and `trophies` for the name card's medal.
 * @param {any[]} records peekStatsRecords()
 * @param {Record<string, any>|any[]} bands data.get('bands')
 * @returns {{ won: Record<string, number>, badges: Set<string>, trophies: number }}
 */
export function draftRecords(records, bands) {
  try {
    const agg = aggregateStats(records);
    const won = Object.fromEntries(Object.entries(agg.bands || {}).map(([id, b]) => [id, b.wins | 0]).filter(([, n]) => n > 0));
    return { won, badges: new Set(strategyBadgeIds(records, bands)), trophies: agg.trophies || 0 };
  } catch { return NO_RECORDS; }
}

/** 「【effect】 description」 of a strategy (the data's description usually opens with the 【effect】 already). */
function BandText({ band, class: cls }) {
  const text = band.descRaw || band.desc || '';
  const head = band.effectName && !String(text).includes(`【${band.effectName}】`) ? `【${band.effectName}】` : '';
  return html`<p class=${cls}>${head}<${RichText} text=${text} /></p>`;
}

/**
 * One doctor of the draft order: the name card (the 名片干员 art, avatar, name, state), the strategy box (⌛ 决策中 / •••
 * / the pick with 🔍, which opens it) and ✓ outside it; a beam runs along the row when the pick lands (useRise).
 * `arts`: the 名片干员 pictures in order of preference (the outfit's, then the operator's default — an outfit file that fails
 * to load falls back to the default as on the seat cards, §35.51), null for none.
 * @param {{ p: any, i: number, picked: string|null, cur: boolean, self: boolean, arts: (string|null)[]|null, medal: string|null,
 *   gd: any, onPeek: (bandId: string) => void }} props
 */
function OrderRow({ p, i, picked, cur, self, gd, onPeek, preview = null, solo = false }) {
  const pband = picked ? gd.band(picked) : null;
  const viewed = picked || (!self && preview);
  return html`<div class=${cx('dorder', cur && 'is-cur', picked && 'is-done', self && 'is-self')}>
    ${!solo ? html`<span class="dorder__idx num">${i + 1}</span>` : null}
    <${PlayerAvatar} player=${p} self=${self} profileLink=${true} />
    <div class="dorder__text">
      <b class="dorder__name"><span>${p.name || t('博士')}</span>${p.isBot ? html`<span class="dorder__ai">AI</span>` : null}</b>
      <span class="dorder__state">${picked ? html`<span class="t-mint">${pband?.name || t('已选择')}</span>`
        : cur ? html`<span class="t-gold"><${Icon} name="hourglass" />${t('决策中')}</span>`
        : html`<span class="t-dim"><${Icon} name="dots" />${t('等待中')}</span>`}</span>
      ${!picked && preview ? html`<span class="dorder__preview">${t('预选')} · ${gd.band(preview)?.name || preview}</span>` : null}
    </div>
    ${viewed ? html`<button type="button" class=${cx('dorder__box', !picked && 'dorder__preview-icon')} onClick=${() => onPeek(viewed)} title=${t('查看「{name}」', { name: gd.band(viewed)?.name || '' })}>
      <${BandIcon} bandId=${viewed} size="sm" />${picked ? html`<span class="dorder__check"><${Icon} name="check" /></span>` : null}
    </button>` : html`<span class="dorder__box">${cur && self ? html`<${Sprite} k="bandChoose/youturn_finger" class="dorder__finger" fallback=${html`<${Icon} name="chevronLeft" />`} />` : null}</span>`}
  </div>`;
}

/** BAND_DRAFT screen. */
export function BandDraftScreen({ held = null } = {}) {
  // `held`: the draft as it ended, while screens/game.js keeps this screen on 已选定策略 after the draft (heldDraftPub)
  const livePub = useStore((s) => s.match.public);
  const pub = held || livePub;
  const priv = useStore((s) => s.match.private);
  const myId = useStore((s) => s.me.playerId);
  const roomSolo = useStore((s) => s.room?.mode === 'solo');
  const gd = useGameData();
  const [sel, setSel] = useState(null);
  const [peek, setPeek] = useState(null);    // a teammate's / my own pick opened from its row (read-only)
  const [busy, setBusy] = useState(null);
  const [exit, setExit] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [bondId, setBondId] = useState(null);
  useEffect(() => { setBondId(null); }, [infoOpen]);

  const mode = gd.config?.modes?.[pub?.modeId];
  const offBonds = modeOffBonds(mode); // the bonds this mode never activates (标准: 10 of 23)
  const solo = roomSolo || mode?.type === 'SINGLE' || String(pub?.modeId || '').includes('single');
  const bands = useMemo(() => allowedBands(gd.list('bands'), mode?.type || (solo ? 'SINGLE' : 'MULTI')), [gd.ready, mode?.type, solo, data.locale(), data.contentId()]);
  const players = sortedPlayers(pub);
  const draft = normalizeDraft(pub?.draft, players);
  const myPick = draft.picks.get(myId) || priv?.bandId || null;
  const inOrder = solo || draft.order.includes(myId);
  const myTurn = !myPick && (solo || draft.turnPid === myId);
  const skipsLeft = draft.skipsLeft.has(myId) ? draft.skipsLeft.get(myId) : (skipped ? 0 : 1);
  // the last doctor still to pick cannot skip (no one to pass the turn to)
  const canSkip = !solo && myTurn && skipsLeft > 0 && draft.order.filter((pid) => !draft.picks.has(pid)).length > 1;
  const taken = solo ? new Map() : teammateBands(draft.picks, myId);
  const pickers = new Map(); // bandId → players
  for (const [pid, bid] of draft.picks) {
    const p = players.find((x) => x.playerId === pid);
    if (!pickers.has(bid)) pickers.set(bid, []);
    pickers.get(bid).push(p || { playerId: pid, name: '?' });
  }

  // default selection: my pick, else what a timeout gives me (华法琳 while free); when my turn comes while the selected
  // band has been taken by a teammate meanwhile (队友已选), move the selection back to that default
  const defaultId = gd.config?.bandDraft?.timeoutBandId || DEFAULT_TIMEOUT_BAND;
  const takenKey = [...taken.keys()].sort().join(',');
  useEffect(() => {
    const next = draftSelection(sel, { bands, taken, myPick, myTurn, defaultId });
    if (next !== sel) setSel(next);
  }, [bands.length, myPick, myTurn, takenKey]);
  // "your turn" cue: the sound and the event's 请选择策略 band (ui/turnBanner.js) once its art is in — co-op and solo
  // alike (the maintainer's decision of 2026-10-21, as in PR #643; [ASSUMED] for solo, see the header). The sprites are
  // fetched early (a room entered, the match screen, this screen's mount); a turn whose art is still loading plays the
  // band as soon as it arrives — never blocking input — up to TURN_BANNER_LATE_MS after the turn began, past which the
  // header's 请选择策略 says it alone.
  useEffect(() => { preloadBootArt(); }, []);
  const [turnBanner, setTurnBanner] = useState(0);
  useEffect(() => {
    if (!myTurn) return undefined;
    setPeek(null);
    audio.sfx('yourTurn');
    if (reducedMotion()) return undefined;
    const since = Date.now();
    return onBootArt(() => { if (Date.now() - since <= TURN_BANNER_LATE_MS) setTurnBanner((n) => n + 1); });
  }, [myTurn]);
  // the 本局信息 dialog never outlives the turn it was opened in: a turn change (a pick, a skip, a turn that ran out, an
  // AI pick) or my pick closes it, so whoever's turn begins sees the draft
  const turnKey = `${draft.turnPid || ''}|${myPick || ''}`;
  useEffect(() => { setInfoOpen(false); }, [turnKey]);
  // the held screen (inert) keeps no dialog open over it
  useEffect(() => { if (held) { setInfoOpen(false); setExit(false); } }, [!!held]);

  // one countdown (user playtest #4 item 4): the current turn's — m.public.deadline
  const clock = solo ? null : draftClock(pub);
  // the highlighted band is what a turn that runs out takes (Match.timeoutBand): report every change before my pick
  const timed = !solo && !!pub?.draft && !pub.draft.untimed;
  const focusSent = useRef(null);
  useEffect(() => {
    // (a spectator seat — community report #26 — is in no draft order: it never reports)
    if (solo || myPick || !sel || focusSent.current === sel || !draft.order.includes(myId)) return;
    focusSent.current = sel;
    act('g.bandFocus', { bandId: sel }, { sfx: false, quiet: true });
  }, [sel, solo, myPick]);

  // what a timeout gives me: the highlighted band while free, else the default (never 队友已选 — match/phases.js timeoutBand)
  const autoId = autoPickBand(sel, { bands, taken, myPick, defaultId });
  const autoName = (autoId && gd.band(autoId)?.name) || gd.band(defaultId)?.name || tName('华法琳');

  const band = sel ? gd.band(sel) : null;
  const selTaken = !!band && taken.has(band.bandId);
  const confirm = async () => {
    if (!band || busy || !myTurn || selTaken) return;
    setBusy('pick');
    await actions.band(band.bandId);
    setBusy(null);
  };
  const skip = async () => {
    if (busy || !canSkip) return;
    setBusy('skip');
    if (await actions.bandSkip()) setSkipped(true);
    setBusy(null);
  };
  const pickTile = (id) => { if (myPick) setPeek(id); else { setSel(id); setPeek(null); } audio.sfx('tab', { volume: 0.5 }); };
  const peekBand = (id) => { setPeek(id); audio.sfx('tab', { volume: 0.5 }); };
  const turnName = players.find((p) => p.playerId === draft.turnPid)?.name;
  useTicker(clock ? 250 : 0);
  const turnSecs = clock ? secondsLeft(clock.deadline) : null;
  const turnLen = Number(pub?.draft?.turnSeconds) > 0 ? Math.round(pub.draft.turnSeconds) : null;
  // 本局信息: the briefing's blocks (built only while the dialog is open) and the draft's state under it
  const info = infoOpen ? matchInfoModel(pub, { bonds: gd.list('bonds'), chess: gd.chess, mode, priv, diyData: { chess: data.get('chess'), backups: data.get('backups') } }) : null;
  const infoStatus = infoOpen ? draftInfoStatus({ myPick, pickName: myPick ? gd.band(myPick)?.name : null, myTurn, turnName, secs: turnSecs,
    waiting: !solo && !draft.done }) : null;

  // 名片干员 art of the order rows (as on the room's seat cards: the doctor's pick, else one chosen by the player id), in
  // this browser's records (up to the stats store's size): read once, after the screen and its entry are up, not while
  // it mounts
  const [local, setLocal] = useState(NO_RECORDS);
  useEffect(() => {
    const later = globalThis.requestIdleCallback ? (fn) => globalThis.requestIdleCallback(fn, { timeout: 1200 }) : (fn) => setTimeout(fn, 300);
    const cancel = globalThis.cancelIdleCallback && globalThis.requestIdleCallback ? (id) => globalThis.cancelIdleCallback(id) : (id) => clearTimeout(id);
    const id = later(() => setLocal(draftRecords(peekStatsRecords(), data.get('bands'))));
    return () => cancel(id);
  }, []);
  // what the right side shows: 已选定策略 after my pick, else the detail pane once opened, else only the wall
  const allPicked = !!draft.done || (draft.order.length > 0 && draft.order.every((pid) => draft.picks.has(pid)));
  // Every draft state keeps the same three columns, including after our confirmed pick.
  const view = 'detail';
  const shownBand = peek ? gd.band(peek) : band;
  const rows = solo ? players.filter((p) => p.playerId === myId) : draft.order.map((pid) => players.find((p) => p.playerId === pid)).filter(Boolean);

  const head = allPicked ? html`<div class="dturn is-done"><span class="dturn__txt"><b>${t('策略选择完成')}</b><span>${t('正在进入模拟…')}</span></span><${Icon} name="hourglass" class="dturn__glass" /></div>`
    : myTurn ? html`<div class="dturn is-turn">
        <span class="dturn__go"><${Sprite} k="bandChoose/youturn_finger" class="dturn__finger" fallback=${html`<${Icon} name="chevronLeft" class="dturn__finger" />`} />
          <b>${t('请选择策略')}</b></span>

      </div>`
    : turnName ? html`<div class="dturn"><span class="dturn__txt"><b>${turnName}</b><span>${t('正在选择策略…')}</span></span><${Icon} name="hourglass" class="dturn__glass" /></div>`
    : null;

  // held after the draft (the server is already in BATTLE_CHECK): only to look at — 离开, 本局信息 and the 🔍 boxes would
  // open dialogs the match screen tears down a moment later
  return html`<div class=${cx('screen draft', `draft--${view}`, held && 'is-held', head && 'has-status')} inert=${held ? true : undefined} aria-busy=${held ? 'true' : undefined}>
    <div class="brief__bg" aria-hidden="true"></div>
    <${StepHeader} step=${2} of=${2} title=${t('选择策略')} micro="STRATEGY // BAND CHECK" pub=${clock ? { ...pub, deadline: clock.deadline } : { ...pub, deadline: 0 }}
      total=${clock ? clock.total : null} onExit=${() => setExit(true)}
      extra=${html`<${Button} variant="secondary" size="sm" icon="search" class="stephead__info" data-testid="match-info-open" aria-haspopup="dialog" onClick=${() => setInfoOpen(true)}
        title=${t('本局信息')}>${t('本局信息')}<//>`}
      status=${head} />
    <main class="draft__main">
      <aside class="draft-order">
        <h3 class="brief-h"><span>${solo ? t('独立模拟') : t('决策顺序')}</span><${MicroLabel}>${solo ? 'FREE PICK' : 'RANDOM ORDER'}<//></h3>
        <div class="draft-order__rows">
          ${rows.map((p, i) => {
            const picked = draft.picks.get(p.playerId) || (p.playerId === myId ? myPick : p.bandId) || null;
            const cur = !picked && !allPicked && (solo || draft.turnPid === p.playerId);
            return html`<${OrderRow} key=${p.playerId} p=${p} i=${i} picked=${picked} cur=${cur} self=${p.playerId === myId}
              preview=${draft.focus.get(p.playerId)} solo=${solo} gd=${gd} onPeek=${peekBand} />`;
          })}
        </div>
        ${!solo ? html`<p class="draft-order__tip" data-testid="draft-tip" title=${draftTip({ timed, turnSeconds: turnLen, autoName: myPick ? null : autoName, selected: autoId === sel })}>
          <span class="draft-tip__full">${draftTip({ timed, turnSeconds: turnLen, autoName: myPick ? null : autoName, selected: autoId === sel })}</span>
          <span class="draft-tip__compact">${myPick ? t('等待其他博士') : timed ? t('超时选择「{name}」', { name: autoName }) : t('不限时选择')}</span>
        </p>` : null}
        <div class="draft-communication"><${CommunicationActivity} players=${players} emotesOnly=${true} /><${CommunicationDock} disabled=${!draft.order.includes(myId)} /></div>
      </aside>
      <i class="draft__link" aria-hidden="true"></i>

        <section class="draft-grid" role="listbox" aria-label=${t('策略')}>
          ${bands.map((b, i) => {
            const isTaken = taken.has(b.bandId);
            const offNames = bandOffBonds(b, offBonds).map((id) => gd.bond(id)?.name || id); // 本局禁用 (still selectable)
            const on = (peek || sel) === b.bandId;
            const previewed = [...draft.focus].some(([pid, bid]) => pid !== myId && bid === b.bandId && !draft.picks.has(pid));
            const badged = local.badges.has(b.bandId); // (the count is the detail pane's 已通过模拟 N 次)
            return html`<button key=${b.bandId} type="button" role="option" aria-selected=${on ? 'true' : 'false'} data-band=${b.bandId}
                title=${isTaken ? t('已被选择') : offNames.length ? bandOffLine(offNames) : b.name}
                class=${cx('dband', previewed && 'is-preview', on && 'is-sel', myPick === b.bandId && 'is-mine', isTaken && 'is-taken', offNames.length && 'is-off')} style=${`--n:${Math.min(i, 15)}`}
                onClick=${() => pickTile(b.bandId)}>
              <span class="dband__frame"><${BandIcon} bandId=${b.bandId} size="lg" /></span>
              <span class="dband__name">${b.name}</span>
              ${badged ? html`<span class="dband__badge" data-testid="band-badge" aria-hidden="true">
                <${Sprite} k="statistics/strategyBadge" class="dband__badge-art" fallback=${html`<span class="dband__medal"><${Icon} name="rook" /></span>`} /></span>` : null}
              <${BandOffTag} names=${offNames} />
              ${isTaken ? html`<span class="dband__taken">${t('已被选择')}</span>` : null}
            </button>`;
          })}
        </section>
        ${shownBand ? html`<aside class="draft-detail" key="detail">
          <div class="draft-detail__body" key=${shownBand.bandId}>
            <div class="draft-detail__overview">
            <div class="draft-detail__art"><${BandIcon} bandId=${shownBand.bandId} size="xl" /></div>
            ${local.won[shownBand.bandId] ? html`<span class="draft-detail__medal">${t('已通过模拟{n}次', { n: local.won[shownBand.bandId] })}</span>` : null}
            <div class="draft-detail__hp"><span>${t('初始生命值')}</span><${LpTower} value=${shownBand.totalHp} size="lg" /></div>
            <span class="draft-tag">STRATEGY</span>
            <h2 class="draft-detail__name">${shownBand.name}</h2>
            </div>
            <${BandOffNote} names=${bandOffBonds(shownBand, offBonds).map((id) => gd.bond(id)?.name || id)} />
            <span class="draft-tag">INTRO</span>
            <div class="draft-detail__eff"><${BandText} band=${shownBand} class="draft-detail__desc" /></div>
          </div>
          <div class="draft-detail__actions">
            <p class=${cx('draft-detail__status', myPick && 't-mint', !myPick && selTaken && 'draft-detail__status--taken')}>
              ${myPick && !peek ? html`<${Icon} name="check" />${t('已选择「{name}」', { name: gd.band(myPick)?.name || '' })}${!solo && !allPicked ? t('，等待其他博士') : ''}`
                : peek ? html`<${Icon} name="search" />${myPick === peek ? t('你选择的策略') : (pickers.get(peek)?.length ? t('{names} 选择的策略', { names: pickers.get(peek).map(x => x.name).join('、') }) : t('查看策略'))}`
                : selTaken ? t('队友已选，请选择其他策略') : !inOrder ? t('观战中') : !myTurn && turnName ? t('{turnName} 正在决策…', { turnName }) : '\u00a0'}
            </p>
            <div class="draft-detail__btns">
              ${!solo ? html`<${Button} variant="secondary" size="lg" icon="chevronRight" class="draft-skip" disabled=${!canSkip || !!busy}
                loading=${busy === 'skip'} title=${skipsLeft > 0 ? t('跳过本轮，稍后再选') : t('跳过次数已用完')} onClick=${skip}>${t('跳过')}<//>` : null}
              <${Button} variant="primary" size="lg" icon="check" class="draft-confirm" disabled=${!!myPick || !!peek || !myTurn || !band || selTaken}
                loading=${busy === 'pick'} title=${myPick ? t('已选择') : t('确认选择')} aria-label=${myPick ? t('已选择') : t('确认选择')} onClick=${confirm}><span class="draft-confirm__full">${myPick ? t('已选择') : t('确认选择')}</span><span class="draft-confirm__compact">${myPick ? t('已选择') : t('确认')}</span><//>
            </div>
          </div>
        </aside>` : null}
    </main>
    <${ExitModal} open=${exit} onClose=${() => setExit(false)} solo=${solo} />
    <${MatchInfoDialog} open=${infoOpen} onClose=${() => setInfoOpen(false)} model=${info} onBond=${setBondId}
      enemies=${infoOpen ? html`<${MatchEnemies} pub=${pub} gd=${gd} idScope="minfo" />` : null}
      status=${infoStatus ? html`<span class=${cx('minfo-dlg__turn', `is-${infoStatus.tone}`)}>
        <${Icon} name=${infoStatus.tone === 'mint' ? 'check' : 'hourglass'} />${infoStatus.text}${infoStatus.secs != null ? html`<b class="num">${infoStatus.secs}s</b>` : null}
      </span>` : null} />
    <${MatchBondDialog} bondId=${infoOpen ? bondId : null} onClose=${() => setBondId(null)} priv=${priv} banned=${info?.banned} off=${!!info?.sets.off.has(bondId)} />
    ${turnBanner ? html`<${TurnBanner} key=${turnBanner} onDone=${() => setTurnBanner(0)} />` : null}
  </div>`;
}
