import { useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Spinner, useTicker } from './components.js';
import { UnitThumb } from './gameComponents.js';
import { battleRunner } from '../battle/runner.js';
import { historyPage } from '../battle/combatHistory.js';
import { t, N_ } from '../../../shared/i18n.js';
import { combatMetricsLayout } from './combatMetricsLayout.js';

const TYPES = Object.freeze([
  { id: 'phys', label: N_('物理') }, { id: 'arts', label: N_('法术') },
  { id: 'true', label: N_('真实') }, { id: 'elemental', label: N_('元素') },
]);
const number = (n) => Math.round(n || 0).toLocaleString('zh-CN');
const rate = (n) => (n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 1 });

/** A modeless panel: the battlefield stays visible and keeps playing. Mounted only while open. */
export function CombatMetricsPanel({ myId, onClose, runner = battleRunner, initialScope = 'battle', historical = false, loading = false }) {
  const [scope, setScope] = useState(initialScope);
  const [selectedRound, setSelectedRound] = useState(null);
  const page = historyPage(runner?.combatRounds?.({ ownerId: myId }) || [], selectedRound);
  const closeRef = useRef(null);
  const panelRef = useRef(null);
  useTicker(250);
  useLayoutEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.modal, .guide')) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, []);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const corner = panel?.parentElement;
    const viewport = window.visualViewport;
    const archiveHeader=historical?panel?.closest('.st--replay')?.querySelector('.app-header'):null;
    const measure = () => {
      if (!panel || !corner) return;
      const rect = corner.getBoundingClientRect();
      const rootStyle = getComputedStyle(document.documentElement);
      const layout = combatMetricsLayout({
        cornerTop: rect.top, cornerBottom: rect.bottom,
        viewportHeight: viewport?.height || window.innerHeight,
        viewportTop: viewport?.offsetTop || 0,
        rem: parseFloat(rootStyle.fontSize) || 40,
        safeTop: Math.max(parseFloat(rootStyle.getPropertyValue('--sa-t')) || 0,
          archiveHeader?archiveHeader.getBoundingClientRect().bottom-(viewport?.offsetTop || 0):0),
        safeBottom: parseFloat(rootStyle.getPropertyValue('--sa-b')) || 0,
      });
      panel.style.setProperty('--combat-corner-height', `${rect.height || 44}px`);
      panel.style.setProperty('--combat-available-height', `${layout.availableHeight}px`);
      panel.style.setProperty('--combat-viewport-height', `${layout.viewportSpace}px`);
      panel.style.setProperty('--combat-viewport-top', `${layout.viewportPanelTop}px`);
      panel.dataset.viewportDocked = String(layout.viewportDocked);
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (corner) observer?.observe(corner);
    if (archiveHeader) observer?.observe(archiveHeader);
    window.addEventListener('resize', measure);
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
    };
  }, []);
  const result = (myId ? runner?.combatMetrics({ scope, ownerId: myId, round: page.round }) : null) || { rows: [], damage: 0, healing: 0 };
  const maximum = Math.max(1, ...result.rows.map((r) => r.damage));
  return html`<section ref=${panelRef} id="combat-metrics-panel" class="combat-metrics brackets" role="dialog" aria-label=${t('作战统计')}
      onKeyDown=${(e) => { if (e.key === 'Escape') onClose(); e.stopPropagation(); }}>
    <header class="combat-metrics__head">
      <div><span class="combat-metrics__micro">COMBAT ANALYSIS</span><h2>${t('作战统计')}</h2></div>
      <button ref=${closeRef} type="button" class="combat-metrics__close" aria-label=${t('关闭作战统计')} onClick=${onClose}><${Icon} name="close" /></button>
    <div class="combat-metrics__tools">
      <div class="combat-metrics__scopes" role="group" aria-label=${t('统计范围')}>
        ${[['battle', t('当前战斗')], ['match', t('本局累计')], ['round', t('逐回合')]].filter(([id])=>!historical || id!=='battle').map(([id, label]) => html`<button type="button" key=${id}
          aria-pressed=${scope === id} onClick=${() => setScope(id)}>${label}</button>`)}
      </div>
    ${scope === 'round' && html`<div class="combat-metrics__scopes combat-metrics__pages" role="group" aria-label=${t('回合记录')}>
      <button type="button" disabled=${page.previous == null} onClick=${() => setSelectedRound(page.previous)} aria-label=${t('上一回合')}>‹</button>
      <span>${page.round == null ? t('暂无战斗明细') : t('第 {round} 回合', { round: page.round })}</span>
      <button type="button" disabled=${page.next == null} onClick=${() => setSelectedRound(page.next)} aria-label=${t('下一回合')}>›</button>
    </div>`}
    </div>
    </header>
    <div class="combat-metrics__body" tabindex="0">
    <div class="combat-metrics__totals">
      <span>${t('总伤害')} <b>${historical&&!result.rows.length&&runner?.coverage?.status!=='complete'?'—':number(result.damage)}</b></span><span>${t('总治疗')} <b>${historical&&!result.rows.length&&runner?.coverage?.status!=='complete'?'—':number(result.healing)}</b></span>
    </div>
    <div class="combat-metrics__legend" aria-label=${t('伤害类型图例')}>
      ${TYPES.map((type) => html`<span key=${type.id} class=${`combat-metrics__type combat-metrics__type--${type.id}`}>${t(type.label)}</span>`)}
      <span class="combat-metrics__sort">${t('伤害降序')}</span>
    </div>
    <ol class="combat-metrics__list" tabindex="0" aria-label=${t('干员伤害排行')}>
      ${result.rows.length ? result.rows.map((r, i) => {
        const description = TYPES.map((type) => `${t(type.label)} ${number(r.types[type.id])}`).join('，');
        return html`<li key=${r.key} class="combat-metrics__row">
          <span class="combat-metrics__rank">${String(i + 1).padStart(2, '0')}</span>
          <${UnitThumb} kind=${r.kind === 'token' ? 'token' : 'chess'} id=${r.defId} showTier=${false} size="sm" />
          <div class="combat-metrics__unit">
            <div class="combat-metrics__name"><b title=${r.name}>${r.name || r.defId}</b></div>
            <div class="combat-metrics__bar" role="img" aria-label=${description} title=${description}>
              ${TYPES.map((t) => html`<span key=${t.id} class=${`combat-metrics__segment combat-metrics__segment--${t.id}`}
                style=${{ width: `${r.types[t.id] / maximum * 100}%` }}></span>`)}
            </div>
            <div class="combat-metrics__values">
              <span><small>${t('伤害')}</small><b>${number(r.damage)}</b></span>
              <span><small>DPS</small><b>${rate(r.dps)}</b></span>
              <span class="combat-metrics__heal"><small>${t('治疗')}</small><b>${number(r.healing)}</b></span>
              <span class="combat-metrics__heal"><small>HPS</small><b>${rate(r.hps)}</b></span>
            </div>
          </div>
        </li>`;
      }) : html`<li class="combat-metrics__empty">${loading?html`<${Spinner} />${t('正在读取…')}`:historical?(runner?.coverage?.status==='complete'?t('该回合没有可统计的干员数据。'):runner?.offline?t('暂时无法读取服务器战斗明细。'):t('该回合尚未记录干员伤害明细。')):html`${t('暂无本地战斗记录')}<br /><small>${t('开始战斗后实时显示干员数据')}</small>`}</li>`}
    </ol>
    <p class="combat-metrics__note">${t('仅统计自己 · 同名干员合并 · 召唤物计入所属干员')}<br />${historical?
      runner?.source==='server'?(runner.coverage?.status==='complete'?t('服务器已保存完整明细 · 客户端采集'):t('服务器已保存部分明细 · 未记录的战斗不计为零')):
      t('当前显示本机明细；服务器未记录或暂时不可用。'):t('实际扣血 / 有效治疗，DPS / HPS 按自己的战斗秒数计算。已结束战斗按回合保存在当前浏览器。')}</p>
    </div>
  </section>`;
}
