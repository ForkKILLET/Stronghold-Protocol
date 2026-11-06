// The battle corner's light UI controls, without importing the battle screen / renderer.
import { html, Icon } from './components.js';
import { CommunicationDock, CommunicationActivity } from './communication.js';
import { SettingsButton } from './settings.js';
import { GuideButton } from './guide.js';
import { FullscreenButton } from './device.js';
import { t } from '../../../shared/i18n.js';

/** Lives in the reserved left column so expanded chat never covers preparation content. */
export function PreparationTools({ players, disabled = false }) {
  return html`<div class="preparation-tools" data-testid="preparation-tools">
    <${CommunicationActivity} players=${players} emotesOnly=${true} />
    <${CommunicationDock} disabled=${disabled} />
    <div class="preparation-tools__actions">
      <button type="button" class="gm__gear gm__metrics" disabled aria-label=${t('作战统计')} title=${t('战斗开始后可查看作战统计')}><${Icon} name="signal" /></button>
      <${SettingsButton} class="gm__gear" square=${true} />
      <${GuideButton} class="gm__gear gm__guide" square=${true} />
      <${FullscreenButton} class="gm__gear gm__fs" />
    </div>
  </div>`;
}
