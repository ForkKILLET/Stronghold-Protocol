"""Regulation's three MapGraphic prefabs composed onto the existing 19x21 board.

Own-field coordinates follow tools/versions/layouts.mjs; ordinary views retain sub_01 and its right preview. Clip polygons at the actual ownership planes, never
discard triangles by centroid: shared baked meshes may cross a seam. Keep interpolated UVs, lightmap UVs,
normals and colours. Background / baked shadow geometry is owned once per visible field family.
"""
import gc
import hashlib
import json
import math
import shutil
import struct
import tempfile
from pathlib import Path

STAGES = tuple(f'act3autochess_m{i:02d}' for i in (1, 2, 3, 4, 5, 6, 9, 10, 11, 12))
# Same binary vertex layout, new composition semantics. Older pages must keep their procedural board rather
# than drawing these chunks without their ownership / height metadata during a resources-first rollout.
SCENE_VERSION = 2
# source part, row interval, column interval, row offset, logical owner rect (x0,y0,x1,y1).
# Unbounded outer edges keep the island's decorative silhouette; seams between owned rows are exact.
REGIONS = {
    'normal': (1, (None, None), (None, None), 7, [0, 9, 10, 13]),
    'unite': (2, (None, None), (None, None), 8, [0, 9, 20, 13]),
    'boss': (3, (None, None), (None, None), 0, [0, 0, 20, 6]),
}
GROUP_RECTS = {f'regulation:{name}': rec[4] for name, rec in REGIONS.items()}
GROUP_RECTS.update({'regulation:backgroundNormal': [0, 9, 10, 13],
                    'regulation:backgroundUnite': [0, 9, 20, 13],
                    'regulation:backgroundBoss': [0, 0, 20, 6]})


def compact_chunks(records, blob):
    """Index identical complete 36-byte vertices after clipping. Every attribute stays byte-for-byte identical.

    Never merge across material/lightmap/owner chunks; only redundant attribute storage changes, not triangles.
    Also used when finishing an isolated staged extraction made before this indexing pass was added.
    """
    out, packed = [], bytearray()
    widths = (12, 8, 8, 4, 4)
    for rec in records:
        n, offset = rec['verts'], rec['offset']
        starts, at = [], offset
        for width in widths:
            starts.append(at)
            at += n * width
        code = 'I' if rec['index32'] else 'H'
        indices = struct.unpack_from('<' + code * (rec['tris'] * 3), blob, at)
        unique, arrays, rewritten = {}, [bytearray() for _ in widths], []
        for vi in indices:
            attrs = tuple(bytes(blob[start + vi * width:start + (vi + 1) * width]) for start, width in zip(starts, widths))
            key = b''.join(attrs)
            idx = unique.get(key)
            if idx is None:
                idx = len(unique)
                unique[key] = idx
                for target, value in zip(arrays, attrs):
                    target.extend(value)
            rewritten.append(idx)
        index32 = len(unique) > 65535
        out.append({**rec, 'offset': len(packed), 'verts': len(unique), 'index32': index32})
        for arr in arrays:
            packed.extend(arr)
        packed.extend(struct.pack('<' + ('I' if index32 else 'H') * len(rewritten), *rewritten))
        packed.extend(b'\0' * ((-len(packed)) % 4))
    return out, packed


def prefab_bundle(stage, part):
    stem = f'level_{stage}_sub_{part:02d}'
    return f'battle/prefabs/levelprefabs/activities/act3autochess/level_{stage}/{stem}/{stem}.ab'


def native_dependencies(ab_root):
    """Unity's actual built-in cube/plane meshes, never a guessed replacement. Also handles client_bundles links."""
    root = Path(ab_root)
    directories = [root.parents[2] / 'Resources']
    index = root / 'hot_update_list.json'
    if index.is_file():
        directories.append(index.resolve().parents[2] / 'Resources')
    out = {}
    for name in ('unity default resources', 'unity_builtin_extra'):
        source = next((d / name for d in directories if (d / name).is_file()), None)
        if source:
            out[name] = str(source)
    return out


def load_dependencies(env, cabs):
    """Load each available external CAB once, including transitive shader and material references."""
    loaded = set()
    while True:
        pending = set()
        for file in {obj.assets_file for obj in env.objects}:
            for ext in file.externals:
                key = ext.path.replace('\\', '/').rsplit('/', 1)[-1].lower()
                if key in cabs and cabs[key] not in loaded:
                    pending.add(cabs[key])
        if not pending:
            break
        for path in sorted(pending):
            loaded.add(path)
            env.load_file(str(path))


def _interpolate(a, b, t):
    return {key: tuple(x + (y - x) * t for x, y in zip(a[key], b[key])) for key in a}


def clip_polygon(poly, axis, value, keep_above):
    """Sutherland-Hodgman plane clipping with all surface attributes, including exact seam intersections."""
    if value is None or not poly:
        return poly
    out = []
    a = poly[-1]
    da = (a['pos'][axis] - value) * (1 if keep_above else -1)
    for b in poly:
        db = (b['pos'][axis] - value) * (1 if keep_above else -1)
        if (da >= 0) != (db >= 0):
            out.append(_interpolate(a, b, da / (da - db)))
        if db >= 0:
            out.append(b)
        a, da = b, db
    return out


def clip_part(part, rows, cols, dr):
    """A clipped and translated mesh part. No grid snapping, triangle-centre culling or normal rotation."""
    attrs = ('pos', 'uv', 'uv1', 'nrm', 'col')
    out = {key: [] for key in (*attrs, 'idx')}
    out.update(material=part['material'], lightmap=part['lightmap'])
    for at in range(0, len(part['idx']), 3):
        poly = [{key: part[key][i] for key in attrs} for i in part['idx'][at:at + 3]]
        for axis, limits in [(0, cols), (1, rows)]:
            poly = clip_polygon(poly, axis, limits[0], True)
            poly = clip_polygon(poly, axis, limits[1], False)
        if len(poly) < 3:
            continue
        # Fan triangulation of a convex clipped triangle; omit only zero-area seam fragments.
        for i in range(1, len(poly) - 1):
            tri = [poly[0], poly[i], poly[i + 1]]
            a, b, c = (v['pos'] for v in tri)
            ab, ac = [b[k] - a[k] for k in range(3)], [c[k] - a[k] for k in range(3)]
            area = sum((ab[(k + 1) % 3] * ac[(k + 2) % 3] - ab[(k + 2) % 3] * ac[(k + 1) % 3]) ** 2 for k in range(3))
            if area <= 1e-20:
                continue
            for v in tri:
                out['idx'].append(len(out['pos']))
                for key in attrs:
                    value = v[key]
                    if key == 'pos':
                        value = (value[0], value[1] + dr, value[2])
                    elif key == 'nrm':
                        norm = math.sqrt(sum(x * x for x in value)) or 1
                        value = tuple(x / norm for x in value)
                    out[key].append(value)
    return out


class SourceAdapter:
    def __init__(self, part, bundle, version):
        self.part = part
        with bundle.open('rb') as stream:
            digest = hashlib.sha256()
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
        self.receipt = {'part': part, 'clientVersion': version, 'bundleSha256': digest.hexdigest()}
        self.lightmap_renderers = {}
        self.lightmap_pages = {}

    def prepare(self, scene_objects, objects, world, tf_of_go):
        graphics = []
        for obj in scene_objects:
            if obj.type.name != 'MonoBehaviour':
                continue
            tree = obj.read_typetree()
            if '_mapSettings' in tree:
                self.receipt['mapSettings'] = tree['_mapSettings']
                self.receipt['effects'] = tree['_effectSettings']
            if '_gridPos' in tree:
                grid = tree['_gridPos']
                mat = world(tf_of_go[tree['m_GameObject']['m_PathID']])
                # Regular tile graphic origins pin the frame; decorative meshes may deliberately have off-centre
                # pivots. Keep every original transform rather than snapping those pivots onto their gridPos.
                error = max(abs(mat[0][3] - grid['col']), abs(mat[1][3] - grid['row']))
                graphics.append({'row': grid['row'], 'col': grid['col'], 'error': error})
            if 'm_RendererInfo' not in tree:
                continue
            for rec in tree['m_RendererInfo']:
                st = rec['lightmapOffsetScale']
                self.lightmap_renderers[rec['renderer']['m_PathID']] = (
                    rec['lightmapIndex'], tuple(st[k] for k in 'xyzw'))
            for i, ptr in enumerate(tree['m_Lightmaps']):
                page = objects[ptr['m_PathID']].read()
                self.lightmap_pages.setdefault(i, {})['light'] = page
            for i, ptr in enumerate(tree['m_ShadowMasks']):
                if ptr['m_PathID']:
                    self.lightmap_pages.setdefault(i, {})['shadowmask'] = objects[ptr['m_PathID']].read()
        if not graphics or 'mapSettings' not in self.receipt or not self.lightmap_renderers:
            raise ValueError(f'part {self.part}: missing MapGraphic or baked lighting metadata')
        self.receipt['tileGraphics'] = len(graphics)
        errors = sorted(g['error'] for g in graphics)
        self.receipt['medianGridOriginError'] = errors[len(errors) // 2]
        self.receipt['maxGraphicPivotOffset'] = errors[-1]
        # [ASSUMED] Extraction guard, not a game rule. The desert sub_02 / sub_03 author their tile meshes with
        # 0.00573 / 0.02741 column pivot offsets (the bench has a different pivot), so preserve those transforms.
        # A majority within 0.05 tile confirms the frame without misclassifying these original art offsets.
        if self.receipt['medianGridOriginError'] > 0.05:
            raise ValueError(f'part {self.part}: tile origins do not confirm the expected board frame')

    def parts(self, renderer):
        path = renderer['path']
        def backdrop(p):
            pos = p['pos']
            return pos and max(max(v[a] for v in pos) - min(v[a] for v in pos) for a in (0, 1)) > 30 \
                and max(v[2] for v in pos) - min(v[2] for v in pos) < 1
        if '/Background/' in path or '/Shadow/' in path or any(backdrop(p) for p in renderer['parts']):
            group, dr = {1: ('backgroundNormal', 7), 2: ('backgroundUnite', 8), 3: ('backgroundBoss', 0)}[self.part]
            return [(f'regulation:{group}', clip_part(p, (None, None), (None, None), dr)) for p in renderer['parts']]
        out = []
        for name, (part, rows, cols, dr, _) in REGIONS.items():
            if part != self.part:
                continue
            for p in renderer['parts']:
                rr = (None, None) if name == 'unite' and '/S_outworld/' in path else rows
                clipped = clip_part(p, rr, cols, dr)
                if clipped['idx']:
                    out.append((f'regulation:{name}', clipped))
        return out


class StaticDeviceAdapter:
    """Bake a level's fixed MeshAnimator graphic, not its selectors, debug meshes or gameplay abilities."""
    def __init__(self, key, devices):
        self.key, self.devices = key, devices
        self.receipt = {'device': key, 'positions': [d['pos'] for d in devices]}
        self.lightmap_renderers, self.lightmap_pages = {}, {}

    def prepare(self, *args):
        pass

    def accept_renderer(self, path):
        return path.startswith(self.key + '/Graphic/')

    def parts(self, renderer):
        out = []
        for d in self.devices:
            r, c = d['pos']
            groups = ['boss'] if r <= 6 else ['normal', 'unite'] if c <= 10 else ['unite']
            angle = {'UP': 0, 'LEFT': math.pi / 2, 'DOWN': math.pi, 'RIGHT': -math.pi / 2}[d['dir']]
            ca, sa = math.cos(angle), math.sin(angle)
            for p in renderer['parts']:
                copy = {**p, 'lightmap': -1}
                copy['pos'] = [(x * ca - y * sa + c, x * sa + y * ca + r, z) for x, y, z in p['pos']]
                copy['nrm'] = [(x * ca - y * sa, x * sa + y * ca, z) for x, y, z in p['nrm']]
                out.extend((f'regulation:{group}', copy) for group in groups)
        return out


def stage_tile_effects(ab_root):
    """Effect identities are serialized on the client Tile prefab, independent of the map's static floor."""
    import aklz4  # noqa: F401
    import UnityPy
    env = UnityPy.load(str(Path(ab_root) / 'battle/prefabs/[uc]tiles.ab'))
    effects = {}
    for obj in env.objects:
        if obj.type.name == 'MonoBehaviour':
            tree = obj.read_typetree()
            if tree.get('_tileKey') and tree.get('_effect'):
                effects[tree['_tileKey']] = tree['_effect'].lower()
    return effects


def export_regulation(stage, ab_root, out_root, manifest, log, material_info, cabs):
    from scenes import export_scene, SCENE_EXTRACT_VERSION, SCENE_SUB, TEX_SUB
    root, out = Path(ab_root), Path(out_root)
    sources = [root / prefab_bundle(stage, i) for i in (1, 2, 3)]
    missing = [str(p.relative_to(root)) for p in sources if not p.is_file()]
    if missing:
        raise ValueError(f'{stage}: active client lacks MapGraphic bundles: {missing}')
    version = json.loads((root / 'hot_update_list.json').read_text(encoding='utf-8'))['versionId']
    combined = {'version': SCENE_VERSION, 'stage': stage, 'layout': 'regulation-composite-v1',
                'groups': sorted(GROUP_RECTS), 'groupRects': GROUP_RECTS, 'materials': {}, 'chunks': [], 'sources': []}
    blob = bytearray()
    pages, entries = 0, {}
    # Stage outside the installation: a missing material or incomplete part must not advertise a half scene.
    with tempfile.TemporaryDirectory(prefix='sp-regulation-scene-') as temporary:
        work = Path(temporary)
        local = {}
        for part, src in enumerate(sources, 1):
            part_id = f'{stage}_sub_{part:02d}'
            adapter = SourceAdapter(part, src, version)
            written = export_scene(part_id, [], src, root, work, local, log, material_info,
                                   source_adapter=adapter, cab_index=cabs)
            if not written:
                raise ValueError(f'{stage}: part {part} did not export')
            folder = work / SCENE_SUB / part_id
            doc = json.loads((folder / 'scene.json').read_text(encoding='utf-8'))
            if any(chunk['lightmap'] >= doc['lightmaps'] for chunk in doc['chunks']) or any(
                    not (folder / f'lm{i}.png').is_file() for i in range(doc['lightmaps'])):
                raise ValueError(f'{stage}: part {part} has missing lightmap pages')
            combined['sources'].append({**doc['source'], 'bundle': prefab_bundle(stage, part)})
            for name, info in doc['materials'].items():
                if name in combined['materials'] and combined['materials'][name] != info:
                    raise ValueError(f'{stage}: material name collision: {name}')
                for key in ('map', 'normalMap', 'glossMap', 'emissionMap'):
                    if info.get(key) and info[key] not in local.get(TEX_SUB, {}):
                        raise ValueError(f'{stage}: {name} has missing {key}')
                combined['materials'][name] = info
            for chunk in doc['chunks']:
                combined['chunks'].append({**chunk, 'offset': chunk['offset'] + len(blob),
                                           'lightmap': chunk['lightmap'] + pages if chunk['lightmap'] >= 0 else -1})
            blob.extend((folder / 'scene.bin').read_bytes())
            for i in range(doc['lightmaps']):
                rec = local[f'{SCENE_SUB}/{part_id}'][f'lm{i}']
                name = f'lm{pages + i}{Path(rec["path"]).suffix}'
                shutil.copyfile(folder / Path(rec['path']).name, work / name)
                entries[f'lm{pages + i}'] = {**rec, 'path': f'/assets/local/scene/{stage}/{name}'}
            pages += doc['lightmaps']
            if part == 2:
                for key in ('light', 'lightRange', 'lightEncoding'):
                    combined[key] = doc[key]
                height = round(doc['source']['mapSettings']['highlandHeight'], 5)
                combined['tileHeightClasses'] = {'wall': height, 'bench': height}
            gc.collect()
        if len({round(s['mapSettings']['highlandHeight'], 5) for s in combined['sources']}) != 1:
            raise ValueError(f'{stage}: different part heights require explicit per-region height metadata')
        # The cannon is a runtime trap prefab, not part of MapGraphic. Keep its source model and native scale.
        stage_data = json.loads((Path(__file__).resolve().parents[2] / 'data/versions/act3autochess-v3_1/stages.json').read_text())[stage]
        tile_effects = stage_tile_effects(root)
        combined['tileEffects'] = {glyph: tile_effects[info['tileKey']] for glyph, info in stage_data['tiles'].items()
                                   if glyph not in 'SEIO' and info['tileKey'] in tile_effects}
        devices = [d for d in stage_data.get('devices', []) if d['key'] == 'trap_196_cnnon'
                   and d.get('active', not d.get('hidden', False))]
        if devices:
            key = devices[0]['key']
            adapter = StaticDeviceAdapter(key, devices)
            device_id = stage + '_devices'
            # Token pack identity is resolved from the current client's container, not a guessed mesh filename.
            from fx import container_index
            index = container_index(root, ('pkgrps/btl_pfb_tokens_*.ab',), work / 'tokens.json', 1, log)
            if key not in index:
                raise ValueError(f'{stage}: missing fixed device prefab {key}')
            export_scene(device_id, [], root / index[key], root, work, local, log, material_info,
                         source_adapter=adapter, cab_index=cabs)
            folder = work / SCENE_SUB / device_id
            doc = json.loads((folder / 'scene.json').read_text())
            combined['materials'].update(doc['materials'])
            combined['chunks'].extend({**c, 'offset': c['offset'] + len(blob)} for c in doc['chunks'])
            blob.extend((folder / 'scene.bin').read_bytes())
            combined['staticDevices'] = {'prefab': key, 'bundle': index[key], 'positions': adapter.receipt['positions']}
        group = f'{SCENE_SUB}/{stage}'
        folder = out / group
        folder.mkdir(parents=True, exist_ok=True)
        for key, entry in entries.items():
            shutil.copyfile(work / Path(entry['path']).name, folder / Path(entry['path']).name)
        # Shared textures keep the installation's existing groups and exact standard scene/tex URLs.
        tex_dir = out / TEX_SUB
        tex_dir.mkdir(parents=True, exist_ok=True)
        for name, rec in local.get(TEX_SUB, {}).items():
            shutil.copyfile(work / TEX_SUB / Path(rec['path']).name, tex_dir / Path(rec['path']).name)
        combined['chunks'], blob = compact_chunks(combined['chunks'], blob)
        combined.update(lightmaps=pages, binBytes=len(blob))
        (folder / 'scene.bin').write_bytes(blob)
        (folder / 'scene.json').write_text(json.dumps(combined, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        manifest.setdefault(TEX_SUB, {}).update(local.get(TEX_SUB, {}))
        manifest[group] = {**entries, 'scene': {'path': f'/assets/local/{group}/scene.json', 'kind': 'Scene',
                                              'version': SCENE_EXTRACT_VERSION, 'chunks': len(combined['chunks'])},
                           'bin': {'path': f'/assets/local/{group}/scene.bin', 'kind': 'SceneData', 'bytes': len(blob)}}
        log(f'{stage}: composed {len(combined["chunks"])} chunks, {len(blob)} mesh bytes, {pages} baked pages')
        return len(entries) + 2 + len(local.get(TEX_SUB, {}))
