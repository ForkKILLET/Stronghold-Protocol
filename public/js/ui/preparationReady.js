import {html,Icon} from './components.js';
import {t} from '../../../shared/i18n.js';

/** Shared preparation status; room callers keep their existing human-only count and host-ready rule. */
export function PreparationReady({players=[],myId,isReady=p=>!!p.ready}) {
 const ready=players.filter(isReady).length;
 return html`<div class="brief-ready" data-testid="preparation-ready">
  <span class="brief-ready__txt"><span class="brief-ready__label">${t('已就绪')}</span><b class="num">${ready}</b><span class="brief-ready__total num">/${players.length}</span></span>
  <span class="brief-ready__pips">${players.map(p=>html`<i key=${p.playerId} class=${`${isReady(p)?'on ':''}${p.playerId===myId?'me':''}`} title=${p.name}><${Icon} name="user" /></i>`)}</span>
 </div>`;
}
