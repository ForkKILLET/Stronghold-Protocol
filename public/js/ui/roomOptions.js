import { html, Button, MicroLabel } from './components.js';
import { PrepTimePicker } from './prepTime.js';
import { BATTLE_SPEEDS } from '../../../shared/roomOptions.js';
import { t } from '../../../shared/i18n.js';

/** A dedicated page; draft values belong to LobbyScreen and survive going back. */
export function RoomOptionsPage({mode, prepChoice, onPrepChange, onBack, disabled=false, children, battleSpeed=2, onSpeedChange=()=>{}}) {
 return html`<div class="screen room-options-screen">
  <header class="topbar"><div class="topbar__left"><${Button} variant="ghost" icon="chevronLeft" onClick=${onBack}>${t('返回创建房间')}<//></div>
   <div class="topbar__center"><${MicroLabel} tone="mint">ROOM CONFIGURATION<//><h1 class="topbar__title">${t('房间额外配置')}</h1></div></header>
  <main class="room-options__body brackets">
   ${mode==='coop' ? html`<${PrepTimePicker} value=${prepChoice} onChange=${onPrepChange} disabled=${disabled} />` : html`<p>${t('独立模拟休整期不限时。')}</p>`}
   <section class="prep-setting" aria-label=${t('战斗倍速')}><div class="prep-setting__title">${t('战斗倍速')}<${MicroLabel}>BATTLE SPEED<//></div>
    <div class="prep-setting__choices">${BATTLE_SPEEDS.map(speed => html`<button type="button" key=${speed} disabled=${disabled} class=${speed===battleSpeed?'is-active':''} aria-pressed=${speed===battleSpeed} onClick=${()=>onSpeedChange(speed)}>${speed}×${speed===2?t('（默认）'):''}</button>`)}</div>
    <p class="prep-setting__hint">${t('全员使用相同倍速，保持固定逻辑帧；自定义倍速仅支持好友 / AI 组队。')}</p>
   </section>
   ${children}
   <${Button} variant="primary" icon="check" disabled=${mode==='coop' && !valid(prepChoice)} onClick=${onBack}>${t('保存并返回')}<//>
  </main>
 </div>`;
}
import { validPrepChoice as valid } from './prepTime.js';
