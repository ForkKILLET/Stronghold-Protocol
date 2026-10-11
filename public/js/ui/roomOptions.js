import { html, Button, MicroLabel } from './components.js';
import { PrepTimePicker } from './prepTime.js';
import { t } from '../../../shared/i18n.js';

/** A dedicated page; draft values belong to LobbyScreen and survive going back. */
export function RoomOptionsPage({mode, prepChoice, onPrepChange, onBack, disabled=false, children}) {
 return html`<div class="screen room-options-screen">
  <header class="topbar"><div class="topbar__left"><${Button} variant="ghost" icon="chevronLeft" onClick=${onBack}>${t('返回创建房间')}<//></div>
   <div class="topbar__center"><${MicroLabel} tone="mint">ROOM CONFIGURATION<//><h1 class="topbar__title">${t('房间额外配置')}</h1></div></header>
  <main class="room-options__body brackets">
   ${mode==='coop' ? html`<${PrepTimePicker} value=${prepChoice} onChange=${onPrepChange} disabled=${disabled} />` : html`<p>${t('独立模拟休整期不限时。')}</p>`}
   ${children}
   <${Button} variant="primary" icon="check" disabled=${mode==='coop' && !valid(prepChoice)} onClick=${onBack}>${t('保存并返回')}<//>
  </main>
 </div>`;
}
import { validPrepChoice as valid } from './prepTime.js';
