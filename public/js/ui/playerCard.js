// Room card selections use the existing preference-sync engine. Cosmetic IDs only; no account or upload.
import { createStore, loadPref, savePref, useStore, shallowEqual } from '../store.js';
import { data, useData } from '../data.js';
import { useMemo } from '../../vendor/hooks.module.js';
import { CARD_ROSTER, parseCardRoster } from '../../../shared/cardRoster.js';
import { cleanPlayerCard } from '../../../shared/playerCard.js';
import { cardOperators, cardContext, cardGroups, rosterOperators, withCardZh } from './seatArt.js';
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
export function installCardSync({ net, target = cardStore, timers, content, getChessReady = () => data.load('chess'),
  getBackupsReady = () => data.load('backups'), listChess = () => data.list('chess'), listBackups = () => data.get('backups'),
  getRosterReady = () => data.status(CARD_ROSTER) === 'missing' ? data.invalidate(CARD_ROSTER) : data.load(CARD_ROSTER),
  listRoster = () => data.getRaw(CARD_ROSTER), watchRoster = (fn) => data.subscribe((name) => {
    if (name === CARD_ROSTER && data.status(name) === 'ready') fn();
  }) } = {}) {
  let rosterBlocked = false;
  const sync = installPrefSync({
    net, timers, content, seatBound: false, target, key: ['charId', 'avatar'], stateKey: 'sync', msgType: 'room.card', field: null, tag: 'card',
    async prepare() {
      rosterBlocked = false;
      const want = cleanPlayerCard(target.get());
      if (!want.charId && !want.avatar) return want;
      if (await getChessReady() == null) return null;
      let ids = new Set(cardOperators(listChess()).map((c) => c.charId));
      const known = () => Object.values(want).every((id) => !id || ids.has(id.split('@')[0]));
      if (!known()) {
        if (await getBackupsReady() == null) return null;
        ids = new Set(cardOperators(listChess(), listBackups()).map((c) => c.charId));
      }
      if (!known()) {
        if (await getRosterReady() == null) { rosterBlocked = true; return null; }
        for (const id of parseCardRoster(listRoster())?.ids || []) ids.add(id);
      }
      return cleanPlayerCard(want, (id) => ids.has(id));
    },
  });
  const offRoster = watchRoster(() => { if (rosterBlocked) { rosterBlocked = false; void sync.flush(); } });
  return { flush: sync.flush, dispose() { offRoster?.(); sync.dispose(); } };
}

/** Share the room's official-period card roster without changing its gameplay data. */
export function useCardOptions(version) {
  const ready = useData('chess', 'backups', 'assets');
  useData(CARD_ROSTER);
  const locale = data.locale(), rosterState = data.status(CARD_ROSTER);
  return useMemo(() => {
    const list = withCardZh(cardOperators(data.list('chess'), data.get('backups')), cardOperators(data.listRaw('chess'), data.getRaw('backups')));
    const others = rosterOperators(data.getRaw(CARD_ROSTER), { exclude: new Set(list.map((c) => c.charId)), lang: locale, localeName: (s) => data.localeName(s) });
    return { ...cardContext(list, { extra: others, pending: !ready || !['ready', 'missing'].includes(rosterState) }), ready, list: [...list, ...others],
      groups: cardGroups(list, others, version), m: data.get('assets'), rosterState };
  }, [ready, locale, version, rosterState, data.get('chess'), data.get('backups'), data.getRaw(CARD_ROSTER)]);
}
