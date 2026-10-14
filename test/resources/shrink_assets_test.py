"""Scoped resource compression tests: no real game art is changed."""
import contextlib
import gzip
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

spec = importlib.util.spec_from_file_location(
    'shrink_assets', Path(__file__).resolve().parents[2] / 'tools/shrink-assets.py')
shrink = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shrink)


class ShrinkAssetsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'source'
        self.root.mkdir()
        shrink.configure(self.root)
        shrink.ASSETS.mkdir(parents=True)
        shrink.DATA.mkdir()
        self.addCleanup(shrink.configure, shrink.REPO)

    def png(self, name, image=None, **kwargs):
        path = shrink.ASSETS / name
        path.parent.mkdir(parents=True, exist_ok=True)
        image = image or Image.new('RGBA', (32, 32), (71, 140, 205, 180))
        image.save(path, 'PNG', compress_level=0, **kwargs)
        return path

    def doc(self, body, local=None):
        doc = {'version': 1, 'hash': shrink.short_hash(body), 'generator': 'fixture',
               'stats': {'files': 99, 'bytes': 99}, **body}
        (shrink.DATA / 'assets.json').write_bytes(shrink.json_bytes(doc))
        if local is not None:
            (shrink.DATA / 'local-assets.json').write_bytes(shrink.json_bytes(local))

    def convert(self):
        return shrink.convert_webp(True, shrink.ORIG)

    def test_original_pngs_and_both_emoticon_trees_remain_reachable(self):
        picture = self.png('ui/picture.png')
        emote = self.png('ui/emoticon/basic/a.png')
        local_emote = self.png('local/emoticon/basic/a.png')
        old = picture.read_bytes()
        self.doc({'ui': {'a': shrink.rel(picture), 'emote': shrink.rel(emote)}},
                 {'groups': {'emoticon/basic': {'a': {'path': shrink.rel(local_emote)}}}})
        self.assertEqual(self.convert()['converted'], 1)
        self.assertEqual(picture.read_bytes(), old)
        shrink.rewrite_manifest(True)
        self.assertFalse(emote.with_suffix('.webp').exists())
        self.assertFalse(local_emote.with_suffix('.webp').exists())
        self.assertEqual(shrink.read_json(shrink.DATA / 'assets.json')['ui']['emote'], shrink.rel(emote))
        self.assertEqual(shrink.read_json(shrink.DATA / 'local-assets.json')['groups']['emoticon/basic']['a']['path'],
                         shrink.rel(local_emote))

    def test_data_maps_cover_original_N_M_E_mask_and_all_lightmap_indices(self):
        for name in ['TX_N.png', 'TX_Transparent_M.png', 'TX_E.png', 'foo_Mask2.png',
                     'TX_SmoothWaves.png', 'lm0.png', 'lm3.png', 'lm12.png']:
            for tree in ['local/map/autochess', 'local/scene/test']:
                self.assertEqual(shrink.policy_for('/assets/' + tree + '/' + name)[0], 'lossless', name)
        self.assertEqual(shrink.policy_for('/assets/local/map/autochess/TX_D.png')[0], 'lossy')
        self.assertEqual(shrink.policy_for('/assets/spine/op/page.png')[0], 'lossless')

    def test_metadata_lossless_beats_old_lossy_flag_and_uses_correct_encoder(self):
        image = Image.new('RGBA', (32, 32), (30, 120, 70, 0))
        image.putpixel((2, 2), (90, 18, 30, 255))
        path = self.png('local/scene/stage/lm4.png', image)
        image.save(path.with_suffix('.webp'), 'WEBP', quality=30)
        old_webp = path.with_suffix('.webp').read_bytes()
        self.doc({'ui': {}}, {'groups': {'scene/stage': {'lm4': {
            'path': shrink.rel(path.with_suffix('.webp')), 'kind': 'Lightmap', 'webp': 'lossy'}}}})
        result = self.convert()
        self.assertEqual(result['lossless'], 1)
        self.assertEqual(shrink.image_rgba(path.with_suffix('.webp')).tobytes(), image.tobytes())
        shrink.rewrite_manifest(True)
        local = shrink.read_json(shrink.DATA / 'local-assets.json')['groups']['scene/stage']['lm4']
        self.assertEqual(local['webp'], 'lossless')
        self.assertEqual(local['hash'], shrink.sha1(path.with_suffix('.webp').read_bytes())[:12])
        backups = list(shrink.ORIG.rglob('*.webp.*'))
        self.assertTrue(any(p.read_bytes() == old_webp for p in backups))
        self.assertEqual(path.read_bytes(), self.png_bytes(image))

    def png_bytes(self, image):
        buf = io.BytesIO()
        image.save(buf, 'PNG', compress_level=0)
        return buf.getvalue()

    def test_rgb_trns_and_palette_alpha_preserved(self):
        rgb = Image.new('RGB', (32, 32), (255, 0, 0))
        self.png('ui/rgb.png', rgb, transparency=(255, 0, 0))
        palette = Image.new('P', (32, 32), 0)
        palette.putpalette([255, 0, 0] + [0, 0, 0] * 255)
        self.png('ui/palette.png', palette, transparency=0)
        self.convert()
        for name in ['rgb', 'palette']:
            self.assertEqual(shrink.image_rgba(shrink.ASSETS / f'ui/{name}.webp').getpixel((0, 0))[3], 0)

    def test_spine_variants_keep_original_atlas_and_manifest_local_names_match(self):
        page = self.png('local/spine/token/x/x.png')
        atlas = page.with_suffix('.atlas')
        atlas.write_text('x.png\nsize: 32,32\npma: true\nregion\n  xy: 0,0\n', encoding='utf-8')
        skeleton = page.with_suffix('.skel')
        skeleton.write_bytes(b'skeleton')
        old_atlas = atlas.read_bytes()
        sl = {'group': 'spine/token/x', 'skel': 'x.skel', 'atlas': 'x.atlas', 'textures': ['x.png']}
        self.doc({'tokens': {'x': {'spineLocal': sl}}}, {'groups': {'spine/token/x': {
            path.name: {'path': shrink.rel(path)} for path in [page, atlas, skeleton]}}})
        self.convert()
        self.assertEqual(shrink.rewrite_atlases(True)['files'], 1)
        shrink.rewrite_manifest(True)
        self.assertEqual(atlas.read_bytes(), old_atlas)
        self.assertTrue(atlas.with_suffix('.webp.atlas').read_text().startswith('x.webp\n'))
        changed = shrink.read_json(shrink.DATA / 'assets.json')['tokens']['x']['spineLocal']
        group = shrink.read_json(shrink.DATA / 'local-assets.json')['groups']['spine/token/x']
        self.assertEqual(changed['atlas'], 'x.webp.atlas')
        self.assertEqual(changed['textures'], ['x.webp'])
        for name in [changed['atlas'], changed['textures'][0], changed['skel']]:
            self.assertTrue(shrink.file_for_url(group[name]['path']).is_file())

    def test_cdn_prefix_and_brackets_stats_hash_and_idempotence(self):
        picture = self.png('ui/[portrait].png')
        font = self.root / 'public/fonts/a.woff2'
        font.parent.mkdir()
        font.write_bytes(b'font')
        self.doc({'ui': {'a': 'https://cdn.example/game/assets/ui/%5Bportrait%5D.png'},
                  'fonts': {'f': '/fonts/a.woff2'}})
        self.convert()
        shrink.rewrite_manifest(True)
        path = shrink.DATA / 'assets.json'
        doc = shrink.read_json(path)
        self.assertEqual(doc['ui']['a'], 'https://cdn.example/game/assets/ui/%5Bportrait%5D.webp')
        self.assertEqual(doc['stats']['files'], 2)
        self.assertEqual(doc['stats']['bytes'], picture.with_suffix('.webp').stat().st_size + 4)
        old, mtime = path.read_bytes(), path.stat().st_mtime_ns
        self.assertEqual(self.convert()['fresh'], 1)
        shrink.rewrite_manifest(True)
        self.assertEqual(path.read_bytes(), old)
        self.assertEqual(path.stat().st_mtime_ns, mtime)

    def test_unverified_existing_webp_never_switches_manifest(self):
        picture = self.png('ui/a.png')
        picture.with_suffix('.webp').write_bytes(b'not webp')
        self.doc({'ui': {'a': shrink.rel(picture)}})
        shrink.rewrite_manifest(True)
        self.assertEqual(shrink.read_json(shrink.DATA / 'assets.json')['ui']['a'], shrink.rel(picture))
        self.assertEqual(self.convert()['converted'], 1)
        shrink.rewrite_manifest(True)
        self.assertTrue(shrink.read_json(shrink.DATA / 'assets.json')['ui']['a'].endswith('.webp'))

    def test_error_exit_stops_later_phases_and_records_report(self):
        (shrink.ASSETS / 'bad.png').write_bytes(b'not png')
        self.doc({'ui': {}})
        before = (shrink.DATA / 'assets.json').read_bytes()
        report = self.root / 'report.json'
        with contextlib.redirect_stdout(io.StringIO()):
            code = shrink.main(['all', '--root', str(self.root), '--apply', '--json', str(report)])
        self.assertEqual(code, 1)
        self.assertNotIn('manifest', shrink.read_json(report))
        self.assertEqual((shrink.DATA / 'assets.json').read_bytes(), before)

    def test_gzip_fallback_is_valid_deterministic_and_repairs_corrupt_sidecar(self):
        path = shrink.ASSETS / 'x.skel'
        path.write_bytes(b'skeleton' * 200)
        with patch.dict(sys.modules, {'brotli': None}):
            shrink.make_br(True)
            sidecar = path.with_name(path.name + '.gz')
            encoded = sidecar.read_bytes()
            self.assertEqual(gzip.decompress(encoded), path.read_bytes())
            self.assertEqual(shrink.make_br(True)['fresh'], 1)
            sidecar.write_bytes(b'corrupt')
            shrink.make_br(True)
            self.assertEqual(sidecar.read_bytes(), encoded)
            with self.assertRaises(ValueError):
                shrink.make_br(True, drop_raw=True)
        self.assertTrue(path.is_file())

    def test_paths_and_unsafe_flags_rejected_before_writes(self):
        for url in ['/assets/../secret.png', '/assets/%2e%2e/secret.png', '/assets/a\\b.png',
                    'file:///assets/x.png']:
            with self.assertRaises(ValueError):
                shrink.file_for_url(url)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(shrink.main(['all', '--root', str(self.root), '--apply', '--drop-raw']), 1)
            self.assertEqual(shrink.main(['webp', '--include-emoticons']), 1)
        self.assertFalse((self.root / shrink.STATE_FILE).exists())

    def test_private_candidate_all_generates_fingerprints_without_modifying_source(self):
        picture = self.png('ui/a.png')
        self.doc({'ui': {'a': shrink.rel(picture)}})
        source_doc = (shrink.DATA / 'assets.json').read_bytes()
        source_image = picture.read_bytes()
        candidate = self.root.parent / 'candidate'
        node = str(shrink.REPO / '.cache/node22-monitoring/node.exe')
        if not Path(node).is_file():
            node = 'node'
        with contextlib.redirect_stdout(io.StringIO()):
            code = shrink.main(['all', '--root', str(self.root), '--output', str(candidate),
                                '--apply', '--node', node])
        self.assertEqual(code, 0)
        self.assertEqual((self.root / 'data/assets.json').read_bytes(), source_doc)
        self.assertEqual(picture.read_bytes(), source_image)
        hashes = shrink.read_json(candidate / 'data/asset-hashes.json')['files']
        self.assertIn('/assets/ui/a.png', hashes)
        self.assertIn('/assets/ui/a.webp', hashes)
        result = subprocess.run([node, str(shrink.REPO / 'tools/asset-hashes.mjs'),
                                 '--root', str(candidate), '--check'], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_audio_is_not_part_of_all_and_repeated_encoding_is_skipped(self):
        path = shrink.ASSETS / 'audio/voice/cn/voice.mp3'
        path.parent.mkdir(parents=True)
        path.write_bytes(b'original')
        with patch.object(shrink, 'probe_audio', return_value={'channels': 1, 'bit_rate': '48000'}), \
                patch.object(shrink.shutil, 'which', return_value='mock-ffmpeg'), \
                patch.object(shrink.subprocess, 'run') as process:
            self.assertEqual(shrink.reencode_audio(True, shrink.ORIG)['already_small'], 1)
            process.assert_not_called()
        self.assertEqual(path.read_bytes(), b'original')

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'Optional ffmpeg/ffprobe not installed')
    def test_real_synthetic_audio_mono_only_keeps_backups_and_is_idempotent(self):
        for directory, channels in [('voice/cn', 1), ('sfx', 2), ('bgm', 1)]:
            path = shrink.ASSETS / f'audio/{directory}/tone.mp3'
            path.parent.mkdir(parents=True)
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                            'sine=frequency=440:duration=1:sample_rate=44100',
                            '-ac', str(channels), '-c:a', 'libmp3lame', '-b:a', '64k', str(path)],
                           check=True, timeout=30)
        mono = shrink.ASSETS / 'audio/voice/cn/tone.mp3'
        stereo = shrink.ASSETS / 'audio/sfx/tone.mp3'
        bgm = shrink.ASSETS / 'audio/bgm/tone.mp3'
        old = [p.read_bytes() for p in (mono, stereo, bgm)]
        dry = shrink.reencode_audio(False, shrink.ORIG)
        self.assertEqual(dry['converted'], 1)
        self.assertEqual([p.read_bytes() for p in (mono, stereo, bgm)], old)
        applied = shrink.reencode_audio(True, shrink.ORIG)
        self.assertEqual(applied['errors'], [])
        self.assertEqual(applied['converted'], 1)
        self.assertEqual(applied['skipped_stereo_or_bgm'], 2)
        self.assertLess(mono.stat().st_size, len(old[0]))
        self.assertEqual(stereo.read_bytes(), old[1])
        self.assertEqual(bgm.read_bytes(), old[2])
        self.assertEqual(shrink.reencode_audio(True, shrink.ORIG)['already_small'], 1)
        self.assertTrue(any(p.read_bytes() == old[0] for p in shrink.ORIG.rglob('tone.mp3.*')))

    def test_report_flag_cannot_overwrite_manifest_on_failure(self):
        self.doc({'ui': {}})
        manifest = shrink.DATA / 'assets.json'
        original = manifest.read_bytes()
        with contextlib.redirect_stdout(io.StringIO()):
            code = shrink.main(['verify', '--root', str(self.root), '--json', str(manifest)])
        self.assertEqual(code, 1)
        self.assertEqual(manifest.read_bytes(), original)

    def test_changed_conversion_after_webp_phase_is_not_endorsed_in_local_manifest(self):
        path = self.png('local/ui/a.png')
        self.doc({'ui': {}}, {'groups': {'ui': {'a': {'path': shrink.rel(path)}}}})
        self.convert()
        shrink.rewrite_manifest(True)
        manifest = shrink.DATA / 'local-assets.json'
        original = manifest.read_bytes()
        path.with_suffix('.webp').write_bytes(b'changed after conversion')
        with self.assertRaises(ValueError):
            shrink.rewrite_manifest(True)
        self.assertEqual(manifest.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
