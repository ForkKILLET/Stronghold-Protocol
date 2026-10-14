// 干员皮肤：客户端状态与同步 (docs/SKINS.md).
//
// Two different things live here:
//
//   * the CATALOGUE (data/skins.json) — every skin the project knows about: ids, names, series. It carries no URLs.
//   * the FILES (data/assets.json → chars[charId].skins) — the skins whose models this install has. They are all
//     installed ahead of time (tools/install-skins.mjs, tools/fetch-assets.mjs) and served from the CDN, so nothing
//     is installed from inside the game: `availableSkins()` offers every catalogue skin this install can draw.
//
// The choice itself is a plain `{ [chessId]: skinId }` map, persisted per browser in localStorage and mirrored to
// the server through `room.skins` — the same shape and the same wiring as the operator loadout (ui/loadoutSync.js),
// except that this one is PUBLIC: the server puts it in `Match.publicView().players[]`, which is how a teammate
// sees your skin.

import { createStore, loadPref, savePref } from '../store.js';
import { data } from '../data.js';
import { cleanSkins } from '../../../shared/skins.js';

export const SKINS_PREF = 'skins';
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
export function setSkin(chessId, skinId) {
  setSkins({ ...skinsStore.get().entries, [chessId]: skinId });
}

/** Drop one operator's choice (it goes back to its default model). */
export function clearSkin(chessId) {
  const next = { ...skinsStore.get().entries };
  delete next[chessId];
  setSkins(next);
}

/** The skin this browser picked for an operator, or null. */
export const skinFor = (chessId) => skinsStore.get().entries[chessId] || null;

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
  const list = data.get('skins')?.chars?.[charId];
  if (!Array.isArray(list)) return [];
  const files = data.get('assets')?.chars?.[charId]?.skins || {};
  return list.filter((s) => files[s.id]?.spine?.front?.anims).map((s) => ({ id: s.id, name: s.name, group: s.group || '' }));
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
export function installSkinsSync({ net, settings, target = skinsStore, timers } = {}) {
  const T = timers || { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  let timer = null;
  let seq = 0;
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
    try {
      // Opt-out withdraws this player's published choice, without erasing the browser's saved selections.
      const skins = settings?.get().skinsEnabled === true ? cleanSkins(target.get().entries) : {};
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

  const offWelcome = net.on('welcome', () => { lastSent = null; pendingJson = null; seq++; schedule(50); });
  const offStore = target.subscribe((s, prev) => { if (s.entries !== prev.entries) schedule(); });
  const offSettings = settings?.subscribe((s, prev) => {
    if (s.skinsEnabled === prev.skinsEnabled) return;
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
      offSettings?.();
    },
  };
}
