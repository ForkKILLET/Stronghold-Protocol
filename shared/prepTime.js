// Room-local preparation limit. null uses game data; 0 is untimed.
export const PREP_MIN_SECONDS = 30;
export const PREP_MAX_SECONDS = 600;
export function isPrepSeconds(value) {
  return value == null || value === 0 || (Number.isInteger(value) && value >= PREP_MIN_SECONDS && value <= PREP_MAX_SECONDS);
}
export function normalizePrepSeconds(value) { return isPrepSeconds(value) ? value ?? null : null; }

// Multiplier is the preferred UI; keep prepSeconds for older custom clients.
export const PREP_MIN_MULTIPLIER = 0.5;
export const PREP_MAX_MULTIPLIER = 4;
export function isPrepMultiplier(value) {
  return value == null || value === 0 || (Number.isFinite(value) && value >= PREP_MIN_MULTIPLIER && value <= PREP_MAX_MULTIPLIER && Number.isInteger(value * 4));
}
export function normalizePrepMultiplier(value) { return isPrepMultiplier(value) && value !== 1 ? value ?? null : null; }
