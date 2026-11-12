import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sceneGroupVisible } from '../public/js/render/board3d/scene.js';
import { AREAS, classifyStage } from '../public/js/render/board3d/layout.js';
import { sceneGroupRects } from '../public/js/render/board3d/load.js';
import { parseStage } from '../public/js/render/tiles.js';
import { isBoardResourceJson } from '../shared/resourcePaths.js';

const TOOL = fileURLToPath(new URL('../tools/local-extract', import.meta.url));
const PY = ['python3', 'python'].find(bin => spawnSync(bin, ['--version']).status === 0);
const py = code => {
  const r = spawnSync(PY, ['-I', '-B', '-c', `import sys,json\nsys.path.insert(0,${JSON.stringify(TOOL)})\nimport regulation_scenes as s\n${code}`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test('clipping preserves both halves of a crossing triangle and interpolates UV/lightmap/colour at the seam', { skip: !PY }, () => {
  const out = py(`p={'material':'stone','lightmap':0,'pos':[(0,0,0),(2,0,0),(0,2,0)],
 'uv':[(0,0),(1,0),(0,1)],'uv1':[(0,0),(.5,0),(0,.5)],
 'nrm':[(0,0,1)]*3,'col':[(0,0,0,1),(1,0,0,1),(0,1,0,1)],'idx':[0,1,2]}
def area(p):
 return sum(abs((p['pos'][i+1][0]-p['pos'][i][0])*(p['pos'][i+2][1]-p['pos'][i][1])-(p['pos'][i+1][1]-p['pos'][i][1])*(p['pos'][i+2][0]-p['pos'][i][0]))/2 for i in range(0,len(p['idx']),3))
a=s.clip_part(p,(None,None),(None,1),7)
b=s.clip_part(p,(None,None),(1,None),7)
print(json.dumps({'areas':[area(a),area(b)],'left':a,'right':b}))`);
  assert.deepEqual(out.areas, [1.5, 0.5]);
  for (const [name, c] of [['left', out.left], ['right', out.right]]) {
    assert.ok(c.pos.some(p => p[0] === 1), 'intersection vertices are retained');
    c.pos.forEach(([x, y], i) => {
      assert.ok(name === 'left' ? x <= 1 : x >= 1);
      assert.deepEqual(c.uv[i], [x / 2, (y - 7) / 2]);
      assert.deepEqual(c.uv1[i], [x / 4, (y - 7) / 4]);
      assert.deepEqual(c.col[i], [x / 2, (y - 7) / 2, 0, 1]);
      assert.deepEqual(c.nrm[i], [0, 0, 1]);
    });
  }
});

test('Regulation owners follow normal/unite/Boss areas independently of background and mountain bounds', { skip: !PY }, () => {
  const groups = py('print(json.dumps(s.GROUP_RECTS))');
  const visible = area => Object.entries(groups).filter(([g, rect]) => sceneGroupVisible(rect, area, g)).map(([g]) => g.replace('regulation:', '')).sort();
  assert.deepEqual(visible(AREAS.normal), ['backgroundNormal', 'normal']);
  assert.deepEqual(visible(AREAS.unite), ['backgroundUnite', 'unite']);
  assert.deepEqual(visible(AREAS.boss), ['backgroundBoss', 'boss']);
  assert.deepEqual(visible(AREAS.all), ['backgroundBoss', 'boss']);
});

test('post-clip indexing retains complete vertex records and triangle order exactly', { skip: !PY }, () => {
  const out = py(`import scenes,struct
p={'pos':[(0,0,0),(1,0,0),(0,1,0),(0,0,0),(0,1,0),(1,1,0)],
 'uv':[(0,0),(1,0),(0,1),(0,0),(0,1),(1,1)],'uv1':[(0,0)]*6,
 'nrm':[(0,0,1)]*6,'col':[(1,1,1,1)]*6,'idx':list(range(6))}
blob,index32=scenes.pack_chunk(p)
records=[{'verts':6,'tris':2,'offset':0,'index32':index32,'material':'stone','lightmap':0,'group':'hand'}]
changed,packed=s.compact_chunks(records,blob)
def expanded(rec,blob):
 n=rec['verts'];starts=[rec['offset']+n*x for x in (0,12,20,28,32)]
 idx=struct.unpack_from('<' + ('I' if rec['index32'] else 'H')*(rec['tris']*3),blob,rec['offset']+n*36)
 return [b''.join(blob[st+i*w:st+(i+1)*w] for st,w in zip(starts,(12,8,8,4,4))).hex() for i in idx]
print(json.dumps({'verts':changed[0]['verts'],'same':expanded(records[0],blob)==expanded(changed[0],packed),
 'smaller':len(packed)<len(blob),'aligned':len(packed)%4==0}))`);
  assert.deepEqual(out, { verts: 4, same: true, smaller: true, aligned: true });
});

test('large scene transport splits fit existing ZIP packs and rejoin byte-for-byte', { skip: !PY }, () => {
  const out = py(`import tempfile,hashlib
from pathlib import Path
blob=bytes(range(251))*120000
with tempfile.TemporaryDirectory() as temp:
 parts=s.write_scene_bins(Path(temp),blob)
 joined=b''.join((Path(temp)/p['name']).read_bytes() for p in parts)
 print(json.dumps({'sizes':[p['bytes'] for p in parts],'keys':[p['key'] for p in parts],
 'same':hashlib.sha256(joined).digest()==hashlib.sha256(blob).digest()}))`);
  assert.deepEqual(out, { sizes: [15_000_000, 15_000_000, 120_000], keys: ['bin', 'bin1', 'bin2'], same: true });
});

test('logical group rectangles override decorative bounds only in composite packs, and reject malformed metadata', () => {
  const chunks = [{ group: 'regulation:roadRight', bounds: [-20, -10, 0, 40, 30, 3] }];
  const groupRects = { 'regulation:roadRight': [11, 9, 20, 13], 'HIDDEN@1': [0, 0, 1, 1], 'regulation:bad': [2, 3, 0, 1] };
  assert.deepEqual(sceneGroupRects(chunks, { groupRects }), { 'regulation:roadRight': [-20, -10, 40, 30] });
  assert.deepEqual(sceneGroupRects(chunks, { layout: 'regulation-composite-v1', groupRects }), { 'regulation:roadRight': [11, 9, 20, 13] });
});

test('official scene heights align high ground and both benches without changing fallback / old maps', () => {
  const rows = Array.from({ length: 19 }, () => 'r'.repeat(21));
  rows[7] = 'aAh' + 'r'.repeat(18);
  const stage = { id: 'act3autochess_m09', rows };
  const classes = { wall: 0.4, bench: 0.4 };
  assert.deepEqual(parseStage(stage, undefined, undefined, classes)[7].slice(0, 3).map(t => t.h), [0.4, 0.4, 0.4]);
  assert.deepEqual(classifyStage(stage, null, classes)[7].slice(0, 3).map(t => t.h), [0.4, 0.4, 0.4]);
  assert.deepEqual(parseStage(stage)[7].slice(0, 3).map(t => t.h), [0.16, 0.16, 0.42]);
  assert.deepEqual(rows[7], 'aAh' + 'r'.repeat(18), 'presentation never rewrites the stage');
});

test('resource JSON boundary admits exactly the ten Regulation scene IDs', () => {
  for (const i of [1, 2, 3, 4, 5, 6, 9, 10, 11, 12]) {
    assert.equal(isBoardResourceJson(`/assets/local/scene/act3autochess_m${String(i).padStart(2, '0')}/scene.json`), true);
  }
  for (const i of ['00', '07', '08', '13', '101', '9']) {
    assert.equal(isBoardResourceJson(`/assets/local/scene/act3autochess_m${i}/scene.json`), false);
  }
  assert.equal(isBoardResourceJson('/assets/local/scene/act3autochess_m09/config.json'), false);
  assert.equal(isBoardResourceJson('/build/assets/local/scene/act3autochess_m09/scene.json'), false);
});
