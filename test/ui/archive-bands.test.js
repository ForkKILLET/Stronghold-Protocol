import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createArchiveBandCatalog } from '../../public/js/ui/archiveBands.js';

test('archive strategies resolve old and current IDs from official tables without loading gameplay or assets', async () => {
  const requests = [];
  const catalog = createArchiveBandCatalog({ fetch: async url => {
    requests.push(url);
    return Response.json(JSON.parse(readFileSync(new URL(`../..${url}`, import.meta.url), 'utf8')));
  } });
  const ids = ['band_chiave', 'band_bldsk', 'band_duyaoy', 'band_orchid', 'band_zumama', 'band_survive',
    'band_mess', 'band_mech', 'band_bonus', 'band_siracusa'];
  const versions = ['act1autochess', 'act3autochess@V3_1'];
  const found = await catalog(ids, versions);
  assert.deepEqual(ids.map(id => found[id]?.name), ['贾维', '华法琳', '杜遥夜', '梓兰', '森蚺', '百炼嘉维尔', '昆图斯', '森蚺', '复奏', '裁度']);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(url => url.endsWith('/bands.json')));
  await catalog(ids, versions);
  assert.equal(requests.length, 3, 'tables are shared between archive openings');
});

test('archive lookup stops after resolving IDs and never requests an unavailable or unknown version', async () => {
  const requests = [];
  const catalog = createArchiveBandCatalog({ fetch: async url => {
    requests.push(url);
    return Response.json(JSON.parse(readFileSync(new URL(`../..${url}`, import.meta.url), 'utf8')));
  } });
  assert.equal((await catalog(['band_chiave'], ['act3autochess@V3_1'])).band_chiave.name, '贾维');
  assert.equal(requests.length, 1, 'default strategy table is sufficient');
  assert.deepEqual(await catalog(['band_unknown'], ['unavailable-version']), {});
  assert.equal(requests.length, 1);
});
