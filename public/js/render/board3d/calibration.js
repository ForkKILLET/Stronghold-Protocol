// Empirical presentation calibration against PRTS's Regulation screenshots (2026-11-12).
// These are visual fits, not recovered official runtime values. Native assets remain unchanged.
// Keep one profile per map for every phase, and one shared sand mix across the desert theme.
export const REGULATION_SAND_BLEND = 0.625;
export const REGULATION_LIGHT = Object.freeze({
  act3autochess_m01: Object.freeze([0.94047, 0.97291, 1.14225]),
  act3autochess_m02: Object.freeze([0.93759, 0.96852, 1.13915]),
  act3autochess_m03: Object.freeze([0.94385, 0.9753, 1.14331]),
  act3autochess_m04: Object.freeze([0.93796, 0.96726, 1.14487]),
  act3autochess_m05: Object.freeze([1.0831, 1.1037, 1.16621]),
  act3autochess_m06: Object.freeze([0.94732, 0.97868, 1.14599]),
  act3autochess_m09: Object.freeze([1.01305, 1.01498, 1.02472]),
  act3autochess_m10: Object.freeze([1.02014, 1.08659, 1.26364]),
  act3autochess_m11: Object.freeze([1.01324, 1.01621, 1.02427]),
  act3autochess_m12: Object.freeze([1.00417, 1.07539, 1.28119]),
});

export function sceneCalibration(stage, doc, material) {
  const light = doc?.layout === 'regulation-composite-v1' && Object.hasOwn(REGULATION_LIGHT, stage) && REGULATION_LIGHT[stage];
  if (!light) return null;
  return { light, blend: material === 'MT_AutochessSand' ? REGULATION_SAND_BLEND : null };
}
