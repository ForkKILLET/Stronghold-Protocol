"""Offline probe controls must preserve hidden RGB and be self-contained."""
import base64
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

spec = importlib.util.spec_from_file_location('probe', Path(__file__).resolve().parents[2] / 'tools/research/snow-alpha-probe.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class Probe(unittest.TestCase):
    def test_controls_keep_exact_rgb_and_alpha_without_modifying_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            native = Image.new('RGBA', (64, 64), (146, 147, 148, 0))
            native.paste((80, 90, 100, 128), (32, 0, 64, 32))
            native.paste((100, 110, 120, 255), (0, 32, 64, 64))
            source = root / 'original.webp'
            native.save(source, 'WEBP', quality=95, exact=True)
            with Image.open(source) as decoded:
                rgba = decoded.convert('RGBA')
            fixed = root / 'fixed.webp'
            rgba.convert('RGB').save(fixed, 'WEBP', lossless=True)
            digest = hashlib.sha256(source.read_bytes()).digest()
            result = root / 'probe.html'
            probe.write_probe(source, fixed, result)
            html = result.read_text()
            data = html.split('<script id="payload" type="application/json">')[1].split('</script>')[0]
            payload = json.loads(data)
            self.assertEqual(hashlib.sha256(source.read_bytes()).digest(), digest)
            self.assertEqual(len(payload['variants']), 4)
            self.assertTrue(any(p['rgba'][3] == 0 and max(p['rgba'][:3]) > 80 for p in payload['points']))
            for variant in payload['variants']:
                with Image.open(io.BytesIO(base64.b64decode(variant['base64']))) as check:
                    self.assertEqual(check.convert('RGB').tobytes(), rgba.convert('RGB').tobytes())
                    if not variant['opaque']:
                        self.assertEqual(check.convert('RGBA').tobytes(), rgba.tobytes())
            self.assertNotIn('__PROBE_PAYLOAD__', html)
            self.assertNotIn('__PROBE_SCRIPT__', html)
            self.assertIn("connect-src 'none'", html)
            self.assertNotIn('<script src=', html)
            # Never silently accept a visually different control image.
            Image.new('RGB', native.size, 'black').save(fixed)
            with self.assertRaisesRegex(ValueError, 'same decoded RGB'):
                probe.build_payload(source, fixed)


if __name__ == '__main__':
    unittest.main()
