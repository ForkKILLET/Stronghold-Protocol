// 皮肤选择器 (docs/SKINS.md) — the 皮肤 section of the 干员调配 screen's detail panel.
//
// Self-contained on purpose: screens/loadout.js only imports this and drops `<${SkinSection} chess=… />` into its
// detail body, so upstream rewriting that screen (it is one of the two files most likely to change) costs one
// line here rather than a merge conflict over the whole panel.
//
// Only the catalogue subset deployed by the administrator is offered. There is no in-game installation:
// 默认 clears the choice and an outfit button selects an existing model (ui/skins.js availableSkins).

import { t } from '../../../shared/i18n.js';
import { html, MicroLabel, Button } from './components.js';
import { useStore, shallowEqual } from '../store.js';
import { data, useData } from '../data.js';
import { useSettings, updateSettings } from './settings.js';
import { skinsStore, availableSkins, setSkin, clearSkin } from './skins.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * The skin's 180×180 avatar URL, or null when the manifest has no entry for it.
 *
 * Keyed by OPERATOR id, not by chess id: data/assets.json groups everything under `chars[charId]`, and the skin
 * catalogue does the same. A chess record carries both (`chess_char_1_01_a` → `charId: char_498_inside`), and
 * getting the two the wrong way round makes the whole section silently empty.
 */
function skinAvatar(charId, skinId) {
  return data.get('assets')?.chars?.[charId]?.skins?.[skinId]?.avatar || null;
}

/**
 * 皮肤 section for one operator.
 * @param {{ chess: any }} props `chess` is the chess record of the detail panel
 */
export function SkinSection({ chess }) {
  const settings = useSettings();
  if (!chess?.chessId || !chess?.charId || chess.isDiy || chess.isHidden) return null;
  if (!settings.skinsEnabled) return html`<section class="lo-sec lo-sec--skin" data-testid="skin-section" data-state="disabled">
    <header class="lo-sec__head"><h3>${t('皮肤')}<${MicroLabel}>SKIN<//></h3>
      <${Button} size="sm" variant="secondary" onClick=${() => updateSettings({ skinsEnabled: true })}>${t('启用皮肤')}<//>
    </header>
    <p class="set-hint">${t('未启用皮肤：自己和其他玩家均使用默认外观。')}</p>
  </section>`;
  return html`<${EnabledSkinSection} chess=${chess} />`;
}

function EnabledSkinSection({ chess }) {
  const s = useStore((v) => v, shallowEqual, skinsStore);
  const ready = useData('skins', 'assets');
  // Two ids, and they are not interchangeable: the CHOICE is stored per chess (like the loadout, and that is the
  // key the server validates and the renderer reads), while the catalogue and the asset manifest are per operator.
  const chessId = chess && chess.chessId;
  const charId = chess && chess.charId;
  if (!chessId || !charId) return null;
  const list = availableSkins(charId);
  const missing = ['skins', 'assets'].filter((name) => data.status(name) === 'missing');
  const state = !ready ? 'loading' : missing.length ? 'missing' : list.length ? 'ready' : 'empty';
  // Keep an unavailable saved choice for a later deployment, while accurately showing the current default fallback.
  const chosen = list.some((x) => x.id === s.entries[chessId]) ? s.entries[chessId] : null;

  return html`<section class="lo-sec lo-sec--skin" data-testid="skin-section" data-state=${state}>
    <header class="lo-sec__head">
      <h3>${t('皮肤')}<${MicroLabel}>SKIN<//></h3>
      ${state === 'ready' || state === 'empty' ? html`<span class="lo-sec__note">${t('{n} 款', { n: list.length })}</span>` : null}
      <${Button} size="sm" variant="secondary" onClick=${() => updateSettings({ skinsEnabled: false })}>${t('关闭皮肤')}<//>
    </header>
    ${state === 'loading' ? html`<p class="set-hint" role="status">${t('正在载入皮肤目录…')}</p>`
      : state === 'missing' ? html`<div class="lo-skin-status" role="status"><p class="set-hint">${t('皮肤数据加载失败，请重试。')}</p>
        <${Button} size="sm" variant="secondary" onClick=${() => Promise.all(missing.map((name) => data.invalidate(name)))}>${t('重试')}<//></div>`
      : html`${state === 'empty' ? html`<p class="set-hint" role="status">${data.get('skins')?.chars?.[charId]?.length
        ? t('本服务器尚未部署该干员的皮肤，当前使用默认外观。') : t('该干员暂无可用皮肤，当前使用默认外观。')}</p>` : null}
    <div class="lo-skins" role="radiogroup" aria-label=${t('选择皮肤')}>
      <button type="button" role="radio" aria-checked=${chosen ? 'false' : 'true'} data-skin=""
        class=${cx('lo-skin', 'lo-skin--default', !chosen && 'is-on')} title=${t('默认')} onClick=${() => clearSkin(chessId)}>
        <span class="lo-skin__art"><span class="lo-skin__art--none"></span></span>
        <span class="lo-skin__text"><b class="lo-skin__name">${t('默认')}</b><span class="lo-skin__group">DEFAULT</span></span>
      </button>
      ${list.map((x) => {
        const art = skinAvatar(charId, x.id);
        return html`<button key=${x.id} type="button" role="radio" aria-checked=${chosen === x.id ? 'true' : 'false'}
            data-skin=${x.id} class=${cx('lo-skin', chosen === x.id && 'is-on')}
            title=${[x.name, x.group].filter(Boolean).join(' · ')}
            onClick=${() => setSkin(chessId, x.id)}>
          <span class="lo-skin__art">
            ${art ? html`<img src=${art} alt="" loading="lazy" referrerpolicy="no-referrer" />` : html`<span class="lo-skin__art--none"></span>`}
          </span>
          <span class="lo-skin__text">
            <b class="lo-skin__name">${x.name}</b>
            <span class="lo-skin__group">${x.group}</span>
          </span>
        </button>`;
      })}
    </div>`}
  </section>`;
}
