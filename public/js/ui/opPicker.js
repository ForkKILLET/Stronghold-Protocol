// Operator/Avatar picker markup from Stardust-minus d6e96f4 (design by 雨千代chiyo).
import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Modal, Button } from './components.js';
import { Img } from './gameComponents.js';
import { chessAvatarUrl } from './assetUrls.js';
import { cardAvatarUrl, cardAvatarSkins, cardPortraitUrl, cardPortraitSkins } from './seatArt.js';
import { cardStore } from './playerCard.js';
import { data, useData } from '../data.js';
import { cardAvatarOperatorId } from '../../../shared/playerCard.js';
import { t } from '../../../shared/i18n.js';
import { operatorSearch } from './operatorSearch.js';
import { versionLabel } from '../versions.js';

export function filterCardOperators(list, query = '', star = 0) {
  const matches = operatorSearch(query);
  return list.filter((c) => (!star || c.rarity === star) && matches([c.name, c.zh, c.appellation], c.charId));
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
  note, onPick, onClose, q, star, onQuery, onStar, body = null, bodyRef = null, groups = null, rosterState = null, onRetryRoster = null }) {
  const shown = groups ? groups.map((g) => ({ ...g, ops: g.ops.filter((c) => list.some((v) => v.charId === c.charId)) })).filter((g) => g.ops.length)
    : [{ key: 'all', ops: list }];
  return html`<${Modal} open=${true} utility=${true} title=${title} micro=${micro} onClose=${onClose} width="min(9.6rem, 94vw)" class="cardpick">
    <div ref=${bodyRef}>${body || html`
    <div class="cardpick__bar">
      <label class="cardpick__search"><${Icon} name="search" /><input type="search" value=${q} placeholder=${t('搜索干员')} aria-label=${t('搜索干员')} onInput=${(e) => onQuery(e.currentTarget.value)} /></label>
      <div class="cardpick__stars" role="radiogroup" aria-label=${t('稀有度')}>
        ${[[0, t('全部')], [6, '6★'], [5, '5★'], [4, '4★']].map(([v, label]) => html`<button key=${v} type="button" role="radio" aria-checked=${star === v ? 'true' : 'false'}
          class=${star === v ? 'is-on' : ''} onClick=${() => onStar(v)}>${label}</button>`)}
      </div>
    </div>
    ${rosterState && rosterState !== 'ready' ? html`<p class="cardpick__note" role="status">${rosterState === 'missing' ? t('其他时期的干员暂时无法载入') : t('其他时期载入中…')}
      ${rosterState === 'missing' ? html`<${Button} size="sm" variant="secondary" onClick=${onRetryRoster}>${t('重试')}<//>` : null}</p>` : null}
    <div class="cardpick__grid">
      <button type="button" class=${`cardpick__op cardpick__op--auto${!current ? ' is-on' : ''}`} onClick=${() => onPick('')} title=${autoTitle} aria-pressed=${String(!current)}>
        <span class="cardpick__img"><${Icon} name=${autoIcon} /></span><span class="cardpick__name">${autoLabel}</span></button>
      ${shown.map((group) => html`${groups ? html`<h3 class="cardpick__group">${group.key === 'room' ? t('本房间版本 · {version}', { version: versionLabel(group.version) }) : t('其他时期 · {version}', { version: versionLabel(group.version) })}</h3>` : null}
      ${group.ops.map((c) => html`<button key=${c.charId} type="button" data-operator=${c.charId} class=${`cardpick__op${current === c.charId ? ' is-on' : ''}`} onClick=${() => onPick(c.charId)} title=${c.name} aria-pressed=${String(current === c.charId)}>
        <span class="cardpick__img"><${Img} src=${faceOf(c)} fallback=${html`<${Icon} name="user" />`} /></span>
        <span class="cardpick__name">${c.name}</span>${c.rarity ? html`<span class=${`cardpick__star r${c.rarity}`}>${c.rarity}★</span>` : null}</button>`)}`)}
    </div>
    ${note ? html`<p class="cardpick__note"><${Icon} name="info" />${note}</p>` : null}`}</div>
  <//>`;
}

export function PortraitPicker(props) {
  return html`<${AvatarPicker} ...${props} kind="portrait" />`;
}

export function AvatarPicker({ current, list, m, onPick, onClose, kind = 'avatar', groups = null, rosterState = null, onRetryRoster = null }) {
  const [operator, setOperator] = useState(null);
  const [q, setQ] = useState('');
  const [star, setStar] = useState(0);
  const bodyRef = useRef(null), returnTo = useRef('');
  useEffect(() => { cardStore.set({ open: true }); return () => cardStore.set({ open: false }); }, []);
  useLayoutEffect(() => {
    if (operator) {
      returnTo.current = operator;
      bodyRef.current?.querySelector('[data-avatar]')?.focus();
    } else if (returnTo.current) {
      bodyRef.current?.querySelector(`[data-operator="${returnTo.current}"]`)?.focus();
      returnTo.current = '';
    }
  }, [operator]);
  return html`<${AvatarPickerView} kind=${kind} current=${current} list=${list} m=${m} onPick=${onPick} onClose=${onClose}
    operator=${operator} onOperator=${setOperator} q=${q} star=${star} onQuery=${setQ} onStar=${setStar} bodyRef=${bodyRef} groups=${groups} rosterState=${rosterState} onRetryRoster=${onRetryRoster} />`;
}

/** Both steps keep one Modal and one preference-sync lifecycle; picking an operator is only a preview. */
export function AvatarPickerView({ current, list, m, onPick, onClose, operator, onOperator,
  q = '', star = 0, onQuery, onStar, bodyRef = null, kind = 'avatar', groups = null, rosterState = null, onRetryRoster = null }) {
  const selected = list.find((c) => c.charId === operator);
  const portrait = kind === 'portrait';
  return html`<${OperatorPickerView} title=${portrait ? t('更换立绘') : t('头像')} micro=${portrait ? 'SEAT CARD' : 'AVATAR'} current=${cardAvatarOperatorId(current)}
    list=${filterCardOperators(list, q, star)} groups=${groups} rosterState=${rosterState} onRetryRoster=${onRetryRoster} faceOf=${(c) => cardAvatarUrl(c.charId, m)}
    autoLabel=${t('默认')} autoTitle=${portrait ? t('按博士编号自动分配') : t('不使用头像：显示策略图标或名字首字')} autoIcon=${portrait ? 'refresh' : 'user'}
    note=${portrait ? t('选择后，同盟里的博士都会看到这张立绘') : t('选择后，同盟里的博士都会看到这个头像')} onPick=${(id) => id ? onOperator(id) : onPick('')}
    onClose=${onClose} q=${q} star=${star} onQuery=${onQuery} onStar=${onStar} bodyRef=${bodyRef}
    body=${selected ? html`<${AvatarVariants} kind=${kind} operator=${selected} current=${current} m=${m} onPick=${onPick} onBack=${() => onOperator(null)} />` : null} />`;
}

function AvatarVariants(props) {
  const ready = useData('skins'); // optional catalogue: requested only after choosing an operator
  const status = !ready ? 'loading' : data.status('skins') === 'missing' ? 'missing' : 'ready';
  const variants = props.kind === 'portrait' ? cardPortraitSkins : cardAvatarSkins;
  return html`<${AvatarVariantsView} ...${props} status=${status} skins=${variants(props.operator.charId, props.m, data.get('skins'))}
    onRetry=${() => data.invalidate('skins')} />`;
}

export function AvatarVariantsView({ operator, current, m, skins, status, onPick, onBack, onRetry, kind = 'avatar' }) {
  const portrait = kind === 'portrait';
  const url = (id) => portrait ? cardPortraitUrl(id, m, operator) : cardAvatarUrl(id, m);
  const baseUrl = url(operator.charId);
  const baseLabel = portrait ? t('默认立绘') : t('默认头像');
  const unavailable = cardAvatarOperatorId(current) === operator.charId && current !== operator.charId && !skins.some((s) => s.id === current);
  const chosen = unavailable ? operator.charId : current;
  return html`<section class=${`cardpick__variants${portrait ? ' cardpick__variants--portrait' : ''}`} data-state=${status}>
    <div class="cardpick__bar">
      <${Button} size="sm" variant="secondary" icon="chevronLeft" onClick=${onBack}>${t('返回干员列表')}<//>
      <b>${operator.name}</b><span class="t-lo">${portrait ? t('选择立绘') : t('选择头像')}</span>
    </div>
    <div class="cardpick__grid">
      <button type="button" class=${`cardpick__op${chosen === operator.charId ? ' is-on' : ''}`} data-avatar=${operator.charId}
        aria-pressed=${String(chosen === operator.charId)} onClick=${() => onPick(operator.charId)} title=${baseLabel}>
        <span class="cardpick__img"><${Img} src=${baseUrl} fallback=${html`<${Icon} name="user" />`} /></span>
        <span class="cardpick__name">${baseLabel}</span>
      </button>
      ${skins.map((s) => html`<button key=${s.id} type="button" class=${`cardpick__op${current === s.id ? ' is-on' : ''}`} data-avatar=${s.id}
        aria-pressed=${String(current === s.id)} title=${[s.name, s.group].filter(Boolean).join(' · ')} onClick=${() => onPick(s.id)}>
        <span class="cardpick__img"><${Img} src=${url(s.id)} fallback=${html`<${Img} src=${baseUrl} fallback=${html`<${Icon} name="user" />`} />`} /></span>
        <span class="cardpick__name">${s.name}</span>
      </button>`)}
    </div>
    ${status === 'loading' ? html`<p class="cardpick__note" role="status">${t('正在载入皮肤目录…')}</p>`
      : status === 'missing' ? html`<div class="cardpick__note" role="status"><span>${t('皮肤数据加载失败，请重试。')}</span>
        <${Button} size="sm" variant="secondary" onClick=${onRetry}>${t('重试')}<//></div>`
      : !skins.length ? html`<p class="cardpick__note" role="status">${portrait ? t('暂无可用的皮肤立绘') : t('暂无可用的皮肤头像')}</p>` : null}
    ${unavailable && status !== 'loading' ? html`<p class="cardpick__note" role="status">${portrait ? t('已选立绘暂不可用，当前显示默认立绘。') : t('已选头像暂不可用，当前显示默认头像。')}</p>` : null}
  </section>`;
}
