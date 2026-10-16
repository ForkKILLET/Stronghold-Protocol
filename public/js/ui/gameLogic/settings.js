import { normalizePreloadVoiceLang } from '../../resources/common.js';
import { normalizeFrameRate } from '../../frameRate.js';
// ui/gameLogic/settings.js — settings defaults and sanitising. Re-exported from ../gameLogic.js.

import { VOICE_LANGS, sanitizeVoiceOverrides } from '../../voicePrefs.js';
export { VOICE_LANGS } from '../../voicePrefs.js';

import { clamp, isObj } from './shared.js';


// ---- settings ------------------------------------------------------------------------------------------------------

/**
 * The operator voice dubs (settings 语音语言): 'cn' 中文 (`audio.voice`, the default), 'jp' 日本語 (`audio.voiceJp`),
 * 'en' English (`audio.voiceEn`) and 'kr' 한국어 (`audio.voiceKr`), each falling back to the Chinese line it lacks
 * (public/js/audio.js voiceLine). Not tied to the interface language. `voiceNative` is the 本土语言 switch: an
 * operator who has `audio.voiceNative` speaks that dub unless their own override says otherwise.
 */


/**
 * The steps of 设置 →「文字大小」 (textSize): the interface text root `--t` of css/theme.css — 'sm' is the design's own
 * sizes (`--t: 1rem`), the others lift the phone's 40 px root by a floor and grow the desktop gently. Text only: the
 * layout root `1rem` (and with it the field camera, the detail card's side and the DOM fallback board) never moves.
 */
export const TEXT_SIZES = Object.freeze(['sm', 'md', 'lg', 'xl']);

/** Shortcuts persist separately in ui/shortcuts.js; voiceLang: VOICE_LANGS.
 *  textSize: TEXT_SIZES (css/theme.css `--t`, applied by ui/settings.js applyTextSize). */
export const DEFAULT_SETTINGS = Object.freeze({ bgm: 0.6, sfx: 0.8, voice: 0.8, voiceLang: 'cn', voiceNative: false, mysticEnergy: false, officialFx: 'auto', voiceOverrides: Object.freeze({}), muted: false, damageNumbers: true, officialDamageNumbers: false, ammoCount: false, deploymentZoom: false, quality: 'high', textSize: 'sm', fpsLimit: 0, skinsEnabled: false, preload: false, preloadOptional: false, preloadVoiceLang: Object.freeze(['cn']), preloadSkins: false });
const QUALITIES = ['high', 'medium', 'low'];
/** The values of 设置「官方特效」 (render/vfx/tier.js OFFICIAL_FX). */
export const OFFICIAL_FX_MODES = Object.freeze(['auto', 'off', 'lite', 'full']);

/**
 * Sanitize persisted settings.
 * @param {any} raw
 * @returns {{ bgm: number, sfx: number, voice: number, voiceLang: 'cn'|'jp'|'en'|'kr', voiceNative: boolean, voiceOverrides: Record<string, string>, muted: boolean, damageNumbers: boolean, officialDamageNumbers: boolean, ammoCount: boolean, deploymentZoom: boolean, combatMetrics: boolean, mysticEnergy: boolean, quality: 'high'|'medium'|'low', officialFx: 'auto'|'off'|'lite'|'full',
 *   textSize: 'sm'|'md'|'lg'|'xl', keys: Record<'buy'|'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready', string> }}
 */
export function sanitizeSettings(raw) {
  const r = isObj(raw) ? raw : {};
  const vol = (v, d) => (Number.isFinite(v) ? clamp(Math.round(v * 100) / 100, 0, 1) : d);
  return {
    bgm: vol(r.bgm, DEFAULT_SETTINGS.bgm),
    sfx: vol(r.sfx, DEFAULT_SETTINGS.sfx),
    voice: vol(r.voice, DEFAULT_SETTINGS.voice),
    voiceLang: VOICE_LANGS.includes(r.voiceLang) ? r.voiceLang : DEFAULT_SETTINGS.voiceLang,
    voiceNative: r.voiceNative === true,
    voiceOverrides: sanitizeVoiceOverrides(r.voiceOverrides),
    muted: typeof r.muted === 'boolean' ? r.muted : DEFAULT_SETTINGS.muted,
    damageNumbers: typeof r.damageNumbers === 'boolean' ? r.damageNumbers : DEFAULT_SETTINGS.damageNumbers,
    officialDamageNumbers: typeof r.officialDamageNumbers === 'boolean' ? r.officialDamageNumbers : false,
    ammoCount: typeof r.ammoCount === 'boolean' ? r.ammoCount : DEFAULT_SETTINGS.ammoCount,
    deploymentZoom: r.deploymentZoom === true,
    mysticEnergy: typeof r.mysticEnergy === 'boolean' ? r.mysticEnergy : DEFAULT_SETTINGS.mysticEnergy,
    quality: QUALITIES.includes(r.quality) ? r.quality : DEFAULT_SETTINGS.quality,
    fpsLimit: normalizeFrameRate(r.fpsLimit),
    skinsEnabled: typeof r.skinsEnabled === 'boolean' ? r.skinsEnabled : false,
    // optional asset preload (docs/ASSETS.md「Preload」): off unless the player turned it on
    preload: typeof r.preload === 'boolean' ? r.preload : DEFAULT_SETTINGS.preload,
    preloadOptional: typeof r.preloadOptional === 'boolean' ? r.preloadOptional : DEFAULT_SETTINGS.preloadOptional,
    preloadVoiceLang: normalizePreloadVoiceLang(r.preloadVoiceLang, r.voiceLang),
    preloadSkins: typeof r.preloadSkins === 'boolean' ? r.preloadSkins : false,
    officialFx: OFFICIAL_FX_MODES.includes(r.officialFx) ? r.officialFx : DEFAULT_SETTINGS.officialFx,
    textSize: TEXT_SIZES.includes(r.textSize) ? r.textSize : DEFAULT_SETTINGS.textSize,
  };
}
