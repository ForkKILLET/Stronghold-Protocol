"""Build an offline, opt-in WebGL2 pixel probe; never change installed game assets."""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path

from PIL import Image


def build_payload(source, companion):
    original = source.read_bytes()
    fixed = companion.read_bytes()
    with Image.open(io.BytesIO(original)) as image:
        rgba = image.convert('RGBA')
    with Image.open(io.BytesIO(fixed)) as image:
        if image.size != rgba.size or image.convert('RGB').tobytes() != rgba.convert('RGB').tobytes():
            raise ValueError('The reference must have exactly the same decoded RGB')
        if image.convert('RGBA').getchannel('A').getextrema() != (255, 255):
            raise ValueError('The reference must be opaque')
    if max(rgba.size) > 4096:
        raise ValueError('Probe supports at most 4096 pixels per side')
    # Bright pixels from several alpha ranges, spread across the real atlas. Keep the
    # familiar floor sample as well. Each LOD0 reference is decoded offline, not via Canvas2D.
    points = []
    for lo, hi in [(0, 0), (1, 31), (32, 127), (128, 254), (255, 255)]:
        matches = [(x, y) for y in range(16, rgba.height, 32) for x in range(16, rgba.width, 32)
                   if lo <= rgba.getpixel((x, y))[3] <= hi and max(rgba.getpixel((x, y))[:3]) >= 80]
        if not matches:
            continue
        for index in sorted({0, len(matches) // 2, len(matches) - 1}):
            x, y = matches[index]
            points.append({'x': x, 'y': y, 'rgba': list(rgba.getpixel((x, y)))})
    if not points or not any(p['rgba'][3] == 0 for p in points):
        raise ValueError('Probe requires bright RGB beneath zero alpha')
    variants = []
    def add(name, data, mime, opaque=False):
        variants.append({'name': name, 'mime': mime, 'opaque': opaque,
                         'sha256': hashlib.sha256(data).hexdigest(),
                         'base64': base64.b64encode(data).decode('ascii')})
    add('original-lossy-rgba', original, 'image/webp')
    for name, fmt in [('lossless-rgba', 'WEBP'), ('png-rgba', 'PNG')]:
        out = io.BytesIO()
        rgba.save(out, fmt, **({'lossless': True, 'exact': True, 'method': 4} if fmt == 'WEBP' else {}))
        data = out.getvalue()
        with Image.open(io.BytesIO(data)) as check:
            if check.convert('RGBA').tobytes() != rgba.tobytes():
                raise ValueError(f'{name} changed pixels')
        add(name, data, 'image/webp' if fmt == 'WEBP' else 'image/png')
    add('fixed-lossless-rgb', fixed, 'image/webp', True)
    return {'format': 'stronghold-snow-alpha-probe', 'version': 1,
            'width': rgba.width, 'height': rgba.height, 'points': points, 'variants': variants}


def write_probe(source, companion, output):
    payload = build_payload(source, companion)
    script = Path(__file__).with_suffix('.mjs').read_text()
    # No external scripts, requests, credentials, game state or service workers.
    html = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob: data:; connect-src 'none'">
<title>雪地贴图像素诊断</title><style>
body{font:16px system-ui;max-width:1000px;margin:32px auto;padding:0 20px;background:#101816;color:#e6eeeb}
button{font:inherit;padding:10px 16px;margin:8px 12px 8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}
</style><h1>雪地贴图像素诊断</h1>
<p>点击后测试内嵌的旧贴图与对照图，读取 WebGL 像素、浏览器版本和可获取的 GPU 信息。
不联网、不读取账号或修改游戏。完成后请保存 JSON；文本可先自行查看。</p>
<button id="run">开始诊断</button><button id="save" disabled>保存诊断 JSON</button>
<pre id="status">尚未运行。Canvas2D 对照允许丢失透明像素颜色，不代表游戏使用了该路径。</pre>
<script id="payload" type="application/json">__PROBE_PAYLOAD__</script>
<script type="module">__PROBE_SCRIPT__</script></html>'''
    html = html.replace('__PROBE_SCRIPT__', script.replace('</script', '<\\/script'))
    html = html.replace('__PROBE_PAYLOAD__', json.dumps(payload, separators=(',', ':')).replace('<', '\\u003c'))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html)
    return {'output': str(output), 'bytes': output.stat().st_size,
            'samples': len(payload['points']), 'variants': len(payload['variants'])}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('public/assets/local/scene/tex/TX_icewild_A.webp'))
    parser.add_argument('--companion', type=Path, default=Path('public/assets/local/scene/tex/TX_icewild_A_opaque_rgb.webp'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(write_probe(args.source, args.companion, args.output), ensure_ascii=False))
