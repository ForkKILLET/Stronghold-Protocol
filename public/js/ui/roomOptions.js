import { PageHeader } from './pageHeader.js';
import { html, Fragment, Button, MicroLabel, DifficultyIcon, Icon } from './components.js';
import { PrepTimePicker } from './prepTime.js';
import { BATTLE_SPEEDS } from '../../../shared/roomOptions.js';
import { DIFFICULTIES, DIFFICULTY_NAMES, DIFFICULTY_COLORS } from '../../../shared/constants.js';
import { prepTimeLabel } from './prepTime.js';
import { t } from '../../../shared/i18n.js';

/** A dedicated page; draft values belong to LobbyScreen and survive going back. */
export function RoomOptionsPage({mode, prepChoice, onPrepChange, onBack, disabled=false, children, battleSpeed=2, onSpeedChange=()=>{}, difficulty='NORMAL', onDifficultyChange=()=>{}, onSave=onBack, readOnly=false, tab='basic', onTabChange=null, pluginContent=null}) {
 return html`<div class="screen room-options-screen">
  <${PageHeader} onBack=${onBack} title=${t('模拟配置')} micro="ROOM CONFIGURATION" />
  ${onTabChange?html`<nav class="room-options__tabs" aria-label=${t('模拟配置')}>
    <button type="button" class=${tab==='basic'?'is-on':''} aria-pressed=${tab==='basic'} disabled=${disabled} onClick=${()=>onTabChange('basic')}>${t('基础配置')}</button>
    <button type="button" class=${tab==='plugins'?'is-on':''} aria-pressed=${tab==='plugins'} disabled=${disabled || (!readOnly && !valid(prepChoice))} onClick=${()=>onTabChange('plugins')}>${t('玩法插件')}</button>
  </nav>`:null}
  <main class="room-options__frame brackets"><div class="room-options__body">
   ${tab==='plugins'?pluginContent:html`<${Fragment}>
   <section class="prep-setting" aria-label=${t('模拟难度')}><div class="prep-setting__title"><${Icon} name="rook" /><span>${t('模拟难度')}</span><${MicroLabel}>DIFFICULTY<//></div>
    <div class="prep-setting__choices prep-setting__choices--speed">${DIFFICULTIES.map(d => html`<button type="button" key=${d} disabled=${disabled || readOnly} class=${d===difficulty?'is-active':''} aria-pressed=${d===difficulty} style=${`--d-color:${DIFFICULTY_COLORS[d]}`} onClick=${()=>onDifficultyChange(d)}><${DifficultyIcon} difficulty=${d} />${t(DIFFICULTY_NAMES[d])}</button>`)}</div>
   </section>
   <${RoomPacingControls} mode=${mode} prepChoice=${prepChoice} onPrepChange=${onPrepChange} battleSpeed=${battleSpeed} onSpeedChange=${onSpeedChange} disabled=${disabled || readOnly} />
   <//>`}
   ${children}
   ${tab==='plugins'?html`<${Button} variant="primary" icon="check" onClick=${onBack}>${t('返回房间')}<//>`:readOnly ? null : html`<${Button} variant="primary" icon="check" disabled=${disabled || (mode==='coop' && !valid(prepChoice))} onClick=${onSave}>${t('保存并返回')}<//>`}
  </div></main>
 </div>`;
}
import { validPrepChoice as valid } from './prepTime.js';


export function RoomConfigSummary({mode, difficulty, prepMultiplier=null, prepSeconds=null, battleSpeed=2, onOpen, editable=true, disabled=false, contentLabel=null, onPlugins=null}) {
 return html`<div class="room-config-summary">
  <div class="room-config-summary__values"><span>${t(DIFFICULTY_NAMES[difficulty] || difficulty)}</span>
   <span>${t('休整期')} · ${mode==='solo'?t('不限时'):prepSeconds!=null?t('每回合 {seconds} 秒',{seconds:prepSeconds}):prepTimeLabel(prepMultiplier)}</span>
   <span>${t('战斗倍速')} · ${battleSpeed}×</span>
   ${contentLabel?html`<button type="button" class="room-config-summary__plugins" data-testid="plugin-tag" disabled=${disabled} onClick=${onPlugins}>${contentLabel}</button>`:null}</div>
  <${Button} variant="secondary" size="sm" icon="edit" disabled=${disabled} onClick=${onOpen}>${editable?t('调整配置'):t('查看配置')}<//>
 </div>`;
}

/** Pacing controls shared by creation and the room configuration page. */
export function RoomPacingControls({mode, prepChoice=null, onPrepChange=()=>{}, battleSpeed=2, onSpeedChange=()=>{}, disabled=false, readOnly=false}) {
 if(mode==='match') return html`<section class="prep-setting protocol-fixed"><div class="prep-setting__title">${t('公共匹配规则')}<${MicroLabel}>MATCH RULES<//></div>
  <p>${t('休整期按回合默认时长，战斗倍速为 2×，使用原版规则。')}</p><p class="prep-setting__hint">${t('所有队友使用一致的公共规则；自定义配置请创建同盟模拟。')}</p></section>`;
 return html`<${Fragment}>
   ${mode==='coop'  ? html`<${PrepTimePicker} value=${prepChoice} onChange=${onPrepChange} disabled=${disabled || readOnly} />` : html`<section class="prep-setting" aria-label=${t('休整期时长')}><div class="prep-setting__title"><${Icon} name="hourglass" /><span>${t('休整期时长')}</span><${MicroLabel}>PREPARATION<//></div><p class="prep-setting__hint">${t('独立模拟休整期不限时。')}</p></section>`}
   <section class="prep-setting" aria-label=${t('战斗倍速')}><div class="prep-setting__title"><${Icon} name="play" /><span>${t('战斗倍速')}</span><${MicroLabel}>BATTLE SPEED<//></div>
    <div class="prep-setting__choices prep-setting__choices--speed">${BATTLE_SPEEDS.map(speed => html`<button type="button" key=${speed} disabled=${disabled || readOnly} class=${speed===battleSpeed?'is-active':''} aria-pressed=${speed===battleSpeed} onClick=${()=>onSpeedChange(speed)}>${speed}×${speed===2?t('（默认）'):''}</button>`)}</div>
    <p class="prep-setting__hint">${t('全员使用相同倍速；自定义倍速仅支持好友 / AI 组队。')}</p>
   </section>
 <//>`;
}
