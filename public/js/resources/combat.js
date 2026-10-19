// Battle-aware bulk-preload gate. Does not pause simulation, runtime asset fetching, ZIP operations or user settings.
import { PHASE } from '../../../shared/constants.js';

const FIGHTING = new Set([PHASE.COMBAT, PHASE.UNITE, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE]);

/** Public phases cover server-streamed combat, spectators, paused fights and an own field already finished. */
export function resourceCombatActive(state) {
  if (!state?.session?.entered) return false;
  const match = state.match;
  const phase = match?.public?.phase;
  if (FIGHTING.has(phase)) return true;
  const battle = match?.battle;
  // b.start may arrive before m.public, including the async simulation-loading interval.
  // A completed/stale battle record must not hold preload through prep, settlement or the result page.
  return !!battle?.battleId && battle.done !== true && (!phase || battle.loading === true);
}

/** All room/game phases reserve storage for the renderer, not just combat. */
export function resourceCheckBlocked(state) {
  return !!(state?.room || state?.match?.public || state?.match?.battle?.battleId
    || state?.ui?.matchQueue || state?.ui?.pendingJoin || state?.ui?.restoring);
}

/** Install before syncing enabled settings so a page restored into a fight cannot briefly start bulk downloads. */
export function bindResourceCombat(store, resources, onError = () => {}) {
  let last, lastCheck;
  const sync = state => {
    const blocked = resourceCheckBlocked(state);
    if (blocked !== lastCheck) {
      lastCheck = blocked;
      resources.setResourceCheckBlocker?.('session', blocked);
    }
    const active = resourceCombatActive(state);
    if (active === last) return;
    last = active;
    Promise.resolve(resources.syncResourceCombat(active)).catch(onError);
  };
  const off = store.subscribe(sync);
  sync(store.get());
  return off;
}
