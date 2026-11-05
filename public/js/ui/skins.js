import { loadDefaultCharMap } from './loadoutSync.js';
// 干员皮肤：客户端状态与同步 (docs/SKINS.md).
//
// Two different things live here:
//
//   * the CATALOGUE (data/skins.json) — every skin the project knows about: ids, names, series. It carries no URLs.
//   * the FILES (data/assets.json → chars[charId].skins) — the skins whose models this install has. They are all
//     installed ahead of time (tools/install-skins.mjs, tools/fetch-assets.mjs) and served from the CDN, so nothing
//     is installed from inside the game: `availableSkins()` offers every catalogue skin this install can draw.
//
// The choice is `{ [charId]: skinId }` (DIY keys remain slot chessIds), persisted per browser and mirrored to
// the server through `room.skins` — the same shape and the same wiring as the operator loadout (ui/loadoutSync.js),
// except that this one is PUBLIC: the server puts it in `Match.publicView().players[]`, which is how a teammate
// sees your skin.

import { createStore, loadPref, savePref } from '../store.js';
import { data } from '../data.js';
import { contentSet } from '../content.js';
import { operatorCharIds } from '../../../shared/protocol.js';
import { cleanSkins } from '../../../shared/skins.js';

export const SKINS_PREF = 'skins';
export const SKINS_KEY = 'entries';
export const SKINS_SYNC_KEY = 'sync';
export const parseStoredSkins = cleanSkins;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v ? v : null);

/**
 * Whether a skin record names a Spine model (not whether it can be worn). Like assets.js
 * `skinHasModel`; actual model loading additionally checks `validSpine`. This module is on the
 * boot path (main.js → screens/lobby.js → screens/loadout.js → ui/loadoutSync.js) and pulling the asset store in with
 * its Spine cache there would be a cost the title page never needs (test/ui/plugins-client.test.js pins that). The
 * difference can only be a skin whose model is written but does not resolve — the picker would offer it once and the
 * renderer would draw the operator's own body, which is the same fallback a plugin-withdrawn model gets.
 */
export const skinHasModel = (skin) => !!skin && isObj(skin.spine) && isObj(skin.spine.front) && typeof skin.spine.front.skel === 'string';

// B6: maintainer option A (2026-10-18), docs/history/0.3.2.md §35.4. [ASSUMED] The existing E2 and
// illust slots count as pictures too; metadata alone never offers a selectable outfit.
export const skinHasPictures = (skin) => !!skin && ['avatar', 'avatarE2', 'portrait', 'portraitE2', 'illust'].some((key) => str(skin[key]));

/**
 * Display choice for an effective operator body. #686 keeps each seat independent; no viewer choice leaks into
 * another seat. [ASSUMED] Latest public choices (including clears) beat old unit metadata, as in render/app.js.
 * An omitted owner means the local picker; null means an unowned catalogue entry. Official skin_table.charSkins
 * groups pictures by charId; activity_table backupCharId / the DIY pick decides which charId callers pass.
 */
export function ownerSkin(charId, { ownerId, myId = null, players = [], localSkins = {}, skin = null, otherSkins = true } = {}) {
  if (!charId || ownerId === null) return null;
  const read = (choices) => { const rec = data.list('chess').find(c => c.charId === charId && !c.isGolden && !c.isDiy); return str(choices?.[rec?.baseId || rec?.chessId]) || str(choices?.[charId]); };
  if (ownerId === undefined) return read(localSkins);
  if (ownerId !== myId && !otherSkins) return null;
  const owner = players.find((p) => p.playerId === ownerId);
  if (owner) return read(owner.skins);
  return str(skin);
}


export const SYNC_DEBOUNCE_MS = 500;
export const RETRY_MS = 1500;

function readStored() {
  return cleanSkins(loadPref(SKINS_PREF, null));
}

/** The chosen skins (per browser) and the sync state — kept apart from the app store for the same reason the loadout is. */
export const skinsStore = createStore({ entries: readStored(), sync: 'idle' });

/** Replace the whole selection (persisted at once; the sync picks the change up). */
export function setSkins(entries) {
  const next = cleanSkins(entries);
  savePref(SKINS_PREF, next);
  skinsStore.set({ entries: next });
}

/** Choose a skin for one operator. */
const choiceKey = id => { const c = data.lookup('chess', id); return c && !c.isDiy ? c.charId || id : id; };
export function setSkin(chessId, skinId) {
  setSkins({ ...skinsStore.get().entries, [choiceKey(chessId)]: skinId });
}

/** Drop one operator's choice (it goes back to its default model). */
export function clearSkin(chessId) {
  const next = { ...skinsStore.get().entries };
  delete next[choiceKey(chessId)];
  delete next[chessId];
  setSkins(next);
}

/** The skin this browser picked for an operator, or null. */
export const skinFor = (chessId) => skinsStore.get().entries[choiceKey(chessId)] || skinsStore.get().entries[chessId] || null;

/**
 * Every skin of an operator that this install can draw, from the catalogue (data/skins.json).
 *
 * Takes the OPERATOR id (`char_498_inside`), not the chess id (`chess_char_1_01_a`): both data/skins.json and
 * data/assets.json are grouped per operator, while a skin *choice* is stored per chess — see ui/skinPicker.js.
 *
 * Only the subset deployed by this server is offered. A catalogue entry alone never triggers a third-party download
 * or a server-side installation, and missing models are not selectable.
 * @param {string} charId
 * @returns {{ id: string, name: string, group: string }[]}
 */
export function availableSkins(charId) {
  const id = str(charId);
  if (!id) return [];
  const m = data.get('assets');
  const rec = m && isObj(m.chars) ? m.chars[id] : null;
  const catalogue = new Map((data.get('skins')?.chars?.[id] || []).map(s => [s.id, s]));
  // a record without `skins` still has its own appearance (the 默认 row below), because the picker's global display rule
  // shows the section for an operator the plugins wrote no skin for (hasAnySkinChoices, docs/SKINS.md)
  if (!rec) return [];
  const ownIllust = str(rec.illust);
  const ownPortrait = str(rec.portrait);
  const ownAvatar = str(rec.avatar);
  const rows = [];
  for (const [skinId, skin] of Object.entries(isObj(rec.skins) ? rec.skins : {})) {
    if (!str(skinId) || !isObj(skin)) continue;
    const hasModel = skinHasModel(skin);
    const playable = hasModel || skinHasPictures(skin);
    // the tile art: the fixed-size portrait family first (a 1:2 box the grid lines up on), then the illustration, then
    // the avatar; the operator's own portrait when the skin ships none (`fallbackArt`, which the picker draws a little
    // differently so a plugin that replaced only the model is legible)
    const ownArt = str(skin.portrait) || str(skin.portraitE2) || str(skin.illust);
    const portrait = ownArt || ownPortrait;
    const avatar = str(skin.avatar) || str(skin.avatarE2) || str(skin.illust) || ownAvatar;
    const illust = str(skin.illust) || portrait;
    rows.push({
      id: skinId,
      name: str(skin.name) || catalogue.get(skinId)?.name || skinId,
      group: str(skin.group) || catalogue.get(skinId)?.group || '',
      playable,
      pictureOnly: playable && !hasModel,
      portrait,
      avatar,
      illust,
      fallbackArt: !ownArt && !str(skin.avatar) && !str(skin.avatarE2),
      own: false,
    });
  }
  // The operator's OWN appearance, always the first row — even for a record the plugins wrote no `skins` under, because
  // the picker shows the section for every operator as soon as one of them has a skin (hasAnySkinChoices).
  //
  // The art is what a plugin wrote for the operator: its 立绘 `chars[<charId>].illust` when there is one — the picture a
  // plugin replaces for the operator itself (docs/PLUGINS.md §9), which the 默认 tile is the only place to see — else its
  // portrait, else its avatar. Preferring the 立绘 is deliberate: a plugin may give an operator a picture and no skin at
  // all, and that picture must be visible rather than staying in the manifest unread. The tile box is 1:2 and crops to
  // the top, exactly as it already does for a skin that ships only an illust. Never null while the record has any of
  // the three: an empty art box is the one thing this row must not draw.
  rows.unshift({
    id: '', name: '', group: '', playable: true,
    portrait: ownIllust || ownPortrait, avatar: ownAvatar,
    illust: ownIllust || ownPortrait, fallbackArt: false, own: true,
  });
  return rows;
}

/**
 * Whether the composed manifest offers a skin choice ANYWHERE: at least one operator of `data.get('assets').chars` has
 * one wear-able skin. This is the picker's display rule (docs/SKINS.md), and it is GLOBAL on purpose.
 *
 * The rule it replaced (a per-operator one, still available as `hasSkinChoices`) hid the whole section from every
 * operator a plugin wrote no skin for — so a player looking at such an operator could not tell "this operator has no
 * skin" from "the plugin did not load", and the feature read as broken. Since this rule, an operator without a skin
 * shows the section holding its 默认 tile alone: the plugin is plainly on, this operator simply has no look of its own.
 * Do NOT turn this back into a per-operator gate — that is the whole point of the change, and it reverses it.
 *
 * Nothing wearing anything means no section anywhere, keeping the promise that an installation without a cosmetic layer
 * looks exactly as it did before the feature: no plugin, a plugin that writes only pictures (`illust`) and no skin, or
 * only metadata-only skins (no model or pictures to wear).
 *
 * Counted through `hasSkinChoices` (one operator's rows at a time) so the global and the per-operator judgement can
 * never disagree about what a "wear-able skin" is.
 * @returns {boolean}
 */
export function hasAnySkinChoices() {
  const m = data.get('assets');
  const chars = m && isObj(m.chars) ? m.chars : null;
  if (!chars) return false;
  return Object.keys(chars).some((charId) => hasSkinChoices(charId));
}

/**
 * Whether ONE operator has a choice to offer at all: **默认 plus at least one wear-able appearance**.
 *
 * This is NOT the picker's display rule any more (that is `hasAnySkinChoices`, docs/SKINS.md): the section is shown for
 * every operator once one of them has a skin, so the single- 默认 box this returns false for is deliberately drawn.
 * Kept exported as the single-operator criterion — the question a badge, a filter or a future rule would ask, and what
 * `hasAnySkinChoices` is built from.
 *
 * A skin with art but no model counts too (B6); a metadata-only record does not.
 * @param {string} charId
 * @returns {boolean}
 */
export function hasSkinChoices(charId) {
  return availableSkins(charId).some((x) => !x.own && x.playable);
}

/**
 * The appearance this operator really wears for a stored selection, or null (默认).
 *
 * A stored id that is not one of THIS operator's wear-able appearances counts as no choice: the plugin may have been
 * switched off, the skin removed from its overlay, or the entry may name a model this client cannot resolve. The
 * entry itself is left alone — switching the plugin back on brings the appearance back — exactly as the renderer and
 * the server fall back to the default model for a skin they cannot resolve (assets.js spineEntry).
 * @param {string} charId @param {Record<string, string>} [entries] defaults to this browser's live selection
 * @returns {string|null}
 */
export function chosenSkin(charId, entries = null) {
  const id = str(charId);
  if (!id) return null;
  const want = str((entries || skinsStore.get()[SKINS_KEY] || {})[id]);
  if (!want) return null;
  return availableSkins(id).some((x) => !x.own && x.playable && x.id === want) ? want : null;
}

/** Load what the picker needs (the catalogue, and the manifest the avatars and models come from). */
export function loadSkinData() {
  data.load('skins').catch(() => {});
  data.load('assets').catch(() => {});
}

/**
 * Keep the server's copy of this browser's skins current.
 *
 * Mirrors installLoadoutSync, minus the sanitising: the loadout has to be checked against data/chess.json before
 * it is sent (a stale entry would be dropped by the server), whereas a skinId needs no lookup to be sent — the
 * server keeps the entries whose chess it recognises and drops the rest, and an unknown skinId is harmless.
 * @param {{ net: any, settings: any, target?: any, timers?: { setTimeout: Function, clearTimeout: Function } }} deps
 * @returns {{ flush: () => Promise<void>, dispose: () => void }}
 */
export function installSkinsSync({ net, settings, target = skinsStore, timers, content = contentSet, operatorsReady, defaultMapReady = loadDefaultCharMap } = {}) {
  const operators = operatorsReady || (async () => {
    const [chess, backups] = await Promise.all([data.load('chess'), data.load('backups')]);
    return chess == null || backups == null ? null : operatorCharIds({ chess: data.getRaw('chess'), backups: data.getRaw('backups') });
  });
  const T = timers || { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  let timer = null;
  let seq = 0;
  let revision = 0;
  let pendingJson = null;
  let lastSent = null;
  let disposed = false;

  const setState = (sync) => { if (target.get().sync !== sync) target.set({ sync }); };
  const schedule = (ms = SYNC_DEBOUNCE_MS) => {
    if (disposed) return;
    T.clearTimeout(timer);
    setState('pending');
    timer = T.setTimeout(() => { timer = null; void flush(); }, ms);
  };

  async function flush() {
    if (disposed || net.status !== 'online') { setState('idle'); return; }
    if (content?.get?.().status === 'loading') return;
    let preparing = revision;
    try {
      const enabled = settings?.get().skinsEnabled === true;
      const stored = cleanSkins(target.get().entries);
      if (enabled && Object.keys(stored).some(id => id.startsWith('chess_char_') && !id.includes('_diy'))) {
        const map = await defaultMapReady();
        if (disposed || preparing !== revision) return;
        if (!map) { schedule(RETRY_MS); return; }
        const next = {};
        for (const [id, value] of Object.entries(stored)) next[map.toChar.get(id) || id] = value;
        if (JSON.stringify(next) !== JSON.stringify(stored)) {
          if (target === skinsStore) savePref(SKINS_PREF, next);
          target.set({ entries: next });
          preparing = revision;
        }
      }
      // Opt-out withdraws this player's published choice, without erasing the browser's saved selections.
      let skins = enabled ? cleanSkins(target.get().entries) : {};
      if (Object.keys(skins).length) {
        const ids = await operators();
        if (disposed || preparing !== revision) return;
        if (!ids) { schedule(RETRY_MS); return; }
        skins = Object.fromEntries(Object.entries(skins).filter(([id]) => ids.has(id) || data.lookup('chess', id)?.isDiy));
      }
      const json = JSON.stringify(skins);
      if (json === pendingJson) return;
      if (json === lastSent && pendingJson == null) { setState('synced'); return; }
      const my = ++seq;
      pendingJson = json;
      setState('sending');
      try {
        await net.request('room.skins', { skins });
        if (disposed || my !== seq) return;
        pendingJson = null;
        lastSent = json;
        setState('synced');
      } catch (err) {
        if (disposed || my !== seq) return;
        pendingJson = null;
        const code = err && err.code;
        if (code === 'RATE' || code === 'TIMEOUT' || code === 'OFFLINE') { schedule(RETRY_MS); return; }
        console.warn('[skins] room.skins refused', code, err && err.detail);
        setState('error');
      }
    } catch (e) {
      console.warn('[skins] sync failed', e);
      setState('error');
    }
  }

  const offData = data.subscribe((name) => { if (name === 'chess') { revision++; schedule(50); } });
  const offContent = content?.subscribe?.(c => { revision++; if (c.status === 'ready' || c.status === 'idle') schedule(50); });
  const offWelcome = net.on('welcome', () => { revision++; lastSent = null; pendingJson = null; seq++; schedule(50); });
  const offStore = target.subscribe((s, prev) => { if (s.entries !== prev.entries) { revision++; schedule(); } });
  const offSettings = settings?.subscribe((s, prev) => {
    if (s.skinsEnabled === prev.skinsEnabled) return;
    revision++;
    T.clearTimeout(timer);
    timer = null;
    void flush(); // do not leave a disabled skin published behind a debounce
  });

  return {
    flush,
    dispose() {
      disposed = true;
      T.clearTimeout(timer);
      offWelcome?.();
      offStore?.();
      offData?.();
      offContent?.();
      offSettings?.();
    },
  };
}
