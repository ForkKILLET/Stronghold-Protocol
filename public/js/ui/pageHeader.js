// Shared navigation for the lobby and management/pre-game pages. Gameplay keeps its own HUD.
import { html, Button, Icon, PingPill, OnlineCount, MicroLabel } from './components.js';
import { useStore, shallowEqual } from '../store.js';
import { DoctorAvatar, profileStore } from './profile.js';
import { SettingsButton } from './settings.js';
import { GuideButton } from './guide.js';
import { AnnouncementButton } from './announcement.js';
import { PwaInstallButton } from './device.js';
import { t } from '../../../shared/i18n.js';

/** Same return treatment for page navigation and nested report/detail views. */
export function BackButton({ onClick, title = t('返回'), busy = false, class: cls = '', ...props }) {
  return html`<${Button} ...${props} variant="ghost" size="sm" icon="chevronLeft" class=${`app-back ${cls}`}
    loading=${busy} onClick=${onClick} title=${title} aria-label=${title}>${t('返回')}<//>`;
}

/** Every page uses the same navigation geometry; only its title and return action vary. */
export function PageHeader({ onBack, backTitle, backBusy = false, title = null, micro = null, subtitle = null, heading = null }) {
  const connection = useStore(s => s.connection, shallowEqual);
  const presence = useStore(s => s.presence, shallowEqual);
  const me = useStore(s => s.me, shallowEqual);
  const profile = useStore(s => s.user, Object.is, profileStore);
  const name = profile?.name || me.name || t('博士');
  const openArchive = () => import('../screens/stats.js').then(m => m.openStats());
  const backButton = html`<${BackButton} onClick=${onBack} title=${backTitle || t('返回')} busy=${backBusy} />`;
  const status = html`<div class="app-header__status connection-status">
        <${PingPill} ms=${connection.ping} online=${connection.status === 'online'} />
        <${OnlineCount} online=${presence.online} />
        <${AnnouncementButton} variant="ghost" size="sm" class="topbar-announcement" />
      </div>`;
  const tools = html`<div class="app-header__tools">
        <${SettingsButton} variant="secondary" square=${true} />
        <${GuideButton} variant="secondary" square=${true} />
        <${PwaInstallButton} square=${true} />
      </div>`;
  const identity = html`<button type="button" class="app-header__identity me-chip me-chip--btn stats-entry" onClick=${openArchive}
        title=${t('博士档案')} aria-label=${t('博士档案')}>
        <${DoctorAvatar} name=${name} />
        <span class="me-chip__text"><span class="me-chip__name">${name}</span><${MicroLabel}>DOCTOR ARCHIVE<//></span>
        <${Icon} name="user" class="me-chip__stats" />
      </button>`;
  return html`<header class="app-header" aria-label=${t('全局导航')} data-testid="page-header">
    <div class="app-header__row">
      <div class="app-header__links">${backButton}${status}</div>
      ${tools}
      ${heading || html`<${PageHeading} title=${title || t('卫戍协议：盟约')} micro=${micro} subtitle=${subtitle} />`}
      ${identity}
    </div>
  </header>`;
}

/** A page's own identity can share the navigation band without duplicating navigation controls. */
export function PageHeading({ title, micro, subtitle, children = null }) {
  return html`<div class="app-header__heading">
    ${micro ? html`<${MicroLabel} tone="mint">${micro}<//>` : null}
    <h1>${title}${children}</h1>
    ${subtitle ? html`<span class="app-header__subtitle">${subtitle}</span>` : null}
  </div>`;
}
