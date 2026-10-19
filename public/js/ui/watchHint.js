import { html, Icon } from './components.js';
import { t } from '../../../shared/i18n.js';

// Dismiss only the explanation. Navigation remains available when the hint contains a return action.
export function WatchHint({ class: cls, children, actions = null, dismissed = false, onDismiss }) {
  if (dismissed && !actions) return null;
  return html`<div class=${cls} role="status">
    ${dismissed ? null : children}${actions}
    ${!dismissed && onDismiss ? html`<button type="button" class="watch-hint__close"
      aria-label=${t('隐藏观战提示')} title=${t('隐藏观战提示')}
      onKeyDown=${(e) => { if (e.key === ' ') e.stopPropagation(); }} onClick=${onDismiss}><${Icon} name="close" /></button>` : null}
  </div>`;
}
