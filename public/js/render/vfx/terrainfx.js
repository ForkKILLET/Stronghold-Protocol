import { boardToUnity } from './math.js';

/** Map-owned loops have their own lifetime: battle resets must not remove preparation terrain effects. */
export class TerrainFx {
  constructor(ofx) { this.ofx = ofx; this.key = null; this.handles = []; }

  update(board, dt) {
    const pack = board?.official;
    const effects = pack?.doc?.tileEffects;
    const key = this.ofx.active && effects ? `${pack.key}|${board.areaKey}|${this.ofx.tier}` : '';
    if (key !== this.key) {
      this.clear(); this.key = key;
      if (key) {
        const grid = board.board?.grid || [];
        // This independent FX renderer does not inherit the 3D canvas's depth buffer.
        // Give its native ZTest materials the visible board's heights, including the bench
        // in front of the road. Hidden field families must not become phantom occluders.
        this.ofx.setGround((r, c) => grid[r]?.[c]?.drawn ? grid[r][c].h : 0, key);
        for (let r = 0; r < grid.length; r++) for (let c = 0; c < grid[r].length; c++) {
          const tile = grid[r][c], effect = effects[tile.glyph];
          if (!tile.drawn || !effect || !this.ofx.lib.has(effect)) continue;
          const handle = this.ofx.spawn(effect, {pos:boardToUnity(c, r, tile.h), groundZ:-tile.h},
            {loop:true, seed:(r * 21 + c + 1) * 97});
          if (handle) this.handles.push({glyph:tile.glyph, handle});
        }
      }
    }
    const visible = new Set(this.handles.filter(({handle})=>handle.effect && !handle.cancelled && !handle.effect.done).map(x=>x.glyph));
    board?.setNativeTerrain?.(visible);
    if (this.ofx.active) this.ofx.update(dt);
  }

  clear() {
    for (const {handle} of this.handles) handle.kill();
    this.handles = []; this.key = null;
    this.ofx.clear();
  }
}
