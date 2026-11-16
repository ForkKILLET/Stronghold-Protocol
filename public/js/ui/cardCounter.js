import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, Modal, Spinner } from './components.js';
import { Select } from './select.js';
import { UnitThumb } from './gameComponents.js';
import { data } from '../data.js';
import { net } from '../net.js';
import { loadPref, savePref } from '../store.js';
import { t } from '../../../shared/i18n.js';
import { useCornerPanel } from './cornerPanel.js';
import { counterRoster, favoriteOperators, oddsText } from './gameToolsModel.js';
import { watchCardCounter } from './cardCounterClient.js';
import { filterRoster, PROF_ORDER, PROF_NAME } from './loadoutModel.js';

function OperatorPicker({ roster, favorites, banned, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState(null);
  const [prof, setProf] = useState(null);
  const [bond, setBond] = useState(null);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const shown = filterRoster(roster, { query, tier, prof, bond }, {}, id => data.lookup('chess', id), id => data.lookup('bonds', id))
    .filter(c => !onlyFavorites || favorites.includes(c.charId));
  const bonds = data.list('bonds').filter(b => roster.some(c => c.bonds?.includes(b.bondId)));
  return html`<${Modal} open=${true} title=${t('搜索并选择干员')} onClose=${onClose} class="card-picker" width="min(max(9rem, 640px), calc(100vw - .4rem))"
      actions=${html`<${Button} onClick=${onClose}>${t('取消')}<//>`}>
    <div class="card-picker__filters">
      <label class="card-picker__search"><${Icon} name="search" /><input type="search" data-autofocus="true" aria-label=${t('搜索干员')}
        placeholder=${t('搜索干员')} value=${query} maxlength="64" onInput=${e => setQuery(e.target.value)} /></label>
      <div class="card-picker__chips" role="group" aria-label=${t('职业')}>
        ${PROF_ORDER.map(p => html`<button type="button" key=${p} aria-pressed=${prof === p} onClick=${() => setProf(prof === p ? null : p)}>${t(PROF_NAME[p])}</button>`)}
      </div>
      <div class="card-picker__chips" role="group" aria-label=${t('等阶')}>
        <button type="button" aria-pressed=${tier == null} onClick=${() => setTier(null)}>${t('全部等阶')}</button>
        ${[1, 2, 3, 4, 5, 6].map(n => html`<button type="button" key=${n} aria-pressed=${tier === n} onClick=${() => setTier(tier === n ? null : n)}>${['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ'][n - 1]}</button>`)}
      </div>
      <div class="card-picker__more"><${Select} value=${bond || ''} onChange=${v => setBond(v || null)} label=${t('盟约')}
        options=${[{ value: '', label: t('全部盟约') }, ...bonds.map(b => ({ value: b.bondId, label: b.name }))]} />
        <button type="button" class="card-picker__favorite-filter" aria-pressed=${onlyFavorites} onClick=${() => setOnlyFavorites(!onlyFavorites)}><${Icon} name="star" />${t('仅显示收藏')}</button>
      </div>
    </div>
    <div class="card-picker__results" aria-label=${t('干员列表')}>
      ${shown.length ? shown.map(c => html`<button type="button" key=${c.chessId} class=${`card-picker__operator${banned.has(c.chessId) ? ' is-banned' : ''}`}
        onClick=${() => onPick(c.chessId)}><${UnitThumb} id=${c.chessId} ownerId=${null} size="sm" /><span><b>${c.name}</b>
          <small>${banned.has(c.chessId) ? t('本局禁用') : (c.bonds || []).map(id => data.lookup('bonds', id)?.name).filter(Boolean).join(' · ')}</small></span>
        ${favorites.includes(c.charId) ? html`<${Icon} name="star" class="card-picker__star" />` : null}</button>`)
        : html`<p class="card-counter__empty">${t('无匹配干员')}</p>`}
    </div>
  <//>`;
}

/** A single selected operator's live ledger; favorite identities stay local and work across versions. */
export function CardCounterPanel({ myId, pub, connected = true, onClose, client = net }) {
  const panel = useRef(null), close = useRef(null), watcher = useRef(null);
  useCornerPanel(panel, close, onClose, false, 320);
  const content = data.contentId(), locale = data.locale();
  const roster = useMemo(() => counterRoster(data.list('chess')), [content, locale]);
  const [favorites, setFavorites] = useState(() => favoriteOperators(loadPref('cardCounter', null)));
  const favoriteRows = roster.filter(c => favorites.includes(c.charId));
  const [selectedChar, setSelectedChar] = useState(() => favoriteRows[0]?.charId || null);
  const [picker, setPicker] = useState(false);
  const [reading, setReading] = useState(null);
  const target = roster.find(c => c.charId === selectedChar);
  const selected = target?.chessId || null;
  const banned = new Set(pub?.bannedChess || []);
  const level = pub?.players?.find(p => p.playerId === myId)?.shopLevel;
  const matchKey = pub?.combatHistoryKey;
  const key = `${content}:${matchKey}:${myId}:${selected}:${pub?.round}:${pub?.setupRevision}:${level}`;
  const current = reading?.key === key ? reading : null;
  const stock = current?.data;
  useEffect(() => {
    if (!target || !connected || !matchKey) return undefined;
    const live = watchCardCounter({ net: client, chessId: selected, playerId: myId, matchKey,
      visible: () => !document.hidden, onState: state => setReading({ ...state, key }) });
    watcher.current = live;
    const wake = () => { if (!document.hidden) live.refresh(); };
    document.addEventListener('visibilitychange', wake);
    return () => { live.stop(); if (watcher.current === live) watcher.current = null; document.removeEventListener('visibilitychange', wake); };
  }, [key, connected, !!target, client]);
  const pick = id => { const rec = roster.find(c => c.chessId === id); if (rec) setSelectedChar(rec.charId); setPicker(false); };
  const favorite = () => {
    if (!target) return;
    const next = favorites.includes(target.charId) ? favorites.filter(id => id !== target.charId) : [...favorites, target.charId];
    const safe = favoriteOperators({ v: 1, favorites: next });
    savePref('cardCounter', { v: 1, favorites: safe }); setFavorites(safe);
  };
  const error = !connected ? t('连接恢复后自动更新') : current?.error === 'BAD_MSG' ? t('此版本不支持记牌器') : current?.error ? t('卡池数据读取失败') : null;
  return html`<section ref=${panel} id="card-counter-panel" class="combat-metrics card-counter brackets" role="dialog" aria-label=${t('记牌器')}
      onKeyDown=${e => { if (e.key === 'Escape') onClose(); e.stopPropagation(); }}>
    <header class="combat-metrics__head"><h2>${t('记牌器')}</h2><button ref=${close} type="button" class="combat-metrics__close" aria-label=${t('关闭记牌器')} onClick=${onClose}><${Icon} name="close" /></button></header>
    <div class="card-counter__body">
      <div class="card-counter__selection">
        <button class="card-counter__target" type="button" aria-label=${t('选择目标干员')} onClick=${() => setPicker(true)}>
          ${target ? html`<${UnitThumb} id=${target.chessId} ownerId=${null} size="sm" /><span><b>${target.name}</b><small>${t('搜索并选择干员')}</small></span>` : html`<b>${t('选择目标干员')}</b>`}
          <${Icon} name="search" /></button>
        <button class="card-counter__favorite" type="button" disabled=${!target} aria-pressed=${!!target && favorites.includes(target.charId)}
          aria-label=${t(target && favorites.includes(target.charId) ? '取消收藏' : '收藏干员')} title=${t(target && favorites.includes(target.charId) ? '取消收藏' : '收藏干员')}
          onClick=${favorite}><${Icon} name="star" /></button>
      </div>
      <nav class="card-counter__favorites" aria-label=${t('已收藏干员')}>${favoriteRows.length ? favoriteRows.map(c => html`<button type="button" key=${c.chessId}
        aria-pressed=${selected === c.chessId} onClick=${() => pick(c.chessId)}>${c.name}</button>`) : html`<small>${t(favorites.length ? '此赛季没有已收藏干员' : '暂无收藏干员')}</small>`}</nav>
      ${error ? html`<div class="card-counter__error" role="status">${error}${connected && current?.error !== 'BAD_MSG' ? html`<button type="button" onClick=${() => watcher.current?.refresh()}>${t('重试')}</button>` : null}</div>` : null}
      ${stock ? html`<div class=${`card-counter__data${error ? ' is-stale' : ''}`}>
        ${stock.status !== 'shared' ? html`<p class="card-counter__status">${t(stock.status === 'banned' ? '本局禁用' : '不进入共享卡池')}</p>` : null}
        <div class="card-counter__totals">${[[t('卡池总量'), stock.total], [t('卡池剩余'), stock.remaining], [t('持有折算'), stock.held]].map(([label, value]) => html`<div><small>${label}</small><b>${value ?? '—'}</b></div>`)}</div>
        <table class="card-counter__holders"><thead><tr><th>${t('玩家')}</th><th>${t('玩家持有')}</th><th>${t('占池')}</th></tr></thead><tbody>
          ${stock.holders.map(p => html`<tr key=${p.playerId} class=${p.playerId === myId ? 'is-self' : ''}><th scope="row" title=${p.name}>${p.name}</th>
            <td><b>${p.held}</b><small>${t('初始 {normal} · 精锐 {elite}', { normal: p.normal, elite: p.elite })}</small>${p.extra > 0 ? html`<small class="card-counter__extra">${t('不占池 {count}', { count: p.extra })}</small>` : null}</td>
            <td><b>${p.occupied ?? '—'}</b></td></tr>`)}
        </tbody></table>
        ${stock.overdraw > 0 ? html`<p class="card-counter__status">${t('超额占用 {count} 份', { count: stock.overdraw })}</p>` : null}
        <section class="card-counter__odds"><h3>${t('自然刷出概率')}<small>${t('调度中心 Lv.{level}', { level: stock.odds.level })}</small></h3>
          ${target.tier > stock.odds.level ? html`<p class="card-counter__status">${t('调度中心等级不足')}</p>` : null}
          <div><span>${t('单个干员栏位')}</span><b>${oddsText(stock.odds.slot)}</b></div>
          <div><span>${t('整次刷新至少 1 名')}</span><b>${oddsText(stock.odds.refresh)}</b></div>
        </section>
        <details class="card-counter__note"><summary>${t('统计口径')}</summary><p>${t('精锐按 {count} 名初始干员折算，持有包含作战区、整备区和暂存区。', { count: stock.goldenCopies })}<br />
          ${t('占池以实际来源为准；不占池部分不会减少卡池剩余。')}<br />
          ${t('仅计算自然刷新，不含冻结保留、特殊刷新和赠送；自编库存计入你的抽取分母。')}</p></details>
      </div>` : !error ? html`<p class="card-counter__empty" role="status">${target ? html`<${Spinner} />${t('正在读取卡池…')}` : t('请选择一名干员查看存量。')}</p>` : null}
    </div>
  </section>${picker ? html`<${OperatorPicker} roster=${roster} favorites=${favorites} banned=${banned} onPick=${pick} onClose=${() => setPicker(false)} />` : null}`;
}
