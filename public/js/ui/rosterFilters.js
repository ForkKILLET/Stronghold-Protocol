// Shared operator search and chips: the loadout, DIY picker and live stock picker use the same controls.
import { html, TextField } from './components.js';
import { Img } from './gameComponents.js';
import { profGlyphUrl } from './assetUrls.js';
import { PROF_ORDER, PROF_NAME } from './loadoutModel.js';
import { t } from '../../../shared/i18n.js';

const cx = (...parts) => parts.filter(Boolean).join(' ');

export function RosterSearch({ query, onQuery, modalFocus = false }) {
  return html`<${TextField} size="sm" icon="search" value=${query} placeholder=${t('搜索干员 / 职业 / 盟约')}
    class="lo-search" ariaLabel=${t('搜索干员 / 职业 / 盟约')} modalFocus=${modalFocus}
    onInput=${value => onQuery(String(value).slice(0, 24))} />`;
}

export function TierFilter({ tier, onTier }) {
  return html`<div class="lo-chips lo-chips--tier" role="group" aria-label=${t('阶级')}>
    <button type="button" class=${cx('lo-chip', !tier && 'is-on')} aria-pressed=${!tier} onClick=${() => onTier(null)}>${t('全部')}</button>
    ${[1, 2, 3, 4, 5, 6].map(n => html`<button key=${n} type="button" class=${cx('lo-chip', 'lo-chip--tier', `lo-chip--t${n}`, tier === n && 'is-on')}
      aria-pressed=${tier === n} title=${t('{tier}阶', { tier: n })} onClick=${() => onTier(tier === n ? null : n)}><span class="num">${['I', 'II', 'III', 'IV', 'V', 'VI'][n - 1]}</span></button>`)}
  </div>`;
}

/** One profession toggles at a time; choosing the current chip clears it. */
export function ProfFilter({ m, prof, onProf }) {
  return html`<div class="lo-chips lo-chips--prof" role="group" aria-label=${t('职业')}>
    ${PROF_ORDER.map(p => html`<button key=${p} type="button" class=${cx('lo-chip', 'lo-chip--prof', prof === p && 'is-on')}
      aria-pressed=${prof === p ? 'true' : 'false'} title=${t(PROF_NAME[p])} onClick=${() => onProf(prof === p ? null : p)}>
      <${Img} src=${profGlyphUrl(m, p)} class="lo-chip__icon lo-profglyph" fallback=${html`<span>${t(PROF_NAME[p])[0]}</span>`} /><span class="lo-chip__lbl">${t(PROF_NAME[p])}</span></button>`)}
  </div>`;
}
