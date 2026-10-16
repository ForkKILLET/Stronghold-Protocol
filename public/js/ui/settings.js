// Player settings (BGM/SFX/voice volume, the voice dub 语音语言, mute, damage numbers, the optional 弹药数量 under an ammo
// skill's bar — not in the official HUD, off by default, PR #552 —, the optional 作战统计 panel — off by default,
// PR #618 —, render quality, 文字大小, the
// shortcut keys): a tiny observable store persisted in localStorage (`sp.pref.settings`), applied to the audio manager
// and to the document on every change, plus the settings modal — which also holds the language switch (ui/lang.js; kept
// apart in `sp.pref.lang`; under it a note while the current language's pack is a machine translation,
// `_meta.machineTranslated`) and the 快捷键 section that rebinds the in-match shortcuts (the key map:
// ui/gameLogic/shortcuts.js; the community request 「快捷键可不可以自己设置」, the owner's decision of 2026-10-07) and
// 问题反馈, which copies the diagnostics of this page for a bug report (diag.js: the error log, this browser, optionally
// the battle on screen; nothing is uploaded). The lobby and the room open it from a 设置 button next to 玩法说明
// (SettingsButton, GitHub #238); the title screen and the match have their own gear.
// 外观插件 (DESIGN §32 P1a, the design study's §7.5): a switch for each cosmetic plugin of scope `personal` the server's
// catalogue lists (content.js) — kept in this browser (`sp.pref.cosmetics`), never sent, seen by this player alone and
// never part of a battle; the section is left out when the server has none. The switched-on ones form a set like a
// room's (content.js personalSet): one another needs is on as 「自动」 and cannot be switched off alone, a switch that
// would make a conflict is refused with the room's message, and a chosen one left out (it conflicts now) says so.
//
// 文字大小 (textSize, applied by applyTextSize): the interface text root `--t` of css/theme.css — a phone clamps the
// layout root `1rem` at 40 px (theme.css), which left the .18rem body text at 7.2 CSS px while the browser's own font
// settings only inflate the glyphs inside fixed boxes (and page zoom is off: index.html's viewport, ui/device.js).
// Only font-size declarations read `--t`, so the board, the HUD bands the prep camera keeps clear and the detail
// card's side do not move — the field is sized from the host element's clientWidth (render/app.js).

import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button, Icon, MicroLabel } from './components.js';
import { createStore, useStore, loadPref, savePref, store } from '../store.js';
import { sanitizeSettings, DEFAULT_SHORTCUTS, sanitizeShortcuts, shortcutLabel, VOICE_LANGS, TEXT_SIZES } from './gameLogic.js';
import { GIcon } from './gameComponents.js';
import { audio } from '../audio.js';
import { openGuide } from './guide.js';
import { detectFeatures } from './device.js';
import { ResourceRow } from './resourcePanel.js';
import { FRAME_RATES } from '../frameRate.js';
import { LangToggle, machineTranslationNote } from './lang.js';
import { t, tc, N_ } from '../../../shared/i18n.js';
import { errorCount, currentBattle, diagnosticsText } from '../diag.js';
import { copyText } from './clipboard.js';
import { catalog, loadCatalog, cosmeticPlugins, installedCount, personal, personalApplied, personalSet, pluginName, setPersonalPlugin } from '../content.js';
import { setUiPlugin, uiPluginEntries, uiPlugins } from './uiPlugins.js';
import { UI_LIMITS } from '../../../shared/plugins/ui.js';
import { toast, describeError } from './toasts.js';
import { pluginMicro } from './pluginTag.js';
import { fxAvailable } from '../render/vfx/available.js';
import { resolveOfficialFx } from '../render/vfx/tier.js';

import { AnnouncementButton } from './announcement.js';
const cx = (...parts) => parts.filter(Boolean).join(' ');

/** Settings store: volumes, voices, damageNumbers, officialDamageNumbers, ammoCount, deploymentZoom, quality, textSize, fpsLimit and preload options. Shortcuts persist separately. */
export const settingsStore = createStore(sanitizeSettings(loadPref('settings', null)));
export const shortcutsStore = createStore(sanitizeShortcuts(loadPref('shortcuts', DEFAULT_SHORTCUTS)));

/**
 * 设置 →「文字大小」: put the step on <html data-text> — css/theme.css turns it into the text root `--t`
 * (`:root[data-text="md"] { --t: … }`), which every readable font-size reads; no layout value does. The attribute
 * (not an inline style) keeps the default in the stylesheet: without it — no JavaScript, an old saved profile, a
 * value a future version dropped — the page is the design's own sizes. Values outside TEXT_SIZES fall back to 小.
 * @param {'sm'|'md'|'lg'|'xl'} v
 */
export function applyTextSize(v) {
  const el = globalThis.document?.documentElement;
  if (el) el.dataset.text = TEXT_SIZES.includes(v) ? v : 'sm';
}

settingsStore.subscribe((s) => {
  savePref('settings', sanitizeSettings(s));
  audio.setVolumes(s);
  audio.setVoiceLang(s.voiceLang, s.voiceOverrides);
  audio.setVoiceNative(s.voiceNative);
  applyTextSize(s.textSize);
});
shortcutsStore.subscribe((s) => savePref('shortcuts', sanitizeShortcuts(s)));
audio.setVolumes(settingsStore.get());
audio.setVoiceLang(settingsStore.get().voiceLang, settingsStore.get().voiceOverrides);
audio.setVoiceNative(settingsStore.get().voiceNative);
// before the first render (main.js boot renders after its imports ran): the stored step is on screen without a flash
applyTextSize(settingsStore.get().textSize);

/** @param {Partial<ReturnType<typeof sanitizeSettings>>} patch */
export function updateSettings(patch) {
  settingsStore.set(sanitizeSettings({ ...settingsStore.get(), ...patch }));
}

/** Preact hook: current settings. */
export const useSettings = () => useStore((s) => s, Object.is, settingsStore);
export const useShortcuts = () => useStore((s) => s, Object.is, shortcutsStore);

/**
 * The label of the key a rebindable shortcut has right now ('R', 'Space' …) — the HUD's key hints (shop bar, ready /
 * pause, underframe). Read at render: the game screen re-renders when the settings dialog closes.
 * @param {'buy'|'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready'} action
 */
export const hotkeyLabelOf = (action) => shortcutLabel(shortcutsStore.get(), action);

function Slider({ label, micro, value, onInput, icon }) {
  const pct = Math.round(value * 100);
  return html`<label class="set-row">
    <span class="set-row__label"><${Icon} name=${icon} />${label}<${MicroLabel}>${micro}<//></span>
    <input class="set-range" type="range" min="0" max="100" step="5" value=${pct} style=${`--pct:${pct}%`}
      onInput=${(e) => onInput(Number(e.currentTarget.value) / 100)} />
    <span class="set-row__val num">${pct}</span>
  </label>`;
}

function Toggle({ label, micro, value, onChange }) {
  return html`<div class="set-row">
    <span class="set-row__label">${label}<${MicroLabel}>${micro}<//></span>
    <button type="button" class=${`set-toggle${value ? ' is-on' : ''}`} role="switch" aria-checked=${value ? 'true' : 'false'}
      onClick=${() => onChange(!value)}><i></i><span>${value ? tc('toggle', '开启') : tc('toggle', '关闭')}</span></button>
  </div>`;
}

const QUALITY = [['high', N_('高')], ['medium', N_('中')], ['low', N_('低')]];
/**
 * 官方特效 (0.3.0, render/vfx): the official battle effects the server's owner extracted from their own client (the
 * server serves them: every player of that server sees the owner's extraction) — normal attacks, projectiles, hits,
 * statuses, deaths, deploys, the operators' skills and a 秘术师's stored energies; 关 / 精简 / 完整. The stored default
 * 'auto' shows as the tier it resolves to (完整 on a desktop, 精简 on a touch device, render/vfx/tier.js); the row is
 * left out when no effects were extracted (data/local-fx.json lists none).
 */
const OFFICIAL_FX = [['off', N_('关')], ['lite', N_('精简')], ['full', N_('完整')]];
/**
 * 文字大小: one step of TEXT_SIZES (ui/gameLogic/settings.js) with its label — 小 is the design's own sizes, the others
 * raise the text root `--t` (css/theme.css) and with it every readable font-size; the board and the HUD's boxes stay.
 */
const TEXT_SCALES = [['sm', N_('小')], ['md', N_('中')], ['lg', N_('大')], ['xl', N_('特大')]];
/**
 * 语音语言: each dub named in its own language, like the interface language switch (ui/lang.js) — the owner's
 * 「中文 / 日本語 / English / 한국어」; VOICE_LANGS order. Each name is that language's own script.
 * The 本土语言 switch beside them is a separate boolean (voiceNative), not a fifth global dub.
 */
const VOICE_LANG_NAMES = { cn: '中文', jp: '日本語', en: 'English', kr: '한국어' }; // i18n-ignore
const VOICE_LANG_TAGS = { cn: 'zh', jp: 'ja', en: 'en', kr: 'ko' };
/** Where a report goes: the upstream issue tracker (shown as text the player can select; a link may open nothing). */
export const ISSUES_URL = 'https://github.com/sganggs/Stronghold-Protocol/issues';

/**
 * 问题反馈: copy the diagnostics of this page (diag.js) for a GitHub issue — the errors recorded since the page opened,
 * this browser and device, where the player is, and, switched on by default while a battle is on screen, that battle's
 * spec (the dev tools replay it). Player names, the room code and the token are replaced; nothing is uploaded. Laid out
 * like 快捷键 above it (a head with its button, a hint, the result line); the battle switch is the settings' Toggle, and
 * when the clipboard refuses (some in-app browsers), the report is shown selected in a box styled like 干员调配's 导出.
 */
/** The result line of 复制诊断信息, by outcome (msgids: translated when shown, so a language switch reaches it). */
const DIAG_NOTES = { copied: N_('已复制诊断信息，可以粘贴到 GitHub issue 中'), refused: N_('无法写入剪贴板，请手动复制下面的内容') };

function DiagSection() {
  const [attach, setAttach] = useState(true);
  const [note, setNote] = useState(null);       // 'copied' | 'refused' | null: the result line
  const [manual, setManual] = useState(null);   // the report, when the clipboard refused it
  const boxRef = useRef(null);
  // the box opens selected for a manual copy, scrolled to its first line (select() leaves it at the end)
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (manual && el) { el.focus(); el.select(); el.scrollTop = 0; }
  }, [manual]);
  const n = errorCount();
  const battle = currentBattle();
  const copy = async () => {
    const text = diagnosticsText({ state: store.get(), settings: settingsStore.get(), attachBattle: attach && !!battle, personal: personalApplied() });
    const ok = await copyText(text);
    setManual(ok ? null : text);
    setNote(ok ? 'copied' : 'refused');
  };
  return html`<section class="set-diag" aria-labelledby="set-diag-title">
    <div class="set-keys__head">
      <span class="set-row__label" id="set-diag-title">${t('问题反馈')}<${MicroLabel}>DIAGNOSTICS<//></span>
      <${Button} variant="ghost" size="sm" icon="copy" class="set-diag__copy" data-testid="diag-copy" onClick=${copy}>${t('复制诊断信息')}<//>
    </div>
    <p class="set-hint">${t('遇到问题时，复制诊断信息并粘贴到 GitHub issue 中，开发者就能看到出错时的情况。诊断信息只在本机生成，不会自动上传；玩家名和房间号会被替换。')}</p>
    <div class="set-diag__meta">
      <span class="set-diag__stat">${t('已记录的错误')}<b class=${cx('set-diag__count num', n > 0 && 'is-warn')} data-testid="diag-count">${n}</b></span>
      <span class="set-diag__url">${ISSUES_URL.replace(/^https:\/\//, '')}</span>
    </div>
    ${battle ? html`<${Toggle} label=${t('附上本场战斗')} micro="BATTLE DATA" value=${attach} onChange=${setAttach} />
      <p class="set-hint set-diag__battle-hint">${t('开发者可以用附上的战斗数据重现这场战斗。')}</p>` : null}
    ${note ? html`<p class=${cx('set-keys__note', note === 'refused' && 'is-warn')} role="status" aria-live="polite">${t(DIAG_NOTES[note])}</p>` : null}
    ${manual ? html`<textarea ref=${boxRef} class="set-diag__text" data-testid="diag-text" spellcheck=${false} readOnly
      aria-label=${t('诊断信息')} value=${manual}></textarea>` : null}
  </section>`;
}

/**
 * 外观插件 (see the header): the server's cosmetic plugins of scope `personal`, each with its switch; nothing when there
 * is none. The catalogue is fetched again when the section opens (a plugin dropped in meanwhile shows) — on a server that
 * has plugins only (content.js installedCount: a server without any is never asked for it).
 */
function CosmeticSection() {
  const cat = useStore((s) => s, Object.is, catalog);
  const ids = useStore((s) => s.ids, Object.is, personal);
  const installed = useStore(installedCount);
  useEffect(() => { if (installed) loadCatalog({ force: true }); }, [installed]);
  const list = installed ? cosmeticPlugins(cat.plugins, 'personal') : [];
  if (!list.length) return null;
  const set = personalSet(ids, list.filter((p) => typeof p.vs === 'string'));
  const applied = new Set(set.order);
  const auto = new Set(set.auto);
  const flip = (id, on) => { const r = setPersonalPlugin(id, on); if ('error' in r) toast(describeError(r.error), 'warn'); };
  return html`<section class="set-plugins" aria-labelledby="set-plugins-title" data-testid="personal-plugins">
    <div class="set-keys__head">
      <span class="set-row__label" id="set-plugins-title">${t('外观插件')}<${MicroLabel}>COSMETIC PLUGINS<//></span>
    </div>
    <p class="set-hint">${t('只改变你自己看到的画面和声音，不影响其他博士，也不影响战斗；插件为非官方制作。')}</p>
    ${list.map((p) => {
      // on: applied (chosen, or 「自动」: another one needs it) — or chosen but left out now (a conflict): switch it off
      const skipped = set.skipped.includes(p.id);
      const on = applied.has(p.id) || skipped;
      const isAuto = auto.has(p.id);
      return html`<div key=${p.id} class="set-row" data-plugin=${p.id}>
        <span class="set-row__label">${pluginName(p)}${isAuto ? html` <span class="plugrow__badge">${t('自动')}</span>` : null}<${MicroLabel}>${pluginMicro(p)}<//>
          ${skipped ? html`<span class="set-hint is-warn">${t('与其他已开启的插件冲突或缺少所需插件，没有生效')}</span>` : null}</span>
        <button type="button" class=${`set-toggle${on ? ' is-on' : ''}`} role="switch" aria-checked=${on ? 'true' : 'false'} aria-label=${pluginName(p)}
          disabled=${isAuto && !ids.includes(p.id)} onClick=${() => flip(p.id, !on)}><i></i><span>${on ? tc('toggle', '开启') : tc('toggle', '关闭')}</span></button>
      </div>`;
    })}
  </section>`;
}

/**
 * 界面插件 (DESIGN §32.8): each loaded ui plugin of scope `personal`, switched on in this browser only
 * (`sp.pref.ui-plugins`). It cannot play the match and it does not change what anyone else sees.
 */
function UiPluginSection() {
  const cat = useStore((s) => s, Object.is, catalog);
  const ids = useStore((s) => s.ids, Object.is, uiPlugins);
  const installed = useStore(installedCount);
  useEffect(() => { if (installed) loadCatalog({ force: true }); }, [installed]);
  const list = installed ? uiPluginEntries(cat.plugins) : [];
  if (!installed || (cat.status !== 'ready' && !list.length && !ids.length)) return null;
  if (!list.length && !ids.length) return null;
  const onIds = new Set(ids);
  const flip = (id, on) => {
    const r = setUiPlugin(id, on);
    if (!r.error) return;
    toast(r.error === 'PLUGIN_LIMIT' ? t('最多同时开启 {n} 个界面插件', { n: UI_LIMITS.maxPlugins }) : describeError(r.error), 'warn');
  };
  return html`<section class="set-plugins" aria-labelledby="set-ui-plugins-title" data-testid="ui-plugins">
    <div class="set-keys__head">
      <span class="set-row__label" id="set-ui-plugins-title">${t('界面插件')}<${MicroLabel}>UI PLUGINS<//></span>
    </div>
    <p class="set-hint">${t('只改变这个浏览器里的界面，不能替你操作对局，也不影响其他博士；插件为非官方制作。')}</p>
    ${!list.length ? html`<p class="set-hint">${t('本服务器没有可开启的界面插件')}</p>` : list.map((p) => {
      const on = onIds.has(p.id);
      return html`<div key=${p.id} class="set-row" data-plugin=${p.id}>
        <span class="set-row__label">${pluginName(p)}<${MicroLabel}>${pluginMicro(p)}<//></span>
        <button type="button" class=${`set-toggle${on ? ' is-on' : ''}`} role="switch" aria-checked=${on ? 'true' : 'false'} aria-label=${pluginName(p)}
          onClick=${() => flip(p.id, !on)}><i></i><span>${on ? tc('toggle', '开启') : tc('toggle', '关闭')}</span></button>
      </div>`;
    })}
  </section>`;
}

/**
 * Settings modal.
 * @param {{ open: boolean, onClose: Function }} props
 */
export function SettingsModal({ open, onClose }) {
  const s = useSettings();
  const [tested, setTested] = useState(false);
  const [touchUi] = useState(() => detectFeatures().coarse && !detectFeatures().fine);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const mtNote = machineTranslationNote(); // a pack marked as machine translation says so under the switch
  const [fxOk, setFxOk] = useState(false);  // effects extracted from the local client: the 官方特效 row shows
  // only while it is open (the title page keeps the modal mounted, closed), and from the effects' own file list: the
  // asset store (assets.js) is not loaded before a match (test/ui/plugins.e2e.test.js). A Phase 1a extraction (0.3.0
  // development builds only) listed its effects in data/local-assets.json instead and shows no row: re-extract.
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    fxAvailable(null).then((ok) => { if (live) setFxOk(!!ok); }, () => {});
    return () => { live = false; };
  }, [open]);
  const fxTier = resolveOfficialFx(s.officialFx, true);
  return html`<${Modal} open=${open} onClose=${onClose} title=${t('设置')} micro="SETTINGS" width="7.4rem" utility=${true} class="settings-modal"
    actions=${html`<${AnnouncementButton} onClick=${onClose} /><${Button} variant="secondary" icon="book" class="set-guide" onClick=${() => openGuide(0)}>${t('玩法说明')}<//>
      <${Button} variant="primary" icon="check" onClick=${onClose}>${t('完成')}<//>`}>
    <div class="set-list">
      <div class="set-row">
        <span class="set-row__label">${t('语言')}<${MicroLabel}>LANGUAGE<//></span>
        <${LangToggle} class="set-lang" />
      </div>
      ${mtNote ? html`<p class="set-hint set-lang-note" data-testid="lang-mt-note">${mtNote}</p>` : null}
      <${Slider} label=${t('背景音乐')} micro="BGM" icon="play" value=${s.bgm} onInput=${(v) => updateSettings({ bgm: v })} />
      <${Slider} label=${t('干员语音')} micro="VOICE" icon="mic" value=${s.voice} onInput=${(v) => updateSettings({ voice: v })} />
      <div class="set-row">
        <span class="set-row__label">${t('语音语言')}<${MicroLabel}>VOICE LANGUAGE<//></span>
        <div class="set-voice">
          <div class="set-seg" role="radiogroup" aria-label=${t('语音语言')} data-testid="voice-lang">
            ${VOICE_LANGS.map((id) => html`<button key=${id} type="button" role="radio" aria-checked=${s.voiceLang === id ? 'true' : 'false'}
              lang=${VOICE_LANG_TAGS[id]} class=${s.voiceLang === id ? 'is-on' : ''} onClick=${() => updateSettings({ voiceLang: id })}>${VOICE_LANG_NAMES[id]}</button>`)}
          </div>
          <button type="button" class=${s.voiceNative ? 'set-native is-on' : 'set-native'} data-testid="voice-native" aria-pressed=${s.voiceNative ? 'true' : 'false'}
            title=${t('有本土语言配音时使用')} onClick=${() => updateSettings({ voiceNative: !s.voiceNative })}>${tc('voice-lang', '本土语言')}</button>
        </div>
      </div>
      <${Slider} label=${t('音效')} micro="SFX" icon="signal" value=${s.sfx}
                 onInput=${(v) => { updateSettings({ sfx: v }); if (!tested) { setTested(true); setTimeout(() => setTested(false), 400); audio.sfx('click'); } }} />
      <${Toggle} label=${t('静音')} micro="MUTE" value=${s.muted} onChange=${(v) => updateSettings({ muted: v })} />
      <${Toggle} label=${t('显示伤害数字')} micro="DAMAGE NUMBERS" value=${s.damageNumbers} onChange=${(v) => updateSettings({ damageNumbers: v })} />
      <${Toggle} label=${t('官方伤害数字')} micro="OFFICIAL NUMBERS" value=${s.officialDamageNumbers} onChange=${(v) => updateSettings({ officialDamageNumbers: v })} />
      <p class="set-hint">${t('只显示达到官方暴击条件的红色数字。关闭时仍显示每一次命中。')}</p>
      <${Toggle} label=${t('弹药数量')} micro="AMMO COUNT" value=${s.ammoCount} onChange=${(v) => updateSettings({ ammoCount: v })} />
      <p class="set-hint">${t('弹药类技能开启时，在弹药条下方显示剩余弹药 / 总弹药数（如 13/14）。官方界面没有这个数字。')}</p>
      <${Toggle} label=${t('部署时镜头缩放')} micro="DEPLOYMENT ZOOM" value=${s.deploymentZoom} onChange=${(v) => updateSettings({ deploymentZoom: v })} />
      <p class="set-hint">${t('放置或移动干员、装备时临时收起商店并放大棋盘，结束后恢复。默认关闭，不影响手动收起商店。')}</p>
      <${ResourceRow} enabled=${s.preload} onChange=${(v) => updateSettings({ preload: v })} />
      <${Toggle} label=${t('启用皮肤')} micro="SKINS" value=${s.skinsEnabled} onChange=${(v) => updateSettings({ skinsEnabled: v })} />
      <p class="set-hint">${t('开启后可在干员调配中选择皮肤，并显示其他玩家的皮肤。关闭时全部显示默认外观，保留已选皮肤。')}</p>
      <div class="set-row"><span class="set-row__label"><${Icon} name="keyboard" />${t('快捷键')}<${MicroLabel}>SHORTCUTS<//></span>
        <${Button} variant="secondary" icon="edit" onClick=${() => setShortcutOpen(true)}>${t('修改快捷键')}<//></div>
      <${Toggle} label=${t('秘术师能量')} micro="STORED ENERGY" value=${s.mysticEnergy} onChange=${(v) => updateSettings({ mysticEnergy: v })} />
      <p class="set-hint">${t('在秘术师的血条下方显示储存的攻击能量 / 上限（如 2/3）。官方用干员身上的特效表示，没有这个数字。')}</p>
      <div class="set-row">
        <span class="set-row__label">${t('画面质量')}<${MicroLabel}>QUALITY<//></span>
        <div class="set-seg" role="radiogroup">
          ${QUALITY.map(([id, label]) => html`<button key=${id} type="button" role="radio" aria-checked=${s.quality === id ? 'true' : 'false'}
            class=${s.quality === id ? 'is-on' : ''} onClick=${() => updateSettings({ quality: id })}>${t(label)}</button>`)}
        </div>
      </div>
      ${fxOk ? html`<div class="set-row" data-testid="official-fx">
        <span class="set-row__label">${t('官方特效')}<${MicroLabel}>OFFICIAL FX<//></span>
        <div class="set-seg" role="radiogroup" aria-label=${t('官方特效')}>
          ${OFFICIAL_FX.map(([id, label]) => html`<button key=${id} type="button" role="radio" aria-checked=${fxTier === id ? 'true' : 'false'}
            class=${fxTier === id ? 'is-on' : ''} onClick=${() => updateSettings({ officialFx: id })}>${t(label)}</button>`)}
        </div>
      </div>
      <p class="set-hint">${t('使用服主从自己的游戏客户端提取的官方战斗特效（普攻、弹道、命中、状态、阵亡、部署，干员、召唤物和敌人的技能与天赋，以及秘术师储存的能量），连到这台服务器的玩家看到的都是服主提取的这一份；提取里没有的或对战中没有时机的（如只在游戏内部条件下触发的天赋效果）仍为本作的特效。精简：半分辨率贴图、粒子减半，适合手机。只在 3D 棋盘上显示。')}</p>` : null}
      <div class="set-row">
        <span class="set-row__label">${t('文字大小')}<${MicroLabel}>TEXT SIZE<//></span>
        <div class="set-seg set-textsize" role="radiogroup" aria-label=${t('文字大小')} data-testid="text-size">
          ${TEXT_SCALES.map(([id, label]) => html`<button key=${id} type="button" role="radio" aria-checked=${s.textSize === id ? 'true' : 'false'}
            class=${s.textSize === id ? 'is-on' : ''} onClick=${() => updateSettings({ textSize: id })}>${t(label)}</button>`)}
        </div>
      </div>
      <p class="set-hint set-textsize-note">${t('调整界面文字大小，棋盘保持原比例。')}</p>
      <${CosmeticSection} />
      <${UiPluginSection} />
      <${DiagSection} />
      <div class="set-row set-row--fps">
        <span class="set-row__label">${t('帧率上限')}<${MicroLabel}>FRAME RATE<//></span>
        <div class="set-seg set-seg--fps" role="radiogroup" aria-label=${t('帧率上限')}>
          ${FRAME_RATES.map((limit) => html`<button key=${limit} type="button" role="radio" aria-checked=${s.fpsLimit === limit ? 'true' : 'false'}
            aria-label=${limit ? `${limit} FPS` : t('不限帧率')} class=${s.fpsLimit === limit ? 'is-on' : ''}
            onClick=${() => updateSettings({ fpsLimit: limit })}>${limit || t('不限')}</button>`)}
        </div>
      </div>
      ${touchUi
        ? html`<p class="set-hint">${t('触屏操作：点击单位选中（撤退 / 出售）· 长按单位或卡牌查看详情 · 拖动部署后滑动选择朝向')}</p>`
        : html`<p class="set-hint">${t('快捷键可在“修改快捷键”中自定义。')}<kbd>Esc</kbd> ${t('关闭弹窗 · 右键查看详情')}</p>`}
    </div>
    <${ShortcutModal} open=${shortcutOpen} onClose=${() => setShortcutOpen(false)} />
  <//>`;
}

const SHORTCUT_LABELS = {
  viewEnemies: [N_('查看本回合怪物'), 'W'], freeze: [N_('冻结'), 'S'], refresh: [N_('刷新'), 'R'], ready: [N_('准备'), 'C'],
  sell: [N_('售卖当前选中干员'), 'X'], retreat: [N_('撤离当前干员'), 'Q'], levelUp: [N_('升级等级'), 'G'], pause: [N_('暂停/继续作战'), N_('空格')],
};

function ShortcutModal({ open, onClose }) {
  const shortcuts = useShortcuts();
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const listenRef = useRef(null);
  useEffect(() => { if (editing) listenRef.current?.focus?.(); }, [editing]);
  const setKey = (action, e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.altKey || e.key === 'Escape') return;
    const code = e.code;
    if (!code || !/^Key[A-Z]|^Digit[0-9]|^Space$|^Arrow/.test(code)) { setError(t('请使用字母、数字、方向键或空格')); return; }
    const other = Object.entries(shortcuts).find(([a, v]) => a !== action && v === code);
    if (other) { setError(t('与“{0}”重复', { 0: t(SHORTCUT_LABELS[other[0]]?.[0] || other[0]) })); return; }
    shortcutsStore.set({ [action]: code }); setEditing(null); setError('');
  };
  const reset = () => { shortcutsStore.set({ ...DEFAULT_SHORTCUTS }); setEditing(null); setError(''); };
  const display = (code) => code === 'Space' ? t('空格') : code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '方向');
  return html`<${Modal} open=${open} title=${t('修改快捷键')} micro="KEYBOARD SHORTCUTS" width="6.5rem" onClose=${onClose} utility=${true} class="settings-shortcuts-modal"
      actions=${html`<${Button} variant="secondary" icon="refresh" onClick=${reset}>${t('重置默认')}<//><${Button} variant="primary" icon="check" onClick=${onClose}>${t('完成')}<//>`}>
    <div class="shortcut-list">
      ${Object.entries(SHORTCUT_LABELS).map(([action, [label]]) => html`<div key=${action} class="shortcut-row">
        <span>${t(label)}</span>
        ${editing === action
          ? html`<button ref=${listenRef} type="button" class="shortcut-key is-listening" onKeyDown=${(e) => setKey(action, e)}>${t('请按键…')}</button>`
          : html`<button type="button" class="shortcut-key" onClick=${() => { setEditing(action); setError(''); }}>${display(shortcuts[action])}</button>`}
      </div>`)}
      ${error ? html`<p class="shortcut-error">${error}</p>` : html`<p class="set-hint">${t('点击按键后，再按下要绑定的新键。重复按键会被拒绝。')}</p>`}
    </div>
  <//>`;
}

/**
 * The 设置 button of the lobby and the room (GitHub #238 — before it the settings were reachable only from the title
 * screen and a running match): the twin of the 玩法说明 button (ui/guide.js GuideButton), with the settings modal behind it
 * (mounted only while open). The same modal as the title screen's and the match's: nothing in it is match-only.
 * `square`: the gear alone (the lobby's top bar), the name stays title / aria-label — like GuideButton's.
 * @param {{ class?: string, size?: 'sm'|'md'|'lg'|'xl', variant?: string, label?: string, square?: boolean }} props
 */
export function SettingsButton({ class: cls, size = 'sm', variant = 'ghost', label = t('设置'), square = false }) {
  const [open, setOpen] = useState(false);
  return html`<${Button} variant=${variant} size=${size} square=${square} class=${cx('settings-btn', cls)} onClick=${() => setOpen(true)}
      title=${t('设置')} aria-label=${t('设置')} data-testid="settings-btn"><${GIcon} name="gear" class="btn__icon" />${square ? null : label}<//>
    ${open ? html`<${SettingsModal} open=${true} onClose=${() => setOpen(false)} />` : null}`;
}
