import { html, Button, MicroLabel, DifficultyIcon } from './components.js';
import { PrepTimePicker } from './prepTime.js';
import { BATTLE_SPEEDS } from '../../../shared/roomOptions.js';
import { DIFFICULTIES, DIFFICULTY_NAMES, DIFFICULTY_COLORS } from '../../../shared/constants.js';
import { prepTimeLabel } from './prepTime.js';
import { t } from '../../../shared/i18n.js';

/** A dedicated page; draft values belong to LobbyScreen and survive going back. */
export function RoomOptionsPage({mode, prepChoice, onPrepChange, onBack, disabled=false, children, battleSpeed=2, onSpeedChange=()=>{}, difficulty='NORMAL', onDifficultyChange=()=>{}, onSave=onBack, readOnly=false}) {
 return html`<div class="screen room-options-screen">
  <header class="topbar"><div class="topbar__left"><${Button} variant="ghost" icon="chevronLeft" onClick=${onBack}>${t('返回')}<//></div>
   <div class="topbar__center"><${MicroLabel} tone="mint">ROOM CONFIGURATION<//><h1 class="topbar__title">${t('模拟配置')}</h1></div></header>
  <main class="room-options__frame brackets"><div class="room-options__body">
   <section class="prep-setting" aria-label=${t('模拟难度')}><div class="prep-setting__title">${t('模拟难度')}<${MicroLabel}>DIFFICULTY<//></div>
    <div class="prep-setting__choices prep-setting__choices--speed">${DIFFICULTIES.map(d => html`<button type="button" key=${d} disabled=${disabled || readOnly} class=${d===difficulty?'is-active':''} aria-pressed=${d===difficulty} style=${`--d-color:${DIFFICULTY_COLORS[d]}`} onClick=${()=>onDifficultyChange(d)}><${DifficultyIcon} difficulty=${d} />${t(DIFFICULTY_NAMES[d])}</button>`)}</div>
   </section>
   ${mode==='coop'  ? html`<${PrepTimePicker} value=${prepChoice} onChange=${onPrepChange} disabled=${disabled || readOnly} />` : html`<p>${t('独立模拟休整期不限时。')}</p>`}
   <section class="prep-setting" aria-label=${t('战斗倍速')}><div class="prep-setting__title">${t('战斗倍速')}<${MicroLabel}>BATTLE SPEED<//></div>
    <div class="prep-setting__choices prep-setting__choices--speed">${BATTLE_SPEEDS.map(speed => html`<button type="button" key=${speed} disabled=${disabled || readOnly} class=${speed===battleSpeed?'is-active':''} aria-pressed=${speed===battleSpeed} onClick=${()=>onSpeedChange(speed)}>${speed}×${speed===2?t('（默认）'):''}</button>`)}</div>
    <p class="prep-setting__hint">${t('全员使用相同倍速；自定义倍速仅支持好友 / AI 组队。')}</p>
   </section>
   ${children}
   ${readOnly ? null : html`<${Button} variant="primary" icon="check" disabled=${disabled || (mode==='coop' && !valid(prepChoice))} onClick=${onSave}>${t('保存并返回')}<//>`}
  </div></main>
 </div>`;
}
import { validPrepChoice as valid } from './prepTime.js';


export function RoomConfigSummary({mode, difficulty, prepMultiplier=null, prepSeconds=null, battleSpeed=2, onOpen, editable=true, disabled=false}) {
 return html`<div class="room-config-summary">
  <div class="room-config-summary__values"><span>${t(DIFFICULTY_NAMES[difficulty] || difficulty)}</span>
   <span>${t('休整期')} · ${mode==='solo'?t('不限时'):prepSeconds!=null?t('每回合 {seconds} 秒',{seconds:prepSeconds}):prepTimeLabel(prepMultiplier)}</span>
   <span>${t('战斗倍速')} · ${battleSpeed}×</span></div>
  <${Button} variant="secondary" size="sm" icon="edit" disabled=${disabled} onClick=${onOpen}>${editable?t('调整配置'):t('查看配置')}<//>
 </div>`;
}
