// Current Boss pool only; server-credited operator and player rows, shared by all viewers.

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { PlayerAvatar, UnitThumb } from './gameComponents.js';
import { t } from '../../../shared/i18n.js';
import { loadPref, savePref } from '../store.js';

/** Percent of the original shared Boss HP, not a share of damage dealt so far. */
export function leaderSharePct(dmg, maxHp) {
  const n = Number(dmg), max = Number(maxHp);
  if (!(max > 0) || !Number.isFinite(max) || !Number.isFinite(n) || !(n > 0)) return 0;
  return Math.max(1, Math.round(n / max * 100));
}

/** The open choice lasts for this phase only. Each new Boss round auto-opens by default,
 * including reconnect; data ticks, mode changes and pinning do not reopen a dismissed chart. */
export function useLeaderRankTool(pub) {
  const [open, setOpen] = useState(false);
  const [auto, setAuto] = useState(() => loadPref('leaderRankAuto', true) !== false);
  const [mode, setMode] = useState(() => loadPref('leaderRankMode', 'operators') === 'players' ? 'players' : 'operators');
  const boss = pub?.phase === 'FINAL_ASSAULT' || pub?.phase === 'HIDDEN_CORE';
  const key = boss ? `${pub.combatHistoryKey || ''}:${pub.round}:${pub.phase}` : null;
  useEffect(() => { setOpen(key != null && auto); }, [key]);
  return { open, auto, mode, boss,
    toggle: () => setOpen(v => !v), close: () => setOpen(false),
    onAuto: value => { setAuto(value); savePref('leaderRankAuto', value); },
    onMode: value => { setMode(value); savePref('leaderRankMode', value); },
  };
}

/** Stable identities keep existing DOM rows alive while their ranks move. Do not manufacture
 * player totals from legacy top-three frames: older servers/replays have no complete total. */
export function leaderChartRows(rows, playerRows, mode) {
  return (mode === 'players' ? playerRows : rows)?.filter(r => r && typeof r.pid === 'string' && Number.isFinite(r.dmg) && r.dmg > 0)
    .map(r => ({ ...r, key: mode === 'players' ? `player:${r.pid}` : `unit:${r.pid}:${r.uid}` }))
    .sort((a, b) => b.dmg - a.dmg) || [];
}

/** @typedef {{ left: number, top: number, right: number, bottom: number }} Box */

/**
 * Where the list goes when its home (under the top bar's right end) would cover the right column — the countdown and,
 * once the level time runs out, the red 「生命值 −1/秒」 warning under it (ui/hud.js OvertimeWarning). Only a tall
 * countdown reaches that far: 可露希尔's TV put the list over the TV and over the warning (the owner, 2026-11-14
 * 「boss关扣生命值的提示会被伤害排行窗口遮挡」, §37.201). Then the list stays at the right edge, under the column, its right
 * edge clear of the DP box beside it. Moved left of the column (§37.201) it sat in the middle of the field under the
 * 规程 themes' wide top-bar column (the owner, 2026-11-14 「伤害排行窗口太靠中间了，有点遮挡场上」, §37.207); left of the
 * column, under the bond strip, stays the fallback when there is no room under it above `floor`.
 * Pure; boxes in viewport px, the result in px from the HUD's top / right edge, null = stay home.
 * @param {{ panel: Box|null, column: Box|null, hud: Box|null, bonds?: Box|null, dp?: Box|null, floor?: number|null, gap?: number }} o
 * @returns {{ top: number, right: number }|null}
 */
export function leaderRankSpot({ panel, column, hud, bonds = null, dp = null, floor = null, gap = 6 }) {
  if (!panel || !hud) return null;
  const dpCross = dp && panel.left < dp.right && panel.right > dp.left && panel.top < dp.bottom && panel.bottom > dp.top;
  if (!column) return dpCross ? { top: Math.round(panel.top - hud.top), right: Math.round(hud.right - dp.left + gap) } : null;
  const crosses = panel.left < column.right && panel.right > column.left && panel.top < column.bottom && panel.bottom > column.top;
  if (!crosses) return dpCross ? { top: Math.round(panel.top - hud.top), right: Math.round(hud.right - dp.left + gap) } : null;
  const height = panel.bottom - panel.top;
  const below = column.bottom + gap;
  if (below + height <= (floor ?? hud.bottom)) {
    let right = hud.right - panel.right;
    if (dp && dp.left < panel.right && dp.right > panel.left && dp.top < below + height && dp.bottom > below) right = Math.max(right, hud.right - dp.left + gap);
    return { top: Math.round(below - hud.top), right: Math.round(right) };
  }
  const top = Math.max(panel.top, bonds && bonds.bottom > 0 ? bonds.bottom + gap : panel.top) - hud.top;
  return { top: Math.round(top), right: Math.round(hud.right - column.left + gap) };
}

/**
 * The list's spot, measured while it shows and again whenever the right column changes size (the warning comes, a theme
 * swaps the countdown) or the window resizes. null = home (the CSS spot).
 * @param {boolean} active
 * @returns {{ top: number, right: number }|null}
 */
export function useLeaderRankSpot(active) {
  const [spot, setSpot] = useState(/** @type {{ top: number, right: number }|null} */ (null));
  useEffect(() => {
    if (!active) { setSpot(null); return undefined; }
    /** @param {Element|null} el @returns {Box|null} */
    const box = (el) => { const b = el?.getBoundingClientRect(); return b && b.width > 0 ? { left: b.left, top: b.top, right: b.right, bottom: b.bottom } : null; };
    let frame = null;
    const measure = () => {
      frame = null;
      const panel = /** @type {HTMLElement|null} */ (document.querySelector('.ldmg'));
      // read the home spot: drop the override for the reading, then put it back
      const keep = panel ? [panel.style.top, panel.style.right] : null;
      if (panel) { panel.style.top = ''; panel.style.right = ''; }
      // the column with what sticks out of it (the warning may be wider than a narrow column)
      const col = document.querySelector('.gtop__right');
      const parts = col ? [col, ...col.children].map(box).filter(Boolean) : [];
      const column = parts.length ? parts.reduce((u, b) => ({ left: Math.min(u.left, b.left), top: Math.min(u.top, b.top),
        right: Math.max(u.right, b.right), bottom: Math.max(u.bottom, b.bottom) })) : null;
      const hud = box(document.querySelector('.gm__hud'));
      // room under the column down to the bottom bar's band (1.4rem: the camera switch and the corner buttons)
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const next = leaderRankSpot({ panel: box(panel), column, hud, bonds: box(document.querySelector('.gm__bonds')),
        dp: box(document.querySelector('.dpbox')), floor: hud ? hud.bottom - 1.4 * rem : null });
      if (panel && keep) { panel.style.top = keep[0]; panel.style.right = keep[1]; }
      setSpot((old) => (old?.top === next?.top && old?.right === next?.right ? old : next));
    };
    const later = () => { if (frame == null) frame = requestAnimationFrame(measure); };
    const column = document.querySelector('.gtop__right');
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(later) : null;
    if (column && ro) ro.observe(column);
    const panel = document.querySelector('.ldmg');
    if (panel && ro) ro.observe(panel);
    addEventListener('resize', later);
    later();
    return () => { ro?.disconnect(); removeEventListener('resize', later); if (frame != null) cancelAnimationFrame(frame); };
  }, [active]);
  return spot;
}

/** A quiet chart in the existing HUD slot. Controls reveal on hover, keyboard focus or touch. */
export function LeaderRank({ rows, playerRows, players, maxHp, mode = 'operators', onMode, auto = true, onAuto,
  onClose, boss = true, spot = null }) {
  const list = boss ? leaderChartRows(rows, playerRows, mode) : [];
  const names = new Map((players || []).map(p => [p.playerId, p]));
  const maximum = Math.max(1, ...list.map(r => r.dmg));
  return html`<aside id="leader-rank-panel" class=${spot ? 'ldmg is-moved' : 'ldmg'} aria-label=${t('领袖伤害排行')}
      tabindex="0" onPointerDown=${e => { if (e.pointerType === 'touch') e.currentTarget.focus({ preventScroll: true }); }} style=${spot ? `top:${spot.top}px;right:${spot.right}px` : null}
      onKeyDown=${e => { if (e.key === 'Escape') { onClose?.(); e.stopPropagation(); } }}>
    <div class="ldmg__head">
      <strong class="ldmg__title">${t('领袖伤害排行')}<small>${mode === 'players' ? t('玩家') : t('干员')}</small></strong>
      <div class="ldmg__controls">
        <div class="ldmg__modes" role="group" aria-label=${t('排行模式')}>
          ${[['operators', t('干员')], ['players', t('玩家')]].map(([id, label]) => html`<button type="button"
            aria-pressed=${mode === id} onClick=${() => onMode?.(id)}>${label}</button>`)}
        </div>
        <label class="ldmg__auto" title=${t('领袖回合自动打开')}><input type="checkbox" checked=${auto}
          onChange=${e => onAuto?.(e.currentTarget.checked)} />${t('自动')}</label>
        <button type="button" class="ldmg__close" aria-label=${t('关闭领袖伤害排行')} onClick=${onClose}><${Icon} name="close" /></button>
      </div>
    </div>
    <div class="ldmg__viewport" tabindex="0">
      <ol class="ldmg__list" style=${{ height: `calc(${list.length} * var(--ldmg-step))` }}>
      ${list.map((row, index) => {
        const player = names.get(row.pid), name = player?.name || row.pid;
        return html`<li key=${row.key} class=${`ldmg__row${index === 0 ? ' is-first' : ''}`} data-row-key=${row.key}
            style=${{ transform: `translateY(calc(${index} * var(--ldmg-step)))` }}>
          ${row.chess ? html`<${UnitThumb} kind="chess" id=${row.chess} tier=${row.tier} size="xs" ownerId=${row.pid} />`
            : html`<${PlayerAvatar} player=${player || { name }} size="sm" />`}
          <div class="ldmg__unit"><span class="ldmg__name" title=${name}>${name}</span>
            <div class="ldmg__track"><span class="ldmg__bar" style=${{ width: `${row.dmg / maximum * 100}%` }}></span></div>
          </div>
          <span class="ldmg__share" title=${`${t('对领袖伤害占比')} · ${Math.round(row.dmg).toLocaleString()}`}>${leaderSharePct(row.dmg, maxHp)}%</span>
        </li>`;
      })}
      </ol>
      ${!list.length ? html`<p class="ldmg__empty">${!boss ? t('领袖回合开始后显示')
        : mode === 'players' && !Array.isArray(playerRows) ? t('当前记录未提供玩家总伤害') : t('等待领袖伤害数据')}</p>` : null}
    </div>
    <span class="ldmg__hint">${t('百分比按领袖总生命值计算；条长相对榜首')}</span>
  </aside>`;
}
