import { LadderOptions } from '../ui/ladderOptions.js';
import { PageHeader, PageHeading } from '../ui/pageHeader.js';
import { prepChoiceMultiplier, validPrepChoice } from '../ui/prepTime.js';
import { Emblem } from './title.js';
import { useMyCard } from '../ui/playerCard.js';
import { HubBackdrop, HubRadar } from '../ui/hubBackdrop.js';
import { setResourceCheckBlocker } from '../resources/index.js';
import { useHubBackdrop, backdropTheme } from '../ui/hubAppearance.js';
import { ProtocolScene } from '../ui/protocolScene.js';
// Lobby screen: pick 独立模拟 / 同盟模拟 / 同盟匹配 and a difficulty (标准/险境/绝境/终极), create a room,
// join the public alliance queue, or join a private room with a 同盟密钥 (recent codes remembered).
// A private room can also be joined as a player or watched from one of its MAX_SPECTATORS spectator seats.
// Shows connection status + ping.
//
// Difficulty descriptions come from data/config.json `modes[modeId]` when present, else from the
// official act2autochess `modeDataDict` texts embedded below (desc + effectDescList), so the
// screen is complete before data is generated. Rounds: solo 标准 = 9, everything else 14 (+R15
// hidden core on 险境+), per research 00-INDEX §2. Battlefield pool (`modes[].stages`): 标准 always
// plays 战场#01, 险境 draws one of 8, 绝境 / 终极 one of 7 (m01 excluded).
// Official versions (DESIGN §35.23, M1; versions.js): with welcome.versions the top bar shows the version chip (ui/
// versionPicker.js VersionSwitch — this browser's choice, its data loaded and checked by content.js), the title names a
// version other than 第二期下半, 选择模拟协议 offers the difficulties of the version shown (its config's modes: 第一期 and
// 第二期上半 have no 终极; the remembered difficulty, when it is not offered, shows as the server's fallback — the highest
// offered below it — and stays remembered until the player picks one; the cards wait while the version loads), 创建同盟 /
// 独立模拟 create the room in that version (room.create `version`), and the 成就统计 card counts the records of its season.
// Texts go through t() (docs/I18N.md); the module-level tables hold msgids (N_) translated where they are shown, the
// config.json mode texts come localized from data.js.

import { RoomOptionsPage, RoomPacingControls } from '../ui/roomOptions.js';
import { TestMark } from '../ui/testConsole.js';
import { ResumeMatchButton } from '../ui/resumeMatch.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { DIFFICULTIES, DIFFICULTY_NAMES, DIFFICULTY_COLORS, ROOM_CODE_LEN, MAX_SEATS, MAX_SPECTATORS, modeIdFor, ERR } from '../../../shared/constants.js';
import { html, confirmDialog, Button, Icon, MicroLabel, Modal, PingPill, Spinner, DifficultyIcon, TextField, Tooltip } from '../ui/components.js';
import { Sprite, Img } from '../ui/gameComponents.js';
import { uiUrl } from '../ui/assetUrls.js';
import { peekStatsRecords, trophyMedalOf, aggregateStats, recordsOfSeason } from '../ui/stats.js';
import { levelProgress, levelOf } from './settle.js';
import { OwnBackdrop, LobbyScene, LobbyMediaButton } from '../ui/lobbyMedia.js';
import { toast, toastError } from '../ui/toasts.js';
import { openStats } from './stats.js';
import { GuideButton, openGuide } from '../ui/guide.js';
import { RadarScene, CreateArt, JoinArt } from '../ui/allyArt.js';
import { AchievementDialog, useStatsOpen } from './stats.js';
import { SettingsButton } from '../ui/settings.js';
import { PwaInstallButton, detectFeatures, useMediaQuery, SHORT_SCREEN_QUERY } from '../ui/device.js';
import { LoadoutButton } from './loadout.js';
import { AchievementEntry } from '../ui/achievements.js';
import { net, identity } from '../net.js';
import { store, useStore, shallowEqual, loadPref, savePref } from '../store.js';
import { data, getConfig, getMode, getStage, useData } from '../data.js';
import { t, tc, N_ } from '../../../shared/i18n.js';
import { scriptOf } from '../../../shared/i18nPacks.js';
import { NoticesButton } from '../ui/notices.js';
import { VersionSwitch } from '../ui/versionPicker.js';
import { contentSet, retryContentSet } from '../content.js';
import { DEFAULT_VERSION, lobbyVersion, offeredDifficulties, fallbackDifficulty, ladderModes, ladderPick, seasonOf, soloTimedOf, soloTimeMsgid, versionLabel } from '../versions.js';

/** Official mode texts (activity_table act2autochess.modeDataDict), fallback when config.json is absent. */
export const MODE_TEXT = {
  single: {
    FUNNY: { code: 'AC-1', desc: N_('时长较短的模拟训练'), effects: [N_('可以快速完成作战'), N_('常规奖励')] },
    NORMAL: { code: 'AC-2', desc: N_('敌方攻击强度较高的模拟训练'), effects: [N_('可使用盟约数增加'), N_('大幅增加奖励')] },
    HARD: { code: 'AC-3', desc: N_('敌方攻击强度极高的模拟训练'), effects: [N_('作战环境困难'), N_('出现更加危险的敌人')] },
    ABYSS: { code: 'AC-4', desc: N_('敌方攻击强度到达极限的模拟训练'), effects: [N_('作战环境无比困难'), N_('出现极度危险的敌人')] },
  },
  multi: {
    FUNNY: { code: 'AC-1', desc: N_('敌方攻击强度较低的模拟训练'), effects: [N_('作战环境较为温和'), N_('常规奖励')] },
    NORMAL: { code: 'AC-2', desc: N_('敌方攻击强度较高的模拟训练'), effects: [N_('可使用盟约数增加'), N_('大幅增加奖励')] },
    HARD: { code: 'AC-3', desc: N_('敌方攻击强度极高的模拟训练'), effects: [N_('作战环境困难'), N_('出现更加危险的敌人')] },
    ABYSS: { code: 'AC-4', desc: N_('敌方攻击强度到达极限的模拟训练'), effects: [N_('作战环境无比困难'), N_('出现极度危险的敌人')] },
  },
};

/** Battlefield pool per difficulty when config.json is absent (the modes' `stages` lists; same for solo and co-op). */
export const STAGE_POOL = { FUNNY: ['act1autochess_m01'], NORMAL: 8, HARD: 7, ABYSS: 7 };

/**
 * Display name of a stage: stages.json when it is loaded, else derived from the id (act1 m0N → 战场#0N, act2 m0N → 战场#0(N+4)).
 * From the data name only its 战场#NN part (with a (上半) / (下半) mark) — 'Battlefield #NN (First Half)' in English.
 * @param {string} id e.g. 'act1autochess_m01'
 */
export function stageLabel(id) {
  const rec = getStage(id);
  if (rec && typeof rec.name === 'string' && rec.name) {
    const m = rec.name.match(/^(.*?#\d+(?:\s*[(（][^)）]*[)）])?)/);
    return m ? m[1] : rec.name.split(/\s+/)[0];
  }
  const m = String(id || '').match(/^act(\d)autochess_m(\d+)$/);
  return m ? t('战场#{no}', { no: String(Number(m[2]) + (m[1] === '2' ? 4 : 0)).padStart(2, '0') }) : '';
}

/**
 * The battlefield note of a difficulty (official wording): a single-stage pool is fixed ("战场固定为 战场#01"), a larger
 * one is drawn at random ("战场随机（共8张）").
 * @param {string[] | number | null | undefined} stages the mode's `stages` list (or a count)
 * @returns {string} '' when unknown
 */
export function stageNote(stages) {
  if (Array.isArray(stages)) {
    const ids = stages.filter((s) => typeof s === 'string' && s);
    if (ids.length === 1) { const name = stageLabel(ids[0]); return name ? t('战场固定为 {name}', { name }) : t('战场固定'); }
    return ids.length > 1 ? t('战场随机（共{n}张）', { n: ids.length }) : '';
  }
  return Number.isInteger(stages) && stages > 1 ? t('战场随机（共{stages}张）', { stages }) : '';
}

const MODE_CARDS = [
  {
    id: 'solo', name: N_('独立模拟'), en: 'SOLO SIMULATION', icon: 'user',
    desc: N_('独自调配资金与干员，以自己的节奏完成整场模拟。'),
    points: [N_('1 名博士'), N_('休整期与机变阶段不限时')],
  },
  {
    id: 'coop', name: N_('同盟模拟'), en: 'ALLIANCE SIMULATION', icon: 'users',
    desc: N_('与至多 {n} 名博士组成同盟，共享干员池，联防协作抵御敌潮。'), params: { n: MAX_SEATS - 1 },
    points: [N_('1–{n} 名博士 · 可邀请或匹配队友'), N_('联防阶段 · 最终攻势合并生命值')], pointParams: { n: MAX_SEATS },
  },
  {
    id: 'match', name: N_('同盟匹配'), en: 'ALLIANCE MATCHMAKING', icon: 'signal',
    desc: N_('独自进入公共匹配池，与其他博士组成同盟后开始模拟。'),
    points: [N_('单人加入 · 自动匹配队友'), N_('仅匹配真人 · 满四人后开始')],
  },
];

/**
 * Text for a difficulty card, preferring data/config.json.
 * @param {'solo'|'coop'|'match'} roomMode
 * @param {string} difficulty
 * @returns {{ code: string, desc: string, effects: string[], rounds: number, hidden: boolean, stageNote: string }}
 */
export function difficultyInfo(roomMode, difficulty) {
  const fallback = MODE_TEXT[roomMode === 'solo' ? 'single' : 'multi'][difficulty] || { code: '', desc: '', effects: [] };
  // modeIdFor() lower-cases the difficulty: never call it with a value the server did not validate.
  const m = DIFFICULTIES.includes(difficulty) ? getMode(modeIdFor(roomMode, difficulty)) : null;
  const effects = Array.isArray(m?.effectDescList)
    ? m.effectDescList.map((e) => String(e).replace(/^[·•・･\s]+/, '')).filter(Boolean)
    : fallback.effects.map((e) => t(e));
  const rounds = Number.isFinite(m?.lastRound) ? m.lastRound : roomMode === 'solo' && difficulty === 'FUNNY' ? 9 : 14;
  return {
    code: typeof m?.code === 'string' ? m.code : fallback.code,
    desc: typeof m?.desc === 'string' ? m.desc : t(fallback.desc),
    effects,
    rounds,
    hidden: difficulty !== 'FUNNY',
    stageNote: stageNote(Array.isArray(m?.stages) && m.stages.length ? m.stages : STAGE_POOL[difficulty]),
  };
}

/**
 * Text for one official mode of a laddered room mode (规程's 极速模拟 / 规程等级 n: data/config.json `modes[modeId]`), in
 * difficultyInfo's shape plus its own name, colour and difficulty (FAST, 极速模拟's, shows as 标准 where a difficulty is needed).
 * @param {string} modeId
 * @returns {{ name: string, color: string, difficulty: string, code: string, desc: string, effects: string[], rounds: number, hidden: boolean, stageNote: string, offBonds: string[] }}
 */
export function modeInfo(modeId) {
  const m = getMode(modeId) || {};
  const difficulty = DIFFICULTIES.includes(m.difficulty) ? m.difficulty : 'FUNNY';
  // the rounds / battlefield fallbacks of the difficulty (its desc and effects are the mode's own below: a laddered solo's
  // mode_single_funny is 极速模拟, whose 「时长较短的模拟训练」 is no 规程等级's)
  const base = difficultyInfo('coop', difficulty);
  const off = Array.isArray(m.inactiveBondIds) ? m.inactiveBondIds : [];
  return {
    ...base,
    name: typeof m.name === 'string' ? m.name : modeId,
    color: typeof m.color === 'string' && /^#?[0-9a-f]{6}$/i.test(m.color) ? (m.color.startsWith('#') ? m.color : `#${m.color}`) : DIFFICULTY_COLORS[difficulty],
    difficulty,
    code: typeof m.code === 'string' ? m.code : '',
    // its own text (规程等级5 追加更多盟约, 9 追加更多敌人 …), else the difficulty's general one — never another mode's own,
    // which names that mode's unlocks (险境模拟: 「解锁时可开放至【规程等级3】」)
    desc: typeof m.desc === 'string' && m.desc ? m.desc : t(MODE_TEXT.multi[difficulty]?.desc || ''),
    effects: Array.isArray(m.effectDescList) ? m.effectDescList.map((e) => String(e).replace(/^[·•・･\s]+/, '')).filter(Boolean) : [],
    rounds: Number.isFinite(m.lastRound) ? m.lastRound : base.rounds,
    hidden: Number.isFinite(m.hiddenRound),
    stageNote: stageNote(Array.isArray(m.stages) ? m.stages : []),
    offBonds: off.map((id) => data.lookup('bonds', id)?.name || id),
  };
}

const CODE_RE = new RegExp(`^[A-Z0-9]{${ROOM_CODE_LEN}}$`);
/**
 * Normalise user input into a room code: accepts a pasted invite link (`…?room=ABCD`), keeps
 * upper-cased alphanumerics and clamps to the code length.
 * @param {string} v
 * @returns {string}
 */
export function normalizeCode(v) {
  let s = String(v ?? '');
  const m = s.match(/[?&]room=([A-Za-z0-9]+)/);
  if (m) s = m[1];
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LEN);
}

/**
 * A handler that Preact binds as `onClick=${fn}` receives the click EVENT as its first argument, and a default
 * parameter only applies to `undefined` — so `fn(c = code)` would normalise the event target into a nonsense code
 * (`String(el)` → `"[object HTMLElement]"` → "OBJE"). Only a string is ever a code; anything else falls back to the
 * input field. Returns null when neither yields a well-formed code.
 * @param {unknown} arg the argument a handler was called with
 * @param {string} field the current input-field value
 * @returns {string|null}
 */
export function codeArg(arg, field) {
  const k = normalizeCode(typeof arg === 'string' ? arg : field);
  return CODE_RE.test(k) ? k : null;
}

/**
 * Room code from a deep link query string (`?room=CODE`), or null when absent/malformed.
 * Accepts ROOM_CODE_LEN..ROOM_CODE_LEN+2 alphanumerics (the protocol's join limit).
 * @param {string} search e.g. location.search
 * @returns {string|null}
 */
export function parseRoomParam(search, param = 'room') {
  try {
    const raw = new URLSearchParams(search || '').get(param);
    if (!raw) return null;
    const code = raw.trim().toUpperCase();
    if (!/^[A-Z0-9]+$/.test(code)) return null;
    return code.length >= ROOM_CODE_LEN && code.length <= ROOM_CODE_LEN + 2 ? code : null;
  } catch {
    return null;
  }
}

/** Recently joined/created co-op room codes (most recent first). */
export function recentRooms() {
  const list = loadPref('recentRooms', []);
  return Array.isArray(list) ? list.filter((c) => typeof c === 'string' && CODE_RE.test(c)).slice(0, 4) : [];
}

/** @param {string} code */
export function rememberRoom(code, test = false) {
  if (!CODE_RE.test(code)) return;
  const recent = [code, ...recentRooms().filter((c) => c !== code)].slice(0, 4);
  const marks = loadPref('recentTestRooms', []);
  savePref('recentTestRooms', recent.filter(c => c === code ? test : Array.isArray(marks) && marks.includes(c)));
  savePref('recentRooms', recent);
}

export async function joinKnown(type, key) {
  try { return await net.request(type, { code: key }); } catch (err) {
    if (err?.code !== ERR.TEST_CONFIRM) throw err;
    const text = type === 'room.spectate'
      ? t('这是测试房间，不计入任何记录。确认观战？')
      : t('这是测试房间，不计入任何记录。确认加入？');
    if (await confirmDialog({ title: t('测试'), text })) {
      return net.request(type, { code: key, testAck: true });
    }
  }
}

const FALLBACK_TIPS = [
  N_('联合模拟在选择策略时可以进行一次跳过'),
  N_('调度中心即使冻结，依然可以主动刷新'),
  N_('两件同名装备可以合成一件更强力的装备'),
  N_('只有达成完美作战的队友可以进行联防'),
];
const TIP_ROTATE_MS = 5000; // matchingTipRotateInterval

/** Rotating tactical tips (config.json `tips`, weighted list of { tip, weight }). */
function TipsPanel() {
  const cfg = getConfig();
  const fallback = FALLBACK_TIPS.map((x) => t(x));
  const tips = Array.isArray(cfg?.tips)
    ? cfg.tips.map((x) => (typeof x === 'string' ? x : x?.tip)).filter((x) => typeof x === 'string' && x)
    : fallback;
  const list = tips.length ? tips : fallback;
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * list.length));
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => i + 1), TIP_ROTATE_MS);
    return () => clearInterval(id);
  }, []);
  const i = ((idx % list.length) + list.length) % list.length;
  return html`<div class="tips brackets">
    <div class="tips__head">
      <${Icon} name="info" />
      <span class="tips__title">${t('作战提示')}</span>
      <${MicroLabel}>TACTICAL TIPS<//>
      <div class="tips__controls"><span class="tips__idx num">${String(i + 1).padStart(2, '0')}<span class="t-dim">/${String(list.length).padStart(2, '0')}</span></span>
      <button type="button" class="tips__nav" onClick=${() => setIdx(i - 1 + list.length)} aria-label=${t('上一条')}><${Icon} name="chevronLeft" /></button>
      <button type="button" class="tips__nav" onClick=${() => setIdx(i + 1)} aria-label=${t('下一条')}><${Icon} name="chevronRight" /></button></div>
    </div>
    <p key=${i} class="tips__text">${list[i]}</p>
  </div>`;
}

function MatchQueuePanel({ queue, onCancel }) {
  if (!queue) return null;
  return html`<section class="match-queue brackets" aria-live="polite">
    <div class="match-queue__scan" aria-hidden="true"></div>
    <div class="match-queue__head"><${Icon} name="signal" /><div><${MicroLabel} tone="mint">ALLIANCE MATCHMAKING<//><strong>${t('正在寻找同盟队友')}</strong></div><span class="match-queue__count num">${queue.count}/${queue.capacity}</span></div>
    <div class="match-queue__meta"><span>${t('仅匹配真实队友')}</span><span>${t('满四人后开始')}</span></div>
    <${Button} variant="danger" size="sm" icon="close" onClick=${onCancel}>${t('退出匹配')}<//>
  </section>`;
}

function HubEntry({ group, name, en, icon, badge, hint, tone = 'mint', onClick, disabled = false, entryRef }) {
  return html`<div class="hub-entry-wrap">
    ${group ? html`<span class="hub-entry__group"><${Icon} name=${group.icon} />${group.label}</span>` : html`<span class="hub-entry__group hub-entry__group--blank"></span>`}
    <button ref=${entryRef} type="button" class=${`hub-entry hub-entry--${tone}`} onClick=${onClick} disabled=${disabled}>
      <span class="hub-entry__icon"><${Icon} name=${icon} /></span>
      <span class="hub-entry__en">${en}</span>
      <span class="hub-entry__name">${name}${badge ? html`<span class="mode-beta">${badge}</span>` : null}</span>
      <span class="hub-entry__hint">${hint}<${Icon} name="chevronRight" /></span>
      <span class="hub-entry__corner" aria-hidden="true"></span>
    </button>
  </div>`;
}

/** Loading is a page too; opening S.W.E.E.P. must never briefly create a modal. */
export function SweepLoadingPage({ onClose }) {
  const back = useRef(null);
  useLayoutEffect(() => { back.current?.focus(); }, []);
  return html`<main class="screen sweep-host" aria-label=${t('S.W.E.E.P.报告')} onKeyDown=${(e) => {
    if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.modal, .guide')) { e.preventDefault(); onClose(); }
  }}>
    <div class="sw"><${PageHeader} onBack=${onClose} backTitle=${t('返回大厅')} title=${t('S.W.E.E.P.报告')} micro="S.W.E.E.P. ARCHIVE" />
      <p class="sw-loading" role="status">${t('正在读取报告…')}</p></div>
  </main>`;
}

/** One difficulty of 选择模拟协议: name, text, effects; the extras (code, rounds, 隐秘核心, battlefields, queue) below. */
export function ProtoCard({ roomMode, difficulty, selected, onSelect, disabled = false }) {
  const info = difficultyInfo(roomMode, difficulty);
  return html`<button type="button" class=${`pcard${selected ? ' is-on' : ''}`} style=${`--d-color:${DIFFICULTY_COLORS[difficulty]}`}
      disabled=${disabled} onClick=${() => onSelect(difficulty)} aria-pressed=${selected ? 'true' : 'false'}>
    <span class="pcard__head"><${DifficultyIcon} difficulty=${difficulty} class="pcard__glyph" /><span class="pcard__name">${t(DIFFICULTY_NAMES[difficulty])}</span></span>
    <span class="pcard__code num">${info.code}</span>
  </button>`;
}

/** Decide Escape ownership before a higher layer can close on the same event. No Tab/focus trap. */
export function protocolEscapeAction(ev, layerOpen = false) {
  return ev.key === 'Escape' && !ev.defaultPrevented && !ev.isComposing && !layerOpen;
}

/** The page owns navigation only; creation, matchmaking and cancellation remain in LobbyScreen. */
function ProtocolPage(props) {
  const pageRef = useRef(null);
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;
  useLayoutEffect(() => {
    if (!document.querySelector('.modal, .guide, .lo, .st, [aria-modal="true"]')) pageRef.current?.querySelector('.proto-back')?.focus();
  }, []);
  useEffect(() => {
    const onKey = (ev) => {
      if (!protocolEscapeAction(ev, !!document.querySelector('.modal, .guide, .lo, .st, [aria-modal="true"]'))) return;
      ev.preventDefault();
      ev.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return html`<${ProtocolSelect} ...${props} pageRef=${pageRef} />`;
}

/** Full secondary page with the fork's visual treatment and this branch's protocol. */
export function ProtocolSelect({ card, roomMode, difficulty, onDifficulty, online, busy, onClose, onStart, queue, onCancel, pageRef, prepChoice = null, onPrepChange = ()=>{}, battleSpeed = 2, onSpeedChange = ()=>{}, difficulties = DIFFICULTIES, soloTime = null, loading = false, ladder = null, modeId = null, onMode = ()=>{} }) {
  const info = ladder && modeId ? modeInfo(modeId) : difficultyInfo(roomMode, difficulty);
  difficulty = info.difficulty || difficulty;
  return html`<main ref=${pageRef} class="screen protocol-screen" aria-label=${`${t(card.name)} · ${t('选择模拟协议')}`}>
    <${PageHeader} onBack=${onClose} backTitle=${t('返回大厅')}
      heading=${html`<${PageHeading} title=${t('选择模拟协议')} micro=${card.en} subtitle=${t(card.name)} />`} />
    <div class="proto" style=${`--d-color:${DIFFICULTY_COLORS[difficulty]}`}>
      <div class="proto__bg" aria-hidden="true"></div>

      <div class="proto-body">
        <section class="proto-stage"><${ProtocolScene} key=${difficulty} difficulty=${difficulty} />
          <div class="proto-brief"><span class="proto-brief__code num">${info.code}</span><b class="proto-brief__name">${info.name || t(DIFFICULTY_NAMES[difficulty])}</b><p>${t(card.desc, card.params)}</p></div>
        </section>
        <section class="proto-side">
          <div class="proto-controls">
          <section class="prep-setting proto-difficulty" aria-label=${t('模拟难度')}><div class="prep-setting__title"><${Icon} name="rook" /><span>${t('模拟难度')}</span><${MicroLabel}>DIFFICULTY<//></div>
          <div class="proto-list" aria-label=${t('模拟难度')}>
            ${ladder ? html`<${LadderOptions} ladder=${ladder} modeId=${modeId} onMode=${onMode} disabled=${!!queue || !!busy || loading} />` : difficulties.map((d) => html`<${ProtoCard} key=${d} roomMode=${roomMode} difficulty=${d} selected=${difficulty === d} disabled=${!!queue || !!busy} onSelect=${onDifficulty} />`)}
          </div>
          <section class="proto-details" aria-live="polite"><strong>${info.desc}</strong>
            <div class="proto-facts"><span>${t('共')} <b class="num">${info.rounds}</b> ${tc('rounds','回合')}${info.hidden?t(' + 隐秘核心'):''}</span><span>${info.stageNote}</span></div>
            <ul>${info.effects.map(e=>html`<li key=${e}>${e}</li>`)}</ul>
          </section></section>
          <div class="proto-settings"><${RoomPacingControls} soloControl=${soloTime ? html`<${Button} size="sm" variant="secondary" icon=${soloTime.on ? 'check' : null} role="switch" data-testid="solo-unlimited" aria-checked=${soloTime.on} disabled=${!!queue || !!busy} onClick=${() => soloTime.onToggle(!soloTime.on)}>${t('不限时')}<//>` : null} soloTimeLabel=${soloTime?.text} mode=${roomMode} prepChoice=${prepChoice} onPrepChange=${onPrepChange} battleSpeed=${battleSpeed} onSpeedChange=${onSpeedChange} disabled=${!!queue || !!busy} />
            ${roomMode!=='match'?html`<p class="proto-plugin-note">${t('玩法：原版规则。创建后，房主可在模拟配置中选择插件。')}</p>`:null}
          </div>
          </div>
          <div class="proto-foot">
            ${queue ? html`<${MatchQueuePanel} queue=${queue} onCancel=${onCancel} />` : html`
              <p class="proto-hint">${!online ? t('正在连接服务器…') : roomMode === 'match' ? t('仅匹配真人 · 满四人后开始') : roomMode === 'solo' ? t('创建后即可开始模拟') : t('创建后可邀请好友或匹配队友')}</p>
              <${Button} class="proto-start" variant="primary" size="lg" loading=${!!busy}
                disabled=${!online || loading || !!busy || (roomMode==='coop' && !validPrepChoice(prepChoice))} onClick=${onStart}>
                ${roomMode === 'solo' ? t('开始独立模拟') : roomMode === 'match' ? t('开始同盟匹配') : t('创建同盟')}
              <//>`}
          </div>
        </section>
      </div>
    </div>
  </main>`;
}

/** The 成就统计 label's badge (original drawing). */
function AchBadge({ class: cls }) {
  return html`<svg class=${cls} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 3h14v12l-7 6-7-6zm4 5v2h2V8zm4 0v2h2V8zm-4.5 4.2a4.5 4.5 0 0 0 7 0l-1.3-1a3 3 0 0 1-4.4 0z" fill-rule="evenodd" /></svg>`;
}

/**
 * 成就统计 on short screens (≤ 520 px tall, a phone in landscape), where the left column with the card gives way: a plate
 * under S.W.E.E.P. and 干员调配 that opens the same window, so the lobby keeps its statistics entry there too [ASSUMED: a
 * remake layout for small screens; css/screens/lobby.css shows it only then].
 */
function AchievementPlate({ onOpen }) {
  return html`<button type="button" class="hub-plate hub-plate--ach" onClick=${onOpen} title=${t('成就统计（本机记录）')}>
    <span class="hub-plate__glyph"><${AchBadge} /></span>
    <span class="hub-plate__label">${t('成就统计')}</span>
  </button>`;
}

/** A tile of the hub's left column (密钥加入). */
function HubTile({ icon, label, en, onClick, class: cls = '' }) {
  return html`<button type="button" class=${`hub-tile ${cls}`} onClick=${onClick}>
    <span class="hub-tile__icon" aria-hidden="true"><${Icon} name=${icon} /></span>
    <span class="hub-tile__text"><span class="hub-tile__label">${label}</span><span class="hub-tile__en">${en}</span></span>
  </button>`;
}

/** Crossed blades in a hexagon: the S.W.E.E.P. plate's glyph (original drawing). */
function SweepGlyph() {
  return html`<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path d="M16 2.5 27.7 9.2v13.6L16 29.5 4.3 22.8V9.2z" fill="none" stroke="currentColor" stroke-width="1.5" />
    <path d="M9 9l12.5 12.5M23 9 10.5 21.5" stroke="currentColor" stroke-width="2.2" />
    <path d="M19.2 23.8l4.6-4.6M8.2 19.2l4.6 4.6M21.6 21.6l2.2 2.2M10.4 21.6l-2.2 2.2" stroke="currentColor" stroke-width="1.8" />
  </svg>`;
}

/** S.W.E.E.P.报告: a light plate with bracket marks; opens the report (screens/sweep.js). */
function SweepPlate({ onClick }) {
  return html`<button type="button" class="hub-plate hub-plate--sweep lobby-sweep" onClick=${onClick} title=${t('S.W.E.E.P.报告：盟约、策略与敌方资料')}>
    <span class="hub-plate__glyph"><${SweepGlyph} /></span>
    <span class="hub-plate__label">${t('S.W.E.E.P.报告')}</span>
    <span class="hub-plate__tag">REPORT</span>
  </button>`;
}

/**
 * The event entry's backdrop: the official glow (`entry/entry_bkg_01`) and Rhodes Island hologram (`entry/entry_bkg_02`)
 * over a dark field with a faint grid; without the art pack only the field and the grid.
 */


/** The radar rings behind the emblem (original drawing; the sweep stops under 减少动态效果). */


/** The emblem (official `entry/season_logo`, the title's dot emblem without the art pack) in its radar, and the title. */
function HubTitle() {
  // a title in an alphabetic script (English …) is set like the title screen's: no wordmark above it, ": " between
  const alphabetic = scriptOf(t('卫戍协议')) === 'alphabetic';
  // another official version (DESIGN §35.23): its name under the title
  const version = useStore(lobbyVersion);
  return html`<div class="hub-center">
    <div class="hub-center__mark"><${HubRadar} /><${Sprite} k="entry/season_logo" class="hub-center__logo" fallback=${html`<${Emblem} />`} /></div>
    ${alphabetic ? null : html`<div class="hub-center__en">STRONGHOLD PROTOCOL <b>ALLIANCE</b></div>`}
    <h1 class=${`hub-center__title${alphabetic ? ' hub-center__title--latin' : ''}`}>${t('卫戍协议')}<span>${alphabetic ? ': ' : '：'}</span><em>${t('盟约')}</em></h1>
    ${version !== DEFAULT_VERSION ? html`<div class="hub-center__ver" data-testid="hub-version">· ${versionLabel(version)}</div>` : null}
  </div>`;
}

/** File names of the official 选择模拟协议 pictures (assets `modeChoice/<name>_rhodes_island`). */
const PROTOCOL_ART = { FUNNY: 'funny', NORMAL: 'normal', HARD: 'hard', ABYSS: 'abyss' };

/** The selected difficulty's scene (ui/protocolScene.js): the official picture on the drawn grid, squares and cable. */
function ProtocolArt({ difficulty }) {
  useData('assets');
  return html`<${ProtocolScene} difficulty=${difficulty} art=${uiUrl(data.get('assets'), `modeChoice/${PROTOCOL_ART[difficulty]}_rhodes_island`)} />`;
}

/** The ‹ + dotted rook plate at the top left of the full-screen dialogs: back to the hub (or the dialog below). */
function BackPlate({ onClick, class: cls = '' }) {
  return html`<button type="button" class=${`proto-back ${cls}`} onClick=${onClick} title=${t('返回')} aria-label=${t('返回')}>
    <${Icon} name="chevronLeft" /><span class="proto-back__home"><${Icon} name="rook" /></span>
  </button>`;
}

/**
 * 选择模拟协议 (laid out after the event's second screen): full screen — the selected difficulty's official picture and
 * brief at the left, the four difficulty cards down the right (the chosen one slides out with the 已选定 stamp), the hint
 * and 开始独立模拟 below them (with the test-room box while the server runs in test mode). The project's Modal (focus
 * trap, Esc, focus restored) styled to fill the screen. The lobby opens it for 独立模拟 only (a co-op room is created
 * from 选择同盟方式 and its difficulty changed in the room); the room (screens/room.js) opens it with `action` / `hint`
 * replacing the button's label and the hint (the host's 确认), or `readOnly` — the cards shown, not chosen, and no
 * button (the other doctors: the host chooses).
 */


/**
 * 选择同盟方式 (laid out after the event's screen after 同盟模拟, research 06 §3.2): full screen — a radar at the left with
 * 玩法说明 under it, at the right the 创建同盟 card (creates the room at once at `difficulty`, the remembered one, which the
 * host changes in the room; the test-room box under it while the server runs in test mode; AI teammates are added in the
 * room) and the 加入同盟 card (the key field — the project's TextField — with 观战, the recent keys that only fill it,
 * 加入同盟). The project's Modal styled to fill the screen. `short`: the screen is at most 520 px tall (the lobby's
 * useMediaQuery(SHORT_SCREEN_QUERY)) — the key field, beside 观战 in a column about 300 px wide, is about 150 px there,
 * so its placeholder is the field's name alone (同盟密钥) instead of the whole 输入同盟密钥 / 粘贴邀请链接, which ran under
 * 观战 at 特大 in English and Japanese (§35.18's leftover); the line under the field still tells where a key comes from.
 * On a taller screen the field's name stands in too wherever the whole sentence does not fit the field (TextField
 * `placeholderShort`, by the field's width: English and Japanese at 特大 on every desktop, the default Chinese at 特大
 * in a 1024 px window — it ended in an ellipsis there).
 */
export function AllianceSelect({ onClose, onCreate, difficulty = 'FUNNY', code, onCode, codeOk, online, busy, onJoin, onSpectate, recent, marks, focusKey,
  testMode = false, asTest = false, onTest = () => {}, short = false }) {
  const diffName = DIFFICULTY_NAMES[difficulty] ? t(DIFFICULTY_NAMES[difficulty]) : '';
  return html`<${Modal} open=${true} onClose=${onClose} class="ally" veilClass="proto-veil">
    <div class="ally__body">
      <div class="proto__bg ally__bg" aria-hidden="true"></div>
      <header class="proto-top">
        <${BackPlate} onClick=${onClose} class="ally__back" />
        <div class="proto-title">
          <h2 class="modal__title">${t('选择同盟方式')}</h2>
          <span class="proto-title__mode ally__mode"><${Icon} name="users" />${t('同盟模拟')}<i>ALLIANCE SIMULATION</i></span>
        </div>
      </header>
      <div class="proto-body ally-body">
        <section class="ally-stage">
          <${RadarScene} />
          <button type="button" class="ally-guide" onClick=${() => openGuide(0)}><span class="ally-guide__icon"><${Icon} name="book" /></span>${t('玩法说明')}</button>
        </section>
        <section class="ally-side">
          <button type="button" class="ally-card ally-card--create ally-create" data-testid="alliance-create" data-difficulty=${difficulty}
              disabled=${!online || busy === 'create'} aria-busy=${busy === 'create' ? 'true' : 'false'} onClick=${() => onCreate()}>
            <span class="ally-card__art"><${CreateArt} /></span>
            <span class="ally-card__bar"><span class="ally-card__icon">${busy === 'create' ? html`<${Spinner} size="sm" />` : html`<${Icon} name="plus" />`}</span><span class="ally-card__name">${t('创建同盟')}</span>
              <small>${online ? t('难度：{name}（可在同盟内更改）', { name: diffName }) : t('正在连接服务器…')}</small></span>
          </button>
          ${testMode ? html`<label class="create-box__test ally-test" data-testid="create-test">
            <input type="checkbox" checked=${asTest} onChange=${(e) => onTest(e.target.checked)} />
            <span>${t('测试房间')}</span>
            <em class="t-dim">${t('不计入战绩。房间会标明「测试」，只有房主能使用测试指令。')}</em>
          </label>` : null}
          <div class="ally-card ally-card--join ally-join join-row">
            <span class="ally-card__art"><${JoinArt} /></span>
            <div class="ally-key">
              <${TextField} class="ally-key__field" size="key" icon="key" value=${code} transform=${normalizeCode} onInput=${onCode} onEnter=${() => onJoin()}
                placeholder=${short ? t('同盟密钥') : t('输入同盟密钥 / 粘贴邀请链接')} placeholderShort=${t('同盟密钥')} ariaLabel=${t('同盟密钥')}
                modalFocus=${!!focusKey} />
              <button type="button" class="ally-key__spec join-spectate" disabled=${!codeOk || !online || busy === 'spectate'} onClick=${() => onSpectate()}
                title=${t('以观战者身份进入：不占博士席位，只能观看（每个同盟最多 {MAX_SPECTATORS} 名，模拟进行中也可进入）', { MAX_SPECTATORS })}>
                ${busy === 'spectate' ? html`<${Spinner} size="sm" />` : html`<${Icon} name="eye" />`}${t('观战')}</button>
            </div>
            <span class="ally-recent join-foot">
              ${recent.length ? html`<span class="t-lo">${t('最近的同盟')}</span>
                ${recent.map((c) => html`<button key=${c} type="button" class="code-chip num" title=${t('填入密钥（不会直接加入）')}
                  onClick=${() => onCode(c)}>${c}${Array.isArray(marks) && marks.includes(c) ? html` <${TestMark} />` : null}</button>`)}`
                : html`<span class="t-dim">${t('向同伴索取 {ROOM_CODE_LEN} 位同盟密钥，或直接打开邀请链接', { ROOM_CODE_LEN })}</span>`}
            </span>
            <button type="button" class="ally-card__bar ally-card__bar--join" disabled=${!codeOk || !online || busy === 'join'} onClick=${() => onJoin()}>
              <span class="ally-card__icon"><${Icon} name="users" /></span>${t('加入同盟')}${busy === 'join' ? html`<${Spinner} size="sm" />` : null}
            </button>
          </div>
        </section>
      </div>
    </div>
  <//>`;
}

/** Lobby screen component. */
export function LobbyScreen() {
  const myCard = useMyCard();
  useData(...(myCard.avatar ? ['assets'] : []));
  const conn = useStore((s) => s.connection, shallowEqual);
  const matchQueue = useStore((s) => s.ui.matchQueue);
  useData('config');
  const [roomMode, setRoomMode] = useState(() => {
    const saved = loadPref('lobby.mode', 'coop');
    return saved === 'solo' || saved === 'match' ? saved : 'coop';
  });
  const [ladderMode, setLadderMode] = useState(() => loadPref('lobby.ladderMode', null));
  const [difficulty, setDifficulty] = useState(() => {
    const d = loadPref('lobby.difficulty', 'FUNNY');
    return DIFFICULTIES.includes(d) ? d : 'FUNNY';
  });
  const [prepChoice, setPrepChoice] = useState(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [battleSpeed, setBattleSpeed] = useState(2);
  const [panel, setPanel] = useState(null); // protocol | join | achievements | sweep; existing server actions only
  useLayoutEffect(() => {
    setResourceCheckBlocker('lobby-panel', !!panel);
    return () => setResourceCheckBlocker('lobby-panel', false);
  }, [panel]);
  const bg = useHubBackdrop();
  const sweepEntry = useRef(null);
  const modeEntries = useRef({});
  const lobbyRef = useRef(null);
  const previousPanel = useRef(null);
  useLayoutEffect(() => {
    if (previousPanel.current === 'sweep' && panel !== 'sweep') sweepEntry.current?.focus();
    if (previousPanel.current === 'protocol' && panel !== 'protocol') {
      const entry = modeEntries.current[roomMode];
      // A queued player's mode entries are disabled; focus the still-available cancel action instead.
      if (entry && !entry.disabled) entry.focus();
      else lobbyRef.current?.querySelector('.match-queue button')?.focus();
    }
    previousPanel.current = panel;
  }, [panel]);
  const [sweepModule, setSweepModule] = useState(null);
  useEffect(() => {
    if (panel !== 'sweep' || sweepModule) return undefined;
    let current = true;
    import('./sweep.js').then((module) => { if (current) setSweepModule(module); }).catch((err) => {
      if (current) { toastError(err); setPanel(null); }
    });
    return () => { current = false; };
  }, [panel, sweepModule]);
  // 「不限时」 for the next timed solo (DESIGN §35.23.10; default off). The room's 模拟设置 is the authority once the
  // room exists; this pref is what the lobby card and the create message say before that.
  const [soloFree, setSoloFree] = useState(() => loadPref('lobby.soloUnlimited', false) === true);
  const [code, setCode] = useState('');
  const [asTest, setAsTest] = useState(false);
  const testMode = useStore((s) => s.testMode === true);
  const [busy, setBusy] = useState(null);
  const [recent] = useState(recentRooms);
  const marks = loadPref('recentTestRooms', []);
  const [achOpen, setAchOpen] = useState(false);
  const [coarse] = useState(() => detectFeatures().coarse);
  const shortScreen = useMediaQuery(SHORT_SCREEN_QUERY);
  const alive = useRef(true);
  const inFlight = useRef(false); // synchronous guard against double clicks (state updates are async)
  useEffect(() => () => { alive.current = false; }, []);

  const online = conn.status === 'online';
  const codeOk = CODE_RE.test(code);
  // official versions (DESIGN §35.23): the lobby's version, the difficulties it offers and the one shown — the remembered
  // one, or the server's fallback when the version lacks it (the pref is only overwritten when the player picks)
  const versions = useStore((s) => s.versions);
  const version = useStore(lobbyVersion);
  const versionLoading = useStore((c) => version !== DEFAULT_VERSION && (c.kind !== 'version' || c.version !== version || c.status !== 'ready'), Object.is, contentSet);
  // its set failed to load or its check (the chip's 重试 sits under the modal): 选择模拟协议 says so and offers 重试 too
  const versionFailed = useStore((c) => version !== DEFAULT_VERSION && c.kind === 'version' && c.version === version && c.status === 'failed', Object.is, contentSet);
  const cfg = getConfig();
  // null while that version's data is not on screen: the card states no time rule and the dialog hides the switch
  const soloTimed = soloTimedOf(versionLoading ? null : cfg, version);
  const solo = offeredDifficulties(versionLoading ? null : cfg, 'solo');
  const coop = offeredDifficulties(versionLoading ? null : cfg, 'coop');
  const shownSolo = fallbackDifficulty(solo, difficulty);
  const shownCoop = fallbackDifficulty(coop, difficulty);
  const ladder = ladderModes(versionLoading ? null : cfg, 'solo');
  const shownMode = ladder ? ladderPick(ladder, ladderMode, shownSolo) : null;

  const pickDifficulty = (d) => { setDifficulty(d); savePref('lobby.difficulty', d); };
  const pickMode = (id) => { setLadderMode(id); savePref('lobby.ladderMode', id); };
  const setSoloFreePref = (on) => { const next = on === true; setSoloFree(next); savePref('lobby.soloUnlimited', next); };

  const run = async (kind, fn) => {
    if (inFlight.current) return;
    if (!online) { toast(t('尚未连接到服务器，请稍候'), 'warn'); return; }
    inFlight.current = true;
    setBusy(kind);
    try { await fn(); } catch (err) { toastError(err); } finally {
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };
  const create = () => {
    if (roomMode === 'coop' && !validPrepChoice(prepChoice)) return;
    return run('create', () => net.request('room.create', { mode: roomMode, difficulty: roomMode === 'solo' ? shownSolo : shownCoop, ...(versions ? { version } : {}), ...(roomMode === 'solo' && shownMode ? { modeId: shownMode } : {}), ...(testMode && asTest ? { test: true } : {}), ...(roomMode === 'solo' && soloFree && soloTimed ? { soloUnlimited: true } : {}), prepMultiplier: roomMode === 'coop' ? prepChoiceMultiplier(prepChoice) : null, battleSpeed }));
  };
  const matchmaking = () => run('match', () => net.request('match.join', { mode: 'coop', difficulty }));
  const cancelMatchmaking = () => run('cancel-match', () => net.request('match.leave', {}));
  const join = (c = code) => {
    // `onClick=${join}` hands the click EVENT as the first argument, and a default parameter only applies to
    // `undefined` — codeArg keeps an event target out of the key and falls back to the input field
    const k = codeArg(c, code);
    if (!k) { toast(t('同盟密钥为 {ROOM_CODE_LEN} 位字母或数字', { ROOM_CODE_LEN }), 'warn'); return; }
    run('join', () => joinKnown('room.join', k));
  };
  // a spectator seat: no player seat taken, nothing to do but watch (also a match already running)
  const spectate = (c = code) => {
    // same guard as join: `onClick=${spectate}` passes the click event, not a code
    const k = codeArg(c, code);
    if (!k) { toast(t('同盟密钥为 {ROOM_CODE_LEN} 位字母或数字', { ROOM_CODE_LEN }), 'warn'); return; }
    run('spectate', () => joinKnown('room.spectate', k).catch((err) => {
      // Clearer than the bare ERR_TEXT: the usual cause is a code that is not the host's (a remembered one from an
      // earlier room, or another machine's) — the server can only answer "no such room".
      if (err?.code === ERR.ROOM_NOT_FOUND) {
        toast(t('没有找到密钥 {k} 对应的同盟：请和房主核对密钥（同盟结束后密钥即失效）', { k }), 'warn');
        return;
      }
      if (err?.code === ERR.ALREADY) {
        toast(t('你已经是该同盟的博士：先离开同盟，才能以观战身份进入'), 'warn');
        return;
      }
      throw err;
    }));
  };
  const backToTitle = () => {
    identity.setEntered(false);
    store.set((s) => ({ session: { ...s.session, entered: false } }));
  };

  if (optionsOpen) return html`<${RoomOptionsPage} mode=${roomMode} prepChoice=${prepChoice} onPrepChange=${setPrepChoice}
    ladder=${roomMode === 'solo' ? ladder : null} modeId=${shownMode} onMode=${pickMode} difficulty=${difficulty} onDifficultyChange=${pickDifficulty} battleSpeed=${battleSpeed} onSpeedChange=${setBattleSpeed} onBack=${() => setOptionsOpen(false)} disabled=${!!busy} />`;
  const card = MODE_CARDS.find((c) => c.id === roomMode) || MODE_CARDS[1];
  const openMode = (mode) => { setRoomMode(mode); savePref('lobby.mode', mode); setPanel('protocol'); };
  // Replace the lobby instead of covering an interactive lobby with a dialog/backdrop.
  if (panel === 'sweep') return sweepModule ? html`<${sweepModule.SweepReport} onClose=${() => setPanel(null)} />`
    : html`<${SweepLoadingPage} onClose=${() => setPanel(null)} />`;
  if (panel === 'protocol') return html`<${ProtocolPage} ladder=${roomMode === 'solo' ? ladder : null} modeId=${shownMode} onMode=${pickMode} card=${card} roomMode=${roomMode} difficulty=${roomMode === 'solo' ? shownSolo : shownCoop} onDifficulty=${pickDifficulty}
    online=${online} busy=${busy} onClose=${() => setPanel(null)} onStart=${roomMode === 'match' ? matchmaking : create}
    difficulties=${roomMode === 'solo' ? solo : coop} loading=${versionLoading} soloTime=${roomMode === 'solo' && soloTimed ? { on: soloFree, onToggle: setSoloFreePref, text:t(soloTimeMsgid('brief',{timed:soloTimed,unlimited:soloFree})) } : null} queue=${matchQueue} onCancel=${cancelMatchmaking} prepChoice=${prepChoice} onPrepChange=${setPrepChoice} battleSpeed=${battleSpeed} onSpeedChange=${setBattleSpeed} />`;
  return html`<div ref=${lobbyRef} class="screen lobby-screen lobby-hub" data-hub-theme=${backdropTheme(bg)}>
    <${HubBackdrop} bg=${bg} />
    <${PageHeader} onBack=${backToTitle} backTitle=${t('返回标题')} title=${t('开始模拟')} micro="OPERATIONS HUB" />
    <main class="hub-stage screen__scroll">
      <div class="hub-center" aria-hidden="true">
        <div class="hub-center__mark"><${HubRadar} bg=${bg} /><${Emblem} /></div>
        <span class="hub-center__en">STRONGHOLD <b>PROTOCOL</b></span>
        <h1 class="hub-center__title">${seasonOf(version) === 'act3autochess' ? t('卫戍协议·规程') : t('卫戍协议：盟约')}</h1>
      </div>
      <aside class="hub-side">
        <${AchievementEntry} onOpen=${() => { openStats('achievements'); }} />
        <button ref=${sweepEntry} type="button" class="hub-plate hub-plate--sweep" onClick=${() => setPanel('sweep')}>
          <span class="hub-plate__glyph"><${Icon} name="book" /></span>
          <span class="hub-plate__label">${t('S.W.E.E.P.报告')}</span>
        </button>
        <${LoadoutButton} from="lobby" size="lg" class="lobby-loadout hub-plate hub-plate--loadout" label=${t('干员调配')} />
        <${TipsPanel} />
      </aside>
      <section class="hub-entries" aria-label=${t('模拟方式')}>
        ${matchQueue ? html`<${MatchQueuePanel} queue=${matchQueue} onCancel=${cancelMatchmaking} prepMultiplier=${prepChoiceMultiplier(prepChoice)} battleSpeed=${battleSpeed} onOptions=${()=>setOptionsOpen(true)} />` : null}
        <div class="hub-entries__context"><${VersionSwitch} /><${ResumeMatchButton} /></div>
        <div class="hub-entries__row">
          ${MODE_CARDS.map((c) => html`<${HubEntry} key=${c.id} name=${c.id === 'coop' ? t('创建同盟') : t(c.name)} en=${c.en} icon=${c.icon}
            entryRef=${(el) => { modeEntries.current[c.id] = el; }}
            hint=${c.id === 'match' ? t('配置并匹配') : t('配置并创建')} tone=${c.id === 'match' ? 'amber' : 'mint'} disabled=${!!matchQueue} onClick=${() => openMode(c.id)} />`)}
          <${HubEntry} name=${t('加入同盟')} en="JOIN ALLIANCE" icon="key" hint=${t('输入同盟密钥')} disabled=${!!matchQueue} onClick=${() => setPanel('join')} />
        </div>
      </section>
    </main>


    <${Modal} open=${panel === 'join'} utility=${true} class="hub-dialog" title=${t('加入同盟')} micro="ALLIANCE KEY" onClose=${() => setPanel(null)}>
      <div class="join-panel">
        <div class="join-row">
          <${TextField} size="code" icon="key" value=${code} placeholder=${t('输入同盟密钥 / 粘贴邀请链接')}
            transform=${normalizeCode} onInput=${(v) => setCode(normalizeCode(v))} onEnter=${() => join()} />
          <${Button} variant="amber" size="lg" icon="users" loading=${busy === 'join'} disabled=${!codeOk || !online} onClick=${() => join()}>${t('加入同盟')}<//>
          <${Tooltip} text=${t('以观战者身份进入：不占博士席位，只能观看（每个同盟最多 {MAX_SPECTATORS} 名，模拟进行中也可进入）', { MAX_SPECTATORS })}>
            <${Button} variant="secondary" size="lg" icon="eye" class="join-spectate" loading=${busy === 'spectate'} disabled=${!codeOk || !online} onClick=${spectate}>${t('观战')}<//>
          <//>
        </div>
        <div class="join-foot">
          ${recent.length ? html`<span class="t-lo">${t('最近的同盟')}</span>
            ${recent.map((c) => html`<button key=${c} type="button" class="code-chip num" title=${t('填入密钥（不会直接加入）')} onClick=${() => setCode(c)}>${c}</button>`)}`
            : html`<span class="t-dim">${t('向同伴索取 {ROOM_CODE_LEN} 位同盟密钥，或直接打开邀请链接', { ROOM_CODE_LEN })}</span>`}
        </div>
      </div>
    <//>
  </div>`;
}
