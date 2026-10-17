// Local lobby appearance lives under settings; audio restores independently during main.js boot.
import { useState } from '../../vendor/hooks.module.js';
import { html, Button, MicroLabel, Modal } from './components.js';
import { BackdropGlyph, BackdropSettings } from './hubBackdrop.js';
import { useHubBackdrop } from './hubAppearance.js';
import { LobbyMusicButton } from './lobbyMusic.js';
import { t } from '../../../shared/i18n.js';

export function PersonalizationSection() {
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const background = useHubBackdrop();
  return html`<section class="set-personalization" aria-labelledby="set-personalization-title">
    <h3 class="set-row__label" id="set-personalization-title">${t('大厅个性化')}<${MicroLabel}>PERSONALIZATION<//></h3>
    <div class="set-personalization__entries">
      <${Button} class="set-personalization__entry" title=${t('大厅背景')} aria-label=${t('大厅背景')}
        onClick=${() => setBackgroundOpen(true)}><${BackdropGlyph} />${t('大厅背景')}<//>
      <${LobbyMusicButton} class="set-personalization__entry" size="md" square=${false} />
    </div>
    <${Modal} open=${backgroundOpen} utility=${true} class="hub-backdrop-panel" title=${t('大厅背景')} micro="LOBBY BACKDROP" onClose=${() => setBackgroundOpen(false)}>
      <${BackdropSettings} bg=${background} />
    <//>
  </section>`;
}
