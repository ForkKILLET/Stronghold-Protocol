// Presentation grids retain Regulation's native right preview and single-row unite bench. Simulation,
// preparation input and replay coordinates stay canonical; the displayed battle road cells keep their coordinates.
const normalStages = new WeakMap();
const uniteStages = new WeakMap();
export function presentationStage(stage, kind) {
  if (kind === 'unite' && stage?.renderLayouts?.unite) {
    let out = uniteStages.get(stage);
    if (!out) {
      const layout = stage.renderLayouts.unite;
      out = { ...stage, rows: layout.rows.map((row, r) => r <= 6 ? stage.rows[r] : row),
        tiles: { ...stage.tiles, ...layout.tiles }, presentationLayout: 'unite-single-bench',
        devices: (stage.devices || []).filter(d => d.pos?.[0] >= 8) };
      uniteStages.set(stage, out);
    }
    return out;
  }
  const layout = stage?.renderLayouts?.normal;
  if (!layout || !['prep', 'normal', 'pen'].includes(kind)) return stage;
  let out = normalStages.get(stage);
  if (!out) {
    out = { ...stage, rows: layout.rows.map((row, r) => r <= 6 ? stage.rows[r] : row),
      tiles: { ...stage.tiles, ...layout.tiles }, config: { ...stage.config, ...layout.config },
      presentationLayout: 'normal-right-preview',
      devices: (stage.devices || []).filter(d => d.pos?.[0] <= 6 || d.pos?.[1] <= 10) };
    normalStages.set(stage, out);
  }
  return out;
}
