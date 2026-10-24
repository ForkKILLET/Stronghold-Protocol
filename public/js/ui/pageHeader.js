// Shared navigation for the lobby and management/pre-game pages. Gameplay keeps its own HUD.
import { html, Button, Icon, PingPill, OnlineCount, MicroLabel } from './components.js';
import { useStore, shallowEqual } from '../store.js';
import { DoctorAvatar, profileStore } from './profile.js';
import { SettingsButton } from './settings.js';
import { GuideButton } from './guide.js';
import { AnnouncementButton } from './announcement.js';
import { FullscreenButton, PwaInstallButton } from './device.js';
import { t, N_ } from '../../../shared/i18n.js';
import { formatDoctorId } from '../../../shared/publicProfiles.js';

/** Same return treatment for page navigation and nested report/detail views. */
export function BackButton({ onClick, title = t('返回'), busy = false, class: cls = '', ...props }) {
  return html`<${Button} ...${props} variant="ghost" size="sm" icon="chevronLeft" class=${`app-back ${cls}`}
    loading=${busy} onClick=${onClick} title=${title} aria-label=${title}>${t('返回')}<//>`;
}

const STATUS_TEXT = {
  idle: N_('准备连接'), connecting: N_('连接中'), connected: N_('已连接'), handshaking: N_('验证中'),
  online: N_('已连接'), reconnecting: N_('重连中'), closed: N_('未连接'),
};

/** Every page uses the same navigation geometry; only its title and return action vary. */
export function PageHeader({ onBack, backTitle, backBusy = false, title = null, micro = null, subtitle = null, heading = null, variant = 'page', language = null, visitor = false }) {
  const connection = useStore(s => s.connection, shallowEqual);
  const presence = useStore(s => s.presence, shallowEqual);
  const me = useStore(s => s.me, shallowEqual);
  const profile = useStore(s => s.user, Object.is, profileStore);
  const isTitle = variant === 'title';
  const dot = ['connected', 'online'].includes(connection.status) ? 'is-on'
    : ['connecting', 'handshaking', 'reconnecting'].includes(connection.status) ? 'is-warn' : 'is-bad';
  const name = profile?.name || me.name || t('博士');
  const openArchive = () => import('../screens/stats.js').then(m => m.openStats());
  const backButton = isTitle ? html`<span class="app-header__connection" role=${connection.lastError?.code === 'SERVER_FULL' ? 'alert' : 'status'}>
    <span class=${`status-dot ${dot}`} aria-hidden="true"></span>
    <span>${t(connection.lastError?.code === 'SERVER_FULL' ? '当前服务器容量已满' : STATUS_TEXT[connection.status] || '未连接')}</span>
  </span>` : html`<${BackButton} onClick=${onBack} title=${backTitle || t('返回')} busy=${backBusy} />`;
  const status = html`<div class="app-header__status connection-status">
    ${visitor?html`<span class="doctor-visitor-status">${t('只读访问')}</span>`:!isTitle || connection.status === 'online' ? html`
      <${PingPill} ms=${connection.ping} online=${connection.status === 'online'} />
      <${OnlineCount} online=${presence.online} />` : null}
    <${AnnouncementButton} variant="ghost" size="sm" class="topbar-announcement" />
  </div>`;
  const tools = html`<div class="app-header__tools">
    <${SettingsButton} variant="secondary" square=${true} />
    <${GuideButton} variant="secondary" square=${true} />
    <${FullscreenButton} square=${true} />
    <${PwaInstallButton} square=${true} />
  </div>`;
  const identity = visitor?html`<${Button} class="app-header__identity doctor-start" variant="secondary" icon="play" aria-label=${t('开始模拟')} title=${t('开始模拟')} onClick=${()=>location.assign(location.pathname)}>${t('开始模拟')}<//>`:html`<button type="button" class="app-header__identity me-chip me-chip--btn stats-entry" onClick=${openArchive}
        title=${t('博士档案')} aria-label=${t('博士档案')}>
        <${DoctorAvatar} name=${name} />
        <span class="me-chip__text"><span class="me-chip__name">${name}</span><${MicroLabel} class="me-chip__id num">${`ID ${formatDoctorId(profile?.publicId) || '—'}`}<//></span>
        <${Icon} name="user" class="me-chip__stats" />
      </button>`;
  return html`<header class=${`app-header${isTitle ? ' app-header--title' : ''}${visitor?' app-header--visitor':''}`} aria-label=${t('全局导航')} data-testid="page-header">
    <div class="app-header__row">
      <div class="app-header__links">${backButton}${status}</div>
      ${tools}
      ${heading || html`<${PageHeading} title=${title || t('卫戍协议：盟约')} micro=${micro} subtitle=${subtitle} />`}
      <div class="app-header__account">
        ${language ? html`<div class="app-header__language">${language}</div>` : null}
        ${identity}
      </div>
    </div>
  </header>`;
}

/** A page's own identity can share the navigation band without duplicating navigation controls. */
export function PageHeading({ title, micro, subtitle, children = null }) {
  return html`<div class="app-header__heading">
    ${micro ? html`<${MicroLabel} tone="mint">${micro}<//>` : null}
    <h1><span class="app-header__title" title=${title}>${title}</span>${children}</h1>
    ${subtitle ? html`<span class="app-header__subtitle">${subtitle}</span>` : null}
  </div>`;
}
