// Local-only adaptation of isomerpoi UI b2bd17af. Reads the existing sp.pref.stats store, never uploads records.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, MicroLabel, useModalFocus } from './components.js';
import { makeLookups, BandIcon, BondGlyph, UnitThumb, Img } from './gameComponents.js';
import { data, useData } from '../data.js';
import { loadStats, subscribeStats, STATS_PREF_KEY } from './stats.js';
import { achievementStats, bondOperators, recordBonds, HEX_TITLES, ACHIEVEMENT_GROUPS } from './achievementModel.js';
import { useLeave } from './transitions.js';
import { cardOperators, cardAvatarUrl } from './seatArt.js';
import { useMyCard, setCardAvatar } from './playerCard.js';
import { AvatarPicker } from './opPicker.js';
import { Emblem } from '../screens/title.js';
import { OpCard } from '../screens/settle.js';
import { openStats } from '../screens/stats.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
const noHidden = () => false;
const fmt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('zh-CN') : '0');

function useAchievements(hiddenLayers) {
  const [local, setLocal] = useState(loadStats);
  useEffect(() => {
    const refresh = () => setLocal(loadStats());
    const stop = subscribeStats(refresh);
    const storage = (e) => { if (!e.key || e.key === `sp.pref.${STATS_PREF_KEY}`) refresh(); };
    globalThis.addEventListener?.('storage', storage);
    refresh();
    return () => { stop(); globalThis.removeEventListener?.('storage', storage); };
  }, []);
  const s = useMemo(() => achievementStats(local.newer ? [] : local.records, { hiddenLayers }), [local, hiddenLayers]);
  return { s, local };
}

export function AchievementEntry({ onOpen }) {
  const { s } = useAchievements(noHidden);
  return html`<${AchievementEntryView} s=${s} onOpen=${onOpen} />`;
}

/** Hook-free entry; no game data is requested just to show it. */
export function AchievementEntryView({ s, onOpen }) {
  return html`<button type="button" class="hub-ach" onClick=${onOpen} title=${t('成就统计（本机记录）')}>
    <span class="hub-ach__scene" aria-hidden="true">
      <svg class="hub-ach__land" viewBox="0 0 320 110" preserveAspectRatio="none">
        <defs><linearGradient id="hubAchSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2a2114" /><stop offset=".5" stop-color="#b8741c" /><stop offset="1" stop-color="#f0a636" /></linearGradient></defs>
        <rect width="320" height="110" fill="url(#hubAchSky)" />
        <path d="M0 110V80l28-12 22 9 34-27 27 18 30-13 41 23 27-11 31 17 33-21 47 25V110z" fill="#3a2a16" />
        <path d="M0 110V94l46-11 41 8 50-15 44 13 50-9 40 11 49-7V110z" fill="#18120b" />
        <path d="M262 110V70M262 80l-9-8M262 76l8-7M262 86l10-6" stroke="#18120b" stroke-width="2.5" fill="none" />
      </svg>
      <span class="hub-ach__mark"><${Emblem} /></span>
      <span class="hub-ach__rank"><${Icon} name="rook" /><small><${Icon} name="crown" /><b class="num">${s.trophies}</b></small></span>
    </span>
    <span class="hub-ach__label">
      <svg class="hub-ach__badge" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h14v12l-7 6-7-6zm4 5v2h2V8zm4 0v2h2V8zm-4.5 4.2a4.5 4.5 0 0 0 7 0l-1.3-1a3 3 0 0 1-4.4 0z" fill-rule="evenodd" /></svg>
      <span>${t('成就统计')}</span><b class="hub-ach__lv">${t('本机记录')}</b>
    </span>
  </button>`;
}

function SectionBar({ title, micro }) {
  return html`<h3 class="ach-bar">
    <span class="ach-bar__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3h12v3h3v3a5 5 0 0 1-5 5h-.4A5 5 0 0 1 13 16.6V19h4v2H7v-2h4v-2.4A5 5 0 0 1 8.4 14H8a5 5 0 0 1-5-5V6h3zm0 5H5v1a3 3 0 0 0 1.4 2.5A5 5 0 0 1 6 10zm12 0v2a5 5 0 0 1-.4 1.5A3 3 0 0 0 19 9V8zM12 5.6l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z" fill-rule="evenodd" /></svg></span>
    <span class="ach-bar__title">${title}</span>
    <span class="ach-bar__marks" aria-hidden="true"><i><${Icon} name="rook" /></i><i><svg viewBox="0 0 24 24"><path d="M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z" fill="none" stroke="currentColor" stroke-width="2" /></svg></i>
      <${MicroLabel} class="ach-bar__micro">STRONGHOLD PROTOCOL<br />${micro}<//></span>
  </h3>`;
}

/**
 * The six 评语 round a hexagon of six solid triangles (gaps between them, the outer corners cut, a ruler along each
 * outer edge, a dark hub). Exported for the tests: the segment paths are plain geometry.
 */
function hexSegments(R = 172) {
  const pt = (deg, r) => [Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r];
  const mix = (p, q, u) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
  const r1 = (p) => p.map((v) => Math.round(v * 10) / 10);
  return HEX_TITLES.map((id, i) => {
    const a = -90 + i * 60;
    const n = pt(a, 1); // outward normal of the outer edge
    const off = (p, d) => [p[0] + n[0] * d, p[1] + n[1] * d];
    const p1 = pt(a - 30, R), p2 = pt(a + 30, R);
    // the gaps: each triangle shrunk towards its centroid; then the hub corner and the two outer corners cut
    const g = [(p1[0] + p2[0]) / 3, (p1[1] + p2[1]) / 3];
    const s = (p) => [g[0] + (p[0] - g[0]) * 0.93, g[1] + (p[1] - g[1]) * 0.93];
    const [C, P1, P2] = [s([0, 0]), s(p1), s(p2)];
    const poly = [mix(C, P1, 0.12), mix(C, P1, 0.93), mix(P1, P2, 0.06), mix(P1, P2, 0.94), mix(C, P2, 0.93), mix(C, P2, 0.12)];
    // the ruler: a line inside the outer edge and ticks reaching towards it (every fourth one longer)
    const e1 = off(mix(P1, P2, 0.12), -14), e2 = off(mix(P1, P2, 0.88), -14);
    const ticks = Array.from({ length: 17 }, (_, j) => { const q = mix(e1, e2, j / 16); return [r1(q), r1(off(q, j % 4 === 0 ? 9 : 5))]; });
    return { id, i, points: poly.map((p) => r1(p).join(',')).join(' '), rule: [r1(e1), r1(e2)], ticks };
  });
}
const HEX = hexSegments();
const seg = ([p, q], key) => html`<line key=${key} x1=${p[0]} y1=${p[1]} x2=${q[0]} y2=${q[1]} />`;

function TitleHex({ titles, gd }) {
  const recs = Array.isArray(gd.config?.titles) ? gd.config.titles : [];
  const pt = (deg, r) => [Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r];
  return html`<div class="ach-hex">
    <span class="ach-hex__cap" aria-hidden="true"><i></i>STRONGHOLD PROTOCOL<small></small></span>
    <svg class="ach-hex__svg" viewBox="-300 -240 600 480" aria-hidden="true">
      ${HEX.map((h) => html`<g key=${h.id} class="ach-hex__seg" style=${`--i:${h.i}`}>
        <polygon points=${h.points} />
        <g class="ach-hex__ticks">${seg(h.rule, 'rule')}${h.ticks.map(seg)}</g>
      </g>`)}
      <circle class="ach-hex__hub" r="15" />
    </svg>
    ${HEX_TITLES.map((id, i) => {
      const [x, y] = pt(-90 + i * 60, 222);
      const rec = recs.find((r) => r.id === id);
      return html`<span key=${id} class="ach-hex__label" style=${`left:calc(50% + ${(x / 600) * 100}%);top:calc(50% + ${(y / 480) * 100}%);--i:${i}`} title=${rec?.text || ''}>
        <b class="num">${titles[id] || 0}</b><span>${rec?.name || id}</span></span>`;
    })}
  </div>`;
}

/** Existing display name only; no account/profile/likes or invented gameplay level. */
export function TrophyBadge({ count }) {
  const medals = data.get('config')?.trophies?.medals;
  const steps = Array.isArray(medals) && medals.length ? medals : [0, 10, 30, 60, 100].map((n, i) => ({ count: n, iconId: `trophy_level${i + 1}_icon` }));
  const medal = steps.filter((m) => count >= m.count).at(-1) || steps[0];
  return html`<${Img} class="tbadge" src=${data.get('assets')?.ui?.[`medalIcon/${medal.iconId}`]}
    fallback=${html`<${Icon} name="rook" />`} />`;
}

function Plate({ me, s, card, onAvatar }) {
  const name = me?.name || t('博士');
  return html`<div class="ach-plate">
    <div class="ach-card">
      <button type="button" class="ach-card__ava" onClick=${onAvatar} title=${t('更换头像')} aria-label=${t('更换头像')}>
        <${Img} src=${cardAvatarUrl(card?.avatar, data.get('assets'))} fallback=${html`<span class="ach-card__glyph">${[...name][0]}</span>`} /></button>
      <span class="ach-card__who"><b class="ach-card__name">${name}</b><span class="ach-card__id">${t('本机记录')}</span></span>
      <span class="ach-card__brand" aria-hidden="true">STRONGHOLD<br />PROTOCOL</span>
    </div>
    <div class="ach-counts">
      <span class="ach-counts__badge is-trophy"><${TrophyBadge} count=${s.trophies} /></span>
      <span class="ach-counts__row" title=${t('最高回合 {n}', { n: s.bestRound })}><small><${Icon} name="crown" />${t('已获奖杯')}</small><b class="num">${fmt(s.trophies)}</b></span>
      <span class="ach-counts__badge"><${Icon} name="check" /></span>
      <span class="ach-counts__row"><small>${t('已达成成就')}</small><b class="num">${s.achieved}<small> / ${s.achievements.length}</small></b></span>
    </div>
  </div>`;
}

function ModeTable({ modes }) {
  const row = (key, icon, label) => html`<div class="ach-modes__row">
    <span class="ach-modes__mode"><${Icon} name=${icon} /><b>${label}</b></span>
    <span class="ach-modes__cell"><b class="num">${modes[key].games}</b><small>${t('总模拟数')}</small></span>
    <span class="ach-modes__cell"><b class="num">${modes[key].wins}</b><small>${t('成功卫戍')}</small></span>
    <span class="ach-modes__cell" title=${t('在绝境模拟或终极模拟中成功卫戍')}><b class="num">${modes[key].hard}</b><small>${t('绝境突破')}</small></span>
  </div>`;
  return html`<div class="ach-modes">${row('solo', 'user', t('独立模拟'))}${row('coop', 'users', t('同盟模拟'))}</div>`;
}

function BestRecord({ best, gd }) {
  if (!best) return html`<p class="ach-empty">${t('还没有可展示的战果：完成一局模拟后在这里记录盟约叠加最高的一局')}</p>`;
  const lineup = Array.isArray(best.self.lineup) ? best.self.lineup : [];
  const slots = Array.from({ length: 10 }, (_, i) => lineup[i] || null);
  const bonds = recordBonds(best.self.bonds, (id) => !!gd.bond?.(id)?.noStack);
  const bond = gd.bond?.(best.bondId);
  return html`<div class="ach-best">
    <div class="ach-best__left">
      <span class="ach-pill">${t('战果纪录')}<${Icon} name="chevrons" /></span>
      <span class="ach-best__mount">
        <span class="ach-best__glyph" title=${bond?.name || best.bondId}><${BondGlyph} bondId=${best.bondId} /></span>
        <span class="ach-best__label">${t('盟约最高叠加')}</span>
        <b class="ach-best__num num">${best.layers}</b>
        <i class="ach-best__wire" aria-hidden="true"></i>
      </span>
    </div>
    <div class="ach-best__lineup">
      <div class="ach-best__rows">
        <div class="ach-best__row">${slots.slice(0, 5).map((u, i) => html`<${OpCard} key=${i} u=${u} gd=${gd} i=${i} />`)}</div>
        <div class="ach-best__row">${slots.slice(5).map((u, i) => html`<${OpCard} key=${i} u=${u} gd=${gd} i=${i + 5} />`)}</div>
      </div>
      <div class="ach-best__bonds">${bonds.map((b, i) => html`<span key=${b.bondId} class=${cx('sbond', b.active && 'is-on')} style=${`--i:${i}`} title=${gd.bond?.(b.bondId)?.name || b.bondId}>
        <span class="sbond__disc"><${BondGlyph} bondId=${b.bondId} /></span><b class="num">${b.hidden ? '—' : b.layers}</b></span>`)}</div>
    </div>
  </div>`;
}

function Maxima({ maxima }) {
  const box = (cls, label, v, glyph) => html`<div class=${cx('ach-max', cls)}>
    <span class="ach-max__label">${label}</span><b class="ach-max__num"><small>x</small><span class="num">${v}</span></b>
    <svg class="ach-max__glyph" viewBox="0 0 48 48" aria-hidden="true"><path d=${glyph} /></svg>
  </div>`;
  return html`<div class="ach-maxima">
    ${box('is-gold', t('单局最多消耗资金:'), maxima.gold, 'M24 3 33 13 24 23 15 13zM12 21l9 10-9 10-9-10zM36 21l9 10-9 10-9-10z')}
    ${box('is-orange', t('单局最多晋级次数:'), maxima.merges, 'M4 22 16 10l8 8 8-8 12 12-5 5-7-7-8 8-8-8-7 7zM4 38l12-12 8 8 8-8 12 12-5 5-7-7-8 8-8-8-7 7z')}
    ${box('is-mint', t('单局最多击败数:'), maxima.kills, 'M6 4h8l10 13L34 4h8L28 22l16 18-6 5-14-15-14 15-6-5 16-18z')}
  </div>`;
}

function BondRecord({ topBonds, gd }) {
  if (!topBonds.length) return html`<p class="ach-empty">${t('暂无盟约记录')}</p>`;
  const ops = bondOperators(data.list('chess'), topBonds[0].bondId);
  return html`<div class="ach-list">
    <p class="ach-sub">${t('最常使用的盟约:')}</p>
    <div class="ach-tops">${topBonds.map((b, i) => html`<div key=${b.bondId} class="ach-top ach-top--bond" title=${t('{n} 局中激活', { n: b.games })}>
      <span class="ach-top__frame"><i class="ach-top__rank">TOP${i + 1}</i><${BondGlyph} bondId=${b.bondId} /></span>
      <b class="ach-top__name">${gd.bond?.(b.bondId)?.name || b.bondId}</b></div>`)}</div>
    ${ops.length ? html`<p class="ach-sub">${t('盟约下干员为:')}</p>
      <div class="ach-ops">${ops.map((c) => html`<span key=${c.chessId} class=${cx('ach-op', `sop--t${c.tier}`)} title=${c.name}>
        <${UnitThumb} kind="chess" id=${c.chessId} size="md" showTier=${false} /><b class="ach-op__tier">${ROMAN[c.tier] || ''}</b></span>`)}</div>` : null}
  </div>`;
}

function BandRecord({ topBands, marked, gd }) {
  if (!topBands.length) return html`<p class="ach-empty">${t('暂无策略记录')}</p>`;
  const name = (id) => gd.band?.(id)?.name || id;
  return html`<div class="ach-list">
    <p class="ach-sub">${t('最常使用的策略:')}</p>
    <div class="ach-tops ach-tops--band">${topBands.map((b, i) => html`<div key=${b.bandId} class="ach-top ach-top--band">
      <span class="ach-top__frame"><i class="ach-top__rank">TOP${i + 1}</i><${BandIcon} bandId=${b.bandId} size="lg" /></span>
      <span class="ach-top__side"><b class="ach-top__name">${name(b.bandId)}</b><span class="ach-top__count"><small>x</small><b class="num">${b.games}</b></span></span></div>`)}</div>
    <p class="ach-sub" title=${t('用该策略在绝境模拟或终极模拟中成功卫戍')}>${t('已获得特殊标识的策略:')}</p>
    ${marked.length ? html`<div class="ach-marks">${marked.map((id) => html`<div key=${id} class="ach-mark">
      <span class="ach-mark__frame"><${BandIcon} bandId=${id} size="lg" /><i class="ach-mark__badge" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M8 1.5 14 13H2zM8 6v3.6M8 11v.6" fill="none" stroke="currentColor" stroke-width="1.8" /></svg></i></span>
      <b>${name(id)}</b></div>`)}</div>` : html`<p class="ach-empty">${t('在绝境模拟或终极模拟中成功卫戍，所用策略会获得特殊标识')}</p>`}
  </div>`;
}

// Keep the reference's row markup and seven-group presentation, not a new dashboard/filter design.
export function AchievementMark({ a, icon }) {
  return html`<div class=${`ach-mark ach-mark--row${a.done ? ' is-done' : ''}`} title=${t(a.desc)}>
    <span class="ach-mark__frame"><${Icon} name=${icon} />${a.done ? html`<span class="ach-mark__badge"><${Icon} name="check" /></span>` : null}</span>
    <span class="ach-mark__text">
      <b>${t(a.name)}</b><small>${t(a.desc)}</small>
      ${a.done ? html`<span class="ach-mark__got">${t('已达成')}</span>`
        : html`<span class="ach-mark__bar" role="progressbar" aria-label=${t(a.name)} aria-valuenow=${a.current} aria-valuemin="0" aria-valuemax=${a.goal}>
          <i style=${`width:${(a.frac * 100).toFixed(1)}%`}></i><em class="num">${fmt(a.current)} / ${fmt(a.goal)}</em></span>`}
    </span>
  </div>`;
}

/** Reference design with the branch's shared modal focus lifecycle, without Modal's visual wrappers. */
export function AchievementPanel({ me, onClose }) {
  const ready = useData('config', 'assets', 'chess', 'bonds', 'bands', 'items', 'backups');
  const gd = useMemo(() => makeLookups(ready), [ready, data.locale()]);
  const hidden = useMemo(() => (id) => !!gd.bond(id)?.noStack, [gd]);
  const { s, local } = useAchievements(hidden);
  const card = useMyCard();
  const [picking, setPicking] = useState(false);
  const boxRef = useRef(null);
  const [closing, close] = useLeave(onClose, 180);
  const [shown, setShown] = useState(false);
  const opened = useRef(Date.now());
  useEffect(() => {
    if (!ready && !local.newer) return undefined;
    const id = setTimeout(() => setShown(true), Math.max(0, 260 - (Date.now() - opened.current)));
    return () => clearTimeout(id);
  }, [ready, local.newer]);
  useModalFocus(true, close, boxRef);
  useLayoutEffect(() => { if (shown) boxRef.current?.querySelector('.ach__close')?.focus(); }, [shown]);
  return html`<${AchievementView} me=${me} onClose=${close} gd=${gd} ready=${shown} s=${s} local=${local} boxRef=${boxRef} closing=${closing}
    card=${card} onAvatar=${() => setPicking(true)} onStats=${() => { onClose(); openStats(); }} />
    ${picking ? html`<${AvatarPicker} current=${card.avatar} list=${cardOperators(data.list('chess'))} m=${data.get('assets')}
      onPick=${(id) => { setCardAvatar(id); setPicking(false); }} onClose=${() => setPicking(false)} />` : null}`;
}

/** Hook-free content of the local achievements panel. */
export function AchievementView({ me, onClose, gd, ready, s, local, boxRef, closing = false, onStats, card, onAvatar }) {
  const icons = Object.fromEntries(ACHIEVEMENT_GROUPS.map(([id, , icon]) => [id, icon]));
  return html`<div class=${cx('ach', closing && 'is-closing')} role="presentation"
    onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref=${boxRef} class=${cx(ready && 'ach__box', !ready && 'ach__pending')} role="dialog" aria-modal="true" aria-label=${t('成就统计')} tabindex="-1">
    ${!ready ? html`<span class="ach__loader" role="status" aria-label=${t('读取中')}><i></i><i></i><b></b></span>` : html`
      <header class="ach__head">
        <span class="ach__logo"><svg viewBox="0 0 40 30" aria-hidden="true"><path d="M8 4h10v8H8zM22 4h10v8H22zM8 18h10v8H8zM22 18h10v8H22z" fill="none" stroke="currentColor" stroke-width="2.4" /><path d="M2 2v26M38 2v26" stroke="currentColor" stroke-width="2" /></svg>
          <b>STRONGHOLD<br />PROTOCOL</b></span>
        <span class="ach__band">
          <svg class="ach__dunes" viewBox="0 0 300 40" preserveAspectRatio="none" aria-hidden="true">
            <path class="is-far" d="M0 24c28-7 58-13 92-9s56 11 90 4 64-14 118-7V40H0z" /><path d="M0 34c34-9 60-12 96-6s52 9 86 3 70-11 118-5V40H0z" /></svg>
          <span class="ach__emblem"><${Emblem} /></span>
          <span class="ach__titles"><i aria-hidden="true">ALLIANCE</i><b>${t('卫戍协议：盟约')}</b></span>
        </span>
      </header>
      <div class="ach__body">
        ${local.newer ? html`<p role="alert">${t('战绩由更新版本保存，请使用对应版本查看')}</p>` : html`
        <section class="ach-top-area">
          <div class="ach-top-area__left"><${Plate} me=${me} s=${s} card=${card} onAvatar=${onAvatar} /><${ModeTable} modes=${s.modes} /></div>
          <${TitleHex} titles=${s.titles} gd=${gd} />
        </section>
        <${SectionBar} title=${t('成就')} micro="ACHIEVEMENTS" />
        ${ACHIEVEMENT_GROUPS.map(([id, label]) => html`<div key=${id} class="ach-list">
          <p class="ach-sub">${t(label)}</p>
          <div class="ach-marks ach-marks--list">${s.achievements.filter((a) => a.group === id).map((a) => html`<${AchievementMark} key=${a.id} a=${a} icon=${icons[id]} />`)}</div>
        </div>`)}
        <${SectionBar} title=${t('卫戍成就')} micro="RECORDS" />
        <${BestRecord} best=${s.best} gd=${gd} />
        <${Maxima} maxima=${s.maxima} />
        <${SectionBar} title=${t('盟约纪录')} micro="BONDS" />
        <${BondRecord} topBonds=${s.topBonds} gd=${gd} />
        <${SectionBar} title=${t('策略纪录')} micro="STRATEGIES" />
        <${BandRecord} topBands=${s.topBands} marked=${s.markedBands} gd=${gd} />`}
        <p class="ach-local"><${Icon} name="info" /><span>${t('本机记录 · 仅统计当前浏览器保留的对局，不上传服务器')}<br />
          ${t('奖杯按保留记录累计；旧压缩记录缺失的奖杯无法补回。盟约和阵容纪录仅覆盖仍保留明细的对局。')}
          <button type="button" class="ach-local__stats" onClick=${onStats}>${t('统计数据')}</button></span></p>
      </div>
      <span class="ach__foot">${t('本机记录 · 保存在这台设备的浏览器里 · 每局结束后更新')}</span>`}
      <button type="button" class="ach__close" data-autofocus onClick=${onClose} aria-label=${t('关闭')}><${Icon} name="close" /></button>
    </div>
  </div>`;
}
