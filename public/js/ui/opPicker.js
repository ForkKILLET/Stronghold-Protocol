// Operator/Avatar picker markup from Stardust-minus d6e96f4 (design by 雨千代chiyo).
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Modal } from './components.js';
import { Img } from './gameComponents.js';
import { chessAvatarUrl } from './assetUrls.js';
import { cardAvatarUrl } from './seatArt.js';
import { cardStore } from './playerCard.js';
import { t } from '../../../shared/i18n.js';

export function filterCardOperators(list, query = '', star = 0) {
  const needle = query.trim().toLowerCase();
  return list.filter((c) => (!star || c.rarity === star) && (!needle || String(c.name || '').toLowerCase().includes(needle)
    || String(c.appellation || '').toLowerCase().includes(needle)));
}

export function OperatorPicker({ title, micro, current, list, m, faceOf = (c) => chessAvatarUrl(m, c), autoLabel, autoTitle, autoIcon = 'refresh',
  note = null, onPick, onClose }) {
  const [q, setQ] = useState('');
  const [star, setStar] = useState(0);
  useEffect(() => { cardStore.set({ open: true }); return () => cardStore.set({ open: false }); }, []);
  return html`<${OperatorPickerView} title=${title} micro=${micro} current=${current} list=${filterCardOperators(list, q, star)}
    faceOf=${faceOf} autoLabel=${autoLabel} autoTitle=${autoTitle} autoIcon=${autoIcon} note=${note}
    onPick=${onPick} onClose=${onClose} q=${q} star=${star} onQuery=${setQ} onStar=${setStar} />`;
}

export function OperatorPickerView({ title, micro, current, list, faceOf, autoLabel, autoTitle, autoIcon = 'refresh',
  note, onPick, onClose, q, star, onQuery, onStar }) {
  return html`<${Modal} open=${true} utility=${true} title=${title} micro=${micro} onClose=${onClose} width="min(9.6rem, 94vw)" class="cardpick">
    <div class="cardpick__bar">
      <label class="cardpick__search"><${Icon} name="search" /><input type="search" value=${q} placeholder=${t('搜索干员')} aria-label=${t('搜索干员')} onInput=${(e) => onQuery(e.currentTarget.value)} /></label>
      <div class="cardpick__stars" role="radiogroup" aria-label=${t('稀有度')}>
        ${[[0, t('全部')], [6, '6★'], [5, '5★'], [4, '4★']].map(([v, label]) => html`<button key=${v} type="button" role="radio" aria-checked=${star === v ? 'true' : 'false'}
          class=${star === v ? 'is-on' : ''} onClick=${() => onStar(v)}>${label}</button>`)}
      </div>
    </div>
    <div class="cardpick__grid">
      <button type="button" class=${`cardpick__op cardpick__op--auto${!current ? ' is-on' : ''}`} onClick=${() => onPick('')} title=${autoTitle} aria-pressed=${String(!current)}>
        <span class="cardpick__img"><${Icon} name=${autoIcon} /></span><span class="cardpick__name">${autoLabel}</span></button>
      ${list.map((c) => html`<button key=${c.charId} type="button" class=${`cardpick__op${current === c.charId ? ' is-on' : ''}`} onClick=${() => onPick(c.charId)} title=${c.name} aria-pressed=${String(current === c.charId)}>
        <span class="cardpick__img"><${Img} src=${faceOf(c)} fallback=${html`<${Icon} name="user" />`} /></span>
        <span class="cardpick__name">${c.name}</span>${c.rarity ? html`<span class=${`cardpick__star r${c.rarity}`}>${c.rarity}★</span>` : null}</button>`)}
    </div>
    ${note ? html`<p class="cardpick__note"><${Icon} name="info" />${note}</p>` : null}
  <//>`;
}

export function AvatarPicker({ current, list, m, onPick, onClose }) {
  return html`<${OperatorPicker} title=${t('头像')} micro="AVATAR" current=${current} list=${list} m=${m} faceOf=${(c) => cardAvatarUrl(c.charId, m)}
    autoLabel=${t('默认')} autoTitle=${t('不使用头像：显示策略图标或名字首字')} autoIcon="user"
    note=${t('选择后，同盟里的博士都会看到这个头像')} onPick=${onPick} onClose=${onClose} />`;
}
