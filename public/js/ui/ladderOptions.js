// Same regulation selector in creation and room configuration; no separate native select or modal.
import { html, DifficultyIcon } from './components.js';
import { DIFFICULTIES, DIFFICULTY_NAMES, DIFFICULTY_COLORS } from '../../../shared/constants.js';
import { t } from '../../../shared/i18n.js';
export function LadderOptions({ ladder, modeId, onMode, disabled = false }) {
  const rows = [{ difficulty: null, modes: ladder.filter(m => !DIFFICULTIES.includes(m.difficulty)) },
    ...DIFFICULTIES.map(d => ({ difficulty: d, modes: ladder.filter(m => m.difficulty === d) }))];
  return html`<div class="ladder-options" data-testid="proto-ladder" role="group" aria-label=${t('规程等级')}>
    ${rows.filter(r => r.modes.length).map(({ difficulty: d, modes }) => html`<div class="ladder-options__row" key=${d || 'fast'} style=${`--d-color:${DIFFICULTY_COLORS[d] || 'var(--mint-400)'}`}>
      <span class="ladder-options__label">${d ? html`<${DifficultyIcon} difficulty=${d} />${t(DIFFICULTY_NAMES[d])}` : t('极速模拟')}</span>
      <div class="ladder-options__cells">${modes.map(m => html`<button type="button" key=${m.id} disabled=${disabled}
        class=${modeId === m.id ? 'is-on' : ''} aria-pressed=${modeId === m.id} title=${m.name} data-mode=${m.id}
        onClick=${() => onMode(m.id)}>${d ? /\d+$/.exec(m.id)?.[0] || m.name : m.name}</button>`)}</div>
    </div>`)}
  </div>`;
}
