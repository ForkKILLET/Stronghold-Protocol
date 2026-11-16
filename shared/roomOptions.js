export const BATTLE_SPEEDS = Object.freeze([1, 2, 3, 4]);
export const isBattleSpeed = (v) => v == null || BATTLE_SPEEDS.includes(v);
export const normalizeBattleSpeed = (v) => BATTLE_SPEEDS.includes(v) ? v : 2;

export const PAUSE_MODES = Object.freeze(['vote', 'veto']);
export const isPauseMode = (v) => v === undefined || PAUSE_MODES.includes(v);
export const normalizePauseMode = (v, fallback = 'vote') => PAUSE_MODES.includes(v) ? v : fallback;
