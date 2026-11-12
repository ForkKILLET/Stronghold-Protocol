import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { presentationStage } from '../../public/js/render/app/stage.js';
import { restView, flightView } from '../../public/js/render/app/view.js';
import { penZones, layoutPen } from '../../public/js/render/pen.js';
import { parseStage } from '../../public/js/render/tiles.js';

const stages = JSON.parse(readFileSync(new URL('../../data/versions/act3autochess-v3_1/stages.json', import.meta.url)));
test('all ten ordinary Regulation maps keep preview beside the unchanged own deployment field', () => {
  let count = 0;
  for (const stage of Object.values(stages).filter(s => s.renderLayouts)) {
    count++;
    const before = JSON.stringify(stage);
    const normal = presentationStage(stage, 'prep');
    const { rect, zones } = penZones(normal);
    assert.deepEqual(rect, { r0: 8, r1: 12, c0: 12, c1: 18 });
    assert.deepEqual(zones.map(z => z.anchor), [[9,12], [12,12]]);
    for (let r = 9; r <= 12; r++) for (let c = 2; c <= 10; c++) {
      assert.equal(normal.tiles[normal.rows[r][c]].tileKey, stage.tiles[stage.rows[r][c]].tileKey, `${stage.id} ${r},${c}`);
    }
    const pen = layoutPen([{ enemyKey: 'enemy_1001', count: 30 }, { enemyKey: 'enemy_1002', count: 25, gate: 'upper' }], { stage: normal });
    assert.ok(pen.figures.length > 0);
    for (const f of pen.figures) {
      assert.ok(f.row >= 8 && f.row <= 12 && f.col >= 12 && f.col <= 18);
      assert.notEqual(f.row, 10, 'separator is not a preview standing tile');
    }
    assert.equal(parseStage(normal, [6,13], [6,13])[8][13].playable, false);
    assert.equal(presentationStage(stage, 'normal'), normal);
    const united = presentationStage(stage, 'unite');
    assert.equal(united.presentationLayout, 'unite-single-bench');
    assert.ok([...united.rows[7]].every(g => united.tiles[g].tileKey === 'tile_forbidden'));
    assert.ok([...united.rows[8]].every(g => ['tile_achand', 'tile_forbidden'].includes(united.tiles[g].tileKey)));
    assert.deepEqual(restView('unite',stage).band,[8,13]);
    assert.equal(presentationStage(stage, 'bossPrep'), stage);
    assert.equal(JSON.stringify(stage), before);
    const view = restView('prep', stage);
    assert.ok(view.area.some(a => a.c0 <= 12 && a.c1 >= 18 && a.r0 <= 8 && a.r1 >= 12));
    assert.deepEqual(flightView('prep', 'normal', stage).band, [6,13]);
  }
  assert.equal(count, 10);
});

test('old seasons retain their grid, preview and camera view contract', () => {
  const stage = { id: 'act2autochess_m01', rows: [] };
  assert.equal(presentationStage(stage, 'prep'), stage);
  assert.deepEqual(restView('prep', stage), restView('prep'));
  assert.deepEqual(flightView('prep','boss',stage), flightView('prep','boss'));
});
