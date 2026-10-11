// Compact room-creation control, using the lobby's existing visual tokens.
import { html, Icon, MicroLabel } from './components.js';
import { PREP_MIN_MULTIPLIER, PREP_MAX_MULTIPLIER, isPrepMultiplier } from '../../../shared/prepTime.js';
import { t } from '../../../shared/i18n.js';
export function prepChoiceMultiplier(value) {
  return typeof value === 'string' ? (value.trim() ? Number(value) : NaN) : value;
}
export function validPrepChoice(value) {
  const multiplier = prepChoiceMultiplier(value);
  return isPrepMultiplier(multiplier) && (typeof value !== 'string' || multiplier >= PREP_MIN_MULTIPLIER);
}
export function prepTimeLabel(multiplier) {
  return multiplier == null ? t('默认 · 随回合变化') : multiplier === 0 ? t('不限时') : t('默认时长 × {multiplier}', { multiplier });
}
export function PrepTimePicker({ value, onChange, disabled = false }) {
  const scaled = typeof value === 'string';
  const valid = validPrepChoice(value);
  const options = [{ key: 'default', label: t('默认'), active: value == null, value: null },
    { key: 'scaled', label: t('时长倍率'), active: scaled, value: '2' },
    { key: 'untimed', label: t('不限时'), active: value === 0, value: 0 }];
  return html`<section class="prep-setting" aria-label=${t('休整期时长')}>
    <div class="prep-setting__title"><${Icon} name="hourglass" /><span>${t('休整期时长')}</span><${MicroLabel}>PREPARATION<//></div>
    <div class="prep-setting__choices" role="group" aria-label=${t('休整期计时方式')}>
      ${options.map((o) => html`<button key=${o.key} type="button" aria-pressed=${o.active} class=${o.active ? 'is-active' : ''}
        disabled=${disabled} onClick=${() => onChange(o.value)}>${o.label}</button>`)}
    </div>
    ${scaled ? html`<div class="prep-setting__duration">
      <label class="prep-setting__input">${t('默认时长')}<input type="number" inputmode="decimal" min=${PREP_MIN_MULTIPLIER} max=${PREP_MAX_MULTIPLIER} step="0.25"
        value=${value} disabled=${disabled} aria-label=${t('休整期时长倍率')} aria-invalid=${!valid} aria-describedby="prep-duration-help"
        onInput=${(e) => onChange(e.currentTarget.value)} /><span>×</span></label>
      <div class="prep-setting__presets">${[1.5, 2, 3].map((n) => html`<button key=${n} type="button" disabled=${disabled}
        aria-pressed=${Number(value) === n} onClick=${() => onChange(String(n))}>${n}×</button>`)}</div>
    </div>` : null}
    <p id="prep-duration-help" class=${`prep-setting__hint${valid ? '' : ' is-invalid'}`}>
      ${!valid ? t('请输入 0.5–4 之间的倍率，步长为 0.25') : value == null ? t('沿用各回合默认时长，全员就绪可提前开始。')
        : value === 0 ? t('等待全员就绪后开始。仅支持好友 / AI 组队。') : t('保留各回合的时长变化，全员就绪可提前开始。仅支持好友 / AI 组队。')}
    </p>
    <p class="prep-setting__note">${t('仅一名真人时，休整期始终不限时。')}</p>
  </section>`;
}
