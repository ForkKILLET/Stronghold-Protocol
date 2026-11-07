// Compact entry points share one global resource manager; closing it leaves background downloads running.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, MicroLabel, Modal, ProgressBar, confirmDialog } from './components.js';
import { createStore, useStore } from '../store.js';
import { formatBytes, normalizePreloadVoiceLang, PRELOAD_VOICE_LANGS, resourcePackPercent } from '../resources/common.js';
import { clearResources, exportResources, importResources, inspectResources, pauseResources,
  resourceState, startResources, syncResources, checkResources, subscribeResources, cancelResourceCheck } from '../resources/index.js';
import { t, N_ } from '../../../shared/i18n.js';

const PRELOAD_VOICE_LABELS = { cn: N_('中文语音'), jp: N_('日语语音'), en: N_('英语语音'), kr: N_('韩语语音') };

const RESOURCE_DOWNLOAD_URL = '/downloads/';

export function byteText(st) {
  if (Number.isFinite(st.selectedWanted)) {
    if (!st.selectedTotalBytes) return '';
    return st.selectedUnknownSize ? formatBytes(st.selectedTotalBytes)
      : `${formatBytes(st.selectedBytes)} / ${formatBytes(st.selectedTotalBytes)}`;
  }
  const total = Number.isFinite(st.totalBytes) && st.totalBytes > 0 ? st.totalBytes : 0;
  if (!total) return '';
  const done = Number.isFinite(st.bytes) ? st.bytes : 0;
  return st.sizedTotal ? `${formatBytes(done)} / ${formatBytes(total)}` : formatBytes(total);
}

export function detailText(st) {
  if (Number.isFinite(st.selectedWanted)) return [t('所选 {done}/{total}', { done: st.selectedDone, total: st.selectedWanted }), byteText(st)].filter(Boolean).join(' · ');
  if (!st.total) return '';
  return [st.tier1Total ? t('必需 {tier1Done}/{tier1Total}', { tier1Done: st.tier1Done, tier1Total: st.tier1Total }) : '', t('全部 {done}/{total}', { done: st.done, total: st.total }), byteText(st)].filter(Boolean).join(' · ');
}

export function percent(st) {
  if (Number.isFinite(st.selectedWanted)) {
    if (!st.selectedWanted) return 0;
    const pct = st.selectedUnknownSize === 0 && st.selectedTotalBytes > 0
      ? st.selectedBytes / st.selectedTotalBytes : st.selectedDone / st.selectedWanted;
    return Math.max(0, Math.min(100, Math.round(pct * 100)));
  }
  if (!st.total) return 0;
  const byBytes = st.totalBytes > 0 && st.sizedTotal === st.total;
  const pct = byBytes ? (st.bytes / st.totalBytes) * 100 : (st.done / Math.max(1, st.wanted || st.total)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

const resourceUi = createStore({ open: false });
export const openResources = () => resourceUi.set({ open: true });
const closeResources = () => { cancelResourceCheck(); resourceUi.set({ open: false }); };
const busy = (st) => !!st.archive || st.phase === 'download' || st.phase === 'checking';

function useResources() {
  const [state, setState] = useState(resourceState);
  useEffect(() => subscribeResources(setState), []);
  return state;
}

export function stateText(st, enabled) {
  if (st.archive) return st.archive === 'import' ? t('正在导入') : t('正在导出');
  if (enabled && st.combatPaused && !st.manualPaused) return t('战斗中暂停');
  if (st.phase === 'foreign') return t('另一标签页处理中');
  if (st.phase === 'error') return t('资源未完成，请继续下载');
  if (st.phase === 'checking') return t('正在检查');
  if (st.phase === 'download') return t('正在下载');
  if (st.cacheVerified === false && st.selectionComplete && st.tier1Total) return t('缓存索引已读取');
  if (st.complete) return t('全部已保存');
  if (st.selectionComplete && st.tier1Total) return st.optional || st.skins ? t('所选资源已齐全。') : t('必备已保存');
  return enabled ? t('已暂停') : t('未开启');
}

/** The preference controls automatic downloading; ZIP/check jobs have a separate cancel action. */
export function resourceControls(st, enabled) {
  return {
    cancel: !!st.archive || st.phase === 'checking',
    resume: enabled && !busy(st) && !st.combatPaused && !st.selectionComplete
      && (st.manualPaused || st.phase === 'paused' || st.phase === 'error'),
    check: !busy(st) && !!st.selectionComplete,
    toggleDisabled: !!st.archive || st.phase === 'checking' || (!st.supported && !enabled),
  };
}

export const resourceDeleteNotice = () => t('删除此浏览器为本站保存的游戏素材，包括预载、ZIP 导入和游玩时按需保存的资源。之后需要重新下载或导入；博士档案、对局记录和设置不会被删除。');

export function ResourceRow({ enabled }) {
  const st = useResources();
  return html`<div class="set-res">
    <div class="set-row">
      <span class="set-row__label">${t('预载资源')}<${MicroLabel}>PRELOAD<//></span>
      <${Button} variant="secondary" size="sm" class="settings-page-action" icon="expand" aria-haspopup="dialog" onClick=${openResources}>${t('资源管理')}<//>
    </div>
    <p class="set-hint">${stateText(st, enabled)} ${t('· 管理必备与可选资源，或导入、导出 ZIP 资源包。')}</p>
  </div>`;
}

export function ResourceLauncher({ enabled }) {
  const st = useResources();
  return html`<button type="button" class=${`res-pill${enabled ? ' is-on' : ''}`}
    title=${t('管理预载资源和 ZIP 资源包')} aria-haspopup="dialog" onClick=${openResources}>
    <span class="res-pill__head">
      <span class="res-pill__label">${t('预载资源')}<${MicroLabel}>PRELOAD<//></span>
      <span class="res-pill__state">${stateText(st, enabled)}</span>
    </span>
    <span class="res-pill__hint">${t('必备 / 可选资源 · ZIP 导入与导出')}</span>
  </button>`;
}

function ResourceTier({ st, tier, optional, onOptional, disabled }) {
  const groups = st.groups.filter((g) => g.tier === tier);
  const chosen = groups.filter((g) => g.selected !== false);
  const total = chosen.reduce((n, g) => n + g.wanted, 0);
  const done = chosen.reduce((n, g) => n + g.present, 0);
  const bytes = chosen.reduce((n, g) => n + g.bytes, 0);
  const totalBytes = chosen.reduce((n, g) => n + g.totalBytes, 0);
  const unknown = chosen.some((g) => g.unknownSize);
  return html`<section class="resource-tier resource-panel">
    <header class="resource-tier__head">
      <div><h3>${tier === 1 ? t('必备资源') : t('可选资源')}</h3>
        <p class="resource-description">${tier === 1 ? t('地图、干员图片与 Spine 等画面资源') : t('个人头像、角色语音、官方特效、音效、背景音乐与玩法说明图片')}</p></div>
      ${tier === 2 ? html`<label class="resource-choice"><input type="checkbox" checked=${optional} disabled=${disabled}
        onChange=${(e) => onOptional(e.currentTarget.checked)} />${t('同时预载')}</label>` : null}
    </header>
    <div class="resource-tier__summary"><span class="num">${t('{done} / {total} 个文件', { done, total })}</span>
      <span class="num">${unknown ? t('部分大小未知') : `${formatBytes(bytes)} / ${formatBytes(totalBytes)}`}</span></div>
    <${ProgressBar} value=${done} max=${Math.max(1, total)} size="sm" tone=${tier === 1 ? 'mint' : 'amber'} />
    <ul class="resource-tier__list">
      ${groups.map((group) => html`<li key=${group.id}
        class=${st.archivePhase === 'import' && st.archiveGroup === group.id ? 'is-importing' : group.selected === false ? 'is-unselected' : ''}><span>${t(group.name)}
          ${group.selected === false ? html`<small>${t('未选择')}</small>` : null}
          ${st.archivePhase === 'import' && st.archiveGroup === group.id ? html`<small>${t('正在导入')}</small>` : null}</span>
        <span class="num">${group.present}/${group.wanted}</span>
        <span class="num">${group.unknownSize ? t('大小待确认') : formatBytes(group.totalBytes)}</span></li>`)}
    </ul>
  </section>`;
}

function ResourceOptions({ optional, voiceLang, onVoiceLang, skins, onSkins, disabled }) {
  const selected = normalizePreloadVoiceLang(voiceLang);
  return html`<fieldset class="resource-voice-choice" disabled=${disabled} aria-labelledby="resource-voice-title">
      <h3 id="resource-voice-title">${t('预载语音')}</h3>
      <div class="resource-voice-choice__options" role="group" aria-label=${t('预载语音')} data-testid="preload-voice-lang">
        ${PRELOAD_VOICE_LANGS.map((lang) => html`<label class="resource-choice" key=${lang}>
          <input type="checkbox" name="preload-voice-lang" disabled=${disabled} value=${lang} checked=${selected.includes(lang)}
            onChange=${(e) => onVoiceLang(normalizePreloadVoiceLang(e.currentTarget.checked
              ? [...selected, lang] : selected.filter((id) => id !== lang)))} />${t(PRELOAD_VOICE_LABELS[lang])}</label>`)}
      </div>
      <p class="resource-description">${t('可多选；全部取消勾选则不预载语音。')}</p>
      <p class="resource-description">${t('仅影响预载范围；播放语言仍在设置中选择。切换后保留已有缓存。')}</p>
      ${!optional ? html`<p class="resource-description">${t('勾选“同时预载”后下载所选语音。')}</p>` : null}
    </fieldset>
    <section class="resource-skin-options resource-panel"><h3>${t('预载皮肤')}</h3><label class="resource-choice resource-skin-choice"><input type="checkbox" checked=${skins} disabled=${disabled}
      onChange=${(e) => onSkins(e.currentTarget.checked)} />${t('启用')}</label>
      <p class="resource-skin-hint resource-description">${t('独立于“同时预载”；不勾选时，启用的皮肤仅在显示时按需加载。保留已有缓存。')}</p></section>`;
}

/** Mounted once in main.js, above all screens including the settings modal. */
export function ResourceHost({ enabled, optional, voiceLang = 'cn', onVoiceLang, skins = false, onSkins, onChange, onOptional }) {
  const { open } = useStore((s) => s, Object.is, resourceUi);
  const st = useResources();
  const fileInput = useRef(null);
  useEffect(() => { if (open) void inspectResources().catch(() => {}); }, [open]);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deleteFlight = useRef(false);
  const archiveBusy = !!st.archive || deleting;
  const controls = resourceControls(st, enabled);
  const cancelProcessing = () => { pauseResources(); onChange(false); };
  const deleteLocalResources = async () => {
    if (deleteFlight.current) return;
    deleteFlight.current = true;
    try {
      if (!await confirmDialog({ utility: true, danger: true, title: t('删除本机游戏资源'),
        text: resourceDeleteNotice(), okText: t('删除资源') })) return;
      setDeleting(true); setDeleteError('');
      onChange(false);
      await syncResources(false);
      await clearResources();
    } catch {
      setDeleteError(t('无法删除游戏资源，请重试。'));
    } finally {
      deleteFlight.current = false; setDeleting(false);
    }
  };
  const importFile = async (e) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    try { await importResources(file, { onImported: () => onChange(true) }); } catch { /* controller displays the error */ }
  };
  const exportFile = async () => {
    try {
      const { blob, version } = await exportResources();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `stronghold-resources-${version.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { /* controller displays the error */ }
  };
  return html`<${Modal} open=${open} onClose=${closeResources} title=${t('预载资源管理')} micro="RESOURCE MANAGER" class="resource-modal" utility=${true}>
    <div class="resource-manager">
      <div class="resource-manager__top">
        <section class="resource-manager__status resource-panel">
          <div class="resource-status__head"><h3>${t('预载状态')}</h3>
            <span class=${`resource-manager__message${st.error ? ' is-error' : ''}`} role="status" aria-live="polite">
              ${st.message || stateText(st, enabled)}</span>
            <label class="resource-choice"><input type="checkbox" data-testid="preload-enabled" checked=${enabled}
              disabled=${controls.toggleDisabled || deleting} onChange=${e => onChange(e.currentTarget.checked)} />${t('自动预载')}</label>
          </div>
          ${st.checkBlocked ? html`<p class="resource-manager__warn">${t('完整检查请返回大厅后进行。')}</p>` : null}
          ${st.packProgress ? html`<div class="resource-manager__pack-progress">
            <${ProgressBar}
              value=${resourcePackPercent(st.packProgress)} max=${100} size="sm" tone="mint"
              label=${t('{0}资源包：{percent}%', { 0: t('正在下载'),
                percent: resourcePackPercent(st.packProgress) })} />
            <small>${t('下载速度：{0}/秒', { 0: formatBytes(st.packProgress.speedBytesPerSecond || 0) })}
              ${st.packProgress.activeDownloads > 1 ? ` · ×${st.packProgress.activeDownloads}` : ''}</small>
          </div>` : null}
          ${st.packProgress?.importing ? html`<${ProgressBar}
            value=${st.packProgress.importing.done} max=${Math.max(1, st.packProgress.importing.totalFiles)}
            size="sm" tone="amber" label=${t('{0}资源包：{percent}%', {
              0: t('正在导入'),
              percent: st.packProgress.importing.totalFiles
                ? Math.floor(st.packProgress.importing.done * 100 / st.packProgress.importing.totalFiles) : 0 })} />` : null}
          ${st.worker ? html`<p class="resource-manager__warn">${st.worker}</p>` : null}
          ${st.failed ? html`<p class="resource-manager__warn">${t('{failed} 个文件下载失败，继续下载时重试。', { failed: st.failed })}</p>` : null}
          ${st.skipped ? html`<p class="resource-manager__warn">${t('{skipped} 个文件超过单文件缓存上限，使用时按需加载。', { skipped: st.skipped })}</p>` : null}
          <p class="resource-description">${t('勾选自动预载后自动补齐所选资源；关闭只停止批量下载，已保存的资源仍可使用。战斗中暂停，结束后自动继续。')}</p>
          <div class="res-actions resource-status__actions">
            ${controls.cancel ? html`<${Button} variant="secondary" icon="hourglass" disabled=${deleting} onClick=${cancelProcessing}>${t('取消处理')}<//>` : null}
            ${controls.resume ? html`<${Button} variant="secondary" icon="refresh" disabled=${deleting || !st.supported} onClick=${startResources}>${st.phase === 'error' ? t('重试预载') : t('继续预载')}<//>` : null}
            ${controls.check ? html`<${Button} variant="secondary" icon="refresh" disabled=${deleting || !st.supported || st.combatPaused || st.checkBlocked} onClick=${checkResources}>${t('检查资源')}<//>` : null}
            <${Button} variant="danger" loading=${deleting} disabled=${archiveBusy} onClick=${deleteLocalResources}>${t('删除本机游戏资源')}<//>
          </div>
          ${deleteError ? html`<p class="resource-manager__warn" role="alert">${deleteError}</p>` : null}
        </section>
        <section class="resource-archive resource-panel">
          <h3>${t('ZIP 资源包')}</h3>
          <p class="resource-description">${t('可前往本服资源补给站下载分类 ZIP，也可将已缓存的资源导出并分享。导入时只复用当前版本仍有效的资源，缺少的部分会增量下载。')}</p>
          ${st.archive ? html`<${ProgressBar} value=${st.archivePercent} max=${100} size="sm" tone="mint" />` : null}
          <input ref=${fileInput} type="file" accept=".zip,application/zip,application/x-zip-compressed" hidden onChange=${importFile} />
          <div class="res-actions">
            <${Button} variant="secondary" disabled=${archiveBusy || !st.supported} onClick=${() => fileInput.current?.click()}>${t('导入 ZIP')}<//>
            <${Button} variant="secondary" disabled=${archiveBusy || !st.supported || !st.done} onClick=${exportFile}>${t('导出 ZIP')}<//>
            <${Button} variant="secondary" icon="link" disabled=${!RESOURCE_DOWNLOAD_URL}
              title=${t('ZIP 资源包')}
              onClick=${() => window.open(RESOURCE_DOWNLOAD_URL, '_blank', 'noopener,noreferrer')}>${t('前往下载')}<//>
          </div>
        </section>
      </div>
      <div class="resource-manager__grid">
        <${ResourceOptions} optional=${optional} voiceLang=${voiceLang} onVoiceLang=${onVoiceLang} skins=${skins} onSkins=${onSkins} disabled=${archiveBusy} />
        <${ResourceTier} st=${st} tier=${1} />
        <${ResourceTier} st=${st} tier=${2} optional=${optional} onOptional=${onOptional} disabled=${archiveBusy} />
      </div>
    </div>
  <//>`;
}
