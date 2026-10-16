// Room card selections use the existing preference-sync engine. Cosmetic IDs only; no account or upload.
import { createStore, loadPref, savePref, useStore, shallowEqual } from '../store.js';
import { data } from '../data.js';
import { cleanPlayerCard } from '../../../shared/playerCard.js';
import { cardOperators } from './seatArt.js';
import { installPrefSync } from './loadoutSync.js';

export const CARD_PREF = 'room.card';
export const cardStore = createStore({ ...cleanPlayerCard(loadPref(CARD_PREF, null)), sync: 'idle', open: false });

export function setPlayerCard(patch) {
  const next = cleanPlayerCard({ ...cardStore.get(), ...patch });
  savePref(CARD_PREF, next);
  cardStore.set(next);
}
export const setCardOperator = (charId) => setPlayerCard({ charId });
export const setCardAvatar = (avatar) => setPlayerCard({ avatar });
export const useMyCard = () => useStore((s) => s, shallowEqual, cardStore);

/** Re-send after every welcome (including reconnect); ordered sends, retries and stale-await guards are shared. */
export function installCardSync({ net, target = cardStore, timers, ready = () => data.load('chess'), operators = () => cardOperators(data.list('chess')) } = {}) {
  return installPrefSync({
    net, timers, target, key: ['charId', 'avatar'], stateKey: 'sync', msgType: 'room.card', field: null, tag: 'card',
    prepare: async () => {
      if (!target.get().charId && !target.get().avatar) return cleanPlayerCard(null);
      if (await ready() == null) return null; // never erase a selection because game data is unavailable
      const ids = new Set(operators().map((c) => c.charId));
      return cleanPlayerCard(target.get(), (id) => ids.has(id));
    },
  });
}
